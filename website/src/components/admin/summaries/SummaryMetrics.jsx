import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import supabase from "../../helper/SupabaseClients";
import { applyAnalyticsFilters } from '../controls/AnalyticsFilterUtils';
import { fetchTrafficSummaryRows } from '../data/TrafficSummaryData';

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

const getTimeframeLabel = (timeframe) => {
    if (timeframe === 'daily') return '24 hr';
    if (timeframe === 'monthly') return 'Monthly';
    if (timeframe === 'custom') return 'filtered';
    return '7 day';
};

const getMetricConfig = (timeframe) => {
    const windowLabel = getTimeframeLabel(timeframe);

    return {
        total: { label: 'Volume', unit: 'movements', detail: `Total traffic volume in the ${windowLabel} report window.` },
        current: { label: 'Recent Movement', unit: 'movements', detail: 'Most recent movement count in the active report window.' },
        peak: { label: 'Peak', unit: 'movements', detail: `Highest movement point in the ${windowLabel} report window.` },
        averageSpeed: { label: 'Avg Speed', unit: 'mph', detail: `Weighted average speed across the ${windowLabel} report window.` },
        v85Speed: { label: '85th Speed', unit: 'mph', detail: `Average 85th percentile speed across the ${windowLabel} report window.` },
        maxSpeed: { label: 'Max Speed', unit: 'mph', detail: `Highest speed observed in the ${windowLabel} report window.` },
        overThresholdCount: { label: 'Over Threshold Count', unit: 'periods', detail: `Number of ${windowLabel} periods where max speed exceeded the lane's max speed cap threshold.` },
        lowNoMovementPeriods: { label: 'Low/No Movement Periods', unit: 'periods', detail: `Number of ${windowLabel} periods with little or no observed movement.` },
        approachShare: { label: 'Approach Share', unit: '%', detail: `Share of directional traffic moving toward approach in the ${windowLabel} report window.` },
        busiestDay: { label: 'Busiest Day', unit: '', detail: `Day with the highest traffic volume in the ${windowLabel} report window.` },
        busiestTime: { label: 'Busiest Time', unit: '', detail: `Time with the highest traffic volume in the ${windowLabel} report window.` },
    };
};

const getDefaultVisibleMetrics = (timeframe) => {
    if (timeframe === 'daily') return ['peak', 'busiestTime', 'total', 'averageSpeed'];
    return ['peak', 'busiestDay', 'total', 'averageSpeed'];
};

const DEFAULT_VISIBLE_METRICS = getDefaultVisibleMetrics('weekly');

const formatMetricNumber = (value, unit) => {
    if (typeof value === 'string') return value;

    const numericValue = Number(value) || 0;
    if (unit === '%' && numericValue > 0 && numericValue < 1) return '<1';
    if (numericValue < 1) return '0';
    if (unit === '%' && numericValue < 10) return numericValue.toFixed(1);
    if (unit === 'mph') return String(Math.round(numericValue * 10) / 10);
    return String(Math.round(numericValue));
};

const formatMetricDisplayValue = (value, unit) => {
    if (unit !== '' || typeof value !== 'string') return formatMetricNumber(value, unit);
    return value.replace(/\b(\d{1,2}):00\s*([AP]M)\b/gi, '$1 $2');
};

const renderMetricDisplay = (value, unit) => {
    const displayValue = formatMetricDisplayValue(value, unit);
    if (unit === '%' && displayValue === '<1') return '<1%';
    return (
        <>
            {displayValue} {unit && <span style={{ fontSize: 'clamp(0.72rem, 0.8vw, 0.86rem)', color: '#aaa', fontWeight: '400' }}>{unit}</span>}
        </>
    );
};

const renderMetricDetail = (detail) => {
    const parts = String(detail || '').split(/(24 hr|7 day|Monthly|filtered)/g);
    return parts.map((part, index) => (
        part === '24 hr' || part === '7 day' || part === 'Monthly' || part === 'filtered'
            ? <strong key={`${part}-${index}`}>{part}</strong>
            : part
    ));
};

const getPointLabel = (point) => point?.dateLabel || point?.axisLabel || point?.time || '-';

