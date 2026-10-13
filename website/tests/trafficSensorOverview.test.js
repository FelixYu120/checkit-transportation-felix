import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSensorCountBadge, getSensorOverview } from '../src/components/maps/TrafficSensorOverview.js';

test('overview totals all mapped sensors rather than only a nearby group', () => {
  const sensors = [
    { latitude: 32.88, longitude: -117.23 },
    { latitude: 32.89, longitude: -117.22 },
    { latitude: 33.01, longitude: -117.41 },
    { latitude: null, longitude: null },
  ];
  const overview = getSensorOverview(sensors);
  assert.equal(overview.count, 3);
  assert.ok(overview.latitude > 32.88 && overview.latitude < 33.01);
  assert.ok(overview.longitude > -117.41 && overview.longitude < -117.22);
  assert.equal(getSensorOverview([]), null);
  assert.equal(getSensorOverview([{ latitude: null, longitude: null }]), null);
});

test('overview center stays near sensors crossing the date line', () => {
  const overview = getSensorOverview([
    { latitude: 10, longitude: 179 },
    { latitude: 10, longitude: -179 },
  ]);
  assert.equal(overview.count, 2);
  assert.equal(overview.latitude, 10);
  assert.ok(Math.abs(overview.longitude) > 179);
});


test('overview dot itself carries its complete count, including a single sensor', () => {
  for (const count of [1, 2, 100, 12345]) {
    const badge = decodeURIComponent(getSensorCountBadge(count).slice('data:image/svg+xml;charset=utf-8,'.length));
    assert.ok(badge.includes(`<text`));
    assert.ok(badge.includes(`>${count}</text>`));
    assert.ok(badge.includes('width="32" height="32"'));
  }
  for (const count of [0, -1, NaN, '<script>', 1.5]) assert.equal(getSensorCountBadge(count), null);
});
