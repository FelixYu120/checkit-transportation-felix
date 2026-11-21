export const PROFILE_PHOTO_BUCKET = 'profile-photos';
export const PROFILE_UPDATED_EVENT = 'checkit:profile-updated';
export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PROFILE_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';

const validPath = (profile) => typeof profile?.avatar_path === 'string'
  && profile.avatar_path.startsWith(`${profile.id}/`)
  && /^[a-f0-9-]{36}\/[a-f0-9-]{36}\.webp$/i.test(profile.avatar_path);

export function validateProfilePhoto(file) {
  if (!file || !PROFILE_PHOTO_ACCEPT.split(',').includes(file.type)) {
    throw new Error('Choose a JPG, PNG, or WebP image.');
  }
  if (!file.size || file.size > PROFILE_PHOTO_MAX_BYTES) {
    throw new Error('Choose an image smaller than 5 MB.');
  }
}

export async function prepareProfilePhoto(file) {
  validateProfilePhoto(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const size = Math.min(image.naturalWidth, image.naturalHeight);
    if (!size) throw new Error('Empty image');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing unavailable');
    context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2,
      size, size, 0, 0, 512, 512);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.88));
    if (!blob || blob.type !== 'image/webp' || blob.size > PROFILE_PHOTO_MAX_BYTES) throw new Error('Image conversion failed');
    return blob;
  } catch {
    throw new Error('This image could not be opened. Choose another JPG, PNG, or WebP.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function withProfilePhotos(client, profiles) {
  const records = profiles.map(profile => ({ ...profile, avatar_url: '' }));
  const paths = [...new Set(records.filter(validPath).map(profile => profile.avatar_path))];
  if (!paths.length) return records;
  try {
    const { data, error } = await client.storage.from(PROFILE_PHOTO_BUCKET).createSignedUrls(paths, 3600);
    if (error) throw error;
    const urls = new Map((data || []).filter(item => !item.error).map(item => [item.path, item.signedUrl]));
    return records.map(profile => ({ ...profile, avatar_url: validPath(profile) ? urls.get(profile.avatar_path) || '' : '' }));
  } catch {
    // Photos are optional; a storage outage must not hide account or team details.
    return records;
  }
}

async function currentUser(client) {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data?.user?.id) throw new Error('Sign in before changing your photo.');
  return data.user;
}

async function clearUnusedPhoto(storage, path) {
  if (!path) return;
  try { await storage.remove([path]); } catch { /* A failed cleanup does not undo a saved profile. */ }
}

export async function uploadProfilePhoto(client, file, { prepare = prepareProfilePhoto } = {}) {
  validateProfilePhoto(file);
  const user = await currentUser(client);
  const blob = await prepare(file);
  const storage = client.storage.from(PROFILE_PHOTO_BUCKET);
  const path = `${user.id}/${crypto.randomUUID()}.webp`;
  const { error: uploadError } = await storage.upload(path, blob, { contentType: 'image/webp', upsert: false, cacheControl: '3600' });
  if (uploadError) throw uploadError;
  let previousPath;
  try {
    const { data, error } = await client.rpc('set_my_profile_photo', { photo_path: path });
    if (error) throw error;
    previousPath = data?.previous_path;
  } catch (error) {
    // A lost RPC response may have committed. Never delete a photo still in use.
    try {
      const result = await client.from('profile').select('avatar_path').eq('id', user.id).maybeSingle();
      if (!result.error && result.data?.avatar_path !== path) await clearUnusedPhoto(storage, path);
    } catch { /* Preserve the upload when its saved state is unknown. */ }
    throw error;
  }
  if (validPath({ id: user.id, avatar_path: previousPath }) && previousPath !== path) await clearUnusedPhoto(storage, previousPath);
  const [profile] = await withProfilePhotos(client, [{ id: user.id, avatar_path: path }]);
  return profile;
}

export async function removeProfilePhoto(client) {
  const user = await currentUser(client);
  const { data, error } = await client.rpc('set_my_profile_photo', { photo_path: null });
  if (error) throw error;
  if (validPath({ id: user.id, avatar_path: data?.previous_path })) {
    await clearUnusedPhoto(client.storage.from(PROFILE_PHOTO_BUCKET), data.previous_path);
  }
  return { id: user.id, avatar_path: null, avatar_url: '' };
}

export function notifyProfileUpdated(profile) {
  window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT, { detail: profile }));
}
