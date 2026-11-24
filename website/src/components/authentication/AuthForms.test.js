import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { transformWithEsbuild } from 'vite';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const fixture = globalThis.__authFormTest = {};
const account = { id: 'signed-in-user', email: 'user@example.test' };
const reset = () => Object.assign(fixture, { failure: null, profileError: null, profileResult: null, setupStatus: {eligible:true,user_id:account.id,remaining_seconds:900}, resetStatus: {eligible:true,user_id:account.id,remaining_seconds:900}, gate: null, sessionError: null, logoutError: null, calls: [], sessionCallback: null, navigations: [], logins: [], initialSession: { user: account }, inviteProfile: { role: 'viewer', assigned_institute: 'fixture-institution' }, loginSession: { access_token: 'fixture-access-token', user: account } });
reset();
fixture.client = {
  rpc: async name => { assert.ok(['invitation_setup_status','password_reset_status'].includes(name)); return {data:name==='password_reset_status'?fixture.resetStatus:fixture.setupStatus,error:null}; },
  auth: {
    getSession: async () => {
      if (fixture.gate) await fixture.gate;
      if (fixture.sessionError) throw fixture.sessionError;
      return { data: { session: fixture.initialSession }, error: null };
    },
    getUser: async () => ({ data: { user: account }, error: null }),
    onAuthStateChange: callback => { fixture.sessionCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    async signOut() { fixture.calls.push({action:'logout'}); fixture.initialSession=null; return {error:fixture.logoutError}; },
    async signInWithPassword(input) { fixture.calls.push({ action: 'login', input }); if (fixture.failure) throw fixture.failure; return { data: { session: fixture.loginSession }, error: null }; },
    async updateUser(input) { fixture.calls.push({ action: 'password', input }); if (fixture.failure) throw fixture.failure; return { data: { user: account }, error: null }; },
    async resetPasswordForEmail(email, options) { fixture.calls.push({ action: 'reset', email, options }); if (fixture.failure) throw fixture.failure; return { error: null }; },
    async signUp() { throw new Error('An invited account must not register again'); },
  },
  from() {
    let updatedName;
    return {
      select() { return this; },
      eq(column, value) { if (updatedName !== undefined) fixture.calls.push({ action: 'profileScope', column, value }); return this; },
      update(input) { updatedName = input.full_name; fixture.calls.push({ action: 'profile', input }); return this; },
      async maybeSingle() { return { data: fixture.inviteProfile, error: null }; },
      async single() { return { data: fixture.profileResult || { id: account.id, full_name: updatedName }, error: fixture.profileError }; },
      async upsert() { throw new Error('Invited profiles must be updated without requesting changes to their ID.'); },
    };
  },
};
const reactUrl = import.meta.resolve('react');
const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function loadComponent(name) {
  const source = await readFile(new URL(`./${name}.jsx`, import.meta.url), 'utf8');
  const transformed = await transformWithEsbuild(source, `${name}.jsx`, { loader: 'jsx', jsx: 'transform' });
  const code = transformed.code.replace(/(^import\s+([\s\S]*?)\s+from\s*)(["'])([^"']+)\3/gm, (_match, prefix, clause, _quote, specifier) => {
    let target;
    if (specifier === 'react') target = reactUrl;
    else if (specifier.endsWith('.css')) target = asModule('export default new Proxy({}, {get: (_, key)=>String(key)});');
    else if (specifier.includes('portalAccess')) target = new URL('../../lib/portalAccess.js', import.meta.url).href;
    else if (specifier === './portalExit.js') target = asModule(`import {finishPasswordSetup as finish, leavePortal as leave} from ${JSON.stringify(new URL('./portalExit.js', import.meta.url).href)};
      export const finishPasswordSetup=client=>finish(client,()=>globalThis.__authFormTest.navigations.push('/login'));
      export const leavePortal=(client,redirect)=>leave(client,redirect||(()=>globalThis.__authFormTest.navigations.push('/login')));`);
    else if (specifier === './authRedirect.js') target = new URL('./authRedirect.js', import.meta.url).href;
    else if (specifier === './signOut.js') target = new URL('./signOut.js', import.meta.url).href;
    else if (specifier === './ProfileModal' || specifier === './ProfileAvatar') target = asModule('export default function ProfileFixture(){ return null; }');
    else if (specifier === './ProfileData.js') target = asModule('export const fetchCurrentProfile=async()=>({profile:{id:"signed-in-user",full_name:"Example User"}});');
    else if (specifier === './ProfilePhoto.js') target = asModule('export const PROFILE_UPDATED_EVENT="profile-fixture-updated";');
    else if (specifier.endsWith('/authentication/signOut.js')) target = new URL('./signOut.js', import.meta.url).href;
    else if (specifier.includes('SupabaseClients')) target = asModule('export default globalThis.__authFormTest.client;');
    else if (specifier === 'react-router-dom') target = asModule(`import React from ${JSON.stringify(reactUrl)}; const navigate=path=>globalThis.__authFormTest.navigations.push(path); export const useNavigate=()=>navigate; export const Link=props=>React.createElement('a',props);`);
    else if (specifier === 'lucide-react') target = asModule(`import React from ${JSON.stringify(reactUrl)};` + clause.match(/\{([\s\S]*?)\}/)[1].split(',').map(name => `export const ${name.trim()}=()=>React.createElement('span',{'aria-hidden':true});`).join('\n'));
    else throw new Error(`Unexpected import ${specifier}`);
    return prefix + JSON.stringify(target);
  });
  return (await import(asModule(code.replaceAll('window.location.replace(', 'globalThis.__authFormTest.navigations.push(')))).default;
}
const Login = await loadComponent('Login');
const ForgotPassword = await loadComponent('ForgotPassword');
const SetPassword = await loadComponent('SetPassword');
const CreateAccount = await loadComponent('CreateAccount');
const ProfileDropdown = await loadComponent('../Header/ProfileDropdown');
const appSource = await readFile(new URL('../../App.jsx', import.meta.url), 'utf8');
const sessionSource = appSource.slice(appSource.indexOf('function AppSession()'), appSource.indexOf('const appRouter ='));
const sessionCode = `import React, {useState,useEffect} from ${JSON.stringify(reactUrl)};
const supabase=globalThis.__authFormTest.client;
const styles={appLayout:'auth-loading'};
const supabaseAuthRedirectPath=null;
const supabaseEmailCallback={hasCallback:false};
const resolveEmailCallback=client=>client.auth.getSession();
const leavePortal=async(_client,redirect)=>redirect();
const getSupabaseAuthRedirectPath=()=>null;
const AppShell=({isLoggedIn})=>React.createElement('div',{'data-authenticated':String(isLoggedIn)});
${sessionSource}
export default AppSession;`;
const sessionTransform = await transformWithEsbuild(sessionCode, 'AppSession.jsx', { loader:'jsx', jsx:'transform' });
const { default: AppSession } = await import(asModule(sessionTransform.code));
const callbackSource = sessionCode.replace('const supabaseAuthRedirectPath=null;', 'const supabaseAuthRedirectPath="/create-account";')
  .replace('const supabaseEmailCallback={hasCallback:false};','const supabaseEmailCallback={hasCallback:true,failureNotice: "invite_invalid"};')
  .replace('window.location.replace(supabaseAuthRedirectPath)', 'globalThis.__authFormTest.callbackRedirects.push(supabaseAuthRedirectPath)');
const callbackTransform = await transformWithEsbuild(callbackSource, 'InviteCallbackSession.jsx', {loader:'jsx',jsx:'transform'});
const {default: InviteCallbackSession} = await import(asModule(callbackTransform.code));
const { createRoot } = await import('react-dom/client');
let root;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; reset(); });
after(() => dom.window.close());
async function mount(Component) {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Component, { setIsLoggedIn: value => fixture.logins.push(value) })));
}
async function enter(selector, value) {
  const input = document.querySelector(selector);
  assert.ok(input, selector);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}
