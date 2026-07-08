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
  volume: '#0f766e',
  approach: '#0f766e',
  away: '#2563eb',
  avgSpeed: '#f97316',
  v85Speed: '#475569',
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

const getMonthBounds = (dateKey) => {
  const [year, month] = dateKey.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));

  return {
    startKey: getDateKeyFromParts(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
    endKey: getDateKeyFromParts(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
  };
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

const getWeeklyBuckets = (rows = [], filters = {}) => {
  const endKey = getLocalDateKey(getAnchorDate(rows, filters));
  const startKey = addCalendarDays(endKey, -6);
  return getDailyRange(startKey, endKey, 'weekday');
};

const getMonthDateRange = (rows = [], filters = {}) => {
  const anchorKey = getLocalDateKey(getAnchorDate(rows, filters));
  const { startKey, endKey } = getMonthBounds(anchorKey);
  return getDailyRange(startKey, endKey, 'monthDay');
};

const getChartBuckets = (type, rows, filters) => {
  if (type === 'monthly') return getMonthDateRange(rows, filters);
  if (type === 'weekly') return getWeeklyBuckets(rows, filters);
  return getHourlyBuckets(rows, filters);
};

const hasDateFilter = (filters) => Boolean(filters?.startDate || filters?.endDate);

const getWindowHours = (type) => {
  if (type === 'monthly') return 31 * 24;
  if (type === 'weekly') return 7 * 24;
  return 24;
};

const getWindowedRows = (rows, type, filters) => {
  if (!rows.length || hasDateFilter(filters)) return rows;

  const latestTime = getLatestRowDate(rows)?.getTime() || 0;
  if (!latestTime) return rows;

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
      avgSpeed: weightedAverageSpeed(group.speedWeightedSum, group.speedWeight),
      v85Speed: weightedAverageSpeed(group.v85WeightedSum, group.speedWeight),
      maxSpeed: roundOne(group.maxSpeed),
    }));
};

const buildChartData = (rows, type, filters) => {
  const buckets = getChartBuckets(type, rows, filters);
  const getBucketKey = type === 'daily' ? getHourlyBucketKey : getDayBucketKey;

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
        label: '85th speed',
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
      label: '85th speed',
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
      { label: 'Avg speed', color: TRAFFIC_COLORS.avgSpeed },
      { label: '85th speed', color: TRAFFIC_COLORS.v85Speed },
    ];
  }

  return [
    { label: 'Total volume', color: TRAFFIC_COLORS.volume, bar: true },
    { label: 'Avg speed', color: TRAFFIC_COLORS.avgSpeed },
  ];
};

const TooltipRow = ({ label, value }) => (
  <span className={styles.tooltipRow}>
    <span>{label}</span>
    <span>{value}</span>
  </span>
);

const TrafficTrendChart = ({ sensorId, filters, type = 'daily', mode = 'combined', title }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeMetric, setActiveMetric] = useState(null);
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
  const chartStats = useMemo(() => buildChartStats(chartData), [chartData]);
  const metricSet = useMemo(() => getMetricSet(mode, chartStats), [mode, chartStats]);
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

      <div className={styles.metricStrip}>
        {metricSet.map((metric) => (
          <button
            key={metric.label}
            type="button"
            className={styles.metric}
            onClick={() => setActiveMetric(metric)}
            aria-label={`${metric.label} details`}
          >
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </button>
        ))}
      </div>

      <div className={styles.canvas}>
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
                    {mode !== 'volume' && <TooltipRow label="Total volume" value={point.volume} />}
                    {mode === 'direction' && <TooltipRow label="Approach" value={point.approach} />}
                    {mode === 'direction' && <TooltipRow label="Away" value={point.away} />}
                    {mode !== 'direction' && <TooltipRow label="Avg speed" value={getDisplaySpeed(point.avgSpeed)} />}
                    {mode !== 'direction' && <TooltipRow label="85th speed" value={getDisplaySpeed(point.v85Speed)} />}
                    {mode !== 'direction' && <TooltipRow label="Max speed" value={`${point.maxSpeed} mph`} />}
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
                <Line yAxisId="speed" type="monotone" dataKey="v85Speed" name="85th speed" stroke={TRAFFIC_COLORS.v85Speed} strokeWidth={2.5} strokeDasharray="5 5" dot={{ r: 2.5, strokeWidth: 1, fill: '#ffffff' }} activeDot={{ r: 5 }} />
              </>
            ) : (
              <>
                <Bar yAxisId="volume" dataKey="volume" name="Total volume" fill={TRAFFIC_COLORS.volume} opacity={0.9} radius={[6, 6, 0, 0]} />
                <Line yAxisId="speed" type="monotone" dataKey="avgSpeed" name="Avg speed" stroke={TRAFFIC_COLORS.avgSpeed} strokeWidth={3} dot={{ r: 3, strokeWidth: 1, fill: '#ffffff' }} activeDot={{ r: 5 }} />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
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

      {activeMetric && (
        <div
          className={styles.metricModalOverlay}
          role="presentation"
          onMouseDown={() => setActiveMetric(null)}
        >
          <div
            className={styles.metricModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="traffic-metric-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h4 id="traffic-metric-title">{activeMetric.label}</h4>
            <strong>{activeMetric.value}</strong>
            <p>{activeMetric.detail}</p>
            <button
              type="button"
              className={styles.metricModalClose}
              onClick={() => setActiveMetric(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrafficTrendChart;
