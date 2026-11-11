import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { transformWithEsbuild } from 'vite';
import { fetchSensorHeartbeats, normalizeSensorIds } from './SensorHeartbeatData.js';
import { getSensorHeartbeatPresentation } from './SensorHeartbeatPresentation.js';
import { getHeartbeatStatusSince, HEARTBEAT_DOWN_AFTER_MS, HEARTBEAT_OFFLINE_AFTER_MS } from '../../../sensorHeartbeat.js';

const SOURCE = import.meta.url.includes('transportation')
  ? { table: 'sensor_health', idColumn: 'sensor_id' }
  : { table: 'device_health', idColumn: 'radar_id' };
const NOW = Date.parse('2026-11-10T20:00:00Z');
const atAge = minutes => new Date(NOW - minutes * 60000).toISOString();
const clientFor = handler => ({ from(table) { return { select(fields) { return { in(column, ids) { return handler({ table, fields, column, ids }); } }; } }; } });

test('occupancy, installation, and update timestamps never substitute for a real health check-in', () => {
  const result = getSensorHeartbeatPresentation({ status: 'active', last_updated: atAge(0), updated_at: atAge(0), last_seen_at: atAge(0), installed_at: atAge(0) }, NOW);
  assert.equal(result.status, 'awaiting');
  assert.equal(result.timestamp, '');
  for (const [age, status] of [[0, 'active'], [30, 'active'], [31, 'down'], [1440, 'down'], [1441, 'offline']]) {
    assert.equal(getSensorHeartbeatPresentation({ health_last_seen_at: atAge(age) }, NOW).status, status);
  }
  for (const value of [null, '', 'not a date', atAge(-6)]) {
    assert.equal(getSensorHeartbeatPresentation({ health_last_seen_at: value }, NOW).status, 'awaiting');
  }
});

test('health reads deduplicate IDs and batch sensors, with no request per room or lane', async () => {
  const ids = Array.from({ length: 401 }, (_, i) => `sensor-${String(i).padStart(3, '0')}`);
  const calls = [];
  const client = clientFor(query => {
    calls.push(query);
    return { data: query.ids.map(id => ({ [SOURCE.idColumn]: id, last_seen_at: atAge(1), updated_at: atAge(0) })) };
  });
  const result = await fetchSensorHeartbeats(client, [...ids, ids[0], ' ', null], SOURCE);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(query => query.table === SOURCE.table && query.column === SOURCE.idColumn && query.fields === `${SOURCE.idColumn}, last_seen_at` && query.ids.length <= 200));
  assert.equal(result.updates.size, 401);
  assert.equal(result.unavailable.size, 0);
  assert.deepEqual(normalizeSensorIds([' a ', 'a', null, '', 'b']), ['a', 'b']);
});

