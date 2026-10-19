export const SENSOR_CATEGORY_LABELS = { roadside: 'Roadside', warning: 'Warning' };

export const getSensorCategory = (sensor) => {
  const mode = String(sensor.operating_mode || '').trim().toLowerCase();
  if (mode === 'roadside_observation') return 'roadside';
  if (['radar_warning', 'flashing_warning', 'legacy_distance_routed_warning'].includes(mode)) return 'warning';
  return 'unknown';
};

// With both filters enabled, retain installations whose mode is not recorded.
export const getSensorFilterExpression = (categories) => {
  const selected = Object.keys(SENSOR_CATEGORY_LABELS).filter((category) => categories.includes(category));
  if (selected.length === Object.keys(SENSOR_CATEGORY_LABELS).length) return '1 = 1';
  if (!selected.length) return '1 = 0';
  return `sensor_category IN (${selected.map((category) => `'${category}'`).join(',')})`;
};