const hasTrafficSamples = (point) => {
    if (!point || point.hasData === false) return false;
    const sampleCount = Number(point.sampleCount);
    return !Number.isFinite(sampleCount) || sampleCount > 0;
};

const getChartMetrics = (sourceChartData, timeframe, thresholdValue) => {
    const dataPoints = (sourceChartData || []).filter(hasTrafficSamples);
    if (!dataPoints.length) return null;

    const getVolume = (point) => Number(point.volume ?? point.total_people ?? point.people_count ?? 0);
    const getSpeed = (point) => Number(point.avgSpeed ?? point.avg_speed ?? point.occupancy ?? point.density ?? 0);
    const latestPoint = dataPoints[dataPoints.length - 1];
    const peakPoint = dataPoints.reduce((best, point) => (
        getVolume(point) > getVolume(best) ? point : best
    ), dataPoints[0]);
    const speedWeight = dataPoints.reduce((sum, point) => sum + Math.max(getVolume(point), 0), 0);
    const averageSpeed = speedWeight
        ? dataPoints.reduce((sum, point) => sum + (getSpeed(point) * Math.max(getVolume(point), 0)), 0) / speedWeight
        : 0;
    const v85Speed = speedWeight
        ? dataPoints.reduce((sum, point) => sum + ((Number(point.v85Speed ?? point.v85_speed) || 0) * Math.max(getVolume(point), 0)), 0) / speedWeight
        : 0;
    const maxSpeed = Math.max(0, ...dataPoints.map((point) => Number(point.maxSpeed ?? point.max_speed) || 0));
    const threshold = Number(thresholdValue);
    const overThresholdCount = Number.isFinite(threshold)
        ? dataPoints.filter((point) => (Number(point.maxSpeed ?? point.max_speed) || 0) > threshold).length
        : '-';
    const lowNoMovementPeriods = dataPoints.filter((point) => getVolume(point) <= 0).length;
    const approachVolume = dataPoints.reduce((sum, point) => sum + (Number(point.approach ?? point.approach_volume) || 0), 0);
    const awayVolume = dataPoints.reduce((sum, point) => sum + (Number(point.away ?? point.away_volume) || 0), 0);
    const approachShare = approachVolume + awayVolume > 0
        ? Math.round((approachVolume / (approachVolume + awayVolume)) * 100)
        : 0;

    return {
        total: Math.round(dataPoints.reduce((sum, point) => sum + getVolume(point), 0)),
        current: Math.round(getVolume(latestPoint)),
        peak: Math.round(getVolume(peakPoint)),
        averageSpeed: Math.round(averageSpeed * 10) / 10,
        v85Speed: Math.round(v85Speed * 10) / 10,
        maxSpeed,
        overThresholdCount,
        lowNoMovementPeriods,
        approachShare,
        busiestDay: getPointLabel(peakPoint),
        busiestTime: getPointLabel(peakPoint),
    };
};

