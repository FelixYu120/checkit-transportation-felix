export const CHECKIT_LANDING_URL = 'https://checkit.dev/';
export const CHECKIT_LOGIN_PATH = '/login';

export function redirectToLogin(location = window.location) {
  location.replace(CHECKIT_LOGIN_PATH);
}

export function redirectToLanding(location = window.location) {
  location.replace(CHECKIT_LANDING_URL);
}

export function clearPortalCache(storage) {
  try {
    const cache = storage ?? window.sessionStorage;
    for (let index = cache.length - 1; index >= 0; index--) {
      const key = cache.key(index);
      if (key?.startsWith('promi:') || key?.startsWith('promi-v2:')) cache.removeItem(key);
    }
  } catch { /* A blocked browser cache must not prevent leaving the portal. */ }
}

export async function leavePortal(client, redirect = redirectToLogin) {
  clearPortalCache();
  try {
    await client?.auth.signOut({ scope: 'local' });
  } catch { /* Access remains denied even if session cleanup cannot complete. */ }
  finally {
    redirect();
  }
}
