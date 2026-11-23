// Read the callback before Supabase consumes and clears its URL fragment.
// A resent invitation may use a magic-link token; its explicit setup path
// still takes precedence over the token type.
export const getSupabaseAuthRedirectPath = ({ pathname = '', search = '', hash = '' } = {}) => {
  const path = pathname.replace(/\/+$/, '') || '/';
  const hashParams = new URLSearchParams(String(hash).replace(/^#/, ''));
  const searchParams = new URLSearchParams(search);
  const authType = hashParams.get('type') || searchParams.get('type');
  const hasCallback = searchParams.has('code') || hashParams.has('access_token') || hashParams.has('refresh_token');
  const setupPath = ['/create-account', '/signup'].includes(path);
  const passwordPath = ['/set-password', '/forgot-password'].includes(path);

  if (authType === 'recovery') return '/set-password';
  if (authType === 'invite' || (setupPath && hasCallback)) return '/create-account';
  if (['magiclink', 'signup', 'email_change', 'reauthentication'].includes(authType)) return '/login';
  if (hasCallback && !passwordPath) return '/create-account';
  return null;
};
