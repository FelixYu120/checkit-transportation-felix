export const SENSOR_HEALTH_COLORS = { active: '#2563eb', down: '#dc2626', unknown: '#66716e' };

export const getMapSensorHealth = (sensor, now = Date.now()) => {
  const timestamps = [sensor.health_last_seen_at, sensor.last_seen_at]
    .filter(Boolean).map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value) && value <= now + 5 * 60000);
  if (timestamps.length) return now - Math.max(...timestamps) <= 30 * 60000 ? 'active' : 'down';
  return ['offline', 'down'].includes(String(sensor.status || '').toLowerCase()) ? 'down' : 'unknown';
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
    const [sensors, health] = await Promise.all([
      load('sensors', 'sensor_id,status,last_seen_at', 'sensor_id,status'),
      load('device_health', 'sensor_id,last_seen_at'),
    ]);
    sensors.forEach((sensor) => rows.set(sensor.sensor_id, sensor));
    health.forEach((sensor) => rows.set(sensor.sensor_id, {
      ...rows.get(sensor.sensor_id), health_last_seen_at: sensor.last_seen_at,
    }));
  }
  return rows;
};
