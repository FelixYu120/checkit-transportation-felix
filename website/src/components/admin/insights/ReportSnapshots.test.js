import test from 'node:test';
import assert from 'node:assert/strict';
import { captureReportSnapshot, getReportSnapshotContext, hasReportSnapshot, refreshReportSnapshots } from './ReportSnapshots.js';
import { getComparableReportState } from './ReportSafety.js';

const context = { mode: 'solo', target: { level: 'room', id: 'room-1', label: 'Room 1' },
  secondaryTarget: {}, filters: { startDate: '2026-11-01' }, timeframe: 'weekly' };
const data = [{ dateLabel: '11/1', occupancy: 25, total_people: 10 }];
const chart = { id: 'chart-1', type: 'chart', snapshotData: data, snapshotKey: 'old-version-key', snapshotContext: context };

test('saved values and their context survive a changed query, period, and snapshot-key version', () => {
  const current = { ...context, target: { id: 'room-2', label: 'Room 2' }, timeframe: 'monthly' };
  assert.deepEqual(getReportSnapshotContext(chart, current), context);
  assert.equal(captureReportSnapshot(chart, { key: 'new-key', data: [{ occupancy: 99 }], context: current }), chart);
  assert.deepEqual(chart.snapshotData, data);
});

test('legacy report keys keep their original period and floor without requiring a new fetch', () => {
  const legacy = { ...chart, snapshotContext: undefined, snapshotKey: JSON.stringify({
    chartSnapshotVersion: 1, mode: 'solo', targetLevel: 'building', targetId: 'building-1', targetFloorNumber: 2,
    timeframe: 'daily', filters: { startDate: '2025-01-01' },
  }) };
  const saved = getReportSnapshotContext(legacy, context);
  assert.equal(saved.timeframe, 'daily');
  assert.equal(saved.target.id, 'building-1');
  assert.equal(saved.target.floorNumber, 2);
  assert.equal(saved.filters.startDate, '2025-01-01');
  assert.equal(getReportSnapshotContext({ ...chart, snapshotContext: undefined }, context), context);
});

test('an empty saved result stays empty until explicitly refreshed', () => {
  const empty = { ...chart, snapshotData: [] };
  assert.equal(hasReportSnapshot(empty), true);
  assert.equal(captureReportSnapshot(empty, { key: 'later', data }), empty);
  assert.equal(hasReportSnapshot(refreshReportSnapshots([empty])[0]), false);
});

test('refreshing one chart invalidates only it and its linked summaries, and records an unsaved edit', () => {
  const linked = { ...chart, id: 'summary-1', type: 'summary', attachedChartId: chart.id };
  const other = { ...chart, id: 'chart-2' };
  const note = { id: 'note', type: 'text', html: 'Keep this note' };
  const original = [chart, linked, other, note];
  const refreshed = refreshReportSnapshots(original, chart.id);
  for (const element of refreshed.slice(0, 2)) {
    assert.equal(hasReportSnapshot(element), false);
    assert.equal(element.snapshotContext, undefined);
    assert.equal(element.snapshotRefreshRevision, 1);
  }
  assert.equal(refreshed[2], other);
  assert.equal(refreshed[3], note);
  assert.notDeepEqual(getComparableReportState({ elements: refreshed }), getComparableReportState({ elements: original }));
  assert.equal(refreshReportSnapshots(original).filter(hasReportSnapshot).length, 0);
});

test('fresh results freeze again and stale responses cannot undo a newer refresh', () => {
  const pending = refreshReportSnapshots([chart])[0];
  const request = { key: 'refreshed-key', data, context, revision: 1 };
  assert.equal(captureReportSnapshot(pending, { ...request, revision: 0 }), pending);
  const captured = captureReportSnapshot(pending, request);
  assert.equal(captured.snapshotData, data);
  assert.equal(captured.snapshotContext, context);
  assert.equal(captureReportSnapshot(captured, { ...request, data: [{ occupancy: 999 }] }), captured);
  const next = refreshReportSnapshots([captured])[0];
  assert.equal(captureReportSnapshot(next, request), next);
});