const submit = async () => act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));

test('password-reset failures show an error and allow a successful retry', async () => {
  await mount(ForgotPassword);
  await enter('input[type="email"]', 'user@example.test');
  fixture.failure = new Error('Connection lost');
  await submit();
  assert.match(document.querySelector('[role="alert"]').textContent, /Connection lost/);
  assert.equal(document.querySelector('button[type="submit"]').disabled, false);
  fixture.failure = null;
  await submit();
  assert.match(document.querySelector('.successMessage').textContent, /Check your email/);
});

test('password-save network failures release loading, and signing out disables the expired form', async () => {
  await mount(SetPassword);
  const ids = [...document.querySelectorAll('input[type="password"]')].map(input => `#${input.id}`);
  for (const selector of ids) await enter(selector, 'valid-password-123');
  fixture.failure = new Error('Connection lost');
  await submit();
  assert.match(document.querySelector('[role="alert"]').textContent, /Connection lost/);
  assert.equal(document.querySelector('button[type="submit"]').disabled, false);
  await act(async () => { fixture.sessionCallback('SIGNED_OUT', null); await new Promise(resolve=>setTimeout(resolve,5)); });
  assert.equal(document.querySelector('form'), null);
  assert.equal(fixture.calls.filter(call => call.action === 'password').length, 1);
});

