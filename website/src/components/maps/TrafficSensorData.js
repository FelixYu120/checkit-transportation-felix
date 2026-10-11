export const getSensorCoordinates = (sensor) => {
  const values = [sensor.latitude, sensor.longitude];
  if (values.some((value) => value == null || String(value).trim() === '')) return null;
  const [latitude, longitude] = values.map(Number);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
};

// Read installation records directly; occupancy and inferred/demo locations must
// never replace missing coordinates in the live transportation GIS.
export const fetchMapSensors = async (client, instituteId) => {
  if (!client) throw new Error('Transportation map connection is not configured.');
  const sensors = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = client.from('sensors')
      .select('sensor_id, institute_id, area_name, corridor_name, latitude, longitude')
      .order('sensor_id').range(offset, offset + pageSize - 1);
    if (instituteId) query = query.eq('institute_id', instituteId);
    const { data, error } = await query;
    if (error) throw error;
    sensors.push(...(data || []));
    if (!data || data.length < pageSize) return sensors;
  }
};
