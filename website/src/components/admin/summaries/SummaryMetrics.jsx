import React, { useState, useEffect, useMemo } from 'react';
import supabase from "../../helper/SupabaseClients";
import { applyAnalyticsFilters, applyDateQueryBounds } from '../controls/AnalyticsFilterUtils';

const getLocalDateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const formatBusiestDayLabel = (date) =>
    date.toLocaleDateString([], {
        month: 'numeric',
        day: 'numeric',
    });

const getBestAverageGroup = (groups) => {
    const entries = Object.entries(groups).filter(([, group]) => group.count > 0);
    if (entries.length === 0) return null;

    return entries.reduce((best, current) => {
        const [, bestGroup] = best;
        const [, currentGroup] = current;
        return (currentGroup.total / currentGroup.count) > (bestGroup.total / bestGroup.count)
            ? current
            : best;
    });
};

const METRIC_CONFIG = {
    current: { label: 'Current Traffic', unit: 'vehicles' },
    peak: { label: 'Peak Traffic', unit: 'vehicles' },
    busiestDay: { label: 'Highest Traffic Day', unit: '' },
    busiestTime: { label: 'Highest Traffic Time', unit: '' },
};

const DEFAULT_VISIBLE_METRICS = ['current', 'peak', 'busiestDay', 'busiestTime'];

