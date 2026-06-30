import { applyAnalyticsFilters } from '../controls/AnalyticsFilterUtils';
import { fetchTrafficSummaryRows, getLatestTrafficSummaryDate } from '../data/TrafficSummaryData';

export const fetchOccupancyHistory = async (supabase, { roomId, type, filters }) => {
  const data = await fetchTrafficSummaryRows(supabase, {
    sensorId: roomId,
    filters,
    type,
  });
  const now = getLatestTrafficSummaryDate(data) || new Date();

  return buildOccupancyChartData(applyAnalyticsFilters(data || [], filters), { now, type, filters });
};

export const buildOccupancyChartData = (rawData, { now = new Date(), type, filters }) => {
  if (filters?.startDate || filters?.endDate) {
    return buildGroupedOccupancyChartData(rawData, { type });
  }

  const timeline = type === "weekly"
    ? buildWeeklyTimeline(now)
    : buildDailyTimeline(now);

  let maxValue = 0;
  const chartData = timeline.map((slot) => {
    const matches = rawData.filter((point) => matchesTimelineSlot(point, slot, type));

    if (matches.length === 0) return slot;

    const densityVal = Math.round(
      matches.reduce((acc, curr) => acc + (curr.density ?? 0), 0) / matches.length
    );
    const peopleVal = Math.round(
      matches.reduce((acc, curr) => acc + (curr.people_count ?? 0), 0) / matches.length
    );

    if (densityVal > maxValue) maxValue = densityVal;
    return { ...slot, density: densityVal, peopleCount: peopleVal };
  });

  return { chartData, maxValue };
};

const buildGroupedOccupancyChartData = (rawData, { type }) => {
  let maxValue = 0;
  const groups = rawData.reduce((acc, row) => {
    const date = new Date(row.observed_at);
    const key = type === "weekly"
      ? date.toLocaleDateString("en-US", { weekday: "short" })
      : date.toLocaleTimeString("en-US", { hour: "numeric", hour12: true }).toLowerCase().replace(/\s/g, "");

    if (!acc[key]) {
      acc[key] = { time: key, density: 0, peopleCount: 0, count: 0 };
    }

    acc[key].density += row.density ?? 0;
    acc[key].peopleCount += row.people_count ?? 0;
    acc[key].count += 1;
    return acc;
  }, {});

  const chartData = Object.values(groups).map((group) => {
    const density = Math.round(group.density / group.count);
    if (density > maxValue) maxValue = density;

    return {
      time: group.time,
      density,
      peopleCount: Math.round(group.peopleCount / group.count),
    };
  });

  return { chartData, maxValue };
};

const buildWeeklyTimeline = (now) => {
  const timeline = [];

  for (let i = 6; i >= 0; i--) {
    const day = new Date(now);
    day.setDate(day.getDate() - i);
    day.setHours(0, 0, 0, 0);
    timeline.push({
      time: day.toLocaleDateString("en-US", { weekday: "short" }),
      matchKey: day.toDateString(),
      density: null,
      peopleCount: null,
    });
  }

  return timeline;
};

const buildDailyTimeline = (now) => {
  const timeline = [];

  for (let i = 23; i >= 0; i--) {
    const hour = new Date(now.getTime() - i * 3600000);
    hour.setMinutes(0, 0, 0);
    timeline.push({
      time: hour
        .toLocaleTimeString("en-US", { hour: "numeric", hour12: true })
        .toLowerCase()
        .replace(/\s/g, ""),
      matchHour: hour.getHours(),
      matchDate: hour.toDateString(),
      density: null,
      peopleCount: null,
    });
  }

  return timeline;
};

const matchesTimelineSlot = (point, slot, type) => {
  const pointDate = new Date(point.observed_at);

  if (type === "weekly") {
    return pointDate.toDateString() === slot.matchKey;
  }

  return (
    pointDate.getHours() === slot.matchHour &&
    pointDate.toDateString() === slot.matchDate
  );
};
