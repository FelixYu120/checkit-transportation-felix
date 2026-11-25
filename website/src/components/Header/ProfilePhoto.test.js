import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProfilePhoto, withProfilePhotos, uploadProfilePhoto, removeProfilePhoto, prepareProfilePhoto, getProfilePhotoCrop } from './ProfilePhoto.js';

const id = '00000000-0000-0000-0000-000000000001';
const otherId = '00000000-0000-0000-0000-000000000002';
const oldPath = `${id}/00000000-0000-0000-0000-000000000010.webp`;
const file = new File(['image'], 'photo.png', { type: 'image/png' });
const blob = new Blob(['webp'], { type: 'image/webp' });

function clientFixture({ rpcError = null, uploadError = null, savedAfterError = null, signingError = null, user = { id } } = {}) {
  const calls = [];
  let uploadedPath;
  const storage = {
    async upload(path, body, options) { uploadedPath = path; calls.push({ action: 'upload', path, body, options }); return { error: uploadError }; },
    async remove(paths) { calls.push({ action: 'delete', paths }); return { error: null }; },
    async createSignedUrls(paths, expiry) { calls.push({ action: 'sign', paths, expiry }); return { data: paths.map(path => ({ path, signedUrl: `https://photos.example/${path}` })), error: signingError }; },
  };
  return {
    calls,
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    storage: { from(bucket) { assert.equal(bucket, 'profile-photos'); return storage; } },
    async rpc(name, args) { calls.push({ action: 'save', name, args }); return { data: { previous_path: oldPath }, error: rpcError }; },
    from(table) {
      assert.equal(table, 'profile');
      return { select() { return this; }, eq(key, value) { assert.equal(key, 'id'); assert.equal(value, id); return this; },
        maybeSingle: async () => ({ data: { avatar_path: savedAfterError === 'uploaded' ? uploadedPath : savedAfterError }, error: null }) };
    },
  };
}

test('photo validation rejects empty files, SVG, fake image extensions, and files above 5 MB', () => {
  assert.doesNotThrow(() => validateProfilePhoto(file));
  for (const candidate of [null, { type: 'image/svg+xml', size: 10 }, { type: 'text/plain', size: 10 }, { type: 'image/png', size: 0 }, { type: 'image/jpeg', size: 5242881 }]) {
    assert.throws(() => validateProfilePhoto(candidate), /Choose/);
  }
});

test('uploads use the authenticated owner, save only the photo RPC, and clean up the old photo after saving', async () => {
  const client = clientFixture();
  const photo = await uploadProfilePhoto(client, file, { prepare: async () => blob });
  assert.equal(photo.id, id);
  assert.match(photo.avatar_path, new RegExp(`^${id}/[a-f0-9-]{36}\\.webp$`));
  assert.equal(photo.avatar_url, `https://photos.example/${photo.avatar_path}`);
  assert.deepEqual(client.calls.map(call => call.action), ['upload', 'save', 'delete', 'sign']);
  assert.deepEqual(client.calls[0].options, { contentType: 'image/webp', upsert: false, cacheControl: '3600' });
  assert.deepEqual(client.calls[1], { action: 'save', name: 'set_my_profile_photo', args: { photo_path: photo.avatar_path } });
  assert.deepEqual(client.calls[2].paths, [oldPath]);
});

test('a failed upload cannot change the profile or delete its current photo', async () => {
  const client = clientFixture({ uploadError: new Error('Upload unavailable') });
  await assert.rejects(uploadProfilePhoto(client, file, { prepare: async () => blob }), /Upload unavailable/);
  assert.deepEqual(client.calls.map(call => call.action), ['upload']);
});

test('a rejected photo save cleans up only the new upload after confirming it is unused', async () => {
  const client = clientFixture({ rpcError: new Error('Save denied') });
  await assert.rejects(uploadProfilePhoto(client, file, { prepare: async () => blob }), /Save denied/);
  assert.deepEqual(client.calls.at(-1).paths, [client.calls[0].path]);
  assert.notEqual(client.calls.at(-1).paths[0], oldPath);
});

test('a lost save response cannot delete a photo that was actually committed', async () => {
  const client = clientFixture({ rpcError: new Error('Network unavailable'), savedAfterError: 'uploaded' });
  await assert.rejects(uploadProfilePhoto(client, file, { prepare: async () => blob }), /Network unavailable/);
  assert.equal(client.calls.some(call => call.action === 'delete'), false);
});

