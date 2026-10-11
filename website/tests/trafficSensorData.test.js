import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchMapSensors, getSensorCoordinates } from '../src/components/maps/TrafficSensorData.js';

test('coordinates preserve precision and reject missing or invalid locations', () => {
  assert.deepEqual(getSensorCoordinates({ latitude: '32.8801234', longitude: '-117.2345678' }),
    { latitude: 32.8801234, longitude: -117.2345678 });
  assert.deepEqual(getSensorCoordinates({ latitude: 0, longitude: 0 }), { latitude: 0, longitude: 0 });
  for (const latitude of [null, undefined, '', ' ', 'invalid', 91, Infinity]) {
    assert.equal(getSensorCoordinates({ latitude, longitude: -117 }), null);
  }
  assert.equal(getSensorCoordinates({ latitude: 32, longitude: -181 }), null);
});

test('map reads scoped installation records including sensors without traffic data, across pages', async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => ({ sensor_id: `sensor-${i}`, latitude: 32, longitude: -117 }));
  const ranges = [];
  const filters = [];
  const client = { from(table) {
    assert.equal(table, 'sensors');
    const query = {
      select(columns) { assert.match(columns, /latitude, longitude/); return this; },
      order(column) { assert.equal(column, 'sensor_id'); return this; },
      range(start, end) { ranges.push([start, end]); this.data = rows.slice(start, end + 1); return this; },
      eq(column, value) { filters.push([column, value]); return this; },
      then(resolve) { return Promise.resolve({ data: this.data, error: null }).then(resolve); },
    };
    return query;
  } };
  assert.deepEqual(await fetchMapSensors(client, 'ucsd'), rows);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
  assert.deepEqual(filters, [['institute_id', 'ucsd'], ['institute_id', 'ucsd']]);
});

test('failed live reads do not substitute occupancy or demo locations', async () => {
  await assert.rejects(fetchMapSensors(null), /not configured/);
  const error = new Error('Access denied');
  const query = { select() { return this; }, order() { return this; }, range() { return this; },
    then(resolve) { return Promise.resolve({ error }).then(resolve); } };
  await assert.rejects(fetchMapSensors({ from: () => query }), /Access denied/);
});
