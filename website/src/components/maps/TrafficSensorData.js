export const getSensorCoordinates = (sensor) => {
  const values = [sensor.latitude, sensor.longitude];
  if (values.some((value) => value == null || String(value).trim() === '')) return null;
  const [latitude, longitude] = values.map(Number);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
};

export const getSensorHeading = (value) => {
  if (value == null || String(value).trim() === '' || typeof value === 'boolean') return null;
  const heading = Number(value);
  if (!Number.isFinite(heading)) return null;
  return ((heading % 360) + 360) % 360;
};

// Rotate the compass pointer around the sensor's exact position.
export const addHeadingPointer = (svg, value, selected = false, color = '#34524d') => {
  const heading = getSensorHeading(value);
  if (heading === null) return null;
  const pointer = `<g transform="rotate(${heading} 32 32)"><path d="M32 1L26 11H38Z" fill="${selected ? '#ffffff' : color}" stroke="${selected ? color : '#ffffff'}" stroke-width="1.5" stroke-linejoin="round"/></g>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace('</svg>', `${pointer}</svg>`))}`;
};

// Read installation records directly; occupancy and inferred/demo locations must
// never replace missing coordinates in the live transportation GIS.
export const fetchMapSensors = async (client, instituteId) => {
  if (!client) throw new Error('Transportation map connection is not configured.');
  const sensors = [];
  const pageSize = 1000;
  const optionalFields = new Set(['heading_degrees', 'deployment_type']);
  for (let offset = 0; ; ) {
    let query = client.from('sensors')
      .select(['sensor_id', 'institute_id', 'area_name', 'corridor_name', 'latitude', 'longitude', ...optionalFields].join(','))
      .order('sensor_id').range(offset, offset + pageSize - 1);
    if (instituteId) query = query.eq('institute_id', instituteId);
    const { data, error } = await query;
    if (error) {
      const missingField = [...optionalFields].find((field) =>
        ['42703', 'PGRST204'].includes(error.code) && (error.message || '').includes(field));
      if (missingField) {
        optionalFields.delete(missingField);
        continue;
      }
      throw error;
    }
    sensors.push(...(data || []));
    if (!data || data.length < pageSize) return sensors;
    offset += pageSize;
  }
};