test('signup waits for invitation verification instead of accidentally registering an existing account', async () => {
  let release;
  fixture.gate = new Promise(resolve => { release = resolve; });
  await mount(CreateAccount);
  assert.equal(document.querySelector('form'), null);
  assert.deepEqual(fixture.calls, []);
  await act(async () => release());
  assert.equal(document.querySelector('button[type="submit"]').disabled, false);
});

test('a profile save failure cannot change the password or claim that account setup completed', async () => {
  await mount(CreateAccount);
  await enter('#signup-first-name', 'Example');
  await enter('#signup-last-name', 'User');
  for (const input of document.querySelectorAll('input[type="password"]')) await enter(`#${input.id}`, 'valid-password-123');
  fixture.profileError = { message: 'Profile unavailable' };
  await submit();
  assert.match(document.querySelector('[role="alert"]').textContent, /profile could not be completed/);
  assert.equal(document.querySelector('button[type="submit"]').disabled, false);
  assert.equal(fixture.calls.some(call => call.action === 'password'), false);
  assert.deepEqual(fixture.logins, []);
  assert.deepEqual(fixture.navigations, []);
});

test('a thrown invitation password request leaves setup retryable', async () => {
  await mount(CreateAccount);
  await enter('#signup-first-name', 'Example');
  await enter('#signup-last-name', 'User');
  for (const input of document.querySelectorAll('input[type="password"]')) await enter(`#${input.id}`, 'valid-password-123');
  fixture.failure = new Error('Connection lost');
  await submit();
  assert.match(document.querySelector('[role="alert"]').textContent, /Connection lost/);
  assert.equal(document.querySelector('button[type="submit"]').disabled, false);
  assert.deepEqual(fixture.logins, []);
});


test('a failed initial session lookup opens sign-in instead of leaving a blank loading screen', async () => {
  fixture.sessionError = new Error('Connection lost');
  await mount(AppSession);
  assert.equal(document.querySelector('[data-authenticated]').dataset.authenticated, 'false');
});

test('a late initial session failure cannot undo a newer successful sign-in', async () => {
  let release;
  fixture.gate = new Promise(resolve => { release = resolve; });
  await mount(AppSession);
  await act(async () => fixture.sessionCallback('SIGNED_IN', { user: account }));
  assert.equal(document.querySelector('[data-authenticated]').dataset.authenticated, 'true');
  fixture.sessionError = new Error('Old lookup failed');
  await act(async () => release());
  assert.equal(document.querySelector('[data-authenticated]').dataset.authenticated, 'true');
});

