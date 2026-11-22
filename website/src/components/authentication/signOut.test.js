import test from 'node:test';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { signOutAccount } from './signOut.js';
import { leavePortal, redirectToLanding, clearPortalCache, CHECKIT_LANDING_URL } from './portalExit.js';

let nextFixture = 0;
function fixture(fetcher) {
  const storageKey = `checkit-review-${++nextFixture}`;
  const payload = { sub: '00000000-0000-0000-0000-000000000001', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 };
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify(payload)).toString('base64url'), 'fixture-signature'].join('.');
  const stored = new Map([[storageKey, JSON.stringify({ access_token: token, refresh_token: 'fixture-refresh-token', expires_at: payload.exp, expires_in: 3600, token_type: 'bearer', user: { id: payload.sub, email: 'fixture@example.test' } })], ['another-platform-session', 'keep-this-session']]);
  const create = () => createClient('https://fixture.invalid', 'fixture-public-key', {
    auth: { storageKey, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: key => stored.delete(key),
    } },
    global: { fetch: async (url, options) => {
      assert.equal(new URL(url).pathname, '/auth/v1/logout');
      assert.equal(options.method, 'POST');
      return fetcher(url, options);
    } },
  });
  return { create, stored, storageKey };
}

for (const [name, fetcher, remoteSignedOut] of [
  ['successful server logout', () => new Response(null, { status: 204 }), true],
  ['temporary auth-service outage', () => new Response(JSON.stringify({ message: 'Temporary outage' }), { status: 503 }), false],
  ['offline logout', () => { throw new TypeError('Failed to fetch'); }, false],
]) {
  test(`${name} clears this session and cannot restore it after reopening`, async () => {
    const { create, stored, storageKey } = fixture(fetcher);
    const client = create();
    assert.ok((await client.auth.getSession()).data.session);
    assert.deepEqual(await signOutAccount(client), { remoteSignedOut });
    assert.equal((await client.auth.getSession()).data.session, null);
    assert.equal(stored.has(storageKey), false);
    assert.equal(stored.get('another-platform-session'), 'keep-this-session');
    const reopened = create();
    assert.equal((await reopened.auth.getSession()).data.session, null);
    await client.auth.stopAutoRefresh();
    await reopened.auth.stopAutoRefresh();
  });
}

for (const result of [{ data: { session: { user: { id: 'still-signed-in' } } }, error: null }, { data: { session: null }, error: new Error('Storage unavailable') }, { data: null, error: null }]) {
  test(`logout cannot claim success when local cleanup is unconfirmed: ${JSON.stringify(result.data)}`, async () => {
    await assert.rejects(signOutAccount({ auth: { signOut: async () => ({ error: null }), getSession: async () => result } }), /confirm sign-out on this device/);
  });
}

test('an unexpected server error only counts as local logout after confirming the session is gone', async () => {
  assert.deepEqual(await signOutAccount({ auth: {
    signOut: async () => { throw new Error('Server unavailable'); },
    getSession: async () => ({ data: { session: null }, error: null }),
  } }), { remoteSignedOut: false });
});


for (const status of [204, 503]) {
  test(`revoked access clears the local session before leaving the site, logout HTTP ${status}`, async () => {
    const { create, stored, storageKey } = fixture(url => {
      assert.equal(new URL(url).searchParams.get('scope'), 'local');
      return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify({ message: 'Temporary outage' }), { status });
    });
    const client = create();
    let redirected = false;
    await leavePortal(client, () => {
      assert.equal(stored.has(storageKey), false);
      assert.equal(stored.get('another-platform-session'), 'keep-this-session');
      redirected = true;
    });
    assert.equal(redirected, true);
    assert.equal((await create().auth.getSession()).data.session, null);
    await client.auth.stopAutoRefresh();
  });
}

test('leaving the portal replaces the history entry with the CheckIt landing page', () => {
  const targets = [];
  redirectToLanding({ replace: target => targets.push(target) });
  assert.equal(CHECKIT_LANDING_URL, 'https://checkit.dev/');
  assert.deepEqual(targets, ['https://checkit.dev/']);
});

test('revocation clears portal conversation caches and preserves unrelated preferences', () => {
  const keys = ['promi:legacy', 'promi-v2:user:institution:room', 'theme'];
  clearPortalCache({ get length() { return keys.length; }, key: index => keys[index], removeItem: key => keys.splice(keys.indexOf(key), 1) });
  assert.deepEqual(keys, ['theme']);
});
