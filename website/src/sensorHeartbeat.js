// These windows are shared by status calculation and the displayed status date.
export const HEARTBEAT_DOWN_AFTER_MS = 30 * 60 * 1000;
export const HEARTBEAT_OFFLINE_AFTER_MS = 24 * 60 * 60 * 1000;

// Only pass last_seen_at from device_health (Occupancy) or sensor_health
// (Transportation). Placement, admin status, traffic, and updated_at are not heartbeats.
export const getHeartbeatTimestamp = (row = {}, now = Date.now()) => {
  const value = row?.last_seen_at;
  if (typeof value !== 'string' || !value.trim()) return '';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now + 5 * 60000 ? value : '';
};

export const getHeartbeatStatus = (lastSeenAt, now = Date.now()) => {
  const value = getHeartbeatTimestamp({ last_seen_at: lastSeenAt }, now);
  if (!value) return 'awaiting';
  const age = Math.max(0, now - Date.parse(value));
  if (age <= HEARTBEAT_DOWN_AFTER_MS) return 'active';
  if (age <= HEARTBEAT_OFFLINE_AFTER_MS) return 'down';
  return 'offline';
};

// This is the inactivity threshold date, not a recorded physical outage event.
export const getHeartbeatStatusSince = (lastSeenAt, now = Date.now()) => {
  const value = getHeartbeatTimestamp({ last_seen_at: lastSeenAt }, now);
  const status = getHeartbeatStatus(value, now);
  const delay = status === 'down' ? HEARTBEAT_DOWN_AFTER_MS
    : status === 'offline' ? HEARTBEAT_OFFLINE_AFTER_MS : null;
  return delay === null ? '' : new Date(Date.parse(value) + delay).toISOString();
};
