import { getHeartbeatStatus } from '../../sensorHeartbeat.js';
export const SENSOR_HEALTH_COLORS = { active: '#2563eb', down: '#dc2626', unknown: '#66716e' };

export const getMapSensorHealth = (sensor, now = Date.now()) => {
  const status = getHeartbeatStatus(sensor.health_last_seen_at, now);
  return status === 'awaiting' ? 'unknown' : status === 'active' ? 'active' : 'down';
};

export const getAggregateMapHealth = (sensors) => {
  if (sensors.some((sensor) => sensor.map_health === 'down')) return 'down';
  return sensors.length && sensors.every((sensor) => sensor.map_health === 'active') ? 'active' : 'unknown';
};

export const colorSensorBadge = (svg, health) => {
  const color = SENSOR_HEALTH_COLORS[health] || SENSOR_HEALTH_COLORS.unknown;
  const halo = health === 'active' ? '#e2e9ef' : health === 'down' ? '#f0e3e3' : '#e5e9e7';
  return svg.replaceAll('#628079', color).replaceAll('#34524d', color).replaceAll('#e3ebe8', halo);
};

export const fetchMapSensorHealth = async (client, sensorIds) => {
  const rows = new Map();
  // Keep queries bounded and respect the same permissions as the map directory.
  for (let offset = 0; offset < sensorIds.length; offset += 200) {
    const ids = sensorIds.slice(offset, offset + 200);
    const load = async (table, columns, fallback) => {
      try {
        let result = await client.from(table).select(columns).in('sensor_id', ids);
        if (result.error && fallback && ['42703', 'PGRST204'].includes(result.error.code)) {
          result = await client.from(table).select(fallback).in('sensor_id', ids);
        }
        if (result.error) {
          console.warn(`Unable to load map health from ${table}:`, result.error.message);
          return [];
        }
        return result.data || [];
      } catch (error) {
        console.warn(`Unable to load map health from ${table}:`, error.message);
        return [];
      }
    };
    const health = await load('sensor_health', 'sensor_id,last_seen_at');
    health.forEach((sensor) => rows.set(sensor.sensor_id, {
      health_last_seen_at: sensor.last_seen_at,
    }));
  }
  return rows;
};
