import { Buffer } from 'node:buffer';
import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { transformWithEsbuild } from 'vite';

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', { url: 'https://example.test' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const fixture = globalThis.__profilePhotoTest = { calls: [], crops: [], profileWrites: [], userId: 'owner', error: null, gate: null, passwordError: null, passwordCalls: 0 };
const reactUrl = import.meta.resolve('react');
const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const avatarSource = await readFile(new URL('./ProfileAvatar.jsx', import.meta.url), 'utf8');
const avatarCode = (await transformWithEsbuild(avatarSource, 'ProfileAvatar.jsx', { loader: 'jsx', jsx: 'transform' })).code;
const avatarUrl = asModule(avatarCode.replace(/from "react"/g, `from ${JSON.stringify(reactUrl)}`));
const source = await readFile(new URL('./ProfileModal.jsx', import.meta.url), 'utf8');
const transformed = await transformWithEsbuild(source, 'ProfileModal.jsx', { loader: 'jsx', jsx: 'transform' });
const code = transformed.code.replace(/(^import\s+([\s\S]*?)\s+from\s*)(["'])([^"']+)\3/gm, (_match, prefix, clause, _quote, specifier) => {
  let target;
  if (specifier === 'react' || specifier === 'react-dom') target = import.meta.resolve(specifier);
  else if (specifier === '../authentication/MfaPage.jsx') target = asModule(`import React, {useEffect} from ${JSON.stringify(reactUrl)}; export default function MfaFixture(props) { useEffect(()=>{globalThis.__profilePhotoTest.mfa=props;},[props]); return React.createElement('section', {'data-mfa-embedded':String(props.embedded)}, 'Authenticator settings'); }`);
  else if (specifier === './ProfileAvatar') target = avatarUrl;
  else if (specifier === './ProfilePhotoEditor') target = asModule(`import React from ${JSON.stringify(reactUrl)};
    export default function Editor({onSave,onCancel,busy}) {return React.createElement('section',{'aria-label':'Adjust profile photo'},
      React.createElement('button',{type:'button',disabled:busy,onClick:()=>onSave({zoom:2,offsetX:0.25,offsetY:0.75})},'Save photo'),
      React.createElement('button',{type:'button',disabled:busy,onClick:onCancel},'Cancel'));}
  `);
  else if (specifier.endsWith('.css')) target = asModule('export default new Proxy({}, {get: (_, key)=>String(key)});');
  else if (specifier.includes('SupabaseClients')) target = asModule(`
    const fixture=globalThis.__profilePhotoTest;
    export default {
      auth: {
        getUser:async()=>({data:{user:{id:fixture.userId}},error:null}),
        updateUser:async()=>{fixture.passwordCalls++;if(fixture.passwordError)throw fixture.passwordError;return {error:null};}
      },
      from(table){if(table!=='profile')throw new Error('Wrong table');return {
        upsert(){throw new Error('Protected profile columns must not be upserted');},
        update(input){fixture.profileWrites.push(input);return this;},
        eq(column,value){fixture.profileScope={column,value};return this;},
        select(columns){fixture.profileColumns=columns;return this;},
        async single(){return {data:fixture.profileResult||{id:'owner',full_name:fixture.profileWrites.at(-1).full_name},error:fixture.profileSaveError};}
      };}
    };
  `);
  else if (specifier === 'lucide-react') target = asModule(`import React from ${JSON.stringify(reactUrl)};` + clause.match(/\{([\s\S]*?)\}/)[1].split(',').map(name => `export const ${name.trim()}=()=>React.createElement('span',{'aria-hidden':true});`).join('\n'));
  else if (specifier === './ProfileData.js') target = asModule(`
    export const createProfileView=()=>({id:'owner',full_name:'Example User',email:'user@example.test',role:'viewer',avatar_path:'owner/old.webp',avatar_url:'https://photos.example/old.webp'});
    export const fetchCurrentProfile=async()=>({profile:createProfileView(),error:null});
  `);
  else if (specifier === './ProfilePhoto.js') target = asModule(`
    export const PROFILE_PHOTO_ACCEPT='image/jpeg,image/png,image/webp';
    export {validateProfilePhoto} from ${JSON.stringify(new URL('./ProfilePhoto.js',import.meta.url).href)};
    export const uploadProfilePhoto=async(_client,file,options)=>{
      const fixture=globalThis.__profilePhotoTest;fixture.calls.push(file);
      fixture.crops.push(options?.crop);
      if(fixture.gate) await fixture.gate;
      if(fixture.error) throw fixture.error;
      return {id:'owner',avatar_path:'owner/new.webp',avatar_url:'https://photos.example/new.webp'};
    };
    export const removeProfilePhoto=async()=>{
      const fixture=globalThis.__profilePhotoTest;fixture.calls.push('remove');
      if(fixture.error) throw fixture.error;
      return {id:'owner',avatar_path:null,avatar_url:''};
    };
    export const notifyProfileUpdated=profile=>{globalThis.__profilePhotoTest.notification=profile;};
  `);
  else throw new Error(`Unexpected import ${specifier}`);
  return prefix + JSON.stringify(target);
});
const { default: ProfileModal } = await import(asModule(code));
const { default: ProfileAvatar } = await import(avatarUrl);
const { createRoot } = await import('react-dom/client');
let root;
let closed;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  Object.assign(fixture, { calls: [], crops: [], profileWrites: [], profileSaveError: null, profileResult: null, userId: 'owner', error: null, gate: null, passwordError: null, passwordCalls: 0, notification: null });
});
after(() => dom.window.close());
async function mount(mode = 'edit') {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  closed = 0;
  await act(async () => root.render(React.createElement(ProfileModal, { isOpen: true, mode, onClose: () => closed++ })));
  if (mode === 'edit') assert.ok(document.querySelector('[aria-label="Choose profile photo"]'));
}
async function choosePhoto({confirm=true}={}) {
  const input = document.querySelector('input[type="file"]');
  const file = new dom.window.File(['photo'], 'my-photo.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
  if(confirm) await act(async()=>[...document.querySelectorAll('[aria-label="Adjust profile photo"] button')].find(button=>button.textContent==='Save photo').click());
  return file;
}

test('uploading from Profile replaces the preview and notifies other screens', async () => {
  await mount();
  const file = await choosePhoto();
  assert.deepEqual(fixture.calls, [file]);
  assert.equal(document.querySelector('.photoPreview img').src, 'https://photos.example/new.webp');
  assert.equal(document.querySelector('[role="status"]').textContent, 'Photo updated.');
  assert.equal(fixture.notification.avatar_path, 'owner/new.webp');
  assert.equal(closed, 0);
  assert.deepEqual(fixture.crops,[{zoom:2,offsetX:0.25,offsetY:0.75}]);
  assert.doesNotMatch(document.body.textContent,/Photos save immediately/);
});

test('photo-only Save changes closes without writing protected profile fields', async () => {
  await mount();
  await choosePhoto();
  await act(async()=>document.querySelector('.saveBtn').click());
  assert.deepEqual(fixture.profileWrites,[]);
  assert.equal(closed,1);
  assert.equal(document.querySelector('[role="alert"]'),null);
});

const enterName=async value=>act(async()=>{
  const input=document.querySelector('#profile-full-name');
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,value);
  input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
});

