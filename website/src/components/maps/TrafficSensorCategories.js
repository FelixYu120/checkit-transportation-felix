export const SENSOR_CATEGORY_LABELS = { roadside: 'Roadside Observation', warning: 'Warning System' };

export const getSensorCategory = (sensor = {}) => {
  const deployment = String(sensor.deployment_type || '').trim().toLowerCase();
  if (deployment === 'roadside_observation') return 'roadside';
  if (deployment === 'warning_system') return 'warning';
  return 'unknown';
};

export const getSensorCategoryLabel = (sensor) =>
  SENSOR_CATEGORY_LABELS[getSensorCategory(sensor)] || '';

// With both filters enabled, retain installations whose deployment type is not recorded.
export const getSensorFilterExpression = (categories) => {
  const selected = Object.keys(SENSOR_CATEGORY_LABELS).filter((category) => categories.includes(category));
  if (selected.length === Object.keys(SENSOR_CATEGORY_LABELS).length) return '1 = 1';
  if (!selected.length) return '1 = 0';
  return `sensor_category IN (${selected.map((category) => `'${category}'`).join(',')})`;
};
