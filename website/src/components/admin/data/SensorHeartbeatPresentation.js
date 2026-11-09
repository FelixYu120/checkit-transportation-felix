import { getHeartbeatStatus, getHeartbeatTimestamp } from '../../../sensorHeartbeat.js';

const STATUS_LABELS = {
  active: 'Online',
  down: 'Overdue',
  offline: 'Offline',
  awaiting: 'Awaiting heartbeat',
};

export const getSensorHeartbeatPresentation = (sensor, now = Date.now()) => {
  // Never substitute traffic activity, placement, or generic update timestamps.
  const timestamp = getHeartbeatTimestamp({ last_seen_at: sensor?.health_last_seen_at }, now);
  const status = getHeartbeatStatus(timestamp, now);
  if (!timestamp) return { status, label: STATUS_LABELS[status], timestamp: '', relativeTime: '' };

  const minutes = Math.floor(Math.max(0, now - Date.parse(timestamp)) / 60000);
  const relativeTime = minutes < 1 ? 'just now'
    : minutes < 60 ? `${minutes}m ago`
    : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago`
    : `${Math.floor(minutes / 1440)}d ago`;
  return { status, label: STATUS_LABELS[status], timestamp, relativeTime };
};
