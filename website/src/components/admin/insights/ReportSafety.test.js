import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTextDraftsToLayout, createSingleFlightTask, decodeReportLayout,
  getCheckpointDocMeta, getComparableReportState, inferReportModeFromLayout,
  normalizeReportPageCount, normalizeStudioRole, requireReportReady,
  removeReportDataNotes, saveReportRecord, waitForReportReady,
} from './ReportSafety.js';

const metadata = { title: 'Original title', author: 'Author', date: 'November 9', period: 'Last 7 Days' };
const layout = { mode: 'solo', pageCount: 1, elements: [{ id: 'note', type: 'text', html: 'Original text' }], reportSettings: { timeframe: 'weekly' } };

test('title, author, date, and period edits all count as unsaved changes', () => {
  const original = getComparableReportState(layout, metadata);
  for (const field of Object.keys(metadata)) {
    assert.notDeepEqual(getComparableReportState(layout, { ...metadata, [field]: 'Changed' }), original, field);
  }
});

test('chart caches and save timestamps do not manufacture unsaved edits', () => {
  const cached = { ...layout,
    elements: layout.elements.map(element => ({ ...element, snapshotData: { values: [1, 2] }, snapshotKey: 'cache-1' })),
    reportSettings: { ...layout.reportSettings, lastSavedBy: 'owner@example.test', lastSavedAt: '2026-11-09' },
  };
  assert.deepEqual(getComparableReportState(cached, metadata), getComparableReportState(layout, metadata));
  assert.equal(cached.elements[0].snapshotKey, 'cache-1', 'comparison does not mutate the saved layout');
});

test('unblurred text drafts are detected before the layout state is committed', () => {
  const candidate = { ...layout, elements: applyTextDraftsToLayout(layout.elements, { note: 'New draft' }) };
  assert.notDeepEqual(getComparableReportState(candidate, metadata), getComparableReportState(layout, metadata));
  assert.equal(layout.elements[0].html, 'Original text');
});

test('sharing layout changes cannot mark unsaved document metadata as saved', () => {
  const checkpoint = JSON.stringify(getComparableReportState(layout, metadata));
  const edited = { ...metadata, title: 'Unsaved title' };
  const shared = { ...layout, reportSettings: { ...layout.reportSettings, sharedWith: ['reader@example.test'] } };
  const persisted = getComparableReportState(shared, getCheckpointDocMeta(checkpoint, edited));
  assert.notDeepEqual(persisted, getComparableReportState(shared, edited));
  assert.deepEqual(getCheckpointDocMeta('invalid', metadata), metadata);
});

test('legacy user accounts keep viewer permissions in both Studio entry points', () => {
  for (const role of [undefined, null, '', ' user ', 'VIEWER']) assert.equal(normalizeStudioRole(role), 'viewer');
  assert.equal(normalizeStudioRole('checkit_admin'), 'checkit_admin');
});

test('legacy arrays and JSON strings load while corrupt layouts are rejected', () => {
  assert.deepEqual(decodeReportLayout(layout.elements), layout.elements);
  assert.deepEqual(decodeReportLayout(JSON.stringify(layout)), layout);
  assert.deepEqual(decodeReportLayout([]), []);
  for (const value of [null, undefined, 'not json', {}, { elements: {} }, [null], [[]]]) {
    assert.equal(decodeReportLayout(value), null);
  }
});

test('comparison reports without an explicit mode are identified from their saved targets', () => {
  assert.equal(inferReportModeFromLayout({ elements: [{ comparisonSelections: { roomId: 'room-2' } }] }), 'comparison');
  assert.equal(inferReportModeFromLayout({ comparisonSelections: { floorNumber: 0 } }), 'comparison');
  assert.equal(inferReportModeFromLayout({ elements: [{ comparisonSelectionList: [{ areaId: 'area-2' }] }] }), 'comparison');
  assert.equal(inferReportModeFromLayout({ mode: 'solo', comparisonSelections: { roomId: 'room-2' } }), 'solo');
  assert.equal(inferReportModeFromLayout({ elements: [{ comparisonSelections: null, comparisonSelectionList: {} }] }), 'solo');
});

test('page counts stay numeric and cannot hide pages containing saved elements', () => {
  assert.equal(normalizeReportPageCount('2', 1), 2);
  assert.equal(normalizeReportPageCount(1, 3), 3);
  for (const count of [null, -1, 0, NaN, Infinity, 'invalid']) assert.equal(normalizeReportPageCount(count, 2), 2);
});

