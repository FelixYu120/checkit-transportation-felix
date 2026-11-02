import test from 'node:test';
import assert from 'node:assert/strict';
import { getHeartbeatTimestamp, getHeartbeatStatus } from '../src/sensorHeartbeat.js';
const now = Date.parse('2026-11-01T12:00:00Z');
const ago = (minutes) => new Date(now - minutes * 60000).toISOString();

test('new placements and administrative edits never count as heartbeats', () => {
  const timestamp = getHeartbeatTimestamp({ created_at: ago(0), updated_at: ago(0), status: 'active' }, now);
  assert.equal(timestamp || '', '');
  assert.equal(getHeartbeatStatus(timestamp, now), 'awaiting');
});

test('only a recent actual heartbeat marks a sensor active', () => {
  assert.equal(getHeartbeatStatus(getHeartbeatTimestamp({ last_seen_at: ago(0) }, now), now), 'active');
  assert.equal(getHeartbeatStatus(ago(30), now), 'active');
  assert.equal(getHeartbeatStatus(ago(31), now), 'down');
  assert.equal(getHeartbeatStatus(ago(1441), now), 'offline');
});

test('invalid or implausibly future heartbeat timestamps stay unknown', () => {
  const future = new Date(now + 3600000).toISOString();
  for (const value of [undefined, null, '', 'invalid', future]) {
    assert.equal(getHeartbeatStatus(value, now), 'awaiting');
  }
});

test('current metadata cannot hide a stale device heartbeat', () => {
  const heartbeat = getHeartbeatTimestamp({ last_seen_at: ago(1500), updated_at: ago(0), status: 'active' }, now);
  assert.equal(getHeartbeatStatus(heartbeat, now), 'offline');
});
