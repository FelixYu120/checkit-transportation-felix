import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchInstitutionTeamMembers, removeTeamMember, inviteTeamMember } from "./TeamData.js";

const createTeam = ({ role = "checkit_admin", invitations = [] } = {}) => {
  const profiles = new Map([
    ["manager", { id: "manager", role, assigned_institute: "institute-a", full_name: "Manager" }],
    ["member", { id: "member", role: "viewer", assigned_institute: "institute-a", full_name: "Team Member" }],
    ["removed", { id: "removed", role: "viewer", assigned_institute: null, full_name: "Removed Member" }],
    ["other-institute", { id: "other-institute", role: "viewer", assigned_institute: "institute-b", full_name: "Other Member" }],
  ]);
  const calls = [];
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: "manager" } }, error: null }) },
    from(table) {
      assert.equal(table, "profile");
      const filters = [];
      let single = false;
      const execute = async () => {
        const rows = [...profiles.values()].filter(row => filters.every(filter => filter(row)));
        return { data: single ? rows[0] || null : rows, error: null };
      };
      const query = {
        select() { return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        not(key, operator, value) { assert.equal(operator, "is"); filters.push(row => row[key] !== value); return query; },
        order() { return query; },
        maybeSingle() { single = true; return execute(); },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      return query;
    },
    async rpc(name) {
      calls.push({ name });
      assert.ok(['pending_team_account_removals', 'pending_team_invitations'].includes(name));
      return { data: name === 'pending_team_invitations' ? invitations : [], error: null };
    },
  };
  return { supabase, calls };
};

test("institution admins only load members assigned to their own institution", async () => {
  const { supabase } = createTeam({ role: "admin" });
  assert.deepEqual((await fetchInstitutionTeamMembers(supabase)).members.map(member => member.id), ["manager", "member"]);
});

test("pending cleanups remain visible after reloading so an administrator can retry", async () => {
  const { supabase } = createTeam({ role: "admin" });
  supabase.rpc = async name => {
    if (name === 'pending_team_invitations') return { data: [], error: null };
    assert.equal(name, 'pending_team_account_removals');
    return { data: [{ id: 'pending', role: 'viewer', assigned_institute: null }], error: null };
  };
  const result = await fetchInstitutionTeamMembers(supabase);
  assert.equal(result.members.find(member => member.id === 'pending').removal_pending, true);
});

test('permanent removal sends the signed-in token and requires server confirmation', async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ ok: true, removed: true, memberId: 'member' }));
  };
  await removeTeamMember(inviteClient, 'member');
  assert.match(request.url, /\/api\/team\/remove$/);
  assert.equal(request.options.headers.Authorization, 'Bearer session-token');
  assert.deepEqual(JSON.parse(request.options.body), { memberId: 'member' });
});

for (const payload of [{}, {ok:true}, {ok:true,removed:false,memberId:'member'}, {ok:true,removed:true,memberId:'other'}]) {
  test(`a partial removal response never claims permanent deletion: ${JSON.stringify(payload)}`, async () => {
    globalThis.fetch = async () => new Response(JSON.stringify(payload));
    await assert.rejects(removeTeamMember(inviteClient, 'member'), /Removal could not be confirmed/);
  });
}

test('missing removal deployment does not fall back to membership detachment', async () => {
  globalThis.fetch = async () => new Response('<html>App fallback</html>', {status:404});
  await assert.rejects(removeTeamMember(inviteClient, 'member'), /unavailable/);
});

test('cleanup failures stay visible and retryable', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({error:'Cleanup is incomplete. Retry removal.'}), {status:500});
  await assert.rejects(removeTeamMember(inviteClient, 'member'), /Cleanup is incomplete/);
});

test('signed-out removal never calls the backend', async () => {
  globalThis.fetch = () => { throw new Error('Must not call backend'); };
  await assert.rejects(removeTeamMember({auth:{getSession:async()=>({data:{session:null}})}},'member'), /Sign in/);
});

const inviteClient = { auth: { getSession: async () => ({ data: { session: { access_token: 'session-token' } } }) } };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('invitations send the selected role, signed-in token and normalized email, and require confirmation', async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ ok: true, email: 'new@example.test' }));
  };
  for (const role of ['viewer', 'field_operator', 'admin', 'checkit_field_operator', 'checkit_admin']) {
    assert.equal((await inviteTeamMember(inviteClient, { email: ' NEW@Example.Test ', role })).ok, true);
    assert.equal(request.url, 'https://checkit-transportation-felix.vercel.app/api/team/invite');
    assert.equal(request.options.headers.Authorization, 'Bearer session-token');
    assert.deepEqual(JSON.parse(request.options.body), { email: 'new@example.test', role });
  }
});

