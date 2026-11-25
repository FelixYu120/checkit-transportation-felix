import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { transformWithEsbuild } from 'vite';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://portal.example.test', pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
const fixture = globalThis.__portalLayoutTest = { desktop: true, mapMounts: 0, workspaceWidth: 900, workspaceLeft: 280 };
window.matchMedia = () => ({ matches: fixture.desktop });
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
  const left = this.className === 'workspace-shell' ? fixture.workspaceLeft : 24;
  const width = this.className === 'workspace-shell' ? fixture.workspaceWidth : 1200;
  return { left, right: left + width, width, top: 64, bottom: 864, height: 800 };
};
const reactUrl = import.meta.resolve('react');
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const cssUrl = moduleUrl('export default new Proxy({}, {get:(_,key)=>String(key)});');
const hookCode = (await readFile(new URL('./usePortalPanels.js', import.meta.url), 'utf8')).replace("from 'react'", `from ${JSON.stringify(reactUrl)}`);
const hookUrl = moduleUrl(hookCode);
const divider = await transformWithEsbuild(await readFile(new URL('./PanelDivider.jsx', import.meta.url), 'utf8'), 'PanelDivider.jsx', { loader: 'jsx', jsx: 'transform' });
const dividerUrl = moduleUrl(divider.code.replace(/from "react"/g, `from ${JSON.stringify(reactUrl)}`)
  .replace(/from "lucide-react"/g, `from ${JSON.stringify(import.meta.resolve('lucide-react'))}`)
  .replace(/from "\.\/AdminLayout.module.css"/g, `from ${JSON.stringify(cssUrl)}`));
const source = await readFile(new URL('./AdminLayout.jsx', import.meta.url), 'utf8');
const storageKey = source.match(/usePortalPanels\('([^']+)'\)/)[1];
const transformed = await transformWithEsbuild(source, 'AdminLayout.jsx', { loader: 'jsx', jsx: 'transform' });
const code = transformed.code.replace(/(^import\s+([\s\S]*?)\s+from\s*)(["'])([^"']+)\3/gm, (_match, prefix, clause, _quote, specifier) => {
  let target;
  if (specifier === 'react') target = reactUrl;
  else if (specifier.endsWith('.css')) target = cssUrl;
  else if (specifier === './usePortalPanels') target = hookUrl;
  else if (specifier === './PanelDivider') target = dividerUrl;
  else if (specifier === 'react-router-dom') target = moduleUrl(`import React from ${JSON.stringify(reactUrl)};
    export const useParams=()=>({floorId:'corridor-a'});
    export const useLocation=()=>({pathname:'/admin/institution'});
    export function Outlet({context}) {globalThis.__portalLayoutTest.outletContext=context;return React.createElement('div',{'data-analytics':true},'Analytics');}`);
  else if (specifier === '../navigation/Sidebar') target = moduleUrl(`import React,{useState} from ${JSON.stringify(reactUrl)};
    export default function Sidebar(){const [selected,setSelected]=useState(false);return React.createElement('button',{'data-tree-choice':true,onClick:()=>setSelected(true)},selected?'Selected building':'Choose building');}`);
  else if (specifier === '../../maps/EsriMap') target = moduleUrl(`import React,{useEffect} from ${JSON.stringify(reactUrl)};
    export default function EsriMap(props){useEffect(()=>{globalThis.__portalLayoutTest.mapMounts++;},[]);return React.createElement('div',{'data-map':true,'data-focused-sensor':props.focusedSensorId});}`);
  else if (specifier === '../ai/PromiSidebar') target = moduleUrl('export default ()=>null;');
  else if (specifier === 'lucide-react') {
    const names = clause.match(/\{([^}]+)\}/)[1].split(',').map(name => name.trim());
    target = moduleUrl(`import React from ${JSON.stringify(reactUrl)};` + names.map(name => `export const ${name}=()=>React.createElement('span',{'aria-hidden':true});`).join('\n'));
  } else throw new Error(`Unexpected import: ${specifier}`);
  return prefix + JSON.stringify(target);
});
const { default: AdminLayout } = await import(moduleUrl(code));
const { createRoot } = await import('react-dom/client');
let root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  window.localStorage.clear();
  Object.assign(fixture, { desktop: true, mapMounts: 0, workspaceWidth: 900, workspaceLeft: 280 });
});
after(() => dom.window.close());
const mount = async () => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(AdminLayout)));
  await act(async () => { await new Promise(resolve => window.requestAnimationFrame(resolve)); });
};
const find = label => document.querySelector(`[aria-label="${label}"]`);
const pointer = async (target, type, clientX, pointerId = 1) => act(async () => {
  const event = new window.MouseEvent(type, { bubbles: true, clientX, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  target.dispatchEvent(event);
  if (type === 'pointermove') await new Promise(resolve => window.requestAnimationFrame(resolve));
});
const key = async (target, value, shiftKey = false) => act(async () => target.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })));
const saved = () => JSON.parse(window.localStorage.getItem(storageKey));