for (const Component of [SetPassword, CreateAccount]) test(`${Component.name} ends the email session and requires credentials on the login page`, async () => {
  await mount(Component);
  if (Component === CreateAccount) {
    await enter('#signup-first-name', 'Example');
    await enter('#signup-last-name', 'User');
  }
  for (const input of document.querySelectorAll('input[type="password"]')) await enter(`#${input.id}`, 'valid-password-123');
  await submit();
  assert.deepEqual(fixture.calls.filter(call=>['password','logout'].includes(call.action)).map(call=>call.action), ['password','logout']);
  assert.deepEqual(fixture.navigations, ['/login']);
  assert.deepEqual(fixture.logins, []);
  assert.equal(fixture.initialSession, null);
});


test('each platform exposes one visible username/password pair with its own autofill section', async () => {
  await mount(Login);
  const product = document.querySelector('.productName').textContent.toLowerCase();
  const username = document.querySelector('input[autocomplete$=" username"]');
  const password = document.querySelector('input[autocomplete$=" current-password"]');
  assert.equal(document.querySelectorAll('input').length, 2);
  assert.equal(username.type, 'email');
  assert.equal(username.name, `checkit-${product}-username`);
  assert.equal(username.autocomplete, `section-checkit-${product} username`);
  assert.equal(password.autocomplete, `section-checkit-${product} current-password`);
  assert.equal(username.closest('form').id, `checkit-${product}-login-form`);
  assert.equal(username.closest('form').getAttribute('action'), `/${product}-login`);
  assert.equal(username.hasAttribute('aria-hidden'), false);
});

test('password-manager autofill without input events submits the actual visible credentials', async () => {
  await mount(Login);
  const username = document.querySelector('input[type="email"]');
  const password = document.querySelector('input[type="password"]');
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  setValue.call(username, 'saved@example.test');
  setValue.call(password, 'saved-password-fixture');
  await submit();
  assert.deepEqual(fixture.calls.find(call => call.action === 'login').input, {
    email: 'saved@example.test', password: 'saved-password-fixture',
  });
  assert.deepEqual(fixture.logins, [true]);
  assert.deepEqual(fixture.navigations, ['/map']);
});

test('old platform-prefixed saved usernames are converted back to a real email', async () => {
  await mount(Login);
  const product = document.querySelector('.productName').textContent.toLowerCase();
  await enter('input[type="email"]', `checkit-${product}:saved@example.test`);
  await enter('input[type="password"]', 'saved-password-fixture');
  assert.equal(document.querySelector('input[type="email"]').value, 'saved@example.test');
  await submit();
  assert.equal(fixture.calls.find(call => call.action === 'login').input.email, 'saved@example.test');
});

test('an unconfirmed sign-in cannot claim success or navigate into the platform', async () => {
  await mount(Login);
  fixture.loginSession = null;
  await enter('input[type="email"]', 'saved@example.test');
  await enter('input[type="password"]', 'saved-password-fixture');
  await submit();
  assert.match(document.querySelector('[role="alert"]').textContent, /could not be confirmed/);
  assert.deepEqual(fixture.logins, []);
  assert.deepEqual(fixture.navigations, []);
  assert.equal(document.querySelector('button[type="submit"]').disabled, false);
});


test('partial logout clearly reports that only this device is signed out', async () => {
  window.history.replaceState(null, '', '/login?signedOut=local');
  try {
    await mount(Login);
    assert.match(document.querySelector('[role="status"]').textContent, /Signed out on this device/);
    assert.match(document.querySelector('[role="status"]').textContent, /couldn’t confirm sign-out on your other devices/);
  } finally {
    window.history.replaceState(null, '', '/');
  }
});


test('signed-out visitors see invitation-only access without a registration form', async () => {
  fixture.initialSession = null;
  await mount(CreateAccount);
  assert.match(document.body.textContent, /Access is by invitation only/);
  assert.equal(document.querySelector('form'), null);
  assert.equal(document.querySelector('input[type="password"]'), null);
  assert.deepEqual(fixture.calls.filter(call=>call.action!=='logout'), []);
});

