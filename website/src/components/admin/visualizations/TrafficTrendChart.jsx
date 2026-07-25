import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import supabase from "../../helper/SupabaseClients";
import { fetchTrafficDirectionRows } from '../data/TrafficSummaryData';
import styles from './TrafficTrendChart.module.css';

const PACIFIC_TIME_ZONE = 'America/Los_Angeles';
const HOUR_MS = 60 * 60 * 1000;
const TRAFFIC_COLORS = {
  volume: '#4f9f98',
  approach: '#4f9f98',
  away: '#6b8fcb',
  avgSpeed: '#d97706',
  v85Speed: '#64748b',
};

const timeFormatter = new Intl.DateTimeFormat([], {
  hour: 'numeric',
  timeZone: PACIFIC_TIME_ZONE,
});

const dateTimeFormatter = new Intl.DateTimeFormat([], {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: PACIFIC_TIME_ZONE,
});

const tooltipDateFormatter = new Intl.DateTimeFormat([], {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: PACIFIC_TIME_ZONE,
});

const tooltipTimeFormatter = new Intl.DateTimeFormat([], {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: PACIFIC_TIME_ZONE,
});

const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: PACIFIC_TIME_ZONE,
});

const dayLabelFormatter = new Intl.DateTimeFormat([], {
  weekday: 'short',
  timeZone: 'UTC',
});