test('collapsing and reopening navigation preserves tree selection and the mounted map', async () => {
  await mount();
  const tree = document.querySelector('[data-tree-choice]');
  const map = document.querySelector('[data-map]');
  await act(async () => tree.click());
  await act(async () => find('Collapse tree menu').click());
  assert.equal(document.querySelector('.sidebar-rail').dataset.collapsed, 'true');
  assert.equal(find('Expand tree menu').getAttribute('aria-expanded'), 'false');
  assert.equal(find('Resize navigation'), null);
  assert.equal(document.querySelector('#portal-navigation').hasAttribute('inert'), true);
  assert.equal(saved().sidebarCollapsed, true);
  await act(async () => find('Expand tree menu').click());
  assert.equal(document.querySelector('[data-tree-choice]'), tree);
  assert.equal(tree.textContent, 'Selected building');
  assert.equal(find('Resize navigation'), null);
  assert.equal(document.querySelector('#portal-navigation').hasAttribute('inert'), false);
  assert.equal(document.querySelector('[data-map]'), map);
  assert.equal(fixture.mapMounts, 1);
});

test('dragging the data/map divider uses workspace coordinates, saves the width, and keeps the map alive', async () => {
  await mount();
  const divider = find('Resize data and map');
  const map = document.querySelector('[data-map]');
  await pointer(divider, 'pointerdown', 800);
  const clientX = fixture.workspaceLeft + 6 + (fixture.workspaceWidth - 12) * 0.55;
  await pointer(window, 'pointermove', clientX, 2);
  assert.equal(divider.getAttribute('aria-valuenow'), '63');
  await pointer(window, 'pointermove', clientX);
  assert.equal(divider.getAttribute('aria-valuenow'), '55');
  assert.equal(document.body.style.cursor, 'col-resize');
  await pointer(window, 'pointerup', clientX);
  assert.ok(Math.abs(saved().dataShare - 0.55) < 0.001);
  assert.equal(document.body.style.cursor, '');
  assert.equal(document.querySelector('[data-map]'), map);
  assert.equal(fixture.mapMounts, 1);
});

test('keyboard resizing respects usable pane widths and double-click restores the default split', async () => {
  await mount();
  const divider = find('Resize data and map');
  await key(divider, 'ArrowLeft');
  assert.equal(divider.getAttribute('aria-valuenow'), '61');
  await key(divider, 'ArrowRight', true);
  assert.equal(divider.getAttribute('aria-valuenow'), divider.getAttribute('aria-valuemax'));
  await key(divider, 'Home');
  assert.equal(divider.getAttribute('aria-valuenow'), divider.getAttribute('aria-valuemin'));
  await key(divider, 'End');
  assert.equal(divider.getAttribute('aria-valuenow'), divider.getAttribute('aria-valuemax'));
  await act(async () => divider.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true })));
  assert.equal(divider.getAttribute('aria-valuenow'), '63');
});

test('dragging cannot shrink either panel excessively and Escape restores the split and pointer styles', async () => {
  await mount();
  const divider = find('Resize data and map');
  document.body.style.userSelect = 'text';
  await pointer(divider, 'pointerdown', 264);
  await pointer(window, 'pointermove', 1500);
  assert.equal(divider.getAttribute('aria-valuenow'), divider.getAttribute('aria-valuemax'));
  await key(window, 'Escape');
  assert.equal(divider.getAttribute('aria-valuenow'), '63');
  assert.equal(document.body.style.userSelect, 'text');
  document.body.style.userSelect = '';
  await key(divider, 'Home');
  assert.ok(saved().dataShare >= 0.5);
  await key(divider, 'End');
  assert.ok(saved().dataShare <= 0.7);
});

