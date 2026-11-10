import test from 'node:test';
import assert from 'node:assert/strict';
import { addTrafficReportRow, trafficReportPointValues } from './TrafficReportAggregation.js';

test('traffic buckets add movements and use volume-weighted speeds', () => {
  const group = {};
  addTrafficReportRow(group, { people_count: 10, avg_speed: 10, v85_speed: 12, max_speed: 15, approach_volume: 4, away_volume: 6 });
  addTrafficReportRow(group, { people_count: 20, avg_speed: 20, v85_speed: 24, max_speed: 30, approach_volume: 10, away_volume: 10 });
  const point = trafficReportPointValues(group);
  assert.equal(point.total_people, 30);
  assert.equal(point.occupancy, 16.7);
  assert.equal(point.v85_speed, 20);
  assert.equal(point.max_speed, 30);
  assert.equal(point.approach_volume, 14);
  assert.equal(point.away_volume, 16);
});
test('a slow speed remains a speed, not an occupancy fraction', () => {
  const group = addTrafficReportRow({}, { people_count: 1, density: 0.4, v85_speed: 0.6, max_speed: 0.8 });
  assert.equal(trafficReportPointValues(group).occupancy, 0.4);
});
test('observed zero movements and a missing bucket remain distinct', () => {
  assert.equal(trafficReportPointValues({}).total_people, null);
  const point = trafficReportPointValues(addTrafficReportRow({}, { people_count: 0 }));
  assert.equal(point.total_people, 0);
  assert.equal(point.occupancy, null);
});
