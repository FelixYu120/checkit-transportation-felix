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
  const ageMinutes = Math.max(0, now - Date.parse(value)) / 60000;
  if (ageMinutes <= 30) return 'active';
  if (ageMinutes <= 24 * 60) return 'down';
  return 'offline';
};