test('an existing account without membership cannot complete invitation setup', async () => {
  fixture.inviteProfile = null;
  await mount(CreateAccount);
  await enter('#signup-first-name', 'Example');
  await enter('#signup-last-name', 'User');
  for (const input of document.querySelectorAll('input[type="password"]')) await enter(`#${input.id}`, 'valid-password-123');
  await submit();
  assert.match(document.querySelector('[role="alert"]').textContent, /active invitation is required/);
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(fixture.logins, []);
});


test('invitation completion updates only the authenticated profile name before setting the password', async () => {
  await mount(CreateAccount);
  await enter('#signup-first-name', 'Felix');
  await enter('#signup-last-name', 'Example');
  for (const input of document.querySelectorAll('input[type="password"]')) await enter(`#${input.id}`, 'valid-password-123');
  await submit();
  assert.deepEqual(fixture.calls.filter(call => call.action === 'profile'), [{action:'profile',input:{full_name:'Felix Example'}}]);
  assert.deepEqual(fixture.calls.find(call => call.action === 'profileScope'), {action:'profileScope',column:'id',value:account.id});
  assert.equal(fixture.calls.some(call => call.action === 'password'), true);
  assert.deepEqual(fixture.logins, []);
  assert.deepEqual(fixture.navigations, ['/login']);
  assert.equal(fixture.calls.at(-1).action, 'logout');
});

for (const profileResult of [{id:'wrong-user',full_name:'Example User'},{id:account.id,full_name:'Old Name'}]) {
  test(`an unconfirmed name save cannot finish password setup: ${profileResult.id}/${profileResult.full_name}`, async () => {
    fixture.profileResult = profileResult;
    await mount(CreateAccount);
    await enter('#signup-first-name', 'Example');
    await enter('#signup-last-name', 'User');
    for (const input of document.querySelectorAll('input[type="password"]')) await enter(`#${input.id}`, 'valid-password-123');
    await submit();
    assert.match(document.querySelector('[role="alert"]').textContent, /profile update could not be confirmed/);
    assert.equal(fixture.calls.some(call => call.action === 'password'), false);
    assert.deepEqual(fixture.logins, []);
  });
}


for (const reason of ['completed','login_required','expired','invitation_required','open_latest_invitation','revoked']) {
  test(`signup URL denies ${reason} sessions and returns to login`, async () => {
    fixture.setupStatus = {eligible:false,reason,user_id:account.id};
    await mount(CreateAccount);
    assert.equal(document.querySelector('form'), null);
    assert.ok(fixture.navigations.some(path=>path.startsWith('/login')));
  });
}

test('typing the signup URL without an invitation session never renders the form', async () => {
  fixture.initialSession = null;
  await mount(CreateAccount);
  assert.equal(document.querySelector('form'), null);
  assert.ok(fixture.navigations.some(path=>path.startsWith('/login')));
});

test('an invitation that expires before submission cannot save a profile or password', async () => {
  await mount(CreateAccount);
  await enter('#signup-first-name', 'Example');
  await enter('#signup-last-name', 'User');
  for (const input of document.querySelectorAll('input[type="password"]')) await enter(`#${input.id}`, 'valid-password-123');
  fixture.setupStatus = {eligible:false,reason:'expired',user_id:account.id};
  await submit();
  assert.equal(fixture.calls.some(call => ['profile','password'].includes(call.action)), false);
  assert.equal(document.querySelector('form'), null);
  assert.ok(fixture.navigations.some(path=>path.startsWith('/login')));
});


test('an open signup form closes when its invitation deadline arrives', async () => {
  const original = window.setTimeout;
  let expire;
  fixture.setupStatus = {eligible:true,user_id:account.id,remaining_seconds:1};
  window.setTimeout = (callback, delay, ...args) => {
    if (delay === 1000) { expire=callback; return 12345; }
    return original.call(window, callback, delay, ...args);
  };
  try {
    await mount(CreateAccount);
    assert.ok(document.querySelector('form'));
    assert.equal(typeof expire,'function');
    await act(async () => expire());
    assert.equal(document.querySelector('form'),null);
    assert.ok(fixture.navigations.some(path=>path.startsWith('/login')));
  } finally { window.setTimeout=original; }
});


