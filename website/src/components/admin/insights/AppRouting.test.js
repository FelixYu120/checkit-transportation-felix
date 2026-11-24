import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { JSDOM } from 'jsdom';
import { transformWithEsbuild } from 'vite';
import React, { act } from 'react';

// Exercise the real auth shell and route definitions, without a live account.
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
const { createRoot } = await import('react-dom/client');
const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const reactUrl = import.meta.resolve('react');
const routerUrl = import.meta.resolve('react-router-dom');
const source = await readFile(new URL('../../../App.jsx', import.meta.url), 'utf8');
const isTransportation = source.includes('/dashboard/institute/');
let root;
let router;
let importVersion = 0;

async function mount(path, signedIn = true, profile = { role: 'admin', assigned_institute: 'ucsd' }, options = {}) {
  window.history.replaceState(null, '', path);
  globalThis.__checkitRoutingFixture = { signedIn, profile, listeners: new Set(), user: { id: 'owner', email: 'owner@example.test' }, redirects: [], signOutCalls: [], verifyCalls: [], ...options };
  let { code } = await transformWithEsbuild(source, 'App.jsx', { loader: 'jsx', jsx: 'transform' });
  code = code.replace(/(import\s+([\s\S]*?)\s+from\s*)['"]([^'"]+)['"]/g, (match, prefix, clause, specifier) => {
    if (specifier === 'react') return prefix + JSON.stringify(reactUrl);
    if (specifier === 'react-router-dom') return prefix + JSON.stringify(routerUrl);
    let stub;
    if (specifier.includes('SupabaseClients')) {
      stub = `const fixture=()=>globalThis.__checkitRoutingFixture;
        export default { auth:{
          getSession:async()=>({data:{session:fixture().signedIn?{user:fixture().user}:null}}),
          getUser:async()=>({data:{user:fixture().user},error:null}),
          verifyOtp:async input=>{fixture().verifyCalls.push(input);if(fixture().verifyError)return {data:{session:null},error:fixture().verifyError};fixture().signedIn=true;return {data:{session:{user:fixture().user,access_token:'fixture-callback-token'}}};},
          signOut:async options=>{fixture().signOutCalls.push(options);if(fixture().signOutGate)await fixture().signOutGate;if(fixture().signOutThrows)throw new Error('Logout unavailable');fixture().signedIn=false;return {error:fixture().signOutError||null};},
          onAuthStateChange:callback=>{const listeners=fixture().listeners;listeners.add(callback);return {data:{subscription:{unsubscribe(){listeners.delete(callback)}}}}}
        },rpc:async name=>({data:name==='mfa_access_status'?{user_id:fixture().user.id,ready:fixture().accountReady!==false,required:false,verified:false,enrolled:false,...fixture().mfaStatus}:fixture().accountReady!==false,error:fixture().readinessError||null}),from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>fixture().profileLookup?fixture().profileLookup():({data:fixture().profile,error:fixture().profileError||null})})};`;
    } else if (specifier.includes('portalExit')) {
      const target = new URL('../../authentication/portalExit.js', import.meta.url).href;
      stub = `import {leavePortal as exit,CHECKIT_LANDING_URL,CHECKIT_LOGIN_PATH} from ${JSON.stringify(target)};
        export const redirectToLanding=()=>globalThis.__checkitRoutingFixture.redirects.push(CHECKIT_LANDING_URL);
        export const leavePortal=(client,redirect)=>exit(client,redirect||(()=>globalThis.__checkitRoutingFixture.redirects.push(CHECKIT_LOGIN_PATH)));`;
    } else if (specifier.includes('portalAccess')) {
      return prefix + JSON.stringify(new URL('../../../lib/portalAccess.js', import.meta.url).href);
    } else if (specifier.endsWith('.css')) {
      stub = 'export default {};';
    } else if (specifier.endsWith('/mfa.js')) {
      return prefix + JSON.stringify(new URL('../../authentication/mfa.js', import.meta.url).href);
    } else if (specifier.includes('authRedirect')) {
      return prefix + JSON.stringify(new URL('../../authentication/authRedirect.js', import.meta.url).href);
    } else if (specifier.includes('AdminRouteUtils')) {
      stub = "export const DEFAULT_ADMIN_ROUTE='/dashboard/ucsd';";
    } else {
      const defaultName = clause.trim().split(/[,\s{]/)[0];
      const named = clause.match(/\{([^}]+)\}/)?.[1].split(',').map(value => value.trim()).filter(Boolean) || [];
      const componentNames = [...new Set([defaultName === '' ? null : defaultName, ...named].filter(Boolean))];
      stub = `import React from ${JSON.stringify(reactUrl)};import {Outlet,useParams,useSearchParams,useBlocker} from ${JSON.stringify(routerUrl)};`;
      for (const name of componentNames) {
        const usesBlocker = name === 'InsightBuilderPage';
        stub += `function ${name}(props){${usesBlocker ? 'useBlocker(false);' : ''}const params=useParams();const [search]=useSearchParams();return React.createElement('section',{'data-page':'${name}'},'${name}',JSON.stringify(params),props.type||'',search.get('id')||'',React.createElement(Outlet));}`;
      }
      if (defaultName) stub += `export default ${defaultName};`;
      if (named.length) stub += `export {${named.join(',')}};`;
    }
    return prefix + JSON.stringify(asModule(stub));
  });
  code=code.replaceAll('window.location.replace(', 'globalThis.__checkitRoutingFixture.redirects.push(');
  const app = await import(asModule(code + `\nexport {appRouter};\n// fixture ${++importVersion}`));
  router = app.appRouter;
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(app.default)); });
}