test('saving a name updates only full_name on the verified current account', async () => {
  await mount();
  await enterName('  New Name  ');
  await act(async()=>document.querySelector('.saveBtn').click());
  assert.deepEqual(fixture.profileWrites,[{full_name:'New Name'}]);
  assert.deepEqual(fixture.profileScope,{column:'id',value:'owner'});
  assert.equal(fixture.profileColumns,'id,full_name');
  assert.equal(fixture.notification.full_name,'New Name');
  assert.equal(closed,1);
});

test('failed name writes stay open, retain the edit, and permit retry', async () => {
  await mount();
  await enterName('New Name');
  fixture.profileSaveError={message:'permission denied for table profile'};
  await act(async()=>document.querySelector('.saveBtn').click());
  assert.equal(closed,0);
  assert.match(document.querySelector('[role="alert"]').textContent,/Couldn’t save changes/);
  assert.equal(document.querySelector('#profile-full-name').value,'New Name');
  assert.equal(document.querySelector('.saveBtn').disabled,false);
  fixture.profileSaveError=null;
  await act(async()=>document.querySelector('.saveBtn').click());
  assert.equal(closed,1);
});

test('switching accounts while the editor is open cannot update the old profile', async () => {
  await mount();
  await enterName('New Name');
  fixture.userId='another-user';
  await act(async()=>document.querySelector('.saveBtn').click());
  assert.deepEqual(fixture.profileWrites,[]);
  assert.equal(closed,0);
});