test('removal clears the authenticated profile before deleting its old object', async () => {
  const client = clientFixture();
  assert.deepEqual(await removeProfilePhoto(client), { id, avatar_path: null, avatar_url: '' });
  assert.deepEqual(client.calls.map(call => call.action), ['save', 'delete']);
  assert.deepEqual(client.calls[0].args, { photo_path: null });
});

test('failed removal retains the stored photo', async () => {
  const client = clientFixture({ rpcError: new Error('Removal denied') });
  await assert.rejects(removeProfilePhoto(client), /Removal denied/);
  assert.equal(client.calls.some(call => call.action === 'delete'), false);
});

test('signed-out accounts cannot upload, remove, or access storage', async () => {
  const client = clientFixture({ user: null });
  await assert.rejects(uploadProfilePhoto(client, file), /Sign in/);
  await assert.rejects(removeProfilePhoto(client), /Sign in/);
  assert.deepEqual(client.calls, []);
});

test('directory photos are signed in one batch and paths belonging to a different owner are ignored', async () => {
  const client = clientFixture();
  const profiles = await withProfilePhotos(client, [{ id, avatar_path: oldPath }, { id: otherId, avatar_path: oldPath }, { id: otherId, avatar_path: 'https://untrusted.example/image.png' }]);
  assert.ok(profiles[0].avatar_url);
  assert.equal(profiles[1].avatar_url, '');
  assert.equal(profiles[2].avatar_url, '');
  assert.deepEqual(client.calls[0].paths, [oldPath]);
  assert.equal(client.calls[0].expiry, 3600);
});

test('photo service failures preserve all directory records with initials as fallback', async () => {
  const profiles = await withProfilePhotos(clientFixture({ signingError: new Error('Denied') }), [{ id, avatar_path: oldPath, full_name: 'Example User' }]);
  assert.equal(profiles[0].full_name, 'Example User');
  assert.equal(profiles[0].avatar_url, '');
});

test('browser preprocessing crops to a square WebP and releases its temporary URL', async () => {
  const original = { Image: globalThis.Image, document: globalThis.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const draws = [];
  const revoked = [];
  let canvas;
  try {
    globalThis.Image = class { naturalWidth = 800; naturalHeight = 600; async decode() {} };
    URL.createObjectURL = () => 'blob:temporary-photo';
    URL.revokeObjectURL = url => revoked.push(url);
    globalThis.document = { createElement: () => (canvas = { getContext: () => ({ drawImage: (...args) => draws.push(args) }), toBlob: (callback, type) => { assert.equal(type, 'image/webp'); callback(blob); } }) };
    assert.equal(await prepareProfilePhoto(file), blob);
    assert.equal(canvas.width, 512);
    assert.equal(canvas.height, 512);
    assert.deepEqual(draws[0].slice(1), [100, 0, 600, 600, 0, 0, 512, 512]);
    assert.deepEqual(revoked, ['blob:temporary-photo']);
    await prepareProfilePhoto(file, { zoom: 2, offsetX: 1, offsetY: 0 });
    assert.deepEqual(draws[1].slice(1), [500, 0, 300, 300, 0, 0, 512, 512]);
    globalThis.Image = class { async decode() { throw new Error('Corrupt'); } };
    await assert.rejects(prepareProfilePhoto(file), /could not be opened/);
    assert.equal(revoked.length, 3);
  } finally {
    globalThis.Image = original.Image; globalThis.document = original.document;
    URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke;
  }
});

test('crop geometry preserves a square and clamps zoom and position inside the source image', () => {
  assert.deepEqual(getProfilePhotoCrop(1200, 800, {zoom:2,offsetX:0.25,offsetY:0.75}), {x:200,y:300,size:400});
  const edge=getProfilePhotoCrop(600, 900, {zoom:50,offsetX:-1,offsetY:2});
  assert.deepEqual(edge, {x:0,y:700,size:200});
  assert.deepEqual(getProfilePhotoCrop(800,600,{zoom:NaN,offsetX:NaN,offsetY:NaN}), {x:100,y:0,size:600});
});

test('upload passes the selected crop to preprocessing before storing the picture', async () => {
  const client=clientFixture();
  const crop={zoom:2,offsetX:0.25,offsetY:0.75};
  await uploadProfilePhoto(client,file,{crop,prepare:async(receivedFile,receivedCrop)=>{
    assert.equal(receivedFile,file);assert.deepEqual(receivedCrop,crop);return blob;
  }});
  assert.ok(client.calls.some(call=>call.action==='upload'));
});
