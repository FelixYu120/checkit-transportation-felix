import test from 'node:test';
import assert from 'node:assert/strict';
import { getSensorSpeedSetupRows } from '../src/components/admin/data/SensorSpeedData.js';

test('converts stored km/h thresholds to mph and exposes only the two logistics fields', () => {
  assert.deepEqual(getSensorSpeedSetupRows({
    speed_limit_threshold: 24, max_speed_cap_threshold: 40,
    danger_speed_kmh: 24, emergency_speed_kmh: 40,
  }), [['Speed Limit', '14.9 mph'], ['Max Speed Cap', '24.9 mph']]);
});

test('uses the Supabase threshold columns ahead of legacy fields', () => {
  assert.deepEqual(getSensorSpeedSetupRows({
    speed_limit_threshold: 16.09344, max_speed_cap_threshold: '32.18688',
    speed_threshold: 80, max_cap: 100,
  }), [['Speed Limit', '10 mph'], ['Max Speed Cap', '20 mph']]);
});

test('converts legacy km/h values when the threshold columns are unavailable', () => {
  assert.deepEqual(getSensorSpeedSetupRows({ speed_limit_kmh: 24, emergency_speed_kmh: 40 }),
    [['Speed Limit', '14.9 mph'], ['Max Speed Cap', '24.9 mph']]);
});

test('missing or invalid thresholds stay unset, while zero remains valid', () => {
  for (const value of [undefined, null, '', ' ', 'invalid', Infinity, false]) {
    assert.deepEqual(getSensorSpeedSetupRows({ speed_limit_threshold: value, max_speed_cap_threshold: value }),
      [['Speed Limit', 'Not set'], ['Max Speed Cap', 'Not set']]);
  }
  assert.deepEqual(getSensorSpeedSetupRows({ speed_limit_threshold: 0, max_speed_cap_threshold: 0 }),
    [['Speed Limit', '0 mph'], ['Max Speed Cap', '0 mph']]);
});