test('successful missing rows clear health while failed batches remain distinct from no heartbeat', async () => {
  const ids = Array.from({ length: 201 }, (_, i) => `sensor-${String(i).padStart(3, '0')}`);
  const result = await fetchSensorHeartbeats(clientFor(query => query.ids.length === 200
    ? { error: { message: 'Network unavailable' } }
    : { data: [{ [SOURCE.idColumn]: ids[200], updated_at: atAge(0) }] }), ids, SOURCE);
  assert.equal(result.unavailable.size, 200);
  assert.equal(result.updates.size, 1);
  assert.equal(result.updates.get(ids[200]), null, 'updated_at cannot fabricate a last check-in');
  const missingClient = await fetchSensorHeartbeats(null, ['sensor'], SOURCE);
  assert.ok(missingClient.unavailable.has('sensor'));
});

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', { url: 'https://example.test' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true, IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} } });
const originalNow = Date.now;
const originalInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
let clock = NOW;
let timerId = 0;
const timers = new Map();
Date.now = () => clock;
globalThis.setInterval = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
globalThis.clearInterval = id => timers.delete(id);
const fixture = { rows: [], calls: [], fail: false, removed: 0, callback: null, handler: null, rooms: [], directorySensors: [] };
globalThis.__heartbeatTestClient = {
  ...clientFor(query => {
    fixture.calls.push(query);
    if (fixture.handler) return fixture.handler(query);
    return fixture.fail ? { error: { message: 'Network unavailable' } } : { data: fixture.rows.filter(row => query.ids.includes(row[SOURCE.idColumn])) };
  }),
  from(table) {
    if (table !== 'rooms') return clientFor(query => {
      fixture.calls.push(query);
      if (fixture.handler) return fixture.handler(query);
      return fixture.fail ? { error: { message: 'Network unavailable' } } : { data: fixture.rows.filter(row => query.ids.includes(row[SOURCE.idColumn])) };
    }).from(table);
    const query = { select() { return query; }, order() { return query; }, eq() { return query; },
      then(resolve, reject) { return Promise.resolve({ data: fixture.rooms }).then(resolve, reject); } };
    return query;
  },
  channel() {
    const channel = { on(_event, filter, callback) { fixture.callback = callback; fixture.filter = filter; return channel; }, subscribe() { return channel; } };
    return channel;
  },
  async removeChannel() { fixture.removed++; },
};
const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function importComponent(file) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const { code } = await transformWithEsbuild(source, file, { loader: file.endsWith('jsx') ? 'jsx' : 'js', jsx: 'transform' });
  return import(asModule(code.replace(/(from\s*)['"]([^'"]+)['"]/g, (_match, prefix, specifier) => {
    const target = specifier.includes('SupabaseClients') ? asModule('export default globalThis.__heartbeatTestClient;')
      : specifier.includes('SensorDirectoryData') ? asModule('export const fetchSensorDirectory=async()=>({sensors:globalThis.__heartbeatTestFixture.directorySensors,institutes:[]});')
      : specifier.endsWith('useSensorHeartbeats') ? asModule('export default globalThis.__heartbeatTestHook;')
      : specifier.endsWith('SensorHeartbeatBadge') ? asModule('export default globalThis.__heartbeatTestBadge;')
      : specifier.endsWith('.css') ? asModule('export default new Proxy({}, {get:(_,key)=>String(key)});')
      : specifier.startsWith('.') ? new URL(specifier, new URL(file, import.meta.url)).href : import.meta.resolve(specifier);
    return prefix + JSON.stringify(target);
  })));
}
const useSensorHeartbeats = (await importComponent('./useSensorHeartbeats.js')).default;
const Badge = (await importComponent('../controls/SensorHeartbeatBadge.jsx')).default;
Object.assign(globalThis, { __heartbeatTestFixture: fixture, __heartbeatTestHook: useSensorHeartbeats, __heartbeatTestBadge: Badge });
let root;
let latest;
let renders = 0;
function Probe({ ids }) {
  latest = useSensorHeartbeats(ids.map(id => ({ [SOURCE.idColumn]: id })));
  renders++;
  return React.createElement(Badge, { sensorId: ids[0], state: latest });
}
async function mount(ids = ['sensor']) {
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(Probe, { ids })); });
}
const currentStatus = () => document.querySelector('[data-status] [aria-current="true"]')?.textContent;
async function tick() { await act(async () => { [...timers.values()][0].callback(); }); }
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null; latest = null; renders = 0;
  clock = NOW; timers.clear();
  Object.assign(fixture, { rows: [], calls: [], fail: false, removed: 0, callback: null, handler: null, rooms: [], directorySensors: [] });
});
after(() => { dom.window.close(); Date.now = originalNow; globalThis.setInterval = originalInterval; globalThis.clearInterval = originalClearInterval; delete globalThis.__heartbeatTestClient; delete globalThis.__heartbeatTestFixture; delete globalThis.__heartbeatTestHook; delete globalThis.__heartbeatTestBadge; delete globalThis.IntersectionObserver; });

