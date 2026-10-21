import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sensorDisplayName, sensorLabelsById } from '../src/components/admin/data/SensorNames.js';
import { fetchMapSensors } from '../src/components/maps/TrafficSensorData.js';

// Exercise the real directory/navigation functions in Node without browser-only
// Supabase initialization. The production query builders are not mocked out.
const asModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const namesUrl = new URL('../src/components/admin/data/SensorNames.js', import.meta.url).href;
const directorySource = readFileSync(new URL('../src/components/admin/data/SensorDirectoryData.js', import.meta.url), 'utf8')
  .replace(/import .* from "..\/..\/helper\/SupabaseClients.jsx";/,
    'const getSupabaseErrorContext = error => error; const shouldUseLocalData = false;')
  .replace("'./SensorNames.js'", JSON.stringify(namesUrl));
const { fetchSensorDirectory } = await import(asModule(directorySource));
const routeSource = readFileSync(new URL('../src/components/admin/routing/AdminRouteUtils.jsx', import.meta.url), 'utf8');
const navigationSource = readFileSync(new URL('../src/components/admin/navigation/SidebarData.jsx', import.meta.url), 'utf8')
  .replace("'../data/SensorNames.js'", JSON.stringify(namesUrl))
  .replace('"../routing/AdminRouteUtils"', JSON.stringify(asModule(routeSource)))
  .replace('"../data/SensorDirectoryData"', JSON.stringify(asModule(directorySource)));
const { formatCampusNavigation, filterCampusNavigation } = await import(asModule(navigationSource));

const sensors = [
  { sensor_id: 'RADAR_ONE', sensor_name: 'Northbound Bike Path', institute_id: 'ucsd', area_name: 'Library', corridor_name: 'Gilman' },
  { sensor_id: 'RADAR_TWO', sensor_name: null, institute_id: 'ucsd', area_name: 'Library', corridor_name: 'Gilman' },
];
function mockClient() {
  const queries = [];
  return { queries, from(table) {
    const q = { table }; queries.push(q);
    const builder = {
      select(columns) { q.columns = columns; return builder; },
      order() { return builder; }, eq() { return builder; }, in() { return builder; }, range() { return builder; },
      then(resolve) {
        if (q.columns.includes('heading_degrees')) return Promise.resolve({ data: null, error: { code: '42703', message: 'column heading_degrees does not exist' } }).then(resolve);
        return Promise.resolve({ error: null, data: table === 'sensors' ? sensors : table === 'institutes'
          ? [{ institute_id: 'ucsd', full_name: 'UCSD' }] : [{ sensor_id: 'RADAR_ONE', diagnostics: { device_name: 'Stale device name' } }] }).then(resolve);
      },
    };
    return builder;
  } };
}

test('sensor name is independent of location and ID, with an ID fallback for unnamed sensors', () => {
  assert.equal(sensorDisplayName(sensors[0]), 'Northbound Bike Path');
  assert.equal(sensorDisplayName(sensors[1]), 'RADAR_TWO');
  assert.equal(sensorDisplayName({ sensor_id: 'RADAR_ONE', sensor_name: '  ' }), 'RADAR_ONE');
  assert.equal(sensorDisplayName({ ...sensors[0], sensor_name: ' New name ' }), 'New name');
});

test('duplicate names remain distinguishable by their stable IDs', () => {
  const labels = sensorLabelsById(sensors.map(sensor => ({ ...sensor, sensor_name: 'Northbound' })));
  assert.equal(labels.get('RADAR_ONE'), 'Northbound (RADAR_ONE)');
  assert.equal(labels.get('RADAR_TWO'), 'Northbound (RADAR_TWO)');
});

test('cloud directory feeds named navigation while routes and ID search keep stable IDs', async () => {
  const client = mockClient();
  const directory = await fetchSensorDirectory(client);
  const sensorQuery = client.queries.find(q => q.table === 'sensors');
  assert.ok(sensorQuery.columns.split(',').includes('sensor_name'));
  assert.equal(client.queries.filter(q => q.table === 'sensors').length, 1, 'lean schema works without legacy retries');
  const navigation = formatCampusNavigation(directory.institutes, directory.sensors);
  const entries = navigation[0].areas[0].corridors;
  assert.equal(entries.find(s => s.id === 'RADAR_ONE').name, 'Northbound Bike Path');
  assert.equal(entries.find(s => s.id === 'RADAR_TWO').name, 'RADAR_TWO');
  assert.equal(filterCampusNavigation(navigation, ['northbound'])[0].areas[0].corridors[0].id, 'RADAR_ONE');
  assert.equal(filterCampusNavigation(navigation, ['radar_one'])[0].areas[0].corridors[0].id, 'RADAR_ONE');
  assert.equal(filterCampusNavigation(navigation, ['gilman'])[0].areas[0].corridors.length, 2);
});

test('maps fetch names even when the optional heading column is unavailable', async () => {
  const client = mockClient();
  const rows = await fetchMapSensors(client, 'ucsd');
  assert.equal(rows[0].sensor_name, 'Northbound Bike Path');
  assert.equal(rows[0].sensor_id, 'RADAR_ONE');
  assert.ok(client.queries.every(q => q.columns.includes('sensor_name')));
  assert.equal(client.queries.length, 2);
});
