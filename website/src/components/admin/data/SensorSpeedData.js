const KMH_PER_MPH = 1.609344;

const formatSpeedMph = (...values) => {
  const raw = values.find((value) => value != null && String(value).trim() !== '');
  if (raw === undefined || typeof raw === 'boolean') return 'Not set';
  const kmh = Number(raw);
  if (!Number.isFinite(kmh)) return 'Not set';
  return `${Math.round(kmh / KMH_PER_MPH * 10) / 10} mph`;
};

// Logistics stores radar thresholds in km/h. The web presents them in mph.
export const getSensorSpeedSetupRows = (sensor = {}) => [
  ['Speed Limit', formatSpeedMph(sensor.speed_limit_threshold, sensor.speed_limit_kmh, sensor.speed_threshold)],
  ['Max Speed Cap', formatSpeedMph(sensor.max_speed_cap_threshold, sensor.emergency_speed_kmh, sensor.max_cap, sensor.max_speed_cap_kmh)],
];