for (const body of ['<!doctype html><html>App fallback</html>', '{}', '{"ok":false}', '']) {
  test(`an HTTP 200 response without invitation confirmation is rejected (${body.slice(0, 20) || 'empty'})`, async () => {
    globalThis.fetch = async () => new Response(body);
    await assert.rejects(inviteTeamMember(inviteClient, { email: 'new@example.test', role: 'viewer' }), /could not be confirmed/i);
  });
}

test('invitation errors from the server remain visible', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Email delivery is not configured' }), { status: 503 });
  await assert.rejects(inviteTeamMember(inviteClient, { email: 'new@example.test', role: 'viewer' }), /Email delivery is not configured/);
});

test('signed-out invitations never call the backend', async () => {
  globalThis.fetch = () => { throw new Error('Must not call backend'); };
  await assert.rejects(inviteTeamMember({ auth: { getSession: async () => ({ data: { session: null } }) } }, { email: 'new@example.test', role: 'viewer' }), /Sign in/);
});


test("the directory stays institution-scoped before the photo and department columns exist", async () => {
  const columns = [];
  const queries = [];
  const member = { id: 'legacy-member', role: 'viewer', full_name: 'Legacy Member', assigned_institute: 'institute-a' };
  const supabase = {
    rpc: async () => ({data:[],error:null}),
    auth: { getUser: async () => ({ data: { user: { id: 'manager' } }, error: null }) },
    from() {
      let select;
      let single = false;
      const filters = [];
      const execute = async () => {
        columns.push(select);
        queries.push({ single, filters });
        if (select.includes('department')) return { error: { message: 'column profile.department does not exist' } };
        if (select.includes('avatar_path')) return { error: { message: 'column profile.avatar_path does not exist' } };
        return { data: single ? { id: 'manager', role: 'admin', assigned_institute: 'institute-a' } : [member], error: null };
      };
      const query = {
        select(value) { select = value; return this; },
        eq(key,value) { filters.push([key,value]); return this; },
        order() { return this; },
        maybeSingle() { single = true; return execute(); },
        then(resolve,reject) { return execute().then(resolve,reject); },
      };
      return query;
    },
  };
  const result = await fetchInstitutionTeamMembers(supabase);
  assert.equal(result.members[0].id, member.id);
  assert.equal(result.members[0].avatar_url, '');
  assert.equal(columns.length, 6);
  assert.ok(queries.filter(query => !query.single).every(query => query.filters.some(([key,value]) => key === 'assigned_institute' && value === 'institute-a')));
});


test('pending invitations annotate only returned directory members and preserve their role', async () => {
  const invitation = { id: 'member', invitation_sent_at: '2026-11-23T12:00:00Z', invitation_expires_at: '2026-11-23T12:15:00Z' };
  const { supabase } = createTeam({ role: 'admin', invitations: [invitation, { ...invitation, id: 'not-in-directory' }] });
  const result = await fetchInstitutionTeamMembers(supabase);
  const pending = result.members.find(member => member.id === 'member');
  assert.equal(pending.invitation_pending, true);
  assert.equal(pending.role, 'viewer');
  assert.equal(pending.invitation_expires_at, invitation.invitation_expires_at);
  assert.equal(result.members.find(member => member.id === 'manager').invitation_pending, false);
  assert.equal(result.members.some(member => member.id === 'not-in-directory'), false);
});

test('viewers do not request invitation management metadata', async () => {
  const { supabase, calls } = createTeam({ role: 'viewer' });
  const result = await fetchInstitutionTeamMembers(supabase);
  assert.equal(calls.some(call => call.name === 'pending_team_invitations'), false);
  assert.ok(result.members.every(member => member.invitation_pending === false));
});

test('an invitation status failure never guesses that a completed account needs an invitation', async () => {
  const { supabase } = createTeam();
  supabase.rpc = async name => name === 'pending_team_invitations'
    ? { error: new Error('Invitation status unavailable') }
    : { data: [], error: null };
  await assert.rejects(fetchInstitutionTeamMembers(supabase), /Invitation status unavailable/);
});