test('saved preferences restore on reopen and malformed values fall back safely', async () => {
  window.localStorage.setItem(storageKey, JSON.stringify({ sidebarCollapsed: true, sidebarWidth: 300, dataShare: 0.5 }));
  await mount();
  assert.ok(find('Expand tree menu'));
  assert.equal(find('Resize data and map').getAttribute('aria-valuenow'), '50');
  await act(async () => root.unmount()); root = null;
  window.localStorage.setItem(storageKey, '{invalid');
  await mount();
  assert.ok(find('Collapse tree menu'));
  assert.equal(find('Resize navigation'), null);
  assert.equal(Object.hasOwn(saved(), 'sidebarWidth'), false);
});

test('legacy split preferences and extreme drags stay within the moderate resize range', async () => {
  fixture.workspaceWidth = 1600;
  window.localStorage.setItem(storageKey, JSON.stringify({ sidebarWidth: 360, dataShare: 0.95 }));
  await mount();
  const divider = find('Resize data and map');
  assert.equal(divider.getAttribute('aria-valuenow'), '70');
  await pointer(divider, 'pointerdown', 1000);
  await pointer(window, 'pointermove', -10000);
  assert.equal(divider.getAttribute('aria-valuenow'), '50');
  await pointer(window, 'pointermove', 10000);
  assert.equal(divider.getAttribute('aria-valuenow'), '70');
  await pointer(window, 'pointerup', 10000);
});

test('the final drag position is saved even if pointer-up happens before the next animation frame', async () => {
  await mount();
  const divider = find('Resize data and map');
  await pointer(divider, 'pointerdown', 800);
  await act(async () => {
    for (const [type, share] of [['pointermove', 0.6], ['pointermove', 0.55], ['pointerup', 0.55]]) {
      const event = new window.MouseEvent(type, { bubbles: true, clientX: fixture.workspaceLeft + 6 + (fixture.workspaceWidth - 12) * share });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      window.dispatchEvent(event);
    }
  });
  assert.ok(Math.abs(saved().dataShare - 0.55) < 0.001);
  assert.equal(document.body.style.cursor, '');
});

test('a collapsed desktop tree does not disable the navigation drawer on narrow screens', async () => {
  window.localStorage.setItem(storageKey, JSON.stringify({ sidebarCollapsed: true, dataShare: 0.63 }));
  await mount();
  assert.equal(document.querySelector('#portal-navigation').hasAttribute('inert'), true);
  fixture.desktop = false;
  await act(async () => window.dispatchEvent(new window.Event('resize')));
  assert.equal(document.querySelector('#portal-navigation').hasAttribute('inert'), false);
});

test('narrow screens ignore horizontal dragging and an interrupted drag releases global pointer styles', async () => {
  await mount();
  fixture.desktop = false;
  await pointer(find('Resize data and map'), 'pointerdown', 800);
  await pointer(window, 'pointermove', 1000);
  assert.equal(find('Resize data and map').getAttribute('aria-valuenow'), '63');
  assert.equal(document.body.style.cursor, '');
  fixture.desktop = true;
  await pointer(find('Resize data and map'), 'pointerdown', 800);
  await act(async () => root.unmount()); root = null;
  assert.equal(document.body.style.cursor, '');
  assert.equal(document.body.style.userSelect, '');
});

test('resizing remains available when browser storage is blocked', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('Storage blocked'); } });
  try {
    await mount();
    await key(find('Resize data and map'), 'ArrowLeft');
    assert.equal(find('Resize data and map').getAttribute('aria-valuenow'), '61');
  } finally { Object.defineProperty(window, 'localStorage', descriptor); }
});

if (source.includes('focusSensorOnMap')) test('transportation keeps its sensor-map focus callback while resizing', async () => {
  await mount();
  await act(async () => fixture.outletContext.focusSensorOnMap('sensor-a'));
  await key(find('Resize data and map'), 'ArrowLeft');
  assert.equal(document.querySelector('[data-map]').dataset.focusedSensor, 'sensor-a');
  assert.equal(document.activeElement.id, 'admin-map-panel');
  assert.equal(fixture.mapMounts, 1);
});