const SummaryMetrics = ({ level, id, filters, metrics: visibleMetrics = ['current', 'peak', 'busiestDay', 'busiestTime'], snapshotData, onSnapshotData }) => {
    const normalizedVisibleMetrics = Array.isArray(visibleMetrics) && visibleMetrics.length > 0
        ? visibleMetrics
        : DEFAULT_VISIBLE_METRICS;
    const [liveMetrics, setLiveMetrics] = useState({
        current: 0,
        peak: 0,
        busiestDay: '-',
        busiestTime: '-'
    });
    const [loading, setLoading] = useState(!snapshotData);
    const startDate = filters?.startDate || '';
    const endDate = filters?.endDate || '';
    const startTime = filters?.startTime || '';
    const endTime = filters?.endTime || '';
    const dayPreset = filters?.dayPreset || 'all';
    const effectiveFilters = useMemo(() => ({
        startDate,
        endDate,
        startTime,
        endTime,
        dayPreset,
    }), [startDate, endDate, startTime, endTime, dayPreset]);
    const metrics = snapshotData || liveMetrics;
    const isMetricsLoading = !snapshotData && loading;

    useEffect(() => {
        if (snapshotData) {
            return undefined;
        }

        let isMounted = true;

        const fetchMetrics = async () => {
            setLoading(true);
            let tableName, columnId;

            // Match your Supabase views
            if (level === 'floor') { tableName = 'floor_history'; columnId = 'floor_number'; }
            else if (level === 'building') { tableName = 'building_history'; columnId = 'building_id'; }
            else if (level === 'area') { tableName = 'area_history'; columnId = 'area_id'; }
            else if (level === 'room') { tableName = 'room_history'; columnId = 'room_id'; }

            if (!tableName || !id) {
                if (isMounted) {
                    setLiveMetrics({ current: 0, peak: 0, busiestDay: '-', busiestTime: '-' });
                    setLoading(false);
                }
                return;
            }

            const limit = effectiveFilters.startDate || effectiveFilters.endDate ? 10000 : 2016;

            // Fetch the last 7 days (2016 data points assuming 5 min intervals)
            const query = supabase
                .from(tableName)
                .select(level === 'room' ? 'observed_at, people_count, density' : 'observed_at, total_people, total_capacity')
                .eq(columnId, id)
                .order('observed_at', { ascending: false })
                .limit(limit);

            const { data } = await applyDateQueryBounds(query, effectiveFilters);
            const filteredData = applyAnalyticsFilters(data || [], effectiveFilters);

            if (filteredData && filteredData.length > 0) {
                const getCount = (row) => level === 'room' ? row.people_count : row.total_people;
                const getOccupancy = (row) => {
                    if (level === 'room') return row.density ?? 0;
                    const capacity = row.total_capacity ?? 0;
                    return capacity > 0 ? ((row.total_people ?? 0) / capacity) * 100 : 0;
                };
                const current = getCount(filteredData[0]); // Most recent data point
                let peak = 0;
                
                // Match the weekly chart: daily cards use averages, not raw sums.
                const dayCounts = {};
                const dayLabels = {};

                [...filteredData].reverse().forEach(row => {
                    const count = getCount(row);
                    
                    const date = new Date(row.observed_at);
                    const day = getLocalDateKey(date);

                    if (!dayCounts[day]) {
                        dayCounts[day] = { total: 0, count: 0 };
                        dayLabels[day] = formatBusiestDayLabel(date);
                    }
                    dayCounts[day].total += count;
                    dayCounts[day].count += 1;
                });

                const busiestDayGroup = getBestAverageGroup(dayCounts);
                const busiestDayKey = busiestDayGroup?.[0];
                const busiestDayAverage = busiestDayGroup
                    ? busiestDayGroup[1].total / busiestDayGroup[1].count
                    : 0;
                peak = Math.round(busiestDayAverage);
                const busiestDay = busiestDayKey ? dayLabels[busiestDayKey] : '-';

                const timeSourceRows = effectiveFilters.startDate || effectiveFilters.endDate
                    ? data || []
                    : (data || []).slice(0, 288);
                const filteredTimeRows = applyAnalyticsFilters(timeSourceRows, effectiveFilters);
                const visibleChartHourCounts = {};

                filteredTimeRows.forEach((row) => {
                    const date = new Date(row.observed_at);
                    date.setMinutes(0, 0, 0);
                    const hour = date.toLocaleTimeString([], { hour: 'numeric' });

                    if (!visibleChartHourCounts[hour]) {
                        visibleChartHourCounts[hour] = { total: 0, count: 0 };
                    }

                    visibleChartHourCounts[hour].total += getOccupancy(row);
                    visibleChartHourCounts[hour].count += 1;
                });

                const busiestTimeGroup = getBestAverageGroup(visibleChartHourCounts);
                const busiestTime = busiestTimeGroup ? busiestTimeGroup[0] : '-';

                const nextMetrics = { current, peak, busiestDay, busiestTime };
                if (isMounted) {
                    setLiveMetrics(nextMetrics);
                    onSnapshotData?.(nextMetrics);
                }
            } else {
                const emptyMetrics = { current: 0, peak: 0, busiestDay: '-', busiestTime: '-' };
                if (isMounted) {
                    setLiveMetrics(emptyMetrics);
                    onSnapshotData?.(emptyMetrics);
                }
            }
            if (isMounted) setLoading(false);
        };

        fetchMetrics();
        return () => {
            isMounted = false;
        };
    }, [level, id, effectiveFilters, snapshotData, onSnapshotData]);

    // Reusable styles for the cards
    const cardStyle = {
        backgroundColor: 'transparent',
        borderRadius: '10px',
        padding: 'clamp(10px, 0.9vw, 14px)',
        boxShadow: 'none',
        border: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minWidth: 0
    };

    const labelStyle = { fontSize: 'clamp(0.66rem, 0.68vw, 0.76rem)', color: '#888', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.05em' };
    const valueStyle = { fontSize: 'clamp(1.2rem, 1.45vw, 1.55rem)', fontWeight: '700', color: '#333', margin: 0, lineHeight: 1.1 };
    const unitStyle = { fontSize: 'clamp(0.72rem, 0.8vw, 0.86rem)', color: '#aaa', fontWeight: '400' };

    if (isMetricsLoading) {
        return (
            <div data-report-loading="true" style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '13px' }}>
                Loading summary...
            </div>
        );
    }

    const safeVisibleMetrics = normalizedVisibleMetrics.filter((metric) => METRIC_CONFIG[metric]);

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.max(safeVisibleMetrics.length, 1)}, minmax(0, 1fr))`,
            gap: 'clamp(8px, 1vw, 12px)',
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            minWidth: 0
        }}>
            {safeVisibleMetrics.map((metricKey) => {
                const config = METRIC_CONFIG[metricKey];
                return (
                    <div key={metricKey} style={cardStyle}>
                        <span style={labelStyle}>{config.label}</span>
                        <p style={valueStyle}>
                            {metrics[metricKey]} {config.unit && <span style={unitStyle}>{config.unit}</span>}
                        </p>
                    </div>
                );
            })}
        </div>
    );
};

export default SummaryMetrics;
