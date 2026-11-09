import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileView, fetchCurrentProfile } from './ProfileData.js';

const account = {
  id: 'signed-in-account', email: 'current@example.test',
  user_metadata: { full_name: 'Current User' },
};

function mockClient({ user = account, authError = null, responses = [] } = {}) {
  const queries = [];
  const pending = [...responses];
  return {
    queries,
    auth: { getUser: async () => ({ data: { user }, error: authError }) },
    from(table) {
      const query = { table, filters: [] };
      queries.push(query);
      return {
        select(columns) { query.columns = columns; return this; },
        eq(column, value) { query.filters.push([column, value]); return this; },
        async maybeSingle() {
          const response = pending.shift() || { data: null, error: null };
          if (response instanceof Error) throw response;
          return response;
        },
      };
    },
  };
}

test('the signed-in account supplies the current email instead of a stale profile copy', async () => {
  const client = mockClient({ responses: [{ data: {
    id: account.id, full_name: 'Saved Name', email: 'stale@example.test', role: 'admin',
    last_logged_in: '2020-01-01T00:00:00Z',
  }, error: null }] });
  const { profile, error } = await fetchCurrentProfile(client);
  assert.equal(error, null);
  assert.equal(profile.email, account.email);
  assert.equal(profile.full_name, 'Saved Name');
  assert.equal(profile.role, 'admin');
  assert.equal('last_logged_in' in profile, false);
  assert.deepEqual(client.queries[0].filters, [['id', account.id]]);
});

test('missing legacy location relationships fall back to the base profile row', async () => {
  const client = mockClient({ responses: [
    { data: null, error: { code: 'PGRST200', message: 'Relationship is missing' } },
    { data: { id: account.id, full_name: 'Saved Name', role: 'user', assigned_area: 'area-1' }, error: null },
  ] });
  const { profile, error } = await fetchCurrentProfile(client);
  assert.equal(error, null);
  assert.equal(profile.email, account.email);
  assert.equal(profile.full_name, 'Saved Name');
  assert.equal(profile.role, 'viewer');
  assert.equal(profile.assigned_area, 'area-1');
  assert.equal(client.queries.length, 2);
  assert.equal(client.queries[1].columns, '*');
  assert.ok(client.queries.every((query) => query.table === 'profile'));
  assert.ok(client.queries.every((query) => query.filters[0][1] === account.id));
});

test('a profile lookup failure preserves authenticated identity and reports incomplete details', async () => {
  const denied = { message: 'Profile unavailable' };
  const client = mockClient({ responses: [
    { data: null, error: denied }, { data: null, error: denied },
  ] });
  const { profile, error } = await fetchCurrentProfile(client);
  assert.equal(profile.id, account.id);
  assert.equal(profile.email, account.email);
  assert.equal(profile.full_name, 'Current User');
  assert.equal(error, denied);
});

test('a thrown metadata request error also preserves the account email', async () => {
  const failure = new Error('Network unavailable');
  const { profile, error } = await fetchCurrentProfile(mockClient({ responses: [failure] }));
  assert.equal(profile.email, account.email);
  assert.equal(error, failure);
});

test('accounts without a profile row still display their authenticated email', async () => {
  const { profile, error } = await fetchCurrentProfile(mockClient());
  assert.equal(error, null);
  assert.equal(profile.email, account.email);
  assert.equal(profile.id, account.id);
});

test('a matching profile email is used when the auth provider has no email', async () => {
  const client = mockClient({ user: { id: account.id }, responses: [{
    data: { id: account.id, email: 'profile@example.test' }, error: null,
  }] });
  const { profile } = await fetchCurrentProfile(client);
  assert.equal(profile.email, 'profile@example.test');
  const mismatched = createProfileView({ id: account.id }, {
    id: 'another-account', email: 'other@example.test', role: 'checkit_admin',
  });
  assert.equal(mismatched.email, '');
  assert.equal(mismatched.role, 'viewer');
});

test('room labels are retained for Occupancy without changing the Transportation query', async () => {
  const client = mockClient({ responses: [{ data: {
    id: account.id, assigned_room: 'room-1', rooms: { room_name: 'Study Room' },
  }, error: null }] });
  const { profile } = await fetchCurrentProfile(client, { includeRoom: true });
  assert.equal(profile.room_name, 'Study Room');
  assert.ok(client.queries[0].columns.includes('rooms!profile_assigned_room_fkey'));
  const traffic = mockClient();
  await fetchCurrentProfile(traffic);
  assert.equal(traffic.queries[0].columns.includes('rooms!'), false);
});

test('authentication must succeed before querying profile records', async () => {
  const missing = mockClient({ user: null });
  await assert.rejects(fetchCurrentProfile(missing), /No signed-in account/);
  assert.equal(missing.queries.length, 0);
  const invalid = mockClient({ authError: new Error('Session expired') });
  await assert.rejects(fetchCurrentProfile(invalid), /Session expired/);
  assert.equal(invalid.queries.length, 0);
});
