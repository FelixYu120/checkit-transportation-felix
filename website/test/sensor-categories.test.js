import test from 'node:test';
import assert from 'node:assert/strict';
import { getSensorCategory, getSensorFilterExpression } from '../src/components/maps/TrafficSensorCategories.js';

test('groups firmware operating modes into the labeled map filters', () => {
  assert.equal(getSensorCategory({ operating_mode: 'roadside_observation' }), 'roadside');
  for (const operating_mode of ['radar_warning', 'flashing_warning', 'legacy_distance_routed_warning']) {
    assert.equal(getSensorCategory({ operating_mode }), 'warning');
  }
});

test('classifies missing and unrecognized modes as unknown', () => {
  for (const operating_mode of [undefined, null, '', 'future_mode']) {
    assert.equal(getSensorCategory({ operating_mode }), 'unknown');
  }
});

test('default filters show every installation including sensors without a mode', () => {
  assert.equal(getSensorFilterExpression(['roadside', 'warning']), '1 = 1');
});

test('individual filters restrict to the selected type and neither hides all', () => {
  assert.equal(getSensorFilterExpression(['roadside']), "sensor_category IN ('roadside')");
  assert.equal(getSensorFilterExpression(['warning']), "sensor_category IN ('warning')");
  assert.equal(getSensorFilterExpression([]), '1 = 0');
});
