import { qrImage, readMfaStatus } from './mfa.js';

// Invitation sessions may set up MFA, but never enter the portal before password login.
export async function requireInvitedUser(client, expectedId) {
  const identity = await client.auth.getUser();
  if (identity.error) throw identity.error;
  const id = identity.data?.user?.id;
  const invitation = await client.rpc('invitation_setup_status');
  if (invitation.error) throw invitation.error;
  if (!id || (expectedId && expectedId !== id) || invitation.data?.user_id !== id ||
      invitation.data?.eligible !== true || !(Number(invitation.data.remaining_seconds) > 0)) {
    throw new Error('Open a valid invitation to continue.');
  }
  return id;
}

export async function invitedFactors(client, userId) {
  await requireInvitedUser(client, userId);
  const result = await client.auth.mfa.listFactors();
  if (result.error) throw result.error;
  return (result.data?.totp || []).filter(factor => factor.status === 'verified');
}

export async function enrollInvitedAuthenticator(client, userId, product) {
  await requireInvitedUser(client, userId);
  const existing = await client.auth.mfa.listFactors();
  if (existing.error) throw existing.error;
  if ((existing.data?.totp || []).some(factor => factor.status === 'verified')) {
    throw new Error('Verify your existing authenticator.');
  }
  for (const factor of existing.data?.all || []) {
    if (factor.factor_type === 'totp' && factor.status === 'unverified') {
      const removed = await client.auth.mfa.unenroll({ factorId: factor.id });
      if (removed.error) throw removed.error;
    }
  }
  const result = await client.auth.mfa.enroll({
    factorType: 'totp', issuer: `CheckIt ${product}`,
    friendlyName: `CheckIt ${product} ${new Date().toISOString()}`,
  });
  if (result.error) throw result.error;
  await requireInvitedUser(client, userId);
  return { id: result.data.id, image: qrImage(result.data.totp.qr_code), secret: result.data.totp.secret };
}

export async function verifyInvitedAuthenticator(client, userId, factorId, code) {
  if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6-digit code.');
  await requireInvitedUser(client, userId);
  const result = await client.auth.mfa.challengeAndVerify({ factorId, code });
  if (result.error) throw result.error;
  await requireInvitedUser(client, userId);
  const status = await readMfaStatus(client);
  const factors = await invitedFactors(client, userId);
  if (status.user_id !== userId || !status.enrolled || !status.required || !factors.some(factor => factor.id === factorId)) {
    throw new Error('Authenticator setup could not be confirmed.');
  }
  // The Auth verification transaction registers mfa_members. Password-only portal
  // readiness remains false until the person finishes signup and signs in again.
}

export async function cancelInvitedAuthenticator(client, userId, factorId) {
  await requireInvitedUser(client, userId);
  const result = await client.auth.mfa.listFactors();
  if (result.error) throw result.error;
  const factor = (result.data?.all || []).find(item => item.id === factorId);
  if (!factor) return;
  if (factor.status !== 'unverified' || factor.factor_type !== 'totp') {
    throw new Error('Authenticator is enabled. Verify a code to continue.');
  }
  const removed = await client.auth.mfa.unenroll({ factorId });
  if (removed.error) throw removed.error;
}
