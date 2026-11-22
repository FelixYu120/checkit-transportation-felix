export function hasPortalAccess(profile) {
  const role = String(profile?.role || '').trim().toLowerCase().replaceAll(' ', '_');
  if (role === 'checkit_admin') return true;
  return ['viewer', 'user', 'admin', 'field_operator', 'checkit_field_operator'].includes(role)
    && Boolean(String(profile?.assigned_institute || '').trim());
}
