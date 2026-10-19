import test from 'node:test';
import assert from 'node:assert/strict';
import { getSensorCategory, getSensorCategoryLabel, getSensorFilterExpression } from '../src/components/maps/TrafficSensorCategories.js';

test('uses only Supabase deployment_type, including when firmware mode disagrees', () => {
  assert.equal(getSensorCategoryLabel({ deployment_type: 'roadside_observation', operating_mode: 'radar_warning' }), 'Roadside Observation');
  assert.equal(getSensorCategoryLabel({ deployment_type: 'warning_system', operating_mode: 'roadside_observation' }), 'Warning System');
});

test('missing deployment types have no visible label and do not inherit firmware mode', () => {
  for (const deployment_type of [undefined, null, '', 'future_type']) {
    const sensor = { deployment_type, operating_mode: 'roadside_observation' };
    assert.equal(getSensorCategory(sensor), 'unknown');
    assert.equal(getSensorCategoryLabel(sensor), '');
  }
});

test('default filters show every installation including sensors without a deployment type', () => {
  assert.equal(getSensorFilterExpression(['roadside', 'warning']), '1 = 1');
});

test('individual filters restrict to the selected type and neither hides all', () => {
  assert.equal(getSensorFilterExpression(['roadside']), "sensor_category IN ('roadside')");
  assert.equal(getSensorFilterExpression(['warning']), "sensor_category IN ('warning')");
  assert.equal(getSensorFilterExpression([]), '1 = 0');
});
