const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const round = value => Math.round(value * 10) / 10;

// Traffic counts are additive events. Occupancy-style per-sample means would
// undercount a corridor, and a speed below 1 mph is never a percentage.
export const addTrafficReportRow = (group, row) => {
  const volume = Math.max(0, finite(row.people_count ?? row.total_people ?? row.volume));
  const speed = finite(row.avg_speed ?? row.density);
  group.peopleSum = (group.peopleSum || 0) + volume;
  group.speedWeightedSum = (group.speedWeightedSum || 0) + speed * volume;
  group.v85WeightedSum = (group.v85WeightedSum || 0) + finite(row.v85_speed) * volume;
  group.volumeWeight = (group.volumeWeight || 0) + volume;
  group.maxSpeed = Math.max(group.maxSpeed || 0, finite(row.max_speed));
  group.approachSum = (group.approachSum || 0) + finite(row.approach_volume);
  group.awaySum = (group.awaySum || 0) + finite(row.away_volume);
  group.count = (group.count || 0) + 1;
  return group;
};

export const trafficReportPointValues = group => ({
  occupancy: group.volumeWeight > 0 ? round(group.speedWeightedSum / group.volumeWeight) : null,
  total_people: group.count > 0 ? Math.round(group.peopleSum || 0) : null,
  v85_speed: group.volumeWeight > 0 ? round(group.v85WeightedSum / group.volumeWeight) : null,
  max_speed: group.volumeWeight > 0 ? group.maxSpeed : null,
  approach_volume: group.count > 0 ? Math.round(group.approachSum || 0) : null,
  away_volume: group.count > 0 ? Math.round(group.awaySum || 0) : null,
});
