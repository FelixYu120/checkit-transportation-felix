import {
  applyAnalyticsFilters,
  getDateBounds,
  hasActiveTimeFilter,
} from "../controls/AnalyticsFilterUtils";
import { getSupabaseErrorContext, shouldUseLocalData } from "../../helper/SupabaseClients.jsx";

const USE_LOCAL_SUMMARIES = shouldUseLocalData;

const FALLBACK_TEN_MINUTE_SUMMARIES = [
  { id: "03ffd455-bb24-4757-8481-75837af37de5", sensor_id: "peppercanyon1", time_bucket: "2026-06-25 23:50:00+00", direction: "away", volume: 10, avg_speed: 8, v85_speed: 10, max_speed: 10 },
  { id: "30fd292e-8c08-4b07-94b8-e8e684570318", sensor_id: "peppercanyon1", time_bucket: "2026-06-26 00:10:00+00", direction: "away", volume: 8, avg_speed: 4.5, v85_speed: 5, max_speed: 5 },
  { id: "41d046b5-0544-47e8-b61e-c68b33691508", sensor_id: "peppercanyon1", time_bucket: "2026-06-25 23:50:00+00", direction: "approach", volume: 12, avg_speed: 7.67, v85_speed: 8, max_speed: 8 },
  { id: "52b9330b-5641-423d-9e1c-fc59fd3fd80b", sensor_id: "peppercanyon1", time_bucket: "2026-06-26 00:30:00+00", direction: "away", volume: 60, avg_speed: 4.47, v85_speed: 7, max_speed: 8 },
  { id: "57424947-05cb-40e1-8568-950dfd9daa3a", sensor_id: "peppercanyon1", time_bucket: "2026-06-26 00:00:00+00", direction: "away", volume: 11, avg_speed: 3.4, v85_speed: 4, max_speed: 4 },
  { id: "64fcc029-0da6-4d62-b79a-58f5873c42d1", sensor_id: "peppercanyon1", time_bucket: "2026-06-26 00:00:00+00", direction: "approach", volume: 14, avg_speed: 3.5, v85_speed: 4, max_speed: 4 },
  { id: "6c599917-4ef5-4f75-9876-a979ca0d6678", sensor_id: "peppercanyon1", time_bucket: "2026-06-25 19:00:00+00", direction: "approach", volume: 12, avg_speed: 6.5, v85_speed: 8, max_speed: 10 },
  { id: "8a7443de-7677-4d14-b37d-6cdaa3eff43e", sensor_id: "peppercanyon1", time_bucket: "2026-06-27 01:00:00+00", direction: "approach", volume: 1, avg_speed: 3, v85_speed: 3, max_speed: 3 },
  { id: "a6570590-5280-4c39-966e-ef5ec4fbe062", sensor_id: "peppercanyon1", time_bucket: "2026-06-26 00:10:00+00", direction: "approach", volume: 13, avg_speed: 5, v85_speed: 7, max_speed: 7 },
  { id: "c6615dc1-a079-47bd-8f58-a7e7e5ad7be3", sensor_id: "peppercanyon1", time_bucket: "2026-06-27 01:00:00+00", direction: "away", volume: 1, avg_speed: 3, v85_speed: 3, max_speed: 3 },
  { id: "cbe89f22-8cb2-4894-86b1-5fd2bf36fadf", sensor_id: "peppercanyon1", time_bucket: "2026-06-26 00:30:00+00", direction: "approach", volume: 72, avg_speed: 4.4, v85_speed: 6, max_speed: 11 },
  { id: "e3d462be-2881-4173-8f73-0c1f99e440e2", sensor_id: "peppercanyon1", time_bucket: "2026-06-26 00:20:00+00", direction: "away", volume: 17, avg_speed: 23.09, v85_speed: 30, max_speed: 30 },
  { id: "f4c6d4a2-97d9-4a9d-a157-bfa3279f8884", sensor_id: "peppercanyon1", time_bucket: "2026-06-26 00:50:00+00", direction: "approach", volume: 1, avg_speed: 3, v85_speed: 3, max_speed: 3 },
  { id: "fb5294e3-0c72-44d9-ad27-93342777d329", sensor_id: "peppercanyon1", time_bucket: "2026-06-25 19:00:00+00", direction: "away", volume: 7, avg_speed: 5.2, v85_speed: 6.8, max_speed: 8 },
  { id: "fdfea46c-b482-4f21-81b0-aac08b995ae8", sensor_id: "peppercanyon1", time_bucket: "2026-06-26 00:20:00+00", direction: "approach", volume: 13, avg_speed: 5.75, v85_speed: 7, max_speed: 18 },
  { id: "ffd3717f-a499-4c15-97a2-cbbe3403742a", sensor_id: "peppercanyon1", time_bucket: "2026-06-26 00:50:00+00", direction: "away", volume: 1, avg_speed: 3, v85_speed: 3, max_speed: 3 },
];

