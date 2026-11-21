import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchInstitutionTeamMembers, removeTeamMember, inviteTeamMember } from "./TeamData.js";

const createTeam = ({ removal = "detach", role = "checkit_admin" } = {}) => {
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
    async rpc(name, args) {
      calls.push({ name, args });
      const member = profiles.get(args.target_profile_id);
      if (removal === "denied") return { data: null, error: new Error("Only admins can remove team members.") };
      if (removal === "delete") profiles.delete(args.target_profile_id);
      if (removal === "detach" && member) profiles.set(member.id, { ...member, assigned_institute: null });
      return { data: null, error: null };
    },
  };
  return { supabase, calls };
};

test("removed members stay out of the admin directory after a reload", async () => {
  const { supabase } = createTeam();
  assert.equal((await fetchInstitutionTeamMembers(supabase)).members.some(member => member.id === "removed"), false);
  await removeTeamMember(supabase, "member");
  assert.equal((await fetchInstitutionTeamMembers(supabase)).members.some(member => member.id === "member"), false);
});

test("institution admins only load members assigned to their own institution", async () => {
  const { supabase } = createTeam({ role: "admin" });
  assert.deepEqual((await fetchInstitutionTeamMembers(supabase)).members.map(member => member.id), ["manager", "member"]);
});

for (const removal of ["detach", "delete"]) test(`removal confirms the saved membership when the server uses ${removal}`, async () => {
  const { supabase, calls } = createTeam({ removal });
  await removeTeamMember(supabase, "member");
  assert.deepEqual(calls, [{ name: "remove_team_member", args: { target_profile_id: "member" } }]);
});

test("a successful RPC response that leaves membership unchanged is not reported as removal", async () => {
  const { supabase } = createTeam({ removal: "noop" });
  await assert.rejects(removeTeamMember(supabase, "member"), /still.*team|not.*removed/i);
});

test("backend permission failures remain visible", async () => {
  const { supabase } = createTeam({ removal: "denied" });
  await assert.rejects(removeTeamMember(supabase, "member"), /Only admins/);
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