async function until(condition) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  assert.fail('App route did not settle: ' + document.body.textContent);
}

afterEach(async () => { if (root) await act(async () => root.unmount()); router?.dispose(); root = null; router = null; });
after(() => { dom.window.close(); });

test('the public Terms route keeps its public header', async () => {
  await mount('/terms', false);
  await until(() => document.querySelector('[data-page="Terms"]'));
  assert.ok(document.querySelector('[data-page="Header"]'));
  assert.equal(document.querySelector('[data-page="AdminHeader"]'), null);
});

test('protected Insights routes retain their ID, builder mode, and navigation-blocker context', async () => {
  await mount('/insights-studio/comparison?id=report-123');
  await until(() => document.querySelector('[data-page="InsightBuilderPage"]'));
  const builder = document.querySelector('[data-page="InsightBuilderPage"]');
  assert.ok(builder.textContent.includes('comparisonreport-123'));
  assert.ok(document.querySelector('[data-page="AdminHeader"]'));
});

test('nested analytics routes retain their route parameters and parent layout', async () => {
  const path = isTransportation ? '/dashboard/institute/ucsd/area/gilman/corridors/north' : '/dashboard/ucsd/library/2/room-a';
  const page = isTransportation ? 'FloorDashboard' : 'RoomDashboard';
  await mount(path);
  await until(() => document.querySelector(`[data-page="${page}"]`));
  const body = document.body.textContent;
  assert.ok(document.querySelector('[data-page="AdminLayout"]'));
  assert.ok(body.includes('"collegeId":"ucsd"'));
  assert.ok(body.includes(isTransportation ? '"floorId":"north"' : '"roomId":"room-a"'));
});

test('signed-out visitors cannot enter Insights Studio', async () => {
  await mount('/insights-studio/solo', false);
  const page = 'Login';
  await until(() => document.querySelector(`[data-page="${page}"]`));
  assert.equal(document.querySelector('[data-page="InsightBuilderPage"]'), null);
});


for (const profile of [null, { role: 'viewer', assigned_institute: null }, { role: 'admin', assigned_institute: '' }, { role: 'unknown', assigned_institute: 'ucsd' }]) {
  test(`inactive or invalid membership cannot enter protected routes: ${JSON.stringify(profile)}`, async () => {
    await mount('/team', true, profile);
    await until(() => globalThis.__checkitRoutingFixture.redirects.length > 0);
    assert.equal(document.querySelector('[data-page="AdminHeader"]'), null);
    assert.deepEqual(globalThis.__checkitRoutingFixture.redirects, ['/login']);
    assert.equal(document.querySelector('[data-page="TeamPage"]'), null);
  });
}

for (const profile of [{ role: 'viewer', assigned_institute: 'ucsd' }, { role: 'checkit_admin', assigned_institute: null }]) {
  test(`valid institution members and platform administrators retain access: ${profile.role}`, async () => {
    await mount('/team', true, profile);
    await until(() => document.querySelector('[data-page="TeamPage"]'));
  });
}

