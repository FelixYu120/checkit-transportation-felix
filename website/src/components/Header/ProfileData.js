export const createProfileView = (user = {}, record = {}) => {
  // The authenticated account owns the identity; profile metadata cannot replace it.
  const data = record?.id && record.id !== user?.id ? {} : (record || {});
  const role = String(data.role || 'viewer').trim().toLowerCase() || 'viewer';
  return {
    id: user?.id || '',
    full_name: data.full_name ?? user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? '',
    email: user?.id ? (String(user.email || '').trim() || String(data.email || '').trim()) : '',
    role: role === 'user' ? 'viewer' : role,
    assigned_area: data.assigned_area || null,
    assigned_building: data.assigned_building || null,
    assigned_floor: data.assigned_floor ?? null,
    assigned_room: data.assigned_room || null,
    area_name: data.areas?.name || (data.assigned_area ? 'Assigned area' : 'None'),
    building_name: data.buildings?.name || (data.assigned_building ? 'Assigned building' : 'None'),
    room_name: data.rooms?.room_name || (data.assigned_room ? 'Assigned room' : 'None'),
  };
};

export const fetchCurrentProfile = async (client, { includeRoom = false } = {}) => {
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  const user = authData?.user;
  if (!user?.id) throw new Error('No signed-in account.');

  const identity = createProfileView(user);
  try {
    const relations = [
      'areas!profile_assigned_area_fkey(name)',
      'buildings!profile_assigned_building_fkey(name)',
      ...(includeRoom ? ['rooms!profile_assigned_room_fkey(room_name)'] : []),
    ];
    let result = await client.from('profile').select(['*', ...relations].join(', '))
      .eq('id', user.id).maybeSingle();

    // Newer installations may not have the legacy location relationships.
    // A failed join must not hide the account's name, role, or email address.
    if (result.error) {
      result = await client.from('profile').select('*').eq('id', user.id).maybeSingle();
    }
    if (result.error) throw result.error;
    return { profile: createProfileView(user, result.data), error: null };
  } catch (error) {
    return { profile: identity, error };
  }
};
