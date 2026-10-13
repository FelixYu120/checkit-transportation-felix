import { SENSOR_HEALTH_COLORS } from './TrafficSensorHealth.js';
import { getSensorCoordinates } from './TrafficSensorData.js';

export const SENSOR_OVERVIEW_ZOOM = 13;
export const SENSOR_CLUSTER_SIZE = '28px';

// Bake the total into the dot so the count cannot separate from its marker.
export const getSensorCountBadge = (count, health = 'unknown') => {
  if (!Number.isSafeInteger(count) || count < 1) return null;
  const text = String(count);
  const fontSize = Math.min(13, 38 / text.length);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15.5" fill="#ffffff"/><circle cx="16" cy="16" r="12.5" fill="#183b35" stroke="${SENSOR_HEALTH_COLORS[health] || SENSOR_HEALTH_COLORS.unknown}" stroke-width="4"/><text x="16" y="16" dy=".35em" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700">${text}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

// Count every mapped sensor, including points outside the current viewport.
export const getSensorOverview = (sensors) => {
  const points = sensors.map(getSensorCoordinates).filter(Boolean);
  if (!points.length) return null;
  const latitude = points.reduce((sum, point) => sum + point.latitude, 0) / points.length;
  // Circular mean keeps sensors across the date line together.
  const sin = points.reduce((sum, point) => sum + Math.sin(point.longitude * Math.PI / 180), 0);
  const cos = points.reduce((sum, point) => sum + Math.cos(point.longitude * Math.PI / 180), 0);
  const longitude = Math.atan2(sin, cos) * 180 / Math.PI;
  return { count: points.length, latitude, longitude };
};