test('canceling a crop does not upload or change the saved picture', async () => {
  await mount();
  await choosePhoto({confirm:false});
  assert.deepEqual(fixture.calls,[]);
  await act(async()=>[...document.querySelectorAll('[aria-label="Adjust profile photo"] button')].find(button=>button.textContent==='Cancel').click());
  assert.deepEqual(fixture.calls,[]);
  assert.equal(document.querySelector('.photoPreview img').src,'https://photos.example/old.webp');
  assert.equal(document.querySelector('[aria-label="Adjust profile photo"]'),null);
});

test('upload failures keep the existing photo and show a retryable error', async () => {
  await mount();
  fixture.error = new Error('Upload failed. Try again.');
  await choosePhoto();
  assert.equal(document.querySelector('.photoPreview img').src, 'https://photos.example/old.webp');
  assert.match(document.querySelector('[role="alert"]').textContent, /Upload failed/);
  assert.equal(fixture.notification, null);
});

test('removing a photo restores initials and notifies other screens', async () => {
  await mount();
  await act(async () => document.querySelector('.photoRemove').click());
  assert.equal(document.querySelector('.photoPreview img'), null);
  assert.equal(document.querySelector('.photoPreview').textContent, 'EU');
  assert.equal(fixture.notification.avatar_path, null);
});

test('pending uploads disable duplicate submissions and prevent closing the editor', async () => {
  await mount();
  let release;
  fixture.gate = new Promise(resolve => { release = resolve; });
  await choosePhoto();
  assert.equal(document.querySelector('input[type="file"]').disabled, true);
  assert.equal(document.querySelector('.saveBtn').disabled, true);
  await act(async () => document.querySelector('.modalOverlay').click());
  assert.equal(closed, 0);
  await act(async () => { release(); });
  assert.equal(document.querySelector('input[type="file"]').disabled, false);
});

test('broken images fall back to initials and a new photo can render afterwards', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  const profile = { full_name: 'Example User', avatar_url: 'https://photos.example/broken.webp' };
  await act(async () => root.render(React.createElement(ProfileAvatar, { profile })));
  await act(async () => document.querySelector('img').dispatchEvent(new dom.window.Event('error')));
  assert.equal(document.querySelector('#root span').textContent, 'EU');
  await act(async () => root.render(React.createElement(ProfileAvatar, { profile: { ...profile, avatar_url: 'https://photos.example/new.webp' } })));
  assert.equal(document.querySelector('img').src, 'https://photos.example/new.webp');
});


test('a thrown password request shows an error, unlocks the editor, and permits retry', async () => {
  await mount('password');
  fixture.passwordError = new Error('Connection lost');
  const inputs = [...document.querySelectorAll('input[type="password"]')];
  await act(async () => {
    for (const input of inputs) {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'valid-password-123');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    }
  });
  await act(async () => document.querySelector('.saveBtn').click());
  assert.match(document.querySelector('.errorMessage').textContent, /Connection lost/);
  assert.equal(document.querySelector('.saveBtn').disabled, false);
  assert.equal(document.querySelector('[aria-label="Close profile"]').disabled, false);
  fixture.passwordError = null;
  await act(async () => document.querySelector('.saveBtn').click());
  assert.equal(fixture.passwordCalls, 2);
  assert.match(document.querySelector('.successMessage').textContent, /Password updated/);
});


test('authenticator settings stay in the profile dialog and prevent closing while verifying', async () => {
  await mount();
  await act(async () => [...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Two-step').click());
  assert.equal(document.querySelector('[data-mfa-embedded="true"]').closest('[role="dialog"]')!==null, true);
  await act(async () => fixture.mfa.onBusyChange(true));
  assert.equal(document.querySelector('[aria-label="Close profile"]').disabled,true);
  await act(async () => document.querySelector('.modalOverlay').click());
  assert.equal(closed,0);
  await act(async () => fixture.mfa.onBusyChange(false));
  await act(async () => document.querySelector('.settingsNav [aria-label="Profile"]').click());
  assert.ok(document.querySelector('[aria-label="Choose profile photo"]'));
  await act(async () => document.querySelector('.modalOverlay').click());
  assert.equal(closed,1);
});

test('leaving password settings clears unsaved credentials within the unified dialog', async () => {
  await mount();
  const changePassword=()=>[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Password').click();
  await act(async () => changePassword());
  await act(async () => {
    const input=document.querySelector('input[type="password"]');
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,'unsaved-secret');
    input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  });
  await act(async () => document.querySelector('.settingsNav [aria-label="Profile"]').click());
  await act(async () => changePassword());
  assert.equal(document.querySelector('input[type="password"]').value,'');
});
