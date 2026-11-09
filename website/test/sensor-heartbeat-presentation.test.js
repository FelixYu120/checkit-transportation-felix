import test from 'node:test';
import assert from 'node:assert/strict';
import { getSensorHeartbeatPresentation } from '../src/components/admin/data/SensorHeartbeatPresentation.js';
import { getSensorCoordinates } from '../src/components/maps/TrafficSensorData.js';

const now = Date.parse('2026-11-08T20:00:00Z');
const atAge = (minutes) => new Date(now - minutes * 60000).toISOString();

test('installation, status, and traffic activity cannot stand in for a real heartbeat', () => {
  const result = getSensorHeartbeatPresentation({
    status: 'active', last_seen_at: atAge(1), lastSeen: atAge(1),
    updated_at: atAge(1), installed_at: atAge(1),
  }, now);
  assert.deepEqual(result, {
    status: 'awaiting', label: 'Awaiting heartbeat', timestamp: '', relativeTime: '',
  });
});

test('lane health follows the shared heartbeat boundaries and exposes the original timestamp', () => {
  for (const [age, expectedStatus, expectedLabel, expectedTime] of [
    [0, 'active', 'Online', 'just now'],
    [2, 'active', 'Online', '2m ago'],
    [30, 'active', 'Online', '30m ago'],
    [31, 'down', 'Overdue', '31m ago'],
    [60, 'down', 'Overdue', '1h ago'],
    [1440, 'down', 'Overdue', '1d ago'],
    [1441, 'offline', 'Offline', '1d ago'],
  ]) {
    assert.deepEqual(getSensorHeartbeatPresentation({ health_last_seen_at: atAge(age) }, now), {
      status: expectedStatus, label: expectedLabel, timestamp: atAge(age), relativeTime: expectedTime,
    });
  }
});

test('invalid or implausibly future heartbeat timestamps remain awaiting', () => {
  for (const value of [null, '', 'invalid', atAge(-6)]) {
    assert.equal(getSensorHeartbeatPresentation({ health_last_seen_at: value }, now).status, 'awaiting');
  }
  assert.equal(getSensorHeartbeatPresentation({ health_last_seen_at: atAge(-2) }, now).relativeTime, 'just now');
});

test('map links require real valid coordinates, including valid zero coordinates', () => {
  for (const sensor of [
    {}, { latitude: null, longitude: -117.2 }, { latitude: ' ', longitude: -117.2 },
    { latitude: 91, longitude: -117.2 }, { latitude: 32.8, longitude: -181 },
  ]) assert.equal(getSensorCoordinates(sensor), null);
  assert.deepEqual(getSensorCoordinates({ latitude: '32.8', longitude: '-117.2' }), {
    latitude: 32.8, longitude: -117.2,
  });
  assert.deepEqual(getSensorCoordinates({ latitude: 0, longitude: 0 }), { latitude: 0, longitude: 0 });
});
