const callbacks = new WeakMap();
const setupPaths = new Set(['/signup', '/create-account']);
const resetPaths = new Set(['/reset-password', '/set-password', '/forgot-password']);

const authenticationPaths = new Set([...setupPaths, ...resetPaths, '/login', '/verify']);

export const isAuthenticationPath = pathname => authenticationPaths.has(String(pathname || '').replace(/\/+$/, '').toLowerCase());

export const EMAIL_LINK_MESSAGES = {
  invite_expired: 'Invite expired. Ask for a new invite.',
  invite_invalid: 'Invite link is invalid. Ask for a new invite.',
  reset_expired: 'Reset link expired. Request a new one.',
  reset_invalid: 'Reset link is invalid. Request a new one.',
};

export function readEmailCallback({pathname = '', search = '', hash = ''} = {}) {
  const path = pathname.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(search);
  for (const [key, value] of new URLSearchParams(hash.replace(/^#/, ''))) params.set(key, value);
  const type = params.get('type');
  const reset = type === 'recovery' || resetPaths.has(path);
  const hasCallback = ['token_hash', 'access_token', 'refresh_token', 'code', 'error', 'error_code', 'error_description'].some(key => params.has(key));
  let redirectPath = null;
  if (type === 'recovery') redirectPath = '/set-password';
  else if (type === 'invite' || (setupPaths.has(path) && hasCallback)) redirectPath = '/create-account';
  else if (['magiclink', 'signup', 'email_change', 'reauthentication'].includes(type)) redirectPath = '/login';
  else if (hasCallback && reset) redirectPath = '/set-password';
  else if (hasCallback) redirectPath = '/create-account';
  const errorCode = params.get('error_code');
  const error = Boolean(params.get('error') || errorCode || params.get('error_description'));
  const failureNotice = `${reset ? 'reset' : 'invite'}_${errorCode === 'otp_expired' ? 'expired' : 'invalid'}`;
  return {hasCallback, redirectPath, type, tokenHash: params.get('token_hash'), accessToken: params.get('access_token'), error, failureNotice};
}

export const getSupabaseAuthRedirectPath = location => readEmailCallback(location).redirectPath;

// StrictMode and multiple subscribers must share one token exchange. A second
// verifyOtp call would consume an already-used token and overwrite its success.
export function resolveEmailCallback(client, callback) {
  if (!callback.hasCallback) return client.auth.getSession();
  const cached = callbacks.get(client);
  if (cached?.callback === callback) return cached.promise;
  const promise = (async () => {
    if (callback.error) throw new Error(callback.failureNotice);
    let result;
    if (callback.tokenHash) {
      if (!['invite', 'magiclink', 'recovery'].includes(callback.type)) throw new Error(callback.failureNotice);
      result = await client.auth.verifyOtp({token_hash: callback.tokenHash, type: callback.type});
    } else {
      // Backward compatibility with existing Supabase confirmation URLs and PKCE.
      result = await client.auth.getSession();
      if (callback.accessToken && result.data?.session?.access_token !== callback.accessToken) throw new Error(callback.failureNotice);
    }
    if (result.error || !result.data?.session?.user?.id) {
      const notice = result.error?.code === 'otp_expired'
        ? callback.failureNotice.replace('_invalid', '_expired') : callback.failureNotice;
      throw new Error(notice);
    }
    return result;
  })();
  callbacks.set(client, {callback, promise});
  return promise;
}
