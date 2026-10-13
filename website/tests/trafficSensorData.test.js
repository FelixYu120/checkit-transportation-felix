import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addHeadingPointer, fetchMapSensors, getSensorCoordinates, getSensorHeading } from '../src/components/maps/TrafficSensorData.js';

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


test('saved compass headings preserve north and normalize bearings without inventing missing headings', () => {
  for (const heading of [0, 90, 180, 270]) assert.equal(getSensorHeading(heading), heading);
  assert.equal(getSensorHeading('90'), 90);
  assert.equal(getSensorHeading(360), 0);
  assert.equal(getSensorHeading(-90), 270);
  for (const value of [null, undefined, '', ' ', 'invalid', Infinity, false]) {
    assert.equal(getSensorHeading(value), null);
    assert.equal(addHeadingPointer('<svg></svg>', value), null);
  }
  const source = '<svg><path id="brand"/></svg>';
  for (const heading of [0, 90, 180, 270]) {
    const result = decodeURIComponent(addHeadingPointer(source, heading).split(',').slice(1).join(','));
    assert.ok(result.includes(`rotate(${heading} 32 32)`));
    assert.ok(result.includes('<path id="brand"/>'));
  }
});

test('older schemas still map saved coordinates when the optional heading column is missing', async () => {
  const selectedColumns = [];
  const sensor = { sensor_id: 'gilman1', latitude: 32.88, longitude: -117.23 };
  const client = { from() {
    return {
      select(columns) { selectedColumns.push(columns); this.heading = columns.includes('heading_degrees'); return this; },
      order() { return this; }, range() { return this; },
      then(resolve) {
        return Promise.resolve(this.heading
          ? { error: { code: '42703', message: 'column sensors.heading_degrees does not exist' } }
          : { data: [sensor] }).then(resolve);
      },
    };
  } };
  assert.deepEqual(await fetchMapSensors(client), [sensor]);
  assert.equal(selectedColumns.length, 2);
  assert.ok(selectedColumns[0].includes('heading_degrees'));
  assert.ok(!selectedColumns[1].includes('heading_degrees'));
});