test('an invite callback waits for SDK session persistence before redirecting and showing a shell', async () => {
  let release;
  fixture.gate = new Promise(resolve => {release = resolve;});
  fixture.callbackRedirects = [];
  window.history.replaceState(null, '', '/login');
  try {
    await mount(InviteCallbackSession);
    assert.deepEqual(fixture.callbackRedirects, []);
    await act(async () => fixture.sessionCallback('SIGNED_IN', {user:account}));
    assert.equal(document.querySelector('[data-authenticated]'), null);
    assert.deepEqual(fixture.callbackRedirects, []);
    await act(async () => release());
    assert.deepEqual(fixture.callbackRedirects, ['/create-account']);
    assert.equal(document.querySelector('[data-authenticated]'), null);
  } finally {window.history.replaceState(null, '', '/');}
});


for (const reason of ['expired','used','not_recovery']) test(`password reset rejects ${reason} sessions without a writable form`, async () => {
  fixture.resetStatus={eligible:false,reason};
  await mount(SetPassword);
  assert.equal(document.querySelector('form'), null);
  assert.equal(fixture.calls.some(call=>call.action==='password'), false);
});

test('a reset which expires before submission cannot change the password', async () => {
  await mount(SetPassword);
  for (const input of document.querySelectorAll('input[type="password"]')) await enter(`#${input.id}`, 'valid-password-123');
  fixture.resetStatus={eligible:false};
  await submit();
  assert.equal(document.querySelector('form'), null);
  assert.equal(fixture.calls.some(call=>call.action==='password'),false);
});

test('reset email targets the current platform password-reset route', async () => {
  await mount(ForgotPassword);
  await enter('input[type="email"]','member@example.test');
  await submit();
  assert.deepEqual(fixture.calls.find(call=>call.action==='reset').options, {redirectTo:'https://example.test/reset-password'});
});

test('expired invite errors remain visible on login', async () => {
  window.history.replaceState(null,'','/login?notice=invite_expired');
  try { await mount(Login); assert.match(document.querySelector('[role="alert"]').textContent,/Invite expired/); }
  finally {window.history.replaceState(null,'','/');}
});


test('signup offers no back-to-sign-in link before account setup is completed', async () => {
  await mount(CreateAccount);
  assert.ok(document.querySelector('form'));
  assert.equal(document.querySelector('.backLink'),null);
  assert.equal([...document.querySelectorAll('a')].some(link=>link.getAttribute('to')==='/login'||link.getAttribute('href')==='/login'),false);
  assert.deepEqual(fixture.navigations,[]);
  assert.equal(fixture.calls.some(call=>call.action==='password'||call.action==='profile'),false);
});


test('revealing a password preserves a username and password filled without input events', async () => {
  await mount(Login);
  const username = document.querySelector('input[type="email"]');
  const password = document.querySelector('input[type="password"]');
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  setValue.call(username, 'saved@example.test');
  setValue.call(password, 'saved-password-fixture');
  await act(async () => document.querySelector('[aria-label="Show password"]').click());
  assert.equal(username.value, 'saved@example.test');
  assert.equal(password.type, 'text');
  assert.equal(password.value, 'saved-password-fixture');
  await act(async () => document.querySelector('[aria-label="Hide password"]').click());
  assert.equal(username.value, 'saved@example.test');
  assert.equal(password.type, 'password');
  assert.equal(password.value, 'saved-password-fixture');
  await submit();
  assert.deepEqual(fixture.calls.find(call => call.action === 'login').input, {email:'saved@example.test',password:'saved-password-fixture'});
});

