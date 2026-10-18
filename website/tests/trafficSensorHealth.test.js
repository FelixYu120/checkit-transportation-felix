import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorSensorBadge, fetchMapSensorHealth, getAggregateMapHealth, getMapSensorHealth, SENSOR_HEALTH_COLORS } from '../src/components/maps/TrafficSensorHealth.js';
import { getSensorCountBadge } from '../src/components/maps/TrafficSensorOverview.js';

const now = Date.parse('2026-10-12T12:00:00Z');
test('fresh heartbeats are blue, stale or offline sensors red, and missing health unknown', () => {
  assert.equal(getMapSensorHealth({ health_last_seen_at: '2026-10-12T11:59:00Z' }, now), 'active');
  assert.equal(getMapSensorHealth({ last_seen_at: '2026-10-12T11:30:00Z' }, now), 'active');
  assert.equal(getMapSensorHealth({ last_seen_at: '2026-10-12T11:29:59Z' }, now), 'down');
  assert.equal(getMapSensorHealth({ status: 'offline' }, now), 'down');
  assert.equal(getMapSensorHealth({ status: 'active' }, now), 'unknown');
  assert.equal(getMapSensorHealth({ last_seen_at: 'invalid' }, now), 'unknown');
  assert.equal(getMapSensorHealth({ last_seen_at: '2027-01-01T00:00:00Z' }, now), 'unknown');
});

test('mixed clusters surface offline sensors, and unknown health never becomes healthy', () => {
  assert.equal(getAggregateMapHealth([{ map_health: 'active' }, { map_health: 'down' }]), 'down');
  assert.equal(getAggregateMapHealth([{ map_health: 'active' }, { map_health: 'unknown' }]), 'unknown');
  assert.equal(getAggregateMapHealth([{ map_health: 'active' }]), 'active');
  assert.equal(getAggregateMapHealth([]), 'unknown');
});

test('logo badges and total counts use the same health color without removing the logo', () => {
  const svg = '<svg><circle fill="#628079"/><path id="brand" fill="#ffffff"/></svg>';
  for (const [health, color] of Object.entries(SENSOR_HEALTH_COLORS)) {
    assert.ok(colorSensorBadge(svg, health).includes(color));
    assert.ok(colorSensorBadge(svg, health).includes('id="brand"'));
    assert.ok(decodeURIComponent(getSensorCountBadge(3, health)).includes(color));
    assert.ok(decodeURIComponent(getSensorCountBadge(3, health)).includes('>3</text>'));
  }
});

test('health lookup combines sensor status and heartbeats, tolerating older sensor schemas', async () => {
  const client = { from(table) {
    return { select(columns) { this.columns = columns; return this; }, in() { return this; },
      then(resolve) {
        return Promise.resolve(table === 'sensor_health'
          ? { data: [{ sensor_id: 'gilman1', last_seen_at: '2026-10-12T11:59:00Z' }] }
          : this.columns.includes('last_seen_at')
            ? { error: { code: '42703', message: 'column last_seen_at does not exist' } }
            : { data: [{ sensor_id: 'gilman1', status: 'active' }] }).then(resolve);
      },
    };
  } };
  const rows = await fetchMapSensorHealth(client, ['gilman1']);
  assert.equal(rows.get('gilman1').status, 'active');
  assert.equal(getMapSensorHealth(rows.get('gilman1'), now), 'active');
});

test('unavailable health feeds remain unknown without preventing map locations from loading', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const client = { from() {
    return { select() { return this; }, in() { return this; },
      then(resolve, reject) { return Promise.reject(new Error('Network unavailable')).then(resolve, reject); } };
  } };
  const rows = await fetchMapSensorHealth(client, ['gilman1']);
  assert.equal(rows.size, 0);
  assert.equal(getMapSensorHealth(rows.get('gilman1') || {}, now), 'unknown');
});