test('returning to an open tab rechecks membership and removes revoked access', async () => {
  await mount('/team');
  await until(() => document.querySelector('[data-page="TeamPage"]'));
  globalThis.__checkitRoutingFixture.profile = { role: 'viewer', assigned_institute: null };
  await act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
  await until(() => globalThis.__checkitRoutingFixture.redirects.length > 0);
    assert.equal(document.querySelector('[data-page="AdminHeader"]'), null);
    assert.deepEqual(globalThis.__checkitRoutingFixture.redirects, ['/login']);
  assert.equal(document.querySelector('[data-page="TeamPage"]'), null);
});

test('a delayed older membership response cannot restore access after removal', async () => {
  await mount('/team');
  await until(() => document.querySelector('[data-page="TeamPage"]'));
  const fixture = globalThis.__checkitRoutingFixture;
  let release;
  fixture.profileLookup = () => new Promise(resolve => { release = resolve; });
  await act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
  assert.equal(typeof release, 'function');
  fixture.profileLookup = null;
  fixture.profile = null;
  await act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
  await until(() => globalThis.__checkitRoutingFixture.redirects.length > 0);
    assert.equal(document.querySelector('[data-page="AdminHeader"]'), null);
    assert.deepEqual(globalThis.__checkitRoutingFixture.redirects, ['/login']);
  await act(async () => release({ data: { role: 'admin', assigned_institute: 'ucsd' }, error: null }));
  assert.equal(document.querySelector('[data-page="TeamPage"]'), null);
});

test('an account switch cannot reuse the previous account’s protected page', async () => {
  await mount('/team');
  await until(() => document.querySelector('[data-page="TeamPage"]'));
  const fixture = globalThis.__checkitRoutingFixture;
  fixture.profile = null;
  fixture.user = { id: 'different-account', email: 'other@example.test' };
  await act(async () => {
    for (const callback of [...fixture.listeners]) callback('SIGNED_IN', { user: fixture.user });
    await new Promise(resolve => window.setTimeout(resolve, 0));
  });
  await until(() => globalThis.__checkitRoutingFixture.redirects.length > 0);
    assert.equal(document.querySelector('[data-page="AdminHeader"]'), null);
    assert.deepEqual(globalThis.__checkitRoutingFixture.redirects, ['/login']);
  assert.equal(document.querySelector('[data-page="TeamPage"]'), null);
});


test('membership is rechecked periodically while a protected page stays open', async () => {
  const original = window.setInterval;
  let recheck;
  window.setInterval = (callback, delay, ...args) => {
    if (delay === 30000) recheck = callback;
    return original.call(window, callback, delay, ...args);
  };
  try {
    await mount('/team');
    await until(() => document.querySelector('[data-page="TeamPage"]'));
    assert.equal(typeof recheck, 'function');
    globalThis.__checkitRoutingFixture.profile = null;
    await act(async () => recheck());
    await until(() => globalThis.__checkitRoutingFixture.redirects.length > 0);
    assert.equal(document.querySelector('[data-page="AdminHeader"]'), null);
    assert.deepEqual(globalThis.__checkitRoutingFixture.redirects, ['/login']);
    assert.equal(document.querySelector('[data-page="TeamPage"]'), null);
  } finally {
    window.setInterval = original;
  }
});


test('the portal header and pages never mount before membership is verified', async () => {
  let release;
  await mount('/team', true, { role: 'admin', assigned_institute: 'ucsd' }, {
    profileLookup: () => new Promise(resolve => { release = resolve; }),
  });
  assert.equal(document.querySelector('[data-page="AdminHeader"]'), null);
  assert.equal(document.querySelector('[data-page="TeamPage"]'), null);
  await act(async () => release({ data: { role: 'admin', assigned_institute: 'ucsd' }, error: null }));
  await until(() => document.querySelector('[data-page="TeamPage"]'));
  assert.ok(document.querySelector('[data-page="AdminHeader"]'));
});

test('revocation removes the entire portal before waiting for logout', async () => {
  await mount('/team');
  await until(() => document.querySelector('[data-page="TeamPage"]'));
  const fixture = globalThis.__checkitRoutingFixture;
  let release;
  fixture.signOutGate = new Promise(resolve => { release = resolve; });
  fixture.profile = null;
  await act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
  assert.equal(document.querySelector('[data-page="AdminHeader"]'), null);
  assert.equal(document.querySelector('[data-page="TeamPage"]'), null);
  assert.deepEqual(fixture.signOutCalls, [{ scope: 'local' }]);
  assert.deepEqual(fixture.redirects, []);
  // A queued refresh cannot resurrect the portal while sign-out is pending.
  fixture.profile = { role: 'admin', assigned_institute: 'ucsd' };
  await act(async () => window.dispatchEvent(new window.Event('focus')));
  assert.equal(document.querySelector('[data-page="AdminHeader"]'), null);
  assert.equal(document.querySelector('[data-page="TeamPage"]'), null);
  await act(async () => release());
  await until(() => fixture.redirects.length > 0);
  assert.deepEqual(fixture.redirects, ['/login']);
});