const toIsoTimestamp = (value) => {
  if (!value) return "";
  return String(value).replace(" ", "T");
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundOne = (value) => Math.round(value * 10) / 10;

const combineDirectionRows = (rows = []) => {
  const groups = new Map();

  rows.forEach((row) => {
    const observedAt = toIsoTimestamp(row.time_bucket);
    const sensorId = row.sensor_id;
    if (!observedAt || !sensorId) return;

    const key = `${sensorId}-${observedAt}`;
    const volume = toNumber(row.volume);
    const speedWeight = volume > 0 ? volume : 1;
    const group = groups.get(key) || {
      sensor_id: sensorId,
      observed_at: observedAt,
      time_bucket: row.time_bucket,
      people_count: 0,
      total_people: 0,
      speedWeightedSum: 0,
      speedWeight: 0,
      v85WeightedSum: 0,
      max_speed: 0,
      approach_volume: 0,
      away_volume: 0,
      directions: new Set(),
    };

    group.people_count += volume;
    group.total_people += volume;
    group.speedWeightedSum += toNumber(row.avg_speed) * speedWeight;
    group.v85WeightedSum += toNumber(row.v85_speed) * speedWeight;
    group.speedWeight += speedWeight;
    group.max_speed = Math.max(group.max_speed, toNumber(row.max_speed));
    if (row.direction === "approach") group.approach_volume += volume;
    if (row.direction === "away") group.away_volume += volume;
    if (row.direction) group.directions.add(row.direction);
    groups.set(key, group);
  });

  return Array.from(groups.values())
    .map((group) => {
      const avgSpeed = group.speedWeight > 0
        ? roundOne(group.speedWeightedSum / group.speedWeight)
        : 0;

      return {
        sensor_id: group.sensor_id,
        observed_at: group.observed_at,
        time_bucket: group.time_bucket,
        people_count: group.people_count,
        total_people: group.total_people,
        density: avgSpeed,
        avg_speed: avgSpeed,
        v85_speed: group.speedWeight > 0 ? roundOne(group.v85WeightedSum / group.speedWeight) : 0,
        max_speed: group.max_speed,
        approach_volume: group.approach_volume,
        away_volume: group.away_volume,
        direction_count: group.directions.size,
      };
    })
    .sort((a, b) => new Date(a.observed_at) - new Date(b.observed_at));
};

const applyTimeBucketBounds = (query, filters) => {
  const { start, end } = getDateBounds(filters);
  let nextQuery = query;

  if (start) nextQuery = nextQuery.gte("time_bucket", start.toISOString());
  if (end) nextQuery = nextQuery.lte("time_bucket", end.toISOString());

  return nextQuery;
};

const normalizeTrafficSummaryRow = (row) => ({
  ...row,
  observed_at: toIsoTimestamp(row.time_bucket),
  volume: toNumber(row.volume),
  avg_speed: toNumber(row.avg_speed),
  v85_speed: toNumber(row.v85_speed),
  max_speed: toNumber(row.max_speed),
});

const normalizeSensorIds = (sensorIds = []) => (
  Array.from(new Set(sensorIds.filter(Boolean)))
);

const getFallbackSummaryRows = (sensorId, sensorIds = []) => {
  const normalizedSensorIds = normalizeSensorIds(sensorIds);
  if (sensorId) return FALLBACK_TEN_MINUTE_SUMMARIES.filter((row) => row.sensor_id === sensorId);
  if (normalizedSensorIds.length) {
    return FALLBACK_TEN_MINUTE_SUMMARIES.filter((row) => normalizedSensorIds.includes(row.sensor_id));
  }

  return FALLBACK_TEN_MINUTE_SUMMARIES;
};

const applyFallbackDirectionRows = (sensorId, sensorIds, filters) =>
  applyAnalyticsFilters(getFallbackSummaryRows(sensorId, sensorIds).map(normalizeTrafficSummaryRow), filters);

export const getLatestTrafficSummaryDate = (rows = []) => {
  if (!rows.length) return null;
  return rows.reduce((latest, row) => {
    const date = new Date(row.observed_at);
    return !latest || date > latest ? date : latest;
  }, null);
};

export const fetchTrafficSummaryRows = async (supabase, {
  sensorId,
  sensorIds = [],
  filters,
  type = "daily",
  limit,
} = {}) => {
  const normalizedSensorIds = normalizeSensorIds(sensorIds);

  if (USE_LOCAL_SUMMARIES) {
    const localRows = getFallbackSummaryRows(sensorId, normalizedSensorIds);

    return applyAnalyticsFilters(combineDirectionRows(localRows), filters);
  }

  try {
    const rowLimit = limit || (filters?.startDate || filters?.endDate ? 50000 : type === "weekly" || type === "monthly" ? 10000 : 1000);
    let query = supabase
      .from("ten_minute_summaries")
      .select("sensor_id, time_bucket, direction, volume, avg_speed, v85_speed, max_speed")
      .order("time_bucket", { ascending: false })
      .limit(rowLimit);

    if (sensorId) query = query.eq("sensor_id", sensorId);
    else if (normalizedSensorIds.length) query = query.in("sensor_id", normalizedSensorIds);

    if (filters?.startDate || filters?.endDate || hasActiveTimeFilter(filters)) {
      query = applyTimeBucketBounds(query, filters);
    }

    const { data, error } = await query;
    if (error) throw error;

    if (!data?.length) {
      return applyAnalyticsFilters(combineDirectionRows(getFallbackSummaryRows(sensorId, normalizedSensorIds)), filters);
    }

    return applyAnalyticsFilters(combineDirectionRows(data), filters);
  } catch (error) {
    console.warn("Using local traffic summary fallback:", getSupabaseErrorContext(error));
    const localRows = getFallbackSummaryRows(sensorId, normalizedSensorIds);

    return applyAnalyticsFilters(combineDirectionRows(localRows), filters);
  }
};

export const fetchTrafficDirectionRows = async (supabase, {
  sensorId,
  sensorIds = [],
  filters,
  type = "daily",
  limit,
} = {}) => {
  const normalizedSensorIds = normalizeSensorIds(sensorIds);

  if (USE_LOCAL_SUMMARIES || !supabase) {
    return applyFallbackDirectionRows(sensorId, normalizedSensorIds, filters);
  }

  try {
    const rowLimit = limit || (filters?.startDate || filters?.endDate ? 50000 : type === "weekly" || type === "monthly" ? 10000 : 1000);
    let query = supabase
      .from("ten_minute_summaries")
      .select("sensor_id, time_bucket, direction, volume, avg_speed, v85_speed, max_speed, created_at")
      .order("time_bucket", { ascending: false })
      .limit(rowLimit);

    if (sensorId) query = query.eq("sensor_id", sensorId);
    else if (normalizedSensorIds.length) query = query.in("sensor_id", normalizedSensorIds);

    if (filters?.startDate || filters?.endDate || hasActiveTimeFilter(filters)) {
      query = applyTimeBucketBounds(query, filters);
    }

    const { data, error } = await query;
    if (error) throw error;

    if (!data?.length) {
      console.warn("Using local directional traffic fallback: remote source returned no rows");
      return applyFallbackDirectionRows(sensorId, normalizedSensorIds, filters);
    }

    return applyAnalyticsFilters(data.map(normalizeTrafficSummaryRow), filters);
  } catch (error) {
    console.warn("Using local directional traffic fallback:", getSupabaseErrorContext(error));
    return applyFallbackDirectionRows(sensorId, normalizedSensorIds, filters);
  }
};
