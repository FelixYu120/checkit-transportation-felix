import test from 'node:test';
import assert from 'node:assert/strict';
import { requireInvitedUser, enrollInvitedAuthenticator, verifyInvitedAuthenticator, cancelInvitedAuthenticator } from './signupMfa.js';

function fixture() {
  const state = { id: 'invitee', eligible: true, enrolled: true, required: true, calls: [], factors: [], expiredDuringVerify: false };
  const client = {
    rpc: async name => ({ data: name === 'invitation_setup_status'
      ? { user_id: state.id, eligible: state.eligible, remaining_seconds: 900 }
      : { user_id: state.id, ready: false, enrolled: state.enrolled, required: state.required, verified: false } }),
    auth: {
      getUser: async () => ({ data: { user: { id: state.id } } }),
      mfa: {
        listFactors: async () => ({ data: { all: state.factors, totp: state.factors } }),
        challengeAndVerify: async () => { state.calls.push('verify'); if (state.expiredDuringVerify) state.eligible = false; return {}; },
        enroll: async () => { state.calls.push('enroll'); return { data: { id: 'new', totp: { qr_code: '<svg></svg>', secret: 'SYNTHETIC' } } }; },
        unenroll: async ({ factorId }) => { state.calls.push(factorId); return {}; },
      },
    },
  };
  return { state, client };
}

test('signup MFA cannot operate on another account or an expired/completed invitation', async () => {
  const { state, client } = fixture();
  await assert.rejects(requireInvitedUser(client, 'another-account'), /valid invitation/);
  state.eligible = false;
  await assert.rejects(enrollInvitedAuthenticator(client, 'invitee', 'Transportation'), /valid invitation/);
  await assert.rejects(verifyInvitedAuthenticator(client, 'invitee', 'factor', '123456'), /valid invitation/);
  assert.deepEqual(state.calls, []);
});

test('a verified signup factor cannot be removed by cancel or replaced by optional enrollment', async () => {
  const { state, client } = fixture();
  state.factors = [{ id: 'verified', factor_type: 'totp', status: 'verified' }];
  await assert.rejects(cancelInvitedAuthenticator(client, 'invitee', 'verified'), /enabled/);
  await assert.rejects(enrollInvitedAuthenticator(client, 'invitee', 'Transportation'), /existing authenticator/);
  assert.deepEqual(state.calls, []);
});

test('signup accepts authenticator verification only when the factor and server policy agree', async () => {
  const { state, client } = fixture();
  state.factors = [{ id: 'factor', factor_type: 'totp', status: 'verified' }];
  state.required = false;
  await assert.rejects(verifyInvitedAuthenticator(client, 'invitee', 'factor', '123456'), /could not be confirmed/);
  state.required = true; state.enrolled = false;
  await assert.rejects(verifyInvitedAuthenticator(client, 'invitee', 'factor', '123456'), /could not be confirmed/);
  state.enrolled = true;
  await verifyInvitedAuthenticator(client, 'invitee', 'factor', '123456');
  state.expiredDuringVerify = true;
  await assert.rejects(verifyInvitedAuthenticator(client, 'invitee', 'factor', '123456'), /valid invitation/);
});

test('malformed signup codes never reach the challenge service', async () => {
  const { state, client } = fixture();
  await assert.rejects(verifyInvitedAuthenticator(client, 'invitee', 'factor', '123'), /6-digit/);
  assert.deepEqual(state.calls, []);
});
