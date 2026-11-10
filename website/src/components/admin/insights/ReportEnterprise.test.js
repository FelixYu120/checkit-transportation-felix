import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChartEvidence, mergeChartEvidence, compareReportVersions, getDecisionQuestion, workflowErrorMessage } from './ReportEnterprise.js';

test('report evidence distinguishes observed zero from missing data without inventing uptime', () => {
  const evidence = buildChartEvidence({ rows: [{ observed_at: '2026-11-09T10:00:00Z', sensor_id: 'one' }],
    points: [{ hasData: true, total_people: 0 }, { hasData: false, total_people: null }], sources: ['ten_minute_summaries'], timezone: 'America/Los_Angeles' });
  assert.equal(evidence.observedBuckets, 1);
  assert.equal(evidence.missingBuckets, 1);
  assert.equal(evidence.firstObservedAt, '2026-11-09T10:00:00.000Z');
  assert.deepEqual(evidence.reportingSourceIds, ['one']);
  assert.equal('uptime' in evidence, false);
});
test('a series containing only reported points cannot establish zero missing periods', () => {
  assert.equal(buildChartEvidence({ points: [{ hasData: true }] }).missingBuckets, null);
  assert.equal(buildChartEvidence({ points: [{ hasData: true }], completeBucketRange: true }).missingBuckets, 0);
  assert.equal(buildChartEvidence({ points: [], rows: [] }).firstObservedAt, null);
});
test('source metadata handles large observation windows without argument-limit errors', () => {
  const rows = Array.from({ length: 150000 }, (_, index) => ({ observed_at: new Date(index * 1000).toISOString() }));
  const evidence = buildChartEvidence({ rows });
  assert.equal(evidence.sourceRows, 150000);
  assert.equal(evidence.firstObservedAt, '1970-01-01T00:00:00.000Z');
});
test('comparison provenance retains source dates and unknown missingness', () => {
  const left = buildChartEvidence({ rows: [{ observed_at: '2026-11-01T10:00Z' }], sources: ['room_history'], points: [{ hasData: true }] });
  const right = buildChartEvidence({ rows: [{ observed_at: '2026-11-08T11:00Z' }], sources: ['occupancy_daily_summary'], points: [{ hasData: false }] });
  const merged = mergeChartEvidence([left, right]);
  assert.equal(merged.firstObservedAt, left.firstObservedAt);
  assert.equal(merged.lastObservedAt, right.lastObservedAt);
  assert.equal(merged.missingBuckets, null);
  assert.deepEqual(merged.sources, ['room_history','occupancy_daily_summary']);
});
test('before/after results use matching numeric saved metrics and disclose scope differences', () => {
  const version = (value, scope) => ({ snapshot: { layout_data: { selections: { roomId: scope }, elements: [{ type: 'summary', id: 'kpi', snapshotData: { average: value, typicalDwellTime: '5 min' } }] } } });
  const result = compareReportVersions(version(10,'a'), version(7,'b'), 'occupancy');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].difference, -3);
  assert.match(result.warning, /locations differ/);
  assert.match(result.warning, /does not by itself establish/);
});
test('decision questions fit their product and blank reports keep their blank starting point', () => {
  assert.match(getDecisionQuestion('transportation','trend-review'), /speeds/);
  assert.match(getDecisionQuestion('occupancy','operations'), /cleaning/);
  assert.equal(getDecisionQuestion('occupancy','blank'), '');
  assert.match(getDecisionQuestion('occupancy','default','comparison'), /changed/);
});
test('a missing workflow migration produces actionable setup feedback', () => {
  assert.match(workflowErrorMessage({ code: 'PGRST202' }), /database update/);
  assert.equal(workflowErrorMessage({ message: 'Editor access required.' }), 'Editor access required.');
});