test('repeated save requests share one operation and the same report ID', async () => {
  const run = createSingleFlightTask();
  let resolve;
  let calls = 0;
  const task = () => { calls++; return new Promise(done => { resolve = done; }); };
  const first = run(task);
  const second = run(task);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve('saved-report');
  assert.deepEqual(await Promise.all([first, second]), ['saved-report', 'saved-report']);
  assert.equal(await run(() => 'next-report'), 'next-report');
});

test('a failed save releases the operation so a retry can succeed', async () => {
  const run = createSingleFlightTask();
  await assert.rejects(run(() => { throw new Error('Failed write'); }), /Failed write/);
  assert.equal(await run(() => 'retry-id'), 'retry-id');
});

function storage(result) {
  const calls = [];
  const query = {
    update(payload) { calls.push(['update', payload]); return query; },
    insert(payload) { calls.push(['insert', payload]); return query; },
    eq(...args) { calls.push(['eq', ...args]); return query; },
    select(fields) { calls.push(['select', fields]); return query; },
    single: async () => result,
  };
  return { calls, from: table => { calls.push(['from', table]); return query; } };
}

test('new reports receive the authenticated owner and require a confirmed saved row', async () => {
  const client = storage({ data: { id: 'new-id' }, error: null });
  assert.equal(await saveReportRecord(client, { payload: { title: 'Report' }, user: { id: 'owner' } }), 'new-id');
  assert.deepEqual(client.calls.find(call => call[0] === 'insert')[1], [{ title: 'Report', owner_id: 'owner' }]);
  assert.deepEqual(client.calls.find(call => call[0] === 'select'), ['select', 'id']);
  await assert.rejects(saveReportRecord(client, { payload: {}, user: null }), /Sign in again/);
});

test('updates that affect no visible row must not report a successful save', async () => {
  const client = storage({ data: null, error: null });
  await assert.rejects(saveReportRecord(client, { reportId: 'deleted-report', payload: {}, user: { id: 'owner' } }), /not saved/);
  assert.deepEqual(client.calls.find(call => call[0] === 'eq'), ['eq', 'id', 'deleted-report']);
  const denied = { code: '42501', message: 'Permission denied' };
  await assert.rejects(saveReportRecord(storage({ data: null, error: denied }), { reportId: 'shared', payload: {}, user: { id: 'viewer' } }), error => error === denied);
});

test('export waits for chart readiness and refuses timed-out or missing content', async () => {
  let remaining = 2;
  assert.equal(await waitForReportReady({ querySelector: () => remaining-- > 0 ? {} : null }, 5000, 1), true);
  assert.equal(await waitForReportReady({ querySelector: () => ({}) }, 3, 1), false);
  assert.equal(await waitForReportReady(null), false);
  await assert.rejects(requireReportReady({ querySelector: () => ({}) }, 0), /Charts are still loading/);
});


test('removing the generated data page preserves evidence, written notes, and intentional blank pages', () => {
  const chart = { id: 'chart', type: 'chart', y: 100, height: 600, snapshotData: [{ value: 10 }], dataEvidence: { sources: ['measurements'] } };
  const note = { id: 'my-note', type: 'text', y: 760, height: 120, html: 'Data sources: my own explanation' };
  const dataNotes = { id: 'report-data-notes', type: 'data-notes', y: 1392, height: 840 };
  const original = [chart, note, dataNotes];
  const before = structuredClone(original);
  const cleaned = removeReportDataNotes(original, 3);
  assert.deepEqual(cleaned.elements, [chart, note]);
  assert.equal(cleaned.pageCount, 2, 'remove only the generated page and retain the intentional blank page');
  assert.deepEqual(original, before, 'stored reports and snapshots are not mutated');
  assert.equal(cleaned.elements[0], chart, 'source evidence stays attached to its chart');
  assert.deepEqual(removeReportDataNotes([chart, note], 3), { elements: [chart, note], pageCount: 3 });
});

test('a generated page in the middle closes its gap without removing shared or spanned content', () => {
  const elements = [
    { id: 'chart', type: 'chart', y: 100, height: 600 },
    { id: 'notes', type: 'data-notes', y: 1392, height: 840 },
    { id: 'text', type: 'text', y: 2500, height: 160, html: 'Conclusion' },
  ];
  const cleaned = removeReportDataNotes(elements, 3);
  assert.equal(cleaned.pageCount, 2);
  assert.equal(cleaned.elements[1].y, 1300);
  assert.equal(elements[2].y, 2500);
  for (const occupied of [
    { id: 'shared', type: 'text', y: 1300, height: 150 },
    { id: 'spanning', type: 'chart', y: 1000, height: 500 },
  ]) {
    const shared = removeReportDataNotes([...elements, occupied], 3);
    assert.equal(shared.pageCount, 3);
    assert.equal(shared.elements.find(element => element.id === 'text').y, 2500);
    assert.ok(shared.elements.includes(occupied));
  }
});