test('only the current sensor status appears as it ages from active to down and offline', async () => {
  fixture.rows = [{ [SOURCE.idColumn]: 'sensor', last_seen_at: atAge(30) }];
  await mount();
  assert.equal(currentStatus(), 'Active');
  assert.deepEqual([...document.querySelectorAll('[data-state]')].map(node => node.textContent), ['Active']);
  assert.equal(document.querySelector('time'), null, 'active sensors have no last-heartbeat date');
  assert.equal(document.body.textContent.includes('Heartbeat'), false);
  assert.equal([...timers.values()][0].delay, 10000);
  clock += 60001;
  await tick();
  assert.equal(currentStatus(), 'Down');
  assert.deepEqual([...document.querySelectorAll('[data-state]')].map(node => node.textContent), ['Down']);
  assert.equal(document.querySelector('[aria-current="true"]').getAttribute('data-status-since'), new Date(NOW).toISOString());
  assert.match(document.querySelector('[aria-current="true"]').getAttribute('aria-label'), /Down since/);
  assert.equal(document.body.textContent.includes('Down since'), false, 'date stays out of the status row');
  clock = NOW + 1441 * 60000;
  await tick();
  assert.equal(currentStatus(), 'Offline');
  assert.deepEqual([...document.querySelectorAll('[data-state]')].map(node => node.textContent), ['Offline']);
  assert.equal(document.querySelector('[aria-current="true"]').getAttribute('data-status-since'), new Date(Date.parse(atAge(30)) + HEARTBEAT_OFFLINE_AFTER_MS).toISOString());
  assert.match(document.querySelector('[aria-current="true"]').getAttribute('aria-label'), /Offline since/);
  assert.equal(document.body.textContent.includes('Offline since'), false, 'date stays out of the status row');
});

test('realtime updates refresh the correct health source and ignore unrelated sensors', async () => {
  fixture.rows = [{ [SOURCE.idColumn]: 'sensor', last_seen_at: atAge(60) }];
  await mount();
  assert.equal(currentStatus(), 'Down');
  const count = fixture.calls.length;
  await act(async () => fixture.callback({ new: { [SOURCE.idColumn]: 'other' } }));
  assert.equal(fixture.calls.length, count);
  fixture.rows[0].last_seen_at = atAge(0);
  await act(async () => fixture.callback({ new: { [SOURCE.idColumn]: 'sensor' } }));
  assert.equal(fixture.filter.table, SOURCE.table);
  assert.equal(currentStatus(), 'Active');
  assert.equal(document.querySelector('time'), null);
});

test('network failures retain and age the last real check-in; unobserved health is unavailable', async () => {
  fixture.fail = true;
  await mount();
  assert.equal(document.body.textContent, '', 'no placeholder health label when a first read fails');
  assert.equal(latest.heartbeats.has('sensor'), false);
  fixture.fail = false;
  fixture.rows = [{ [SOURCE.idColumn]: 'sensor', last_seen_at: atAge(1) }];
  await act(async () => window.dispatchEvent(new dom.window.Event('focus')));
  assert.equal(currentStatus(), 'Active');
  fixture.fail = true; clock += 31 * 60000;
  await tick();
  assert.equal(latest.heartbeats.get('sensor'), atAge(1));
  assert.equal(currentStatus(), 'Down');
  assert.ok(document.querySelector('[title="Last known status; refresh unavailable"]'));
});

test('missing health and rooms without assigned sensors show no placeholder badge', async () => {
  await mount();
  assert.equal(document.body.textContent, '', 'no awaiting label without a real check-in');
  await act(async () => root.render(React.createElement(Probe, { ids: [] })));
  assert.equal(document.body.textContent, '');
});

test('scope changes cancel old responses and cleanup stops polling and subscriptions', async () => {
  let finishOld;
  fixture.handler = query => query.ids.includes('old') ? new Promise(resolve => { finishOld = resolve; })
    : { data: [{ [SOURCE.idColumn]: 'new', last_seen_at: atAge(0) }] };
  await mount(['old']);
  assert.equal(document.body.textContent, '', 'no waiting message while health loads');
  await act(async () => root.render(React.createElement(Probe, { ids: ['new'] })));
  assert.ok(latest.heartbeats.has('new'));
  await act(async () => finishOld({ data: [{ [SOURCE.idColumn]: 'old', last_seen_at: atAge(0) }] }));
  assert.equal(latest.heartbeats.has('old'), false);
  const before = renders;
  await act(async () => root.unmount()); root = null;
  assert.equal(renders, before);
  assert.equal(timers.size, 0);
  assert.equal(fixture.removed, 2);
});