test('a logout failure cannot leave a revoked member inside the portal', async () => {
  await mount('/team', true, null, { signOutThrows: true });
  await until(() => globalThis.__checkitRoutingFixture.redirects.length > 0);
  assert.equal(document.querySelector('[data-page="AdminHeader"]'), null);
  assert.equal(document.querySelector('[data-page="TeamPage"]'), null);
});

test('temporary verification failures leave the portal without deleting a valid session', async () => {
  await mount('/team', true, { role: 'admin', assigned_institute: 'ucsd' }, {
    profileError: { message: 'Temporary network failure', status: 503 },
  });
  const fixture = globalThis.__checkitRoutingFixture;
  await until(() => fixture.redirects.length > 0);
  assert.deepEqual(fixture.signOutCalls, []);
  assert.deepEqual(fixture.redirects, ['https://checkit.dev/']);
  assert.equal(document.querySelector('[data-page="AdminHeader"]'), null);
  assert.equal(document.querySelector('[data-page="TeamPage"]'), null);
});

test('a revoked member cannot recover portal content through another protected URL', async () => {
  await mount('/team', true, { role: 'viewer', assigned_institute: null });
  const fixture = globalThis.__checkitRoutingFixture;
  await until(() => fixture.redirects.length > 0);
  await act(async () => router.navigate('/insights-studio/comparison?id=report-123'));
  assert.equal(document.querySelector('[data-page="AdminHeader"]'), null);
  assert.equal(document.querySelector('[data-page="InsightBuilderPage"]'), null);
  assert.equal(document.querySelector('[data-page="TeamPage"]'), null);
});


test('a fresh invitation cannot enter the portal before choosing a password', async () => {
  await mount('/team',true,{role:'viewer',assigned_institute:'ucsd'},{accountReady:false});
  await until(() => window.location.pathname === '/create-account');
  assert.equal(document.querySelector('[data-page="TeamPage"]'), null);
  assert.equal(document.querySelector('[data-page="AdminHeader"]'), null);
  assert.deepEqual(globalThis.__checkitRoutingFixture.signOutCalls, []);
});

test('account setup verification fails closed without rendering the portal', async () => {
  await mount('/team',true,{role:'viewer',assigned_institute:'ucsd'},{readinessError:new Error('Unavailable')});
  await until(() => globalThis.__checkitRoutingFixture.redirects.length > 0);
  assert.equal(document.querySelector('[data-page="TeamPage"]'), null);
  assert.equal(document.querySelector('[data-page="AdminHeader"]'), null);
});


for (const [path,type,target] of [['/signup','invite','/create-account'],['/signup','magiclink','/create-account'],['/reset-password','recovery','/set-password']])test(`${type} email callback verifies once and routes to ${target}`,async()=>{
  await mount(`${path}#token_hash=fixture-hash&type=${type}`,false);
  await until(()=>globalThis.__checkitRoutingFixture.redirects.includes(target));
  assert.deepEqual(globalThis.__checkitRoutingFixture.verifyCalls,[{token_hash:'fixture-hash',type}]);
  assert.equal(document.querySelector('[data-page="AdminHeader"]'),null);
});

test('an expired invitation routes to login with an explicit error and no portal content',async()=>{
  await mount('/signup#token_hash=expired-fixture&type=invite',false,undefined,{verifyError:{code:'otp_expired'}});
  await until(()=>globalThis.__checkitRoutingFixture.redirects.includes('/login?notice=invite_expired'));
  assert.equal(document.querySelector('[data-page="AdminHeader"]'),null);
});


test('password-only admin sessions reach MFA before any portal content or navigation', async()=>{
 await mount('/team',true,{role:'admin',assigned_institute:'ucsd'},{mfaStatus:{required:true,verified:false}});
 await until(()=>document.querySelector('[data-page="MfaPage"]'));
 assert.equal(document.querySelector('[data-page="AdminHeader"]'),null);
 assert.equal(document.querySelector('[data-page="TeamPage"]'),null);
});