const SummaryMetrics = ({ level, id, filters, timeframe = 'weekly', metrics: visibleMetrics, metricGroups, snapshotData, onSnapshotData, sourceChartData, preferSourceChartData = false, thresholdValue }) => {
    const groupedMetricKeys = Array.isArray(metricGroups)
        ? metricGroups.flatMap((group) => Array.isArray(group.metrics) ? group.metrics : [])
        : [];
    const normalizedVisibleMetrics = Array.isArray(visibleMetrics) && visibleMetrics.length > 0
        ? visibleMetrics
        : groupedMetricKeys.length
            ? groupedMetricKeys
        : getDefaultVisibleMetrics(timeframe);
    const [liveMetrics, setLiveMetrics] = useState({
        total: 0,
        current: 0,
        peak: 0,
        averageSpeed: 0,
        v85Speed: 0,
        maxSpeed: 0,
        overThresholdCount: '-',
        lowNoMovementPeriods: 0,
        approachShare: 0,
        busiestDay: '-',
        busiestTime: '-'
    });
    const [loading, setLoading] = useState(!snapshotData);
    const [activeDetailKey, setActiveDetailKey] = useState(null);
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
    const chartMetrics = useMemo(() => getChartMetrics(sourceChartData, timeframe, thresholdValue), [sourceChartData, timeframe, thresholdValue]);
    const metrics = chartMetrics || snapshotData || liveMetrics;
    const isWaitingForSourceChartData = preferSourceChartData && sourceChartData == null;
    const isMetricsLoading = isWaitingForSourceChartData || (!chartMetrics && !snapshotData && loading);
    const metricConfig = useMemo(() => getMetricConfig(timeframe), [timeframe]);

    useEffect(() => {
        if (snapshotData) {
            return undefined;
        }
        if (chartMetrics) {
            setLoading(false);
            return undefined;
        }
        if (preferSourceChartData) {
            setLoading(false);
            return undefined;
        }

        let isMounted = true;

        const fetchMetrics = async () => {
            setLoading(true);
            if (!id) {
                if (isMounted) {
                    setLiveMetrics({ total: 0, current: 0, peak: 0, averageSpeed: 0, v85Speed: 0, maxSpeed: 0, overThresholdCount: '-', lowNoMovementPeriods: 0, approachShare: 0, busiestDay: '-', busiestTime: '-' });
                    setLoading(false);
                }
                return;
            }

            const sensorId = level === 'floor' || level === 'room' ? id : undefined;
            const data = await fetchTrafficSummaryRows(supabase, {
                sensorId,
                filters: effectiveFilters,
                type: timeframe,
            });
            const filteredData = applyAnalyticsFilters([...(data || [])].reverse(), effectiveFilters);

            if (filteredData && filteredData.length > 0) {
                const getCount = (row) => row.people_count ?? row.total_people ?? 0;
                const getAverageSpeed = (row) => row.avg_speed ?? row.density ?? 0;
                const current = getCount(filteredData[0]); // Most recent data point
                const total = filteredData.reduce((sum, row) => sum + getCount(row), 0);
                const speedWeight = filteredData.reduce((sum, row) => sum + Math.max(getCount(row), 0), 0);
                const weightedAverageSpeed = speedWeight
                    ? filteredData.reduce((sum, row) => sum + (getAverageSpeed(row) * Math.max(getCount(row), 0)), 0) / speedWeight
                    : 0;
                const weightedV85Speed = speedWeight
                    ? filteredData.reduce((sum, row) => sum + ((Number(row.v85_speed) || 0) * Math.max(getCount(row), 0)), 0) / speedWeight
                    : 0;
                const maxSpeed = Math.max(0, ...filteredData.map((row) => Number(row.max_speed) || 0));
                const threshold = Number(thresholdValue);
                const overThresholdCount = Number.isFinite(threshold)
                    ? filteredData.filter((row) => (Number(row.max_speed) || 0) > threshold).length
                    : '-';
                const lowNoMovementPeriods = filteredData.filter((row) => getCount(row) <= 0).length;
                const approachVolume = filteredData.reduce((sum, row) => sum + (Number(row.approach_volume) || 0), 0);
                const awayVolume = filteredData.reduce((sum, row) => sum + (Number(row.away_volume) || 0), 0);
                const approachShare = approachVolume + awayVolume > 0
                    ? Math.round((approachVolume / (approachVolume + awayVolume)) * 100)
                    : 0;
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
                    : (data || []).slice(-144);
                const filteredTimeRows = applyAnalyticsFilters(timeSourceRows, effectiveFilters);
                const visibleChartHourCounts = {};

                filteredTimeRows.forEach((row) => {
                    const date = new Date(row.observed_at);
                    date.setMinutes(0, 0, 0);
                    const hour = date.toLocaleTimeString([], { hour: 'numeric' });

                    if (!visibleChartHourCounts[hour]) {
                        visibleChartHourCounts[hour] = { total: 0, count: 0 };
                    }

                    visibleChartHourCounts[hour].total += getCount(row);
                    visibleChartHourCounts[hour].count += 1;
                });

                const busiestTimeGroup = getBestAverageGroup(visibleChartHourCounts);
                const busiestTime = busiestTimeGroup ? busiestTimeGroup[0] : '-';

                const nextMetrics = {
                    total,
                    current,
                    peak,
                    averageSpeed: Math.round(weightedAverageSpeed * 10) / 10,
                    v85Speed: Math.round(weightedV85Speed * 10) / 10,
                    maxSpeed,
                    overThresholdCount,
                    lowNoMovementPeriods,
                    approachShare,
                    busiestDay,
                    busiestTime,
                };
                if (isMounted) {
                    setLiveMetrics(nextMetrics);
                    onSnapshotData?.(nextMetrics);
                }
            } else {
                const emptyMetrics = { total: 0, current: 0, peak: 0, averageSpeed: 0, v85Speed: 0, maxSpeed: 0, overThresholdCount: Number.isFinite(Number(thresholdValue)) ? 0 : '-', lowNoMovementPeriods: 0, approachShare: 0, busiestDay: '-', busiestTime: '-' };
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
    }, [chartMetrics, level, id, effectiveFilters, timeframe, snapshotData, onSnapshotData, preferSourceChartData, thresholdValue]);

    const cardStyle = {
        backgroundColor: '#ffffff',
        borderRadius: '10px',
        padding: 'clamp(10px, 0.9vw, 14px)',
        boxShadow: '0 10px 24px rgba(15, 23, 42, 0.06)',
        border: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minHeight: 'clamp(82px, 6.5vw, 108px)',
        minWidth: 0
    };
    const skeletonStyle = {
        display: 'block',
        borderRadius: 999,
        background: 'linear-gradient(90deg, #edf4f7 0%, #f8fbfc 50%, #edf4f7 100%)',
    };

    const labelStyle = { fontSize: 'clamp(0.66rem, 0.68vw, 0.76rem)', color: '#888', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.05em' };
    const valueStyle = { fontSize: 'clamp(1.2rem, 1.45vw, 1.55rem)', fontWeight: '700', color: '#333', margin: 0, lineHeight: 1.1 };
    const activeConfig = activeDetailKey ? metricConfig[activeDetailKey] : null;
    const modalValue = activeDetailKey ? metrics[activeDetailKey] : '';

    const selectedVisibleMetrics = normalizedVisibleMetrics.filter((metric) => (
        metricConfig[metric] &&
        !(timeframe === 'daily' && metric === 'busiestDay') &&
        !(timeframe !== 'daily' && metric === 'busiestTime')
    ));
    const gridStyle = {
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.max(selectedVisibleMetrics.length, 1)}, minmax(150px, 1fr))`,
        alignContent: 'start',
        gap: 'clamp(8px, 1vw, 12px)',
        width: '100%',
        height: metricGroups ? 'auto' : '100%',
        boxSizing: 'border-box',
        minWidth: 0,
        overflowX: 'auto',
    };

    if (isMetricsLoading) {
        if (Array.isArray(metricGroups) && metricGroups.length > 0) {
            return (
                <div data-report-loading="true" style={{ display: 'grid', gap: 'clamp(12px, 1.3vw, 16px)', width: '100%' }}>
                    {metricGroups.map((group) => {
                        const groupMetrics = selectedVisibleMetrics.filter((metric) => group.metrics?.includes(metric));
                        if (!groupMetrics.length) return null;

                        return (
                            <section key={group.label || groupMetrics.join('-')} aria-hidden="true">
                                {group.label ? (
                                    <div style={{ color: '#64748b', fontSize: '0.74rem', fontWeight: 800, letterSpacing: '0.08em', marginBottom: 8, textTransform: 'uppercase' }}>
                                        {group.label}
                                    </div>
                                ) : null}
                                <div style={{
                                    ...gridStyle,
                                    gridTemplateColumns: `repeat(${Math.max(groupMetrics.length, 1)}, minmax(150px, 1fr))`,
                                }}>
                                    {groupMetrics.map((metricKey) => (
                                        <div key={metricKey} style={{ ...cardStyle, gap: '10px' }}>
                                            <span style={{ ...skeletonStyle, height: 12, width: '58%' }} />
                                            <span style={{ ...skeletonStyle, height: 28, width: '44%' }} />
                                            <span style={{ ...skeletonStyle, height: 10, width: '34%' }} />
                                        </div>
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </div>
            );
        }

        return (
            <div data-report-loading="true" style={gridStyle}>
                {selectedVisibleMetrics.map((metricKey) => (
                    <div key={metricKey} style={{ ...cardStyle, gap: '10px' }} aria-hidden="true">
                        <span style={{ ...skeletonStyle, height: 12, width: '58%' }} />
                        <span style={{ ...skeletonStyle, height: 28, width: '44%' }} />
                        <span style={{ ...skeletonStyle, height: 10, width: '34%' }} />
                    </div>
                ))}
            </div>
        );
    }

    const safeVisibleMetrics = selectedVisibleMetrics.filter((metric) => {
        const value = metrics[metric];
        return value !== undefined && value !== null && value !== '' && value !== '-';
    });
    const renderedMetrics = safeVisibleMetrics.length ? safeVisibleMetrics : selectedVisibleMetrics;
    const renderMetricCard = (metricKey) => {
        const config = metricConfig[metricKey];
        const isActive = activeDetailKey === metricKey;
        const value = metrics[metricKey] ?? (config.unit ? 0 : '-');

        return (
            <div
                key={metricKey}
                style={{ ...cardStyle, cursor: 'pointer', position: 'relative' }}
                role="button"
                tabIndex={0}
                onClick={(event) => {
                    event.stopPropagation();
                    setActiveDetailKey(isActive ? null : metricKey);
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setActiveDetailKey(isActive ? null : metricKey);
                    }
                }}
            >
                <span style={labelStyle}>{config.label}</span>
                <p style={valueStyle}>
                    {renderMetricDisplay(value, config.unit)}
                </p>
            </div>
        );
    };
    const modal = activeConfig && typeof document !== 'undefined' && createPortal((
        <div
            role="presentation"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
                event.stopPropagation();
                setActiveDetailKey(null);
            }}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 10000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(15, 23, 42, 0.28)',
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label={`${activeConfig.label} details`}
                onClick={(event) => event.stopPropagation()}
                style={{
                    width: 'min(420px, calc(100vw - 32px))',
                    background: '#ffffff',
                    border: '1px solid #dbe4ee',
                    borderRadius: '14px',
                    boxShadow: '0 24px 60px rgba(15, 23, 42, 0.22)',
                    padding: '20px',
                    color: '#0f172a',
                }}
            >
                <h3 style={{ margin: '0 0 8px', fontSize: '1rem', lineHeight: 1.25 }}>{activeConfig.label}</h3>
                <p style={{ margin: '0 0 14px', color: '#475569', fontSize: '0.9rem', lineHeight: 1.45 }}>{renderMetricDetail(activeConfig.detail)}</p>
                <p style={{ margin: 0, color: '#1f2937', fontWeight: 700 }}>
                    Value: {formatMetricDisplayValue(modalValue, activeConfig.unit)} {activeConfig.unit}
                </p>
                <button
                    type="button"
                    onClick={() => setActiveDetailKey(null)}
                    style={{
                        marginTop: '18px',
                        border: 0,
                        borderRadius: '999px',
                        background: '#2f716f',
                        color: '#ffffff',
                        padding: '8px 16px',
                        fontWeight: 700,
                        cursor: 'pointer',
                    }}
                >
                    Close
                </button>
            </div>
        </div>
    ), document.body);

    if (Array.isArray(metricGroups) && metricGroups.length > 0) {
        return (
            <div style={{ display: 'grid', gap: 'clamp(12px, 1.3vw, 16px)', width: '100%' }}>
                {metricGroups.map((group) => {
                    const groupMetrics = renderedMetrics.filter((metric) => group.metrics?.includes(metric));
                    if (!groupMetrics.length) return null;

                    return (
                        <section key={group.label || groupMetrics.join('-')}>
                            {group.label ? (
                                <div style={{ color: '#64748b', fontSize: '0.74rem', fontWeight: 800, letterSpacing: '0.08em', marginBottom: 8, textTransform: 'uppercase' }}>
                                    {group.label}
                                </div>
                            ) : null}
                            <div style={{
                                ...gridStyle,
                                gridTemplateColumns: `repeat(${Math.max(groupMetrics.length, 1)}, minmax(150px, 1fr))`,
                            }}>
                                {groupMetrics.map(renderMetricCard)}
                            </div>
                        </section>
                    );
                })}
                {modal}
            </div>
        );
    }

    return (
        <div style={{
            ...gridStyle,
            gridTemplateColumns: `repeat(${Math.max(renderedMetrics.length, 1)}, minmax(150px, 1fr))`,
        }}>
            {renderedMetrics.map(renderMetricCard)}
            {modal}
        </div>
    );
};

export default SummaryMetrics;