test('the public real-time directory shows names without sensor health indicators or health requests', async () => {
  fixture.rows = [{ [SOURCE.idColumn]: 'sensor', last_seen_at: atAge(2) }];
  fixture.rooms = [{ id: 'room-id', room_name: 'Boardroom', radar_id: 'sensor', building_id: 'building-id', floor_number: 1, room_capacity: 6, current_people_count: 0, current_density: 0, buildings: { name: 'Library' } }];
  fixture.directorySensors = [{ sensor_id: 'sensor', institute_id: 'ucsd', area_name: 'Gilman', corridor_name: 'North Lane', status: 'active' }];
  const Dashboard = (await importComponent('../../pages/Dashboard.jsx')).default;
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Dashboard)));
  assert.match(document.body.textContent, SOURCE.idColumn === 'radar_id' ? /Boardroom/ : /North Lane/);
  assert.equal(document.querySelector('[data-status]'), null);
  assert.doesNotMatch(document.body.textContent, /Active|Down|Offline|Sensor Status|Heartbeat/);
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  assert.equal(fixture.calls.filter(query => query.table === SOURCE.table).length, 0);
});


test('analytics dot-only indicators hide health text and retain the date on demand', async () => {
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Badge, {
    sensorId: 'sensor', dotOnly: true,
    state: { heartbeats: new Map([['sensor', atAge(60)]]), now: NOW },
  })));
  const dot = document.querySelector('[data-status="down"]');
  assert.ok(dot);
  assert.equal(dot.textContent, '');
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  await act(async () => dot.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })));
  assert.match(document.querySelector('[role="tooltip"]').textContent, /Down since/);
});

test('status dates use the existing inactivity thresholds and never invent outage events or unknown dates', () => {
  for (const value of ['', null, 'invalid', atAge(-6), atAge(0), atAge(30)]) {
    assert.equal(getHeartbeatStatusSince(value, NOW), '');
  }
  assert.equal(getHeartbeatStatusSince(atAge(31), NOW), new Date(Date.parse(atAge(31)) + HEARTBEAT_DOWN_AFTER_MS).toISOString());
  assert.equal(getHeartbeatStatusSince(atAge(1441), NOW), new Date(Date.parse(atAge(1441)) + HEARTBEAT_OFFLINE_AFTER_MS).toISOString());
});


test('status dates open visibly on hover, keyboard focus, and tap outside clipping containers', async () => {
  fixture.rows = [{ [SOURCE.idColumn]: 'sensor', last_seen_at: atAge(60) }];
  await mount();
  const trigger = document.querySelector('[data-status] button[aria-current="true"]');
  assert.ok(trigger, 'a dated status is an accessible trigger');
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  await act(async () => trigger.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })));
  let tooltip = document.querySelector('[role="tooltip"]');
  assert.ok(tooltip);
  assert.match(tooltip.textContent, /Down since/);
  assert.equal(tooltip.parentElement, document.body, 'tooltip escapes scrolling cards and tables');
  assert.equal(trigger.getAttribute('aria-describedby'), tooltip.id);
  await act(async () => {
    trigger.dispatchEvent(new dom.window.MouseEvent('mouseout', { bubbles: true, relatedTarget: tooltip }));
    tooltip.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true, relatedTarget: trigger }));
    await new Promise(resolve => setTimeout(resolve, 160));
  });
  assert.ok(document.querySelector('[role="tooltip"]'), 'the tooltip stays visible while reading it');
  await act(async () => {
    tooltip.dispatchEvent(new dom.window.MouseEvent('mouseout', { bubbles: true, relatedTarget: window }));
    await new Promise(resolve => setTimeout(resolve, 160));
  });
  assert.equal(document.querySelector('[role="tooltip"]'), null, 'leaving to the window closes safely');
  await act(async () => trigger.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })));
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  await act(async () => trigger.focus());
  tooltip = document.querySelector('[role="tooltip"]');
  assert.ok(tooltip, 'keyboard focus opens the date');
  await act(async () => window.dispatchEvent(new dom.window.Event('scroll')));
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  await act(async () => trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  assert.ok(document.querySelector('[role="tooltip"]'), 'tap/click reopens the date');
  await act(async () => document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })));
  assert.equal(document.querySelector('[role="tooltip"]'), null, 'clicking outside dismisses the date');
});
