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

async function mount(path, signedIn = true) {
  window.history.replaceState(null, '', path);
  globalThis.__checkitRoutingFixture = { signedIn };
  let { code } = await transformWithEsbuild(source, 'App.jsx', { loader: 'jsx', jsx: 'transform' });
  code = code.replace(/(import\s+([\s\S]*?)\s+from\s*)['"]([^'"]+)['"]/g, (match, prefix, clause, specifier) => {
    if (specifier === 'react') return prefix + JSON.stringify(reactUrl);
    if (specifier === 'react-router-dom') return prefix + JSON.stringify(routerUrl);
    let stub;
    if (specifier.includes('SupabaseClients')) {
      stub = `const user={id:'owner',email:'owner@example.test'};
        export default { auth:{
          getSession:async()=>({data:{session:globalThis.__checkitRoutingFixture.signedIn?{user}:null}}),
          getUser:async()=>({data:{user},error:null}),
          onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})
        },from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{role:'admin'},error:null})})};`;
    } else if (specifier.endsWith('.css')) {
      stub = 'export default {};';
    } else if (specifier.includes('authRedirect')) {
      stub = 'export const getSupabaseAuthRedirectPath=()=>null;';
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
  const page = isTransportation ? 'Login' : 'StudentMapPage';
  await until(() => document.querySelector(`[data-page="${page}"]`));
  assert.equal(document.querySelector('[data-page="InsightBuilderPage"]'), null);
});
