import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import supabase from "../../helper/SupabaseClients";
import { fetchTrafficDirectionRows } from '../data/TrafficSummaryData';
import styles from './TrafficTrendChart.module.css';

const formatTime = (value) =>
  new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const formatDateTime = (value) =>
  new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const roundOne = (value) => Math.round(value * 10) / 10;

const getBucketKey = (value, granularity) => {
  const date = new Date(value);
  if (granularity === 'day') {
    date.setHours(0, 0, 0, 0);
  } else if (granularity === 'hour') {
    date.setMinutes(0, 0, 0);
  }
  return date.toISOString();
};

const getGranularity = (type, filters) => {
  if (type === 'monthly') return 'day';
  if (type === 'weekly') return 'day';
  if (filters?.startDate && filters?.endDate && filters.startDate !== filters.endDate) return 'day';
  return 'bucket';
};

const hasDateFilter = (filters) => Boolean(filters?.startDate || filters?.endDate);

const getWindowHours = (type) => {
  if (type === 'monthly') return 30 * 24;
  if (type === 'weekly') return 7 * 24;
  return 24;
};

const getWindowedRows = (rows, type, filters) => {
  if (!rows.length || hasDateFilter(filters)) return rows;

  const latestTime = rows.reduce((latest, row) => {
    const rowTime = new Date(row.observed_at).getTime();
    return Number.isFinite(rowTime) && rowTime > latest ? rowTime : latest;
  }, 0);

  if (!latestTime) return rows;

  const windowStart = latestTime - (getWindowHours(type) * 60 * 60 * 1000);
  return rows.filter((row) => {
    const rowTime = new Date(row.observed_at).getTime();
    return Number.isFinite(rowTime) && rowTime >= windowStart && rowTime <= latestTime;
  });
};

const buildChartData = (rows, granularity) => {
  const groups = new Map();

  rows.forEach((row) => {
    const key = getBucketKey(row.observed_at, granularity);
    const group = groups.get(key) || {
      key,
      approach: 0,
      away: 0,
      volume: 0,
      speedWeightedSum: 0,
      v85WeightedSum: 0,
      speedWeight: 0,
      maxSpeed: 0,
    };
    const directionKey = row.direction === 'away' ? 'away' : 'approach';
    const volume = Number(row.volume) || 0;
    const weight = volume > 0 ? volume : 1;

    group[directionKey] += volume;
    group.volume += volume;
    group.speedWeightedSum += (Number(row.avg_speed) || 0) * weight;
    group.v85WeightedSum += (Number(row.v85_speed) || 0) * weight;
    group.speedWeight += weight;
    group.maxSpeed = Math.max(group.maxSpeed, Number(row.max_speed) || 0);
    groups.set(key, group);
  });

  return Array.from(groups.values())
    .sort((a, b) => new Date(a.key) - new Date(b.key))
    .map((group) => ({
      time: granularity === 'bucket' ? formatTime(group.key) : new Date(group.key).toLocaleDateString([], { month: 'short', day: 'numeric' }),
      fullTime: formatDateTime(group.key),
      approach: group.approach,
      away: group.away,
      volume: group.volume,
      avgSpeed: group.speedWeight ? roundOne(group.speedWeightedSum / group.speedWeight) : 0,
      v85Speed: group.speedWeight ? roundOne(group.v85WeightedSum / group.speedWeight) : 0,
      maxSpeed: group.maxSpeed,
    }));
};