const monthDayFormatter = new Intl.DateTimeFormat([], {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

const formatHourLabel = (value) => timeFormatter.format(new Date(value));

const formatDateTime = (value) => dateTimeFormatter.format(new Date(value));

const formatTooltipDateTime = (value) => {
  const date = new Date(value);
  return {
    date: tooltipDateFormatter.format(date),
    time: tooltipTimeFormatter.format(date),
  };
};

const roundOne = (value) => Math.round(value * 10) / 10;

const toFiniteDate = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const getLocalDateKey = (date = new Date()) => {
  const parts = Object.fromEntries(
    dateKeyFormatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  return `${year}-${month}-${day}`;
};

const getDateKeyFromParts = (year, monthIndex, day) => (
  `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
);

const getCalendarDate = (dateKey) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const addCalendarDays = (dateKey, days) => {
  const date = getCalendarDate(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return getDateKeyFromParts(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

const getMonthKey = (date = new Date()) => {
  const dateKey = getLocalDateKey(date);
  return dateKey.slice(0, 7);
};

const getMonthLabel = (monthKey) => {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString([], {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

const addCalendarMonths = (monthKey, months) => {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCMonth(date.getUTCMonth() + months);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const getRowDate = (row) => toFiniteDate(row.observed_at || row.time_bucket);

const getLatestRowDate = (rows = []) => rows.reduce((latest, row) => {
  const rowDate = getRowDate(row);
  if (!rowDate) return latest;
  return !latest || rowDate > latest ? rowDate : latest;
}, null);

const getAnchorDate = (rows = [], filters = {}) => {
  const filterDate = filters.endDate || filters.startDate;
  if (filterDate) return new Date(`${filterDate}T23:59:59`);
  return getLatestRowDate(rows) || new Date();
};

const getHourlyBucketKey = (value) => {
  const date = toFiniteDate(value);
  if (!date) return '';

  date.setMinutes(0, 0, 0);
  return date.toISOString();
};

const getDayBucketKey = (value) => {
  const date = toFiniteDate(value);
  return date ? getLocalDateKey(date) : '';
};

const getHourlyBuckets = (rows = [], filters = {}) => {
  const buckets = [];
  const filterDate = filters.endDate || filters.startDate;
  let previousDateKey = '';

  if (filterDate) {
    const [year, month, day] = filterDate.split('-').map(Number);
    const start = new Date(year, month - 1, day, 0, 0, 0, 0);

    for (let index = 0; index < 24; index += 1) {
      const bucketDate = new Date(start.getTime() + (index * HOUR_MS));
      const key = getHourlyBucketKey(bucketDate);
      const dateKey = getLocalDateKey(bucketDate);
      const isDayStart = index === 0 || dateKey !== previousDateKey;
      buckets.push({
        key,
        time: formatHourLabel(key),
        fullTime: formatDateTime(key),
        dateLabel: monthDayFormatter.format(getCalendarDate(dateKey)),
        isDayStart,
        isFirstBucket: index === 0,
      });
      previousDateKey = dateKey;
    }

    return buckets;
  }

  const end = getAnchorDate(rows, filters);
  end.setMinutes(0, 0, 0);
  const startTime = end.getTime() - (23 * HOUR_MS);

  for (let index = 0; index < 24; index += 1) {
    const bucketDate = new Date(startTime + (index * HOUR_MS));
    const key = getHourlyBucketKey(bucketDate);
    const dateKey = getLocalDateKey(bucketDate);
    const isDayStart = index === 0 || dateKey !== previousDateKey;
    buckets.push({
      key,
      time: formatHourLabel(key),
      fullTime: formatDateTime(key),
      dateLabel: monthDayFormatter.format(getCalendarDate(dateKey)),
      isDayStart,
      isFirstBucket: index === 0,
    });
    previousDateKey = dateKey;
  }

  return buckets;
};

const getDailyRange = (startKey, endKey, labelType = 'day') => {
  const buckets = [];
  let currentKey = startKey;

  while (currentKey <= endKey) {
    const date = getCalendarDate(currentKey);
    buckets.push({
      key: currentKey,
      time: labelType === 'weekday' ? dayLabelFormatter.format(date) : monthDayFormatter.format(date),
      fullTime: monthDayFormatter.format(date),
    });
    currentKey = addCalendarDays(currentKey, 1);
  }

  return buckets;
};

const getMonthlyRange = (startKey, endKey) => {
  const buckets = [];
  let currentKey = startKey.slice(0, 7);
  const finalKey = endKey.slice(0, 7);

  while (currentKey <= finalKey) {
    buckets.push({
      key: currentKey,
      time: getMonthLabel(currentKey),
      fullTime: getMonthLabel(currentKey),
    });
    currentKey = addCalendarMonths(currentKey, 1);
  }

  return buckets;
};

const getFilterRangeDays = (filters = {}) => {
  if (!filters.startDate && !filters.endDate) return 1;
  const startKey = filters.startDate || filters.endDate;
  const endKey = filters.endDate || filters.startDate;
  const start = getCalendarDate(startKey);
  const end = getCalendarDate(endKey);
  return Math.max(1, Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1);
};

const shouldUseMonthlyBuckets = (type, filters = {}) => (
  type === 'monthly' && Boolean(filters.startDate || filters.endDate) && getFilterRangeDays(filters) > 62
);

const getWeeklyBuckets = (rows = [], filters = {}) => {
  const endKey = getLocalDateKey(getAnchorDate(rows, filters));
  const startKey = addCalendarDays(endKey, -6);
  return getDailyRange(startKey, endKey, 'weekday');
};

const getMonthDateRange = (rows = [], filters = {}) => {
  const anchorKey = getLocalDateKey(getAnchorDate(rows, filters));
  const endKey = anchorKey;
  const startKey = addCalendarDays(endKey, -29);
  return getDailyRange(startKey, endKey, 'monthDay');
};

const getChartBuckets = (type, rows, filters) => {
  if (shouldUseMonthlyBuckets(type, filters)) {
    const startKey = filters.startDate || filters.endDate;
    const endKey = filters.endDate || filters.startDate;
    return getMonthlyRange(startKey, endKey);
  }
  if (type === 'monthly') return getMonthDateRange(rows, filters);
  if (type === 'weekly') return getWeeklyBuckets(rows, filters);
  return getHourlyBuckets(rows, filters);
};

const hasDateFilter = (filters) => Boolean(filters?.startDate || filters?.endDate);

const getWindowHours = (type) => {
  if (type === 'monthly') return 30 * 24;
  if (type === 'weekly') return 7 * 24;
  return 24;
};

const getWindowedRows = (rows, type, filters) => {
  if (!rows.length || hasDateFilter(filters)) return rows;

  const latestDate = getLatestRowDate(rows);
  const latestTime = latestDate?.getTime() || 0;
  if (!latestDate || !latestTime) return rows;

  const windowStart = latestTime - (getWindowHours(type) * HOUR_MS);
  return rows.filter((row) => {
    const rowTime = new Date(row.observed_at).getTime();
    return Number.isFinite(rowTime) && rowTime >= windowStart && rowTime <= latestTime;
  });
};

const weightedAverageSpeed = (weightedSum, weight) => (
  weight > 0 ? roundOne(weightedSum / weight) : null
);

const createEmptyAggregate = (bucket) => ({
  ...bucket,
  approach: 0,
  away: 0,
  volume: 0,
  sampleCount: 0,
  speedWeightedSum: 0,
  v85WeightedSum: 0,
  speedWeight: 0,
  maxSpeed: 0,
});

const aggregateSummariesByBucket = (rows = [], buckets = [], getBucketKey) => {
  const groups = new Map(
    buckets.map((bucket) => [bucket.key, createEmptyAggregate(bucket)])
  );

  rows.forEach((row) => {
    const key = getBucketKey(row.observed_at);
    if (!key) return;

    const group = groups.get(key) || createEmptyAggregate({
      key,
      time: formatDateTime(row.observed_at),
      fullTime: formatDateTime(row.observed_at),
    });
    const directionKey = row.direction === 'away' ? 'away' : 'approach';
    const volume = Number(row.volume) || 0;

    group[directionKey] += volume;
    group.volume += volume;
    group.sampleCount += 1;
    if (volume > 0) {
      group.speedWeightedSum += (Number(row.avg_speed) || 0) * volume;
      group.v85WeightedSum += (Number(row.v85_speed) || 0) * volume;
      group.speedWeight += volume;
    }
    group.maxSpeed = Math.max(group.maxSpeed, Number(row.max_speed) || 0);
    groups.set(key, group);
  });

  return Array.from(groups.values())
    .sort((a, b) => String(a.key).localeCompare(String(b.key)))
    .map((group) => ({
      key: group.key,
      time: group.time,
      fullTime: group.fullTime,
      approach: group.approach,
      away: group.away,
      volume: group.volume,
      sampleCount: group.sampleCount,
      avgSpeed: weightedAverageSpeed(group.speedWeightedSum, group.speedWeight),
      v85Speed: weightedAverageSpeed(group.v85WeightedSum, group.speedWeight),
      maxSpeed: roundOne(group.maxSpeed),
    }));
};

const buildChartData = (rows, type, filters) => {
  const buckets = getChartBuckets(type, rows, filters);
  const getBucketKey = shouldUseMonthlyBuckets(type, filters)
    ? (value) => {
      const date = toFiniteDate(value);
      return date ? getMonthKey(date) : '';
    }
    : type === 'daily'
      ? getHourlyBucketKey
      : getDayBucketKey;

  // Ten-minute summaries arrive as one row per direction. Chart buckets first
  // create the expected time range, then merge both directions into that range.
  return aggregateSummariesByBucket(rows, buckets, getBucketKey);
};

const getChartTitle = (mode) => {
  if (mode === 'direction') return 'Direction Split';
  if (mode === 'volume') return 'Speed Profile';
  return 'Traffic Flow';
};

const getXAxisInterval = (type) => {
  if (type === 'weekly') return 0;
  if (type === 'monthly') return 4;
  return 'preserveStartEnd';
};

const getNiceCeiling = (value) => {
  const numeric = Number(value) || 0;
  if (numeric <= 10) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(numeric));
  return Math.ceil(numeric / magnitude) * magnitude;
};

const buildChartStats = (points = []) => {
  const totals = points.reduce((acc, point) => {
    const volume = Number(point.volume) || 0;

    acc.volume += volume;
    acc.approach += Number(point.approach) || 0;
    acc.away += Number(point.away) || 0;
    if (volume > 0 && point.avgSpeed != null) {
      acc.speedWeightedSum += Number(point.avgSpeed) * volume;
      acc.speedWeight += volume;
    }
    if (volume > 0 && point.v85Speed != null) {
      acc.v85WeightedSum += Number(point.v85Speed) * volume;
      acc.v85Weight += volume;
    }
    acc.maxSpeed = Math.max(acc.maxSpeed, Number(point.maxSpeed) || 0);
    if (volume > 0 && (!acc.peak || volume > acc.peak.volume)) acc.peak = point;
    return acc;
  }, {
    volume: 0,
    approach: 0,
    away: 0,
    speedWeightedSum: 0,
    v85WeightedSum: 0,
    speedWeight: 0,
    v85Weight: 0,
    maxSpeed: 0,
    peak: null,
  });

  return {
    totalVolume: totals.volume,
    approach: totals.approach,
    away: totals.away,
    avgSpeed: weightedAverageSpeed(totals.speedWeightedSum, totals.speedWeight) ?? 0,
    v85Speed: weightedAverageSpeed(totals.v85WeightedSum, totals.v85Weight) ?? 0,
    maxSpeed: roundOne(totals.maxSpeed),
    peakLabel: totals.peak?.time || 'No peak',
  };
};

const getDisplaySpeed = (value) => (value == null ? 'No data' : `${value} mph`);

const getChartMargin = (mode) => ({
  top: 10,
  right: mode === 'direction' ? 24 : 30,
  left: 25,
  bottom: 35,
});

const getXAxisHeight = (type) => (type === 'daily' ? 58 : 46);

const TrafficXAxisTick = ({ x, y, payload, pointsByKey, type }) => {
  const point = pointsByKey.get(payload.value);
  if (!point) return null;

  if (type !== 'daily') {
    return (
      <text x={x} y={y + 16} textAnchor="middle" fill="#64748b" fontSize={11}>
        {point.time}
      </text>
    );
  }

  return (
    <g transform={`translate(${x},${y})`}>
      {point.isFirstBucket && (
        <text x={0} y={14} textAnchor="middle" fill="#334155" fontSize={11} fontWeight={800}>
          {point.dateLabel}
        </text>
      )}
      <text
        x={0}
        y={point.isFirstBucket ? 34 : 24}
        textAnchor="middle"
        fill="#64748b"
        fontSize={11}
      >
        {point.time}
      </text>
    </g>
  );
};

const getMetricSet = (mode, stats) => {
  if (mode === 'direction') {
    return [
      {
        label: 'Total volume',
        value: stats.totalVolume,
        detail: 'Total observed movement across both directions in this chart window.',
      },
      {
        label: 'Approach',
        value: stats.approach,
        detail: 'Movement traveling toward the monitored approach direction in this chart window.',
      },
      {
        label: 'Away',
        value: stats.away,
        detail: 'Movement traveling away from the monitored approach direction in this chart window.',
      },
      {
        label: 'Peak interval',
        value: stats.peakLabel,
        detail: 'The interval with the highest observed movement in this chart window.',
      },
    ];
  }

  if (mode === 'volume') {
    return [
      {
        label: 'Average speed',
        value: `${stats.avgSpeed} mph`,
        detail: 'Weighted average traffic speed across the chart window.',
      },
      {
        label: '85th percentile speed',
        value: `${stats.v85Speed} mph`,
        detail: 'Volume-weighted 85th percentile speed approximation across the chart window.',
      },
      {
        label: 'Max speed',
        value: `${stats.maxSpeed} mph`,
        detail: 'Highest recorded speed in this chart window.',
      },
      {
        label: 'Peak interval',
        value: stats.peakLabel,
        detail: 'The interval with the highest observed movement in this chart window.',
      },
    ];
  }

  return [
    {
      label: 'Total volume',
      value: stats.totalVolume,
      detail: 'Total observed movement in this chart window.',
    },
    {
      label: 'Average speed',
      value: `${stats.avgSpeed} mph`,
      detail: 'Weighted average traffic speed across the chart window.',
    },
    {
      label: '85th percentile speed',
      value: `${stats.v85Speed} mph`,
      detail: 'Volume-weighted 85th percentile speed approximation across the chart window.',
    },
    {
      label: 'Max speed',
      value: `${stats.maxSpeed} mph`,
      detail: 'Highest recorded speed in this chart window.',
    },
  ];
};

const getLegendItems = (mode) => {
  if (mode === 'direction') {
    return [
      { label: 'Approach', color: TRAFFIC_COLORS.approach, bar: true },
      { label: 'Away', color: TRAFFIC_COLORS.away, bar: true },
    ];
  }

  if (mode === 'volume') {
    return [
      { label: 'Low', color: '#d9efec' },
      { label: 'High', color: '#4f9f98' },
    ];
  }

  return [
    { label: 'Total volume', color: TRAFFIC_COLORS.volume, bar: true },
    { label: 'Speed', color: TRAFFIC_COLORS.avgSpeed },
  ];
};

const TooltipRow = ({ label, value }) => (
  <span className={styles.tooltipRow}>
    <span>{label}</span>
    <span>{value}</span>
  </span>
);

const TooltipSection = ({ title, children }) => (
  <div className={styles.tooltipSection}>
    <span className={styles.tooltipSectionTitle}>{title}</span>
    {children}
  </div>
);

const getHeatmapMetric = (point, mode) => {
  if (mode === 'direction') return Math.max(Number(point.approach) || 0, Number(point.away) || 0);
  if (mode === 'volume') return Number(point.avgSpeed) || 0;
  return Number(point.volume) || 0;
};

const getHeatmapLabel = (mode) => {
  if (mode === 'direction') return 'direction volume';
  if (mode === 'volume') return 'avg speed';
  return 'traffic volume';
};

const getHeatmapColor = (value, maxValue) => {
  if (!value || !maxValue) return '#f1f5f9';
  const intensity = value / maxValue;
  if (intensity >= 0.8) return '#4f9f98';
  if (intensity >= 0.6) return '#6bb5ad';
  if (intensity >= 0.4) return '#8ecac3';
  if (intensity >= 0.2) return '#bfe3df';
  return '#e5f5f3';
};

const getHeatmapTextColor = (value, maxValue) => {
  if (!value || !maxValue) return '#64748b';
  return value / maxValue >= 0.72 ? '#ffffff' : '#172033';
};

const MonthlyTooltipContent = ({ cell, mode }) => {
  if (mode === 'direction') {
    return (
      <TooltipSection title="Movement">
        <span>Total volume: {cell.volume || 0}</span>
        <span>Approach: {cell.approach || 0}</span>
        <span>Away: {cell.away || 0}</span>
      </TooltipSection>
    );
  }

  if (mode === 'volume') {
    return (
      <TooltipSection title="Speed">
        <span>Average: {getDisplaySpeed(cell.avgSpeed)}</span>
        <span>85th percentile: {getDisplaySpeed(cell.v85Speed)}</span>
        <span>Max: {getDisplaySpeed(cell.maxSpeed)}</span>
      </TooltipSection>
    );
  }

  return (
    <>
      <TooltipSection title="Movement">
        <span>Total volume: {cell.volume || 0}</span>
        <span>Approach: {cell.approach || 0}</span>
        <span>Away: {cell.away || 0}</span>
      </TooltipSection>
      <TooltipSection title="Speed">
        <span>Average: {getDisplaySpeed(cell.avgSpeed)}</span>
        <span>85th percentile: {getDisplaySpeed(cell.v85Speed)}</span>
        <span>Max: {getDisplaySpeed(cell.maxSpeed)}</span>
      </TooltipSection>
    </>
  );
};

const MonthlyTrafficHeatmap = ({ data, mode }) => {
  const [activeCell, setActiveCell] = useState(null);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const firstDate = data.length ? getCalendarDate(data[0].key) : null;
  const leadingBlanks = firstDate && Number.isFinite(firstDate.getTime()) ? firstDate.getUTCDay() : 0;
  const maxValue = Math.max(0, ...data.map((point) => getHeatmapMetric(point, mode)));
  const label = getHeatmapLabel(mode);
  const cells = [
    ...Array.from({ length: leadingBlanks }, (_, index) => ({ key: `blank-${index}`, blank: true })),
    ...data,
  ];

  return (
    <div className={styles.heatmap}>
      <div className={styles.heatmapWeekdays}>
        {days.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className={styles.heatmapGrid}>
        {cells.map((cell) => {
          if (cell.blank) return <div key={cell.key} aria-hidden="true" />;
          const date = getCalendarDate(cell.key);
          const value = getHeatmapMetric(cell, mode);
          const dayNumber = date.getUTCDate();
          return (
            <div
              key={cell.key}
              className={styles.heatmapCell}
              style={{
                '--heatmap-color': getHeatmapColor(value, maxValue),
                '--heatmap-text-color': getHeatmapTextColor(value, maxValue),
              }}
              title={`${cell.fullTime || cell.time}: ${label} ${mode === 'volume' ? getDisplaySpeed(value) : value}`}
              onMouseEnter={() => setActiveCell(cell)}
              onMouseLeave={() => setActiveCell(null)}
              onFocus={() => setActiveCell(cell)}
              onBlur={() => setActiveCell(null)}
              tabIndex={0}
            >
              <strong>{dayNumber}</strong>
              <span>{mode === 'volume' ? getDisplaySpeed(value) : value || '-'}</span>
              {activeCell?.key === cell.key && (
                <div className={styles.heatmapTooltip}>
                  <strong>{cell.fullTime || cell.time}</strong>
                  <MonthlyTooltipContent cell={cell} mode={mode} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className={styles.heatmapLegend}>
        <span>Low</span>
        {[0.15, 0.35, 0.55, 0.75, 0.95].map((ratio) => (
          <i key={ratio} style={{ '--heatmap-color': getHeatmapColor(maxValue * ratio, maxValue) }} />
        ))}
        <span>High</span>
      </div>
    </div>
  );
};

const TrafficTrendChart = ({ sensorId, filters, type = 'daily', mode = 'combined', title, onSnapshotData }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const effectiveFilters = useMemo(() => ({
    startDate: filters?.startDate || '',
    endDate: filters?.endDate || '',
    startTime: filters?.startTime || '',
    endTime: filters?.endTime || '',
    dayPreset: filters?.dayPreset || 'all',
  }), [filters]);

  const windowedRows = useMemo(
    () => getWindowedRows(rows, type, effectiveFilters),
    [rows, type, effectiveFilters]
  );
  const chartData = useMemo(
    () => buildChartData(windowedRows, type, effectiveFilters),
    [windowedRows, type, effectiveFilters]
  );
  const legendItems = useMemo(() => getLegendItems(mode), [mode]);
  const xAxisInterval = getXAxisInterval(type);
  const chartMargin = useMemo(() => getChartMargin(mode), [mode]);
  const pointsByKey = useMemo(
    () => new Map(chartData.map((point) => [point.key, point])),
    [chartData]
  );
  const dayDividers = useMemo(
    () => (type === 'daily' ? chartData.filter((point) => point.isDayStart && !point.isFirstBucket) : []),
    [chartData, type]
  );
  const volumeAxisMax = useMemo(() => {
    const values = chartData.map((point) => (
      mode === 'direction'
        ? Math.max(Number(point.approach) || 0, Number(point.away) || 0)
        : Number(point.volume) || 0
    ));

    return getNiceCeiling(Math.max(...values, 10));
  }, [chartData, mode]);
  const speedAxisMax = useMemo(() => getNiceCeiling(Math.max(...chartData.map((point) => (
    Number(point.maxSpeed) || Number(point.v85Speed) || Number(point.avgSpeed) || 0
  )), 10)), [chartData]);

  useEffect(() => {
    if (!loading) onSnapshotData?.(chartData);
  }, [chartData, loading, onSnapshotData]);

  useEffect(() => {
    const loadRows = async () => {
      setLoading(true);
      try {
        const nextRows = await fetchTrafficDirectionRows(supabase, {
          sensorId,
          filters: effectiveFilters,
          type,
        });
        setRows(nextRows);
      } catch (error) {
        console.error('Traffic trend fetch error:', error);
        setRows([]);
      } finally {
        setLoading(false);
      }
    };

    loadRows();
  }, [sensorId, type, effectiveFilters]);

  if (loading) {
    return <div className={styles.loading}>Loading traffic trend...</div>;
  }

  if (!chartData.length) {
    return (
      <div className={styles.shell}>
        <div className={styles.header}>
          <div className={styles.titleBlock}>
            <h3>{title || getChartTitle(mode)}</h3>
          </div>
        </div>
        <div className={styles.empty}>
          <strong>No traffic summaries found for this chart.</strong>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h3>{title || getChartTitle(mode)}</h3>
        </div>
      </div>

      <div className={styles.canvas}>
        {type === 'monthly' ? (
          <MonthlyTrafficHeatmap data={chartData} mode={mode} />
        ) : (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={chartMargin}>
            <CartesianGrid stroke="#eef3f6" vertical={false} />
            <XAxis
              dataKey="key"
              height={getXAxisHeight(type)}
              tickLine={false}
              axisLine={false}
              minTickGap={25}
              interval={xAxisInterval}
              tick={<TrafficXAxisTick pointsByKey={pointsByKey} type={type} />}
            />
            <YAxis
              yAxisId="volume"
              domain={[0, volumeAxisMax]}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={55}
            />
            {mode !== 'direction' && (
              <YAxis
                yAxisId="speed"
                orientation="right"
                domain={[0, speedAxisMax]}
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={45}
              />
            )}
            {dayDividers.map((point) => (
              <ReferenceLine
                key={`day-divider-${point.key}`}
                x={point.key}
                stroke="#cbd5e1"
                strokeDasharray="3 4"
                strokeWidth={1}
                ifOverflow="extendDomain"
                label={{
                  value: point.dateLabel,
                  position: 'insideTop',
                  fill: '#475569',
                  fontSize: 11,
                  fontWeight: 800,
                }}
              />
            ))}
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0].payload;
                const tooltipDateTime = formatTooltipDateTime(point.key);
                return (
                  <div className={styles.tooltip}>
                    <strong>
                      {tooltipDateTime.date}
                      <span>{tooltipDateTime.time}</span>
                    </strong>
                    {mode !== 'volume' && (
                      <TooltipSection title="Movement">
                        <TooltipRow label="Total volume" value={point.volume} />
                        <TooltipRow label="Approach" value={point.approach} />
                        <TooltipRow label="Away" value={point.away} />
                      </TooltipSection>
                    )}
                    {mode !== 'direction' && (
                      <TooltipSection title="Speed">
                        <TooltipRow label="Average" value={getDisplaySpeed(point.avgSpeed)} />
                        <TooltipRow label="85th percentile" value={getDisplaySpeed(point.v85Speed)} />
                        <TooltipRow label="Max" value={`${point.maxSpeed} mph`} />
                      </TooltipSection>
                    )}
                  </div>
                );
              }}
            />
            {mode === 'direction' ? (
              <>
                <Bar yAxisId="volume" dataKey="approach" name="Approach" fill={TRAFFIC_COLORS.approach} radius={[6, 6, 0, 0]} />
                <Bar yAxisId="volume" dataKey="away" name="Away" fill={TRAFFIC_COLORS.away} radius={[6, 6, 0, 0]} />
              </>
            ) : mode === 'volume' ? (
              <>
                <Line yAxisId="speed" type="monotone" dataKey="avgSpeed" name="Avg speed" stroke={TRAFFIC_COLORS.avgSpeed} strokeWidth={3} dot={{ r: 3, strokeWidth: 1, fill: '#ffffff' }} activeDot={{ r: 5 }} />
                <Line yAxisId="speed" type="monotone" dataKey="v85Speed" name="85th percentile speed" stroke={TRAFFIC_COLORS.v85Speed} strokeWidth={2.5} strokeDasharray="5 5" dot={{ r: 2.5, strokeWidth: 1, fill: '#ffffff' }} activeDot={{ r: 5 }} />
              </>
            ) : (
              <>
                <Bar yAxisId="volume" dataKey="volume" name="Total volume" fill={TRAFFIC_COLORS.volume} opacity={0.9} radius={[6, 6, 0, 0]} />
                <Line yAxisId="speed" type="monotone" dataKey="avgSpeed" name="Avg speed" stroke={TRAFFIC_COLORS.avgSpeed} strokeWidth={3} dot={{ r: 3, strokeWidth: 1, fill: '#ffffff' }} activeDot={{ r: 5 }} />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
        )}
      </div>

      <div className={styles.legend} aria-label="Chart legend">
        {legendItems.map((item) => (
          <span key={item.label} className={styles.legendItem}>
            <i
              className={`${styles.swatch} ${item.bar ? styles.barSwatch : ''}`}
              style={{ '--swatch-color': item.color }}
              aria-hidden="true"
            />
            {item.label}
          </span>
        ))}
      </div>

    </div>
  );
};

export default TrafficTrendChart;
