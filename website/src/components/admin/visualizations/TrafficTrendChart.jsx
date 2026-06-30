import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Label,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import supabase from "../../helper/SupabaseClients";
import { fetchTrafficDirectionRows } from '../data/TrafficSummaryData';

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
  if (mode === 'volume') return 'Volume and Speed Trend';
  return 'Traffic Trend';
};

const TrafficTrendChart = ({ sensorId, filters, type = 'daily', mode = 'combined', title }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
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
    return <div className="traffic-chart-loading">Loading traffic trend...</div>;
  }

  if (!chartData.length) {
    return (
      <div className="traffic-chart-shell">
        <div className="traffic-chart-header">
          <div>
            <h3>{title || getChartTitle(mode)}</h3>
          </div>
        </div>
        <div className="traffic-chart-empty">
          <strong>No traffic summaries found for this chart.</strong>
        </div>
      </div>
    );
  }

  const ChartComponent = mode === 'direction' ? BarChart : ComposedChart;

  return (
    <div className="traffic-chart-shell">
      <div className="traffic-chart-header">
        <div>
          <h3>{title || getChartTitle(mode)}</h3>
        </div>
      </div>
      <div className="traffic-chart-canvas">
        <ResponsiveContainer width="100%" height="100%">
          <ChartComponent data={chartData} margin={{ top: 10, right: 18, left: 0, bottom: 34 }}>
            <CartesianGrid stroke="#e8eef2" vertical={false} />
            <XAxis dataKey="time" fontSize={11} tickLine={false} axisLine={false} minTickGap={18}>
              <Label value={granularity === 'bucket' ? 'Time bucket' : 'Date'} offset={-22} position="insideBottom" />
            </XAxis>
            <YAxis yAxisId="volume" fontSize={11} tickLine={false} axisLine={false}>
              <Label value="Volume" angle={-90} position="insideLeft" style={{ textAnchor: 'middle' }} />
            </YAxis>
            {mode !== 'direction' && (
              <YAxis yAxisId="speed" orientation="right" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`}>
                <Label value="Speed mph" angle={90} position="insideRight" style={{ textAnchor: 'middle' }} />
              </YAxis>
            )}
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0].payload;
                return (
                  <div className="traffic-chart-tooltip">
                    <strong>{point.fullTime}</strong>
                    <span>Total volume: {point.volume}</span>
                    <span>Approach: {point.approach}</span>
                    <span>Away: {point.away}</span>
                    <span>Avg speed: {point.avgSpeed} mph</span>
                    <span>85th speed: {point.v85Speed} mph</span>
                    <span>Max speed: {point.maxSpeed} mph</span>
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {mode === 'volume' ? (
              <Bar yAxisId="volume" dataKey="volume" name="Total volume" fill="#2f716f" radius={[4, 4, 0, 0]} />
            ) : (
              <>
                <Bar yAxisId="volume" dataKey="approach" stackId="traffic" name="Approach volume" fill="#2f716f" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="volume" dataKey="away" stackId="traffic" name="Away volume" fill="#a0d1c5" radius={[4, 4, 0, 0]} />
              </>
            )}
            {mode !== 'direction' && (
              <>
                <Line yAxisId="speed" type="monotone" dataKey="avgSpeed" name="Avg speed" stroke="#4c6d69" strokeWidth={2.4} dot={false} />
                <Line yAxisId="speed" type="monotone" dataKey="v85Speed" name="85th speed" stroke="#88afa6" strokeWidth={2} dot={false} />
              </>
            )}
          </ChartComponent>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default TrafficTrendChart;