const getChartTitle = (mode) => {
  if (mode === 'direction') return 'Direction Split';
  if (mode === 'volume') return 'Speed Profile';
  return 'Traffic Flow';
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
    const speedWeight = volume > 0 ? volume : 1;

    acc.volume += volume;
    acc.approach += Number(point.approach) || 0;
    acc.away += Number(point.away) || 0;
    acc.speedWeightedSum += (Number(point.avgSpeed) || 0) * speedWeight;
    acc.v85WeightedSum += (Number(point.v85Speed) || 0) * speedWeight;
    acc.speedWeight += speedWeight;
    acc.maxSpeed = Math.max(acc.maxSpeed, Number(point.maxSpeed) || 0);
    if (!acc.peak || volume > acc.peak.volume) acc.peak = point;
    return acc;
  }, {
    volume: 0,
    approach: 0,
    away: 0,
    speedWeightedSum: 0,
    v85WeightedSum: 0,
    speedWeight: 0,
    maxSpeed: 0,
    peak: null,
  });

  return {
    totalVolume: totals.volume,
    approach: totals.approach,
    away: totals.away,
    avgSpeed: totals.speedWeight ? roundOne(totals.speedWeightedSum / totals.speedWeight) : 0,
    v85Speed: totals.speedWeight ? roundOne(totals.v85WeightedSum / totals.speedWeight) : 0,
    maxSpeed: roundOne(totals.maxSpeed),
    peakLabel: totals.peak?.time || 'No peak',
  };
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
        detail: 'Weighted average vehicle speed across the chart window.',
      },
      {
        label: '85th speed',
        value: `${stats.v85Speed} mph`,
        detail: 'A higher-end speed signal that helps show whether most traffic is staying within a typical range.',
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
      detail: 'Weighted average vehicle speed across the chart window.',
    },
    {
      label: '85th speed',
      value: `${stats.v85Speed} mph`,
      detail: 'A higher-end speed signal that helps show whether most traffic is staying within a typical range.',
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
      { label: 'Approach', color: '#2f716f', bar: true },
      { label: 'Away', color: '#a0d1c5', bar: true },
    ];
  }

  if (mode === 'volume') {
    return [
      { label: 'Avg speed', color: '#2f716f' },
      { label: '85th speed', color: '#89b8ae' },
    ];
  }

  return [
    { label: 'Total volume', color: '#2f716f', bar: true },
    { label: 'Avg speed', color: '#89a9a3' },
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

  const granularity = getGranularity(type, effectiveFilters);
  const windowedRows = useMemo(
    () => getWindowedRows(rows, type, effectiveFilters),
    [rows, type, effectiveFilters]
  );
  const chartData = useMemo(() => buildChartData(windowedRows, granularity), [windowedRows, granularity]);
  const chartStats = useMemo(() => buildChartStats(chartData), [chartData]);
  const metricSet = useMemo(() => getMetricSet(mode, chartStats), [mode, chartStats]);
  const legendItems = useMemo(() => getLegendItems(mode), [mode]);
  const volumeAxisMax = useMemo(() => {
    const values = chartData.map((point) => (
      mode === 'direction'
        ? Math.max(Number(point.approach) || 0, Number(point.away) || 0)
        : Number(point.volume) || 0
    ));

    return getNiceCeiling(Math.max(...values, 10));
  }, [chartData, mode]);
  const speedAxisMax = useMemo(() => getNiceCeiling(Math.max(...chartData.map((point) => Number(point.maxSpeed) || Number(point.v85Speed) || 0), 10)), [chartData]);

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
          <ComposedChart data={chartData} margin={{ top: 8, right: mode === 'combined' ? 12 : 8, left: -18, bottom: 8 }}>
            <CartesianGrid stroke="#eef3f6" vertical={false} />
            <XAxis dataKey="time" fontSize={11} tickLine={false} axisLine={false} minTickGap={18} />
            <YAxis
              yAxisId="volume"
              domain={[0, volumeAxisMax]}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={42}
            />
            {mode !== 'direction' && (
              <YAxis
                yAxisId="speed"
                orientation="right"
                domain={[0, speedAxisMax]}
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={38}
              />
            )}
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0].payload;
                return (
                  <div className={styles.tooltip}>
                    <strong>{point.fullTime}</strong>
                    {mode !== 'volume' && <TooltipRow label="Total volume" value={point.volume} />}
                    {mode === 'direction' && <TooltipRow label="Approach" value={point.approach} />}
                    {mode === 'direction' && <TooltipRow label="Away" value={point.away} />}
                    {mode !== 'direction' && <TooltipRow label="Avg speed" value={`${point.avgSpeed} mph`} />}
                    {mode !== 'direction' && <TooltipRow label="85th speed" value={`${point.v85Speed} mph`} />}
                    <TooltipRow label="Max speed" value={`${point.maxSpeed} mph`} />
                  </div>
                );
              }}
            />
            {mode === 'direction' ? (
              <>
                <Bar yAxisId="volume" dataKey="approach" name="Approach" fill="#2f716f" radius={[6, 6, 0, 0]} />
                <Bar yAxisId="volume" dataKey="away" name="Away" fill="#a0d1c5" radius={[6, 6, 0, 0]} />
              </>
            ) : mode === 'volume' ? (
              <>
                <Line yAxisId="speed" type="monotone" dataKey="avgSpeed" name="Avg speed" stroke="#2f716f" strokeWidth={2.8} dot={false} />
                <Line yAxisId="speed" type="monotone" dataKey="v85Speed" name="85th speed" stroke="#89b8ae" strokeWidth={2.2} strokeDasharray="5 5" dot={false} />
              </>
            ) : (
              <>
                <Bar yAxisId="volume" dataKey="volume" name="Total volume" fill="#2f716f" opacity={0.88} radius={[6, 6, 0, 0]} />
                <Line yAxisId="speed" type="monotone" dataKey="avgSpeed" name="Avg speed" stroke="#89a9a3" strokeWidth={2.2} dot={false} />
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
