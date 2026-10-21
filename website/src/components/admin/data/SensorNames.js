// Names are presentation metadata. URLs, telemetry joins and map selection use sensor_id.
export const sensorDisplayName = (sensor = {}) =>
  sensor?.sensor_name?.trim() || sensor?.sensor_id?.trim() || 'Unnamed sensor';

export const sensorLabelsById = (sensors = []) => {
  const counts = new Map();
  for (const sensor of sensors) {
    const key = sensorDisplayName(sensor).toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Map(sensors.map((sensor) => {
    const name = sensorDisplayName(sensor);
    return [sensor.sensor_id, counts.get(name.toLowerCase()) > 1
      ? `${name} (${sensor.sensor_id})` : name];
  }));
};

export const SENSOR_DIRECTORY_COLUMNS = 'sensor_id,sensor_name,institute_id,area_name,corridor_name,latitude,longitude,status,speed_limit_threshold,max_speed_cap_threshold,deployment_type';