for (const remoteError of [null, new Error('Auth service unavailable')]) test(`sign out returns directly to login after confirmed device cleanup, remote error: ${Boolean(remoteError)}`, async () => {
  fixture.logoutError = remoteError;
  await mount(ProfileDropdown);
  await act(async () => document.querySelector('[aria-label="Profile menu"]').click());
  await act(async () => [...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Sign out').click());
  assert.deepEqual(fixture.navigations, [remoteError ? '/login?signedOut=local' : '/login']);
  assert.equal(fixture.initialSession, null);
  assert.equal(fixture.calls.filter(call=>call.action==='logout').length, 1);
  await act(async () => root.unmount());
  root = null;
  await mount(Login);
  assert.equal(document.querySelector('input[type="email"]').value, '');
  assert.equal(document.querySelector('input[type="password"]').value, '');
});

test('unconfirmed device sign-out stays retryable and never claims the session is gone', async () => {
  fixture.sessionError = new Error('Device storage unavailable');
  await mount(ProfileDropdown);
  await act(async () => document.querySelector('[aria-label="Profile menu"]').click());
  await act(async () => [...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Sign out').click());
  assert.deepEqual(fixture.navigations, []);
  assert.match(document.querySelector('[role="alert"]').textContent, /couldn’t confirm sign-out/);
  assert.ok([...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Sign out'&&!button.disabled));
});


test('reset request reads an email filled by a password manager without input events', async () => {
  await mount(ForgotPassword);
  const email = document.querySelector('input[type="email"]');
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(email, 'saved@example.test');
  await submit();
  assert.equal(fixture.calls.find(call=>call.action==='reset').email, 'saved@example.test');
  assert.match(document.querySelector('[role="status"]').textContent, /Check your email/);
});


test('logout clears an already-open login form and hides its revealed password', async () => {
  await mount(Login);
  await enter('input[type="email"]', 'previous@example.test');
  await enter('input[type="password"]', 'previous-password-fixture');
  await act(async () => document.querySelector('[aria-label="Show password"]').click());
  await act(async () => fixture.sessionCallback?.('SIGNED_OUT', null));
  assert.equal(document.querySelector('input[type="email"]').value, '');
  const password = document.querySelector('input[autocomplete$=" current-password"]');
  assert.equal(password.value, '');
  assert.equal(password.type, 'password');
  assert.equal(document.querySelector('[aria-label="Show password"]').getAttribute('aria-pressed'), 'false');
});

test('leaving and restoring a cached login page cannot restore old form values', async () => {
  await mount(Login);
  await enter('input[type="email"]', 'previous@example.test');
  await enter('input[type="password"]', 'previous-password-fixture');
  await act(async () => document.querySelector('[aria-label="Show password"]').click());
  await act(async () => window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide', {persisted:true})));
  const username = document.querySelector('input[type="email"]');
  const password = document.querySelector('input[autocomplete$=" current-password"]');
  assert.equal(username.value, '');
  assert.equal(password.value, '');
  assert.equal(password.type, 'password');
  // Simulate native restoration without React input events, even with blank state.
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  setValue.call(username, 'restored@example.test');
  setValue.call(password, 'restored-password-fixture');
  password.type = 'text';
  await act(async () => window.dispatchEvent(new dom.window.PageTransitionEvent('pageshow', {persisted:true})));
  assert.equal(username.value, '');
  assert.equal(password.value, '');
  assert.equal(password.type, 'password');
});

test('normal page display and focus preserve optional password-manager autofill', async () => {
  await mount(Login);
  const username = document.querySelector('input[type="email"]');
  const password = document.querySelector('input[type="password"]');
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  setValue.call(username, 'saved@example.test');
  setValue.call(password, 'saved-password-fixture');
  await act(async () => {
    window.dispatchEvent(new dom.window.PageTransitionEvent('pageshow', {persisted:false}));
    window.dispatchEvent(new dom.window.Event('focus'));
  });
  assert.equal(username.value, 'saved@example.test');
  assert.equal(password.value, 'saved-password-fixture');
  assert.equal(username.closest('form').getAttribute('autocomplete'), 'on');
  await submit();
  assert.deepEqual(fixture.calls.find(call=>call.action==='login').input, {email:'saved@example.test',password:'saved-password-fixture'});
});
