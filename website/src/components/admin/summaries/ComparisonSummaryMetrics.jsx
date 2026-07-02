import React, { useEffect, useMemo, useState } from 'react';
import supabase from "../../helper/SupabaseClients";
import { applyAnalyticsFilters } from '../controls/AnalyticsFilterUtils';
import { fetchTrafficSummaryRows } from '../data/TrafficSummaryData';

const getMetricSummary = async ({ target, filters, timeframe }) => {
    if (!target.id) {
        return { current: 0, total: 0, average: 0, peak: 0, change: 0, averageSpeed: 0 };
    }

    const sensorId = target.level === 'floor' || target.level === 'room' ? target.id : undefined;
    const data = await fetchTrafficSummaryRows(supabase, {
        sensorId,
        filters,
        type: timeframe,
    });
    const filteredData = applyAnalyticsFilters([...(data || [])].reverse(), filters);
    if (filteredData.length === 0) return { current: 0, total: 0, average: 0, peak: 0, change: 0, averageSpeed: 0 };

    const counts = filteredData.map((row) => row.people_count ?? row.total_people ?? 0);
    const current = counts[0] ?? 0;
    const start = counts[counts.length - 1] ?? current;
    const total = counts.reduce((sum, count) => sum + count, 0);
    const average = Math.round(counts.reduce((sum, count) => sum + count, 0) / counts.length);
    const peak = Math.max(...counts);
    const change = current - start;
    const speedWeight = filteredData.reduce((sum, row) => sum + Math.max(row.people_count ?? row.total_people ?? 0, 1), 0);
    const averageSpeed = speedWeight
        ? Math.round((filteredData.reduce((sum, row) => sum + ((row.avg_speed ?? row.density ?? 0) * Math.max(row.people_count ?? row.total_people ?? 0, 1)), 0) / speedWeight) * 10) / 10
        : 0;

    return { current, total, average, peak, change, averageSpeed };
};

const METRIC_COPY = {
    current: {
        primaryLabel: 'Latest',
        secondaryLabel: 'Latest',
        differenceLabel: 'Latest Point Difference',
        leaderLabel: 'Higher Latest Point',
        field: 'current',
        signed: false,
        unit: 'movements',
    },
    average: {
        primaryLabel: 'Average',
        secondaryLabel: 'Average',
        differenceLabel: 'Average Difference',
        leaderLabel: 'Higher Average Traffic',
        field: 'average',
        signed: false,
        unit: 'movements',
    },
    peak: {
        primaryLabel: 'Peak',
        secondaryLabel: 'Peak',
        differenceLabel: 'Peak Difference',
        leaderLabel: 'Higher Peak Traffic',
        field: 'peak',
        signed: false,
        unit: 'movements',
    },
    change: {
        primaryLabel: 'Change',
        secondaryLabel: 'Change',
        differenceLabel: 'Change Difference',
        leaderLabel: 'Bigger Change',
        field: 'change',
        signed: true,
        unit: 'movements',
    },
    totalVolume: {
        label: 'Total Traffic Volume',
        field: 'total',
        type: 'sum',
        unit: 'movements',
    },
    groupAverage: {
        label: 'Group Average',
        field: 'average',
        type: 'average',
        unit: 'movements',
    },
    topVolume: {
        label: 'Top Volume Corridor',
        field: 'total',
        type: 'leader',
        unit: 'movements',
    },
    topAverage: {
        label: 'Top Average Corridor',
        field: 'average',
        type: 'leader',
        unit: 'movements',
    },
    range: {
        label: 'Traffic Spread',
        field: 'average',
        type: 'spread',
        unit: 'movements',
    },
    averageSpeed: {
        label: 'Avg Speed',
        field: 'averageSpeed',
        type: 'average',
        unit: 'mph',
    },
};

const getWindowLabel = (timeframe) => {
    if (timeframe === 'daily') return '24h';
    if (timeframe === 'monthly') return '30-day';
    return '7-day';
};

const formatMetricValue = (value, signed = false) => {
    if (!signed) return value;
    return value > 0 ? `+${value}` : String(value);
};

const MODE_ALIASES = {
    current: 'totalVolume',
    totalCurrent: 'totalVolume',
    topCurrent: 'topVolume',
};

const DEFAULT_MULTI_METRICS = ['totalVolume', 'topVolume', 'groupAverage', 'range'];

const getTargetKey = (target, index) => `${target.level || 'target'}-${target.id || index}-${index}`;

const getRenderableTargets = (targets = []) => (
    targets
        .map((target, index) => ({
            ...target,
            key: getTargetKey(target, index),
            label: target?.label || `Data source ${index + 1}`,
        }))
        .filter((target) => target.id && target.level)
);

const getShortLabel = (label = '') => {
    const cleaned = label.replace(/\s+/g, ' ').trim();
    return cleaned.length > 20 ? `${cleaned.slice(0, 19)}...` : cleaned;
};

const getComparisonLabel = (leader, lowest, field) => {
    if (!leader || !lowest) return 'All corridors';
    const leaderValue = leader.metrics[field] ?? 0;
    const lowestValue = lowest.metrics[field] ?? 0;
    const symbol = leaderValue === lowestValue ? '=' : '>';
    return `${getShortLabel(leader.label)} ${symbol} ${getShortLabel(lowest.label)}`;
};

