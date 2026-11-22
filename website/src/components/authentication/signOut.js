export const LOCAL_SIGN_OUT_MESSAGE = 'Signed out on this device. We couldn’t confirm sign-out on your other devices.';

export async function signOutAccount(client) {
  if (!client) throw new Error('Sign-out is unavailable. Please try again.');

  let remoteSignedOut = false;
  try {
    const { error } = await client.auth.signOut();
    remoteSignedOut = !error;
  } catch {
    // The SDK can clear the local session even when server revocation fails.
  }

  const { data, error } = await client.auth.getSession();
  if (error || !data || data.session) {
    throw new Error('We couldn’t confirm sign-out on this device. Please try again.');
  }

  return { remoteSignedOut };
}
