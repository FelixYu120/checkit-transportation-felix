import React, { useEffect, useMemo, useState } from 'react';
import supabase from "../../helper/SupabaseClients";
import { applyAnalyticsFilters, applyDateQueryBounds } from '../controls/AnalyticsFilterUtils';

const getTargetTableConfig = (level) => {
    if (level === 'building') return { tableName: 'building_history', columnId: 'building_id' };
    if (level === 'area') return { tableName: 'area_history', columnId: 'area_id' };
    if (level === 'room') return { tableName: 'room_history', columnId: 'room_id' };
    return {};
};

const getMetricSummary = async ({ target, filters, timeframe }) => {
    const { tableName, columnId } = getTargetTableConfig(target.level);
    if (!tableName || !columnId || !target.id) {
        return { current: 0, average: 0, peak: 0, change: 0 };
    }

    const limit = filters?.startDate || filters?.endDate ? 10000 : timeframe === 'daily' ? 288 : 2016;
    const query = supabase
        .from(tableName)
        .select(target.level === 'room' ? 'observed_at, people_count, density' : 'observed_at, total_people, total_capacity')
        .eq(columnId, target.id)
        .order('observed_at', { ascending: false })
        .limit(limit);

    const { data, error } = await applyDateQueryBounds(query, filters);
    if (error) throw error;

    const filteredData = applyAnalyticsFilters(data || [], filters);
    if (filteredData.length === 0) return { current: 0, average: 0, peak: 0, change: 0 };

    const counts = filteredData.map((row) => row.people_count ?? row.total_people ?? 0);
    const current = counts[0] ?? 0;
    const start = counts[counts.length - 1] ?? current;
    const average = Math.round(counts.reduce((sum, count) => sum + count, 0) / counts.length);
    const peak = Math.max(...counts);
    const change = current - start;

    return { current, average, peak, change };
};

const METRIC_COPY = {
    current: {
        primaryLabel: 'Current',
        secondaryLabel: 'Current',
        differenceLabel: 'Current Difference',
        leaderLabel: 'Higher Traffic Now',
        field: 'current',
        signed: false,
    },
    average: {
        primaryLabel: 'Average',
        secondaryLabel: 'Average',
        differenceLabel: 'Average Difference',
        leaderLabel: 'Higher Average Traffic',
        field: 'average',
        signed: false,
    },
    peak: {
        primaryLabel: 'Peak',
        secondaryLabel: 'Peak',
        differenceLabel: 'Peak Difference',
        leaderLabel: 'Higher Peak Traffic',
        field: 'peak',
        signed: false,
    },
    change: {
        primaryLabel: 'Change',
        secondaryLabel: 'Change',
        differenceLabel: 'Change Difference',
        leaderLabel: 'Bigger Change',
        field: 'change',
        signed: true,
    },
};

const getWindowLabel = (timeframe) => timeframe === 'daily' ? '24h' : '7-day';

const formatMetricValue = (value, signed = false) => {
    if (!signed) return value;
    return value > 0 ? `+${value}` : String(value);
};

const ComparisonSummaryMetrics = ({ targets = [], filters, timeframe = 'weekly', metricMode = 'current', snapshotData, onSnapshotData }) => {
    const [liveMetrics, setLiveMetrics] = useState(null);
    const [loading, setLoading] = useState(!snapshotData);

    const primaryTarget = targets[0];
    const secondaryTarget = targets[1];
    const primaryTargetId = primaryTarget?.id || '';
    const primaryTargetLevel = primaryTarget?.level || '';
    const primaryLabel = primaryTarget?.label || 'Data source 1';
    const secondaryTargetId = secondaryTarget?.id || '';
    const secondaryTargetLevel = secondaryTarget?.level || '';
    const secondaryLabel = secondaryTarget?.label || 'Data source 2';
    const hasTargets = primaryTargetId && secondaryTargetId;
    const safeMetricMode = METRIC_COPY[metricMode] ? metricMode : 'current';
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
                const nextPrimaryTarget = {
                    id: primaryTargetId,
                    level: primaryTargetLevel,
                    label: primaryLabel,
                };
                const nextSecondaryTarget = {
                    id: secondaryTargetId,
                    level: secondaryTargetLevel,
                    label: secondaryLabel,
                };

                const [primary, secondary] = await Promise.all([
                    getMetricSummary({ target: nextPrimaryTarget, filters: effectiveFilters, timeframe }),
                    getMetricSummary({ target: nextSecondaryTarget, filters: effectiveFilters, timeframe }),
                ]);

                const nextMetrics = { primary, secondary };
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
    }, [hasTargets, primaryLabel, primaryTargetId, primaryTargetLevel, secondaryLabel, secondaryTargetId, secondaryTargetLevel, timeframe, effectiveFilters, snapshotData, onSnapshotData]);

    if (isMetricsLoading) return <div data-report-loading="true" style={{ height: '100%' }} />;

    if (!hasTargets || !metrics) {
        return (
            <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#888', fontStyle: 'italic' }}>
                Select two data sources to compare.
            </div>
        );
    }

    const modeCopy = METRIC_COPY[safeMetricMode];
    const metricField = modeCopy.field;
    const primaryValue = metrics.primary[metricField] ?? 0;
    const secondaryValue = metrics.secondary[metricField] ?? 0;
    const selectedDelta = primaryValue - secondaryValue;
    const averageDelta = metrics.primary.average - metrics.secondary.average;
    const leaderLabel = selectedDelta === 0 ? 'Even' : selectedDelta > 0 ? primaryLabel : secondaryLabel;
    const windowLabel = getWindowLabel(timeframe);

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
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 'clamp(8px, 1vw, 12px)',
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            minWidth: 0,
        }}>
            <div style={cardStyle}>
                <span style={labelStyle}>{primaryLabel} {modeCopy.primaryLabel}</span>
                <p style={valueStyle}>{formatMetricValue(primaryValue, modeCopy.signed)} <span style={unitStyle}>vehicles</span></p>
            </div>

            <div style={cardStyle}>
                <span style={labelStyle}>{secondaryLabel} {modeCopy.secondaryLabel}</span>
                <p style={valueStyle}>{formatMetricValue(secondaryValue, modeCopy.signed)} <span style={unitStyle}>vehicles</span></p>
            </div>

            <div style={cardStyle}>
                <span style={labelStyle}>{windowLabel} {modeCopy.differenceLabel}</span>
                <p style={valueStyle}>{Math.abs(selectedDelta)} <span style={unitStyle}>vehicles</span></p>
            </div>

            <div style={cardStyle}>
                <span style={labelStyle}>{modeCopy.leaderLabel}</span>
                <p style={valueStyle}>{leaderLabel}</p>
                <span style={{ ...unitStyle, marginTop: '5px' }}>Avg diff {Math.abs(averageDelta)}</span>
            </div>
        </div>
    );
};

export default ComparisonSummaryMetrics;