const getSummaryCards = ({ summaries, metricModes, timeframe }) => {
    const safeModes = (Array.isArray(metricModes) && metricModes.length > 0 ? metricModes : DEFAULT_MULTI_METRICS)
        .map((mode) => MODE_ALIASES[mode] || mode)
        .filter((mode) => METRIC_COPY[mode]);
    const windowLabel = getWindowLabel(timeframe);

    return safeModes.map((mode) => {
        const copy = METRIC_COPY[mode];
        const field = copy.field;
        const sorted = [...summaries].sort((a, b) => (b.metrics[field] ?? 0) - (a.metrics[field] ?? 0));
        const leader = sorted[0];
        const lowest = sorted[sorted.length - 1];
        const values = summaries.map((summary) => summary.metrics[field] ?? 0);
        const sum = values.reduce((total, value) => total + value, 0);
        const average = summaries.length ? Math.round((sum / summaries.length) * 10) / 10 : 0;
        const spread = leader && lowest ? Math.round(((leader.metrics[field] ?? 0) - (lowest.metrics[field] ?? 0)) * 10) / 10 : 0;

        if (copy.type === 'sum') {
            return { key: mode, label: copy.label, value: sum, unit: copy.unit, sublabel: `${summaries.length} corridors` };
        }
        if (copy.type === 'average') {
            return { key: mode, label: copy.label, value: average, unit: copy.unit, sublabel: `${windowLabel} avg` };
        }
        if (copy.type === 'leader') {
            return { key: mode, label: copy.label, value: getShortLabel(leader?.label || '-'), unit: '', sublabel: `${leader?.metrics[field] ?? 0} ${copy.unit}` };
        }
        if (copy.type === 'spread') {
            return { key: mode, label: copy.label, value: spread, unit: copy.unit, sublabel: getComparisonLabel(leader, lowest, field) };
        }

        return {
            key: mode,
            label: copy.signed ? copy.differenceLabel : `${windowLabel} ${copy.differenceLabel}`,
            value: Math.abs(spread),
            unit: copy.unit,
            sublabel: getComparisonLabel(leader, lowest, field),
        };
    });
};

const ComparisonSummaryMetrics = ({ targets = [], filters, timeframe = 'weekly', metricMode = 'totalVolume', metricModes, snapshotData, onSnapshotData }) => {
    const [liveMetrics, setLiveMetrics] = useState(null);
    const [loading, setLoading] = useState(!snapshotData);

    const renderableTargets = useMemo(() => getRenderableTargets(targets), [targets]);
    const targetSignature = useMemo(() => renderableTargets.map((target) => `${target.level}:${target.id}:${target.label}`).join('|'), [renderableTargets]);
    const hasTargets = renderableTargets.length >= 2;
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
            if (!hasTargets) {
                if (isMounted) {
                    setLiveMetrics(null);
                    setLoading(false);
                }
                return;
            }

            setLoading(true);

            try {
                const summaries = await Promise.all(renderableTargets.map(async (target) => ({
                    key: target.key,
                    label: target.label,
                    metrics: await getMetricSummary({ target, filters: effectiveFilters, timeframe }),
                })));

                const nextMetrics = { summaries };
                if (isMounted) {
                    setLiveMetrics(nextMetrics);
                    onSnapshotData?.(nextMetrics);
                }
            } catch (error) {
                console.error('Comparison summary fetch error:', error);
                if (isMounted) setLiveMetrics(null);
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchMetrics();
        return () => {
            isMounted = false;
        };
    }, [hasTargets, renderableTargets, targetSignature, timeframe, effectiveFilters, snapshotData, onSnapshotData]);

    if (isMetricsLoading) return <div data-report-loading="true" style={{ height: '100%' }} />;

    if (!hasTargets || !metrics) {
        return (
            <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#888', fontStyle: 'italic' }}>
                Select at least two data sources to compare.
            </div>
        );
    }

    const emptySummaries = renderableTargets.map((target) => ({
        key: target.key,
        label: target.label,
        metrics: { current: 0, total: 0, average: 0, peak: 0, change: 0, averageSpeed: 0 },
    }));
    const summaries = metrics?.summaries || (metrics ? [
        { label: targets[0]?.label || 'Data source 1', metrics: metrics.primary || {} },
        { label: targets[1]?.label || 'Data source 2', metrics: metrics.secondary || {} },
    ] : emptySummaries);
    const selectedModes = metricModes || (metricMode ? [metricMode] : DEFAULT_MULTI_METRICS);
    const cards = getSummaryCards({ summaries, metricModes: selectedModes, timeframe });

    const cardStyle = {
        backgroundColor: 'transparent',
        borderRadius: '10px',
        padding: 'clamp(10px, 1vw, 14px)',
        boxShadow: 'none',
        border: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minWidth: 0,
    };
    const labelStyle = { fontSize: 'clamp(0.62rem, 0.66vw, 0.74rem)', color: '#888', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.05em' };
    const valueStyle = { fontSize: 'clamp(1rem, 1.25vw, 1.42rem)', fontWeight: '700', color: '#333', margin: 0, lineHeight: 1.1 };
    const unitStyle = { fontSize: 'clamp(0.68rem, 0.76vw, 0.82rem)', color: '#aaa', fontWeight: '400' };

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(Math.max(cards.length, 1), 4)}, minmax(0, 1fr))`,
            gap: 'clamp(8px, 1vw, 12px)',
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            minWidth: 0,
        }}>
            {cards.map((card) => (
                <div key={card.key} style={cardStyle}>
                    <span style={labelStyle}>{card.label}</span>
                    <p style={valueStyle}>
                        {formatMetricValue(card.value, card.signed)} {card.unit && <span style={unitStyle}>{card.unit}</span>}
                    </p>
                    {card.sublabel && <span style={{ ...unitStyle, marginTop: '5px' }}>{card.sublabel}</span>}
                </div>
            ))}
        </div>
    );
};

export default ComparisonSummaryMetrics;
