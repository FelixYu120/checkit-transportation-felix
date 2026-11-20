import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTeamInviteUrl } from './TeamInviteUrl.js';

test('unconfigured frontends use the dedicated Transportation invite API, including custom domains', () => {
  for (const value of [undefined, '', '  ']) {
    assert.equal(resolveTeamInviteUrl(value), 'https://checkit-transportation-felix.vercel.app/api/team/invite');
  }
});

for (const base of ['https://api.example.test', ' https://api.example.test/// ', 'https://api.example.test/api', 'https://api.example.test/api/team/invite/', 'https://api.example.test/api/team/invite?old=1#fragment']) {
  test(`invite API override resolves correctly: ${base}`, () => {
    assert.equal(resolveTeamInviteUrl(base), 'https://api.example.test/api/team/invite');
  });
}

test('invite API overrides preserve a proxy prefix', () => {
  assert.equal(resolveTeamInviteUrl('https://api.example.test/transport/'), 'https://api.example.test/transport/api/team/invite');
});

test('invalid invitation service URLs fail before making a request', () => {
  assert.throws(() => resolveTeamInviteUrl('not a URL'), /address is invalid/);
  assert.throws(() => resolveTeamInviteUrl('ftp://api.example.test'), /HTTP or HTTPS/);
});
