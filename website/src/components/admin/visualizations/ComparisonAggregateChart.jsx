import React, { useEffect, useId, useMemo, useState } from 'react';
import supabase from "../../helper/SupabaseClients";
import { getDateBounds, getFilterTimeRange, hasActiveTimeFilter, isSingleDateFilter } from '../controls/AnalyticsFilterUtils';
import { fetchTrafficSummaryRows } from '../data/TrafficSummaryData';
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    LineChart,
    Line,
    BarChart,
    Bar,
    ComposedChart,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ReferenceLine,
} from 'recharts';

const PRIMARY_COLOR = '#2f716f';
const SECONDARY_COLOR = '#8b5cf6';
const PEOPLE_PRIMARY_COLOR = '#64748b';
const PEOPLE_SECONDARY_COLOR = '#b8a2f3';
const OCCUPANCY_COLORS = [PRIMARY_COLOR, SECONDARY_COLOR, '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#6366f1', '#14b8a6'];
const PEOPLE_COLORS = [PEOPLE_PRIMARY_COLOR, PEOPLE_SECONDARY_COLOR, '#94a3b8', '#d97706', '#059669', '#dc2626', '#818cf8', '#0f766e'];
const DEFAULT_CUSTOM_METRICS = { volume: true, avgSpeed: true };

const normalizeOccupancy = (density, people, capacity) => {
    const numericDensity = Number(density);
    if (Number.isFinite(numericDensity)) {
        return numericDensity > 0 && numericDensity <= 1 ? numericDensity * 100 : numericDensity;
    }
    return capacity > 0 ? (people / capacity) * 100 : 0;
};

const getNiceCeiling = (value) => {
    if (!Number.isFinite(value) || value <= 0) return 10;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    return Math.ceil(value / magnitude) * magnitude;
};

const getLocalDateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const getLocalHourKey = (date) => `${getLocalDateKey(date)}-${date.getHours()}`;

const getHourOfDayKey = (date) => String(date.getHours()).padStart(2, '0');

const getWeeklyAnchorDate = (rawData, filters) => {
    if (filters?.endDate) return new Date(`${filters.endDate}T00:00:00`);
    if (filters?.startDate && rawData.length) return new Date(rawData[rawData.length - 1].observed_at);
    return new Date();
};

const matchesDayPreset = (date, filters) => {
    const day = date.getDay();
    if (filters?.dayPreset === 'weekdays') return day !== 0 && day !== 6;
    if (filters?.dayPreset === 'weekends') return day === 0 || day === 6;
    return true;
};

const getDefaultStartTime = (type, anchorDate = new Date()) => {
    const lookbackHours = type === 'weekly' ? 8 * 24 : 24;
    return new Date(new Date(anchorDate).getTime() - lookbackHours * 60 * 60 * 1000);
};

const getHourlyLabel = (date, filters) => {
    const hasMultiDayRange = filters?.startDate && filters?.endDate && filters.startDate !== filters.endDate;
    return hasMultiDayRange
        ? date.toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric' })
        : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const getHourLabel = (hour) => {
    const date = new Date();
    date.setHours(hour, 0, 0, 0);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const createDailySlot = (date) => ({
    key: getLocalDateKey(date),
    sortKey: getLocalDateKey(date),
    time: date.toLocaleDateString([], { month: 'numeric', day: 'numeric' }),
    dateLabel: date.toLocaleDateString([], { month: 'numeric', day: 'numeric' }),
    peopleSum: 0,
    occupancySum: 0,
    count: 0,
});

const getDateRangeSlots = (filters) => {
    const { start, end } = getDateBounds(filters);
    const slots = [];
    const cursor = new Date(start);
    const maxDays = 366;

    cursor.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    while (cursor <= end && slots.length < maxDays) {
        slots.push(createDailySlot(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }

    return slots;
};

const getSelectedHours = (filters) => {
    const { startMinutes, endMinutes } = getFilterTimeRange(filters);
    const startHour = Math.floor(startMinutes / 60);
    const endHour = Math.floor(endMinutes / 60);

    if (startHour <= endHour) {
        return Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);
    }

    return [
        ...Array.from({ length: 24 - startHour }, (_, index) => startHour + index),
        ...Array.from({ length: endHour + 1 }, (_, index) => index),
    ];
};

const createHourOfDayTimeline = (filters) => getSelectedHours(filters).map((hour) => ({
    key: String(hour),
    sortKey: getHourOfDayKey({ getHours: () => hour }),
    time: getHourLabel(hour),
    peopleSum: 0,
    occupancySum: 0,
    count: 0,
}));

const createSingleDateHourlyTimeline = (filters) => {
    const { start } = getDateBounds(filters);
    const date = new Date(start);
    date.setHours(0, 0, 0, 0);
    const hours = hasActiveTimeFilter(filters)
        ? getSelectedHours(filters)
        : Array.from({ length: 24 }, (_, index) => index);

    return hours.map((hour, index) => {
        const slotDate = new Date(date);
        slotDate.setHours(hour, 0, 0, 0);

        return {
            key: getLocalHourKey(slotDate),
            sortKey: String(index).padStart(2, '0'),
            time: getHourLabel(hour),
            peopleSum: 0,
            occupancySum: 0,
            count: 0,
        };
    });
};

const getHourlyRange = (rawData, filters, type) => {
    const hasDateFilters = filters?.startDate || filters?.endDate;
    const { start: filterStart, end: filterEnd } = getDateBounds(filters);
    const fallbackEnd = rawData.length ? new Date(rawData[rawData.length - 1].observed_at) : new Date();
    const fallbackStart = getDefaultStartTime(type, fallbackEnd);
    const start = hasDateFilters
        ? new Date(filterStart)
        : fallbackStart;
    const end = hasDateFilters
        ? new Date(filterEnd)
        : fallbackEnd;

    start.setMinutes(0, 0, 0);
    end.setMinutes(0, 0, 0);

    return start <= end ? { start, end } : { start: end, end: start };
};

const createHourlyTimeline = (rawData, filters, type) => {
    const { start, end } = getHourlyRange(rawData, filters, type);
    const slots = [];
    const cursor = new Date(start);
    const maxHours = 24 * 31;

    while (cursor <= end && slots.length < maxHours) {
        slots.push({
            key: getLocalHourKey(cursor),
            sortKey: String(cursor.getTime()),
            time: getHourlyLabel(cursor, filters),
            peopleSum: 0,
            occupancySum: 0,
            count: 0,
        });
        cursor.setHours(cursor.getHours() + 1);
    }

    return slots;
};

const buildWeeklyData = (rawData, filters) => {
    const anchorDate = getWeeklyAnchorDate(rawData, filters);
    anchorDate.setHours(0, 0, 0, 0);

    const groups = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(anchorDate);
        date.setDate(anchorDate.getDate() - (6 - index));
        const weekday = date.toLocaleDateString([], { weekday: 'short' });
        const dateLabel = date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });

        return {
            sortDate: getLocalDateKey(date),
            sortKey: getLocalDateKey(date),
            time: weekday,
            dateLabel,
            peopleSum: 0,
            occupancySum: 0,
            count: 0,
        };
    });

    const groupsByDate = groups.reduce((acc, group) => {
        acc[group.sortDate] = group;
        return acc;
    }, {});

    rawData.forEach((row) => {
        const group = groupsByDate[getLocalDateKey(new Date(row.observed_at))];
        if (!group) return;

        const people = row.people_count ?? row.total_people ?? 0;
        const capacity = row.total_capacity ?? 0;
        const occupancy = normalizeOccupancy(row.density, people, capacity);

        group.peopleSum += people;
        group.occupancySum += occupancy;
        group.count += 1;
    });

    return groups
        .filter((group) => matchesDayPreset(new Date(`${group.sortDate}T00:00:00`), filters))
        .map((group) => ({
            sortKey: group.sortKey,
            time: group.time,
            dateLabel: group.dateLabel,
            hasData: group.count > 0,
            occupancy: group.count > 0 ? Math.round(group.occupancySum / group.count) : null,
            total_people: group.count > 0 ? Math.round(group.peopleSum / group.count) : 0,
        }));
};

const buildDailyData = (rawData, filters) => {
    const hourlyTimeline = createHourlyTimeline(rawData, filters, 'daily');
    const hourGroups = hourlyTimeline.reduce((acc, group) => {
        acc[group.key] = group;
        return acc;
    }, {});

    rawData.forEach((row) => {
        const date = new Date(row.observed_at);
        date.setMinutes(0, 0, 0);
        const group = hourGroups[getLocalHourKey(date)];
        if (!group) return;

        const people = row.people_count ?? row.total_people ?? 0;
        const capacity = row.total_capacity ?? 0;
        const occupancy = normalizeOccupancy(row.density, people, capacity);

        group.peopleSum += people;
        group.occupancySum += occupancy;
        group.count += 1;
    });

    return hourlyTimeline.map((group) => ({
        sortKey: group.sortKey,
        time: group.time,
        hasData: group.count > 0,
        occupancy: group.count > 0 ? Math.round(group.occupancySum / group.count) : 0,
        total_people: group.count > 0 ? Math.round(group.peopleSum / group.count) : 0,
    }));
};

const buildDateData = (rawData, filters) => {
    const dayTimeline = getDateRangeSlots(filters);
    const groupsByDate = dayTimeline.reduce((acc, group) => {
        acc[group.key] = group;
        return acc;
    }, {});

    rawData.forEach((row) => {
        const group = groupsByDate[getLocalDateKey(new Date(row.observed_at))];
        if (!group) return;

        const people = row.people_count ?? row.total_people ?? 0;
        const capacity = row.total_capacity ?? 0;
        const occupancy = normalizeOccupancy(row.density, people, capacity);

        group.peopleSum += people;
        group.occupancySum += occupancy;
        group.count += 1;
    });

    return dayTimeline.map((group) => ({
        sortKey: group.sortKey,
        time: group.time,
        dateLabel: group.dateLabel,
        hasData: group.count > 0,
        occupancy: group.count > 0 ? Math.round(group.occupancySum / group.count) : 0,
        total_people: group.count > 0 ? Math.round(group.peopleSum / group.count) : 0,
    }));
};

const buildHourOfDayData = (rawData, filters) => {
    const hourlyTimeline = createHourOfDayTimeline(filters);
    const groupsByHour = hourlyTimeline.reduce((acc, group) => {
        acc[group.key] = group;
        return acc;
    }, {});

    rawData.forEach((row) => {
        const date = new Date(row.observed_at);
        const group = groupsByHour[String(date.getHours())];
        if (!group) return;

        const people = row.people_count ?? row.total_people ?? 0;
        const capacity = row.total_capacity ?? 0;
        const occupancy = normalizeOccupancy(row.density, people, capacity);

        group.peopleSum += people;
        group.occupancySum += occupancy;
        group.count += 1;
    });

    return hourlyTimeline.map((group) => ({
        sortKey: group.sortKey,
        time: group.time,
        hasData: group.count > 0,
        occupancy: group.count > 0 ? Math.round(group.occupancySum / group.count) : 0,
        total_people: group.count > 0 ? Math.round(group.peopleSum / group.count) : 0,
    }));
};

const buildSingleDateHourlyData = (rawData, filters) => {
    const hourlyTimeline = createSingleDateHourlyTimeline(filters);
    const hourGroups = hourlyTimeline.reduce((acc, group) => {
        acc[group.key] = group;
        return acc;
    }, {});

    rawData.forEach((row) => {
        const date = new Date(row.observed_at);
        date.setMinutes(0, 0, 0);
        const group = hourGroups[getLocalHourKey(date)];
        if (!group) return;

        const people = row.people_count ?? row.total_people ?? 0;
        const capacity = row.total_capacity ?? 0;
        const occupancy = normalizeOccupancy(row.density, people, capacity);

        group.peopleSum += people;
        group.occupancySum += occupancy;
        group.count += 1;
    });

    return hourlyTimeline.map((group) => ({
        sortKey: group.sortKey,
        time: group.time,
        hasData: group.count > 0,
        occupancy: group.count > 0 ? Math.round(group.occupancySum / group.count) : 0,
        total_people: group.count > 0 ? Math.round(group.peopleSum / group.count) : 0,
    }));
};

const getPeopleAxisMax = (chartData, targetSeries) => {
    const peopleValues = chartData.flatMap((point) => (
        targetSeries.map((series) => Number(point[series.peopleKey]) || 0)
    ));
    const maxPeople = Math.max(0, ...peopleValues);
    return getNiceCeiling(maxPeople);
};

const fetchTargetData = async ({ target, type, filters }) => {
    if (!target.id) return [];

    const sensorId = target.level === 'floor' || target.level === 'room' ? target.id : undefined;
    const rawData = await fetchTrafficSummaryRows(supabase, {
        sensorId,
        filters,
        type,
    });

    if (type === 'weekly') return buildWeeklyData(rawData, filters);

    const hasDateFilters = filters?.startDate || filters?.endDate;
    const hasTimeFilters = hasActiveTimeFilter(filters);
    if (hasDateFilters && isSingleDateFilter(filters)) return buildSingleDateHourlyData(rawData, filters);
    if (hasDateFilters) return buildDateData(rawData, filters);
    if (hasTimeFilters) return buildHourOfDayData(rawData, filters);
    return buildDailyData(rawData, filters);
};

const getTargetKey = (index) => `target${index}`;

const mergeComparisonData = (targetDataSets, type) => {
    const merged = new Map();

    const addPoint = (point, targetIndex) => {
        const key = point.sortKey || (type === 'weekly' ? point.dateLabel : point.time);
        const existing = merged.get(key) || {
            sortKey: key,
            time: point.time,
            dateLabel: point.dateLabel,
        };
        const targetKey = getTargetKey(targetIndex);
        const hasData = point.hasData !== false;

        existing[`${targetKey}Occupancy`] = hasData ? point.occupancy : null;
        existing[`${targetKey}People`] = hasData ? point.total_people : null;
        existing[`${targetKey}HasData`] = hasData;
        merged.set(key, existing);
    };

    targetDataSets.forEach((targetData, targetIndex) => {
        targetData.forEach((point) => addPoint(point, targetIndex));
    });

    return Array.from(merged.values())
        .sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));
};

const ComparisonAggregateChart = ({
    targets,
    type,
    filters,
    plotType = 'line',
    snapshotData,
    onSnapshotData,
    seriesColors = [],
    peopleSeriesColors = [],
    thresholdEnabled = false,
    thresholdValue,
    thresholdLabel = 'Threshold',
    thresholdColor = '#ef4444',
    showLegend = true,
    legendItems,
    customMetrics,
    frameless = false,
}) => {
    const [liveChartData, setLiveChartData] = useState([]);
    const [isLoading, setIsLoading] = useState(!snapshotData?.length);
    const gradientId = `comparisonOccupancy-${useId().replace(/:/g, '')}`;

    const activeTargets = useMemo(() => (
        (Array.isArray(targets) ? targets : [])
            .filter((target) => target?.id && target?.level)
            .map((target) => ({
                id: target.id,
                level: target.level,
                label: target.label || '',
            }))
    ), [targets]);
    const targetSignature = useMemo(() => (
        activeTargets.map((target) => `${target.level}:${target.id}:${target.label}`).join('|')
    ), [activeTargets]);
    const hasTargets = activeTargets.length >= 2;
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
    const chartData = useMemo(() => (
        (snapshotData?.length ? snapshotData : liveChartData).map((point, index) => ({
            ...point,
            sortKey: point.sortKey || `${point.dateLabel || point.time || 'point'}-${index}`,
        }))
    ), [liveChartData, snapshotData]);
    const isChartLoading = !snapshotData?.length && isLoading;
    const targetSeries = useMemo(() => activeTargets.map((target, index) => ({
        ...target,
        label: target.label || `Data source ${index + 1}`,
        key: getTargetKey(index),
        occupancyKey: `${getTargetKey(index)}Occupancy`,
        peopleKey: `${getTargetKey(index)}People`,
        occupancyColor: seriesColors[index] || OCCUPANCY_COLORS[index % OCCUPANCY_COLORS.length],
        peopleColor: peopleSeriesColors[index] || PEOPLE_COLORS[index % PEOPLE_COLORS.length],
        dash: index > 0 && index % 2 === 1 ? '7 4' : undefined,
    })), [activeTargets, peopleSeriesColors, seriesColors]);
    const peopleAxisMax = useMemo(() => getPeopleAxisMax(chartData, targetSeries), [chartData, targetSeries]);
    const speedAxisMax = useMemo(() => getNiceCeiling(Math.max(10, ...chartData.flatMap((point) => (
        targetSeries.map((series) => Number(point[series.occupancyKey]) || 0)
    )))), [chartData, targetSeries]);
    const effectiveLegendItems = { occupancy: true, people: true, threshold: true, ...(legendItems || {}) };
    const effectiveCustomMetrics = { ...DEFAULT_CUSTOM_METRICS, ...(customMetrics || {}) };

    useEffect(() => {
        if (snapshotData?.length) {
            return undefined;
        }

        let isMounted = true;

        const fetchComparisonData = async () => {
            if (!hasTargets) {
                if (isMounted) {
                    setLiveChartData([]);
                    setIsLoading(false);
                }
                return;
            }

            setIsLoading(true);

            try {
                const targetDataSets = await Promise.all(
                    activeTargets.map((target) => fetchTargetData({ target, type, filters: effectiveFilters }))
                );

                const nextData = mergeComparisonData(targetDataSets, type);
                if (isMounted) {
                    setLiveChartData(nextData);
                    onSnapshotData?.(nextData);
                }
            } catch (error) {
                console.error('Comparison chart fetch error:', error);
                if (isMounted) setLiveChartData([]);
            } finally {
                if (isMounted) setIsLoading(false);
            }
        };

        fetchComparisonData();
        return () => {
            isMounted = false;
        };
    }, [activeTargets, hasTargets, targetSignature, type, effectiveFilters, snapshotData, onSnapshotData]);

    const xAxisKey = type === 'weekly' ? 'dateLabel' : 'sortKey';
    const tickInterval = type === 'weekly' ? 0 : 2;
    const xAxisTickLabels = useMemo(() => (
        new Map(chartData.map((point) => [
            String(point[xAxisKey]),
            type === 'weekly' ? point.dateLabel || point.time : point.time,
        ]))
    ), [chartData, type, xAxisKey]);

    const renderTooltip = ({ active, payload, label }) => {
        if (!active || !payload?.length) return null;

        const point = payload[0].payload;
        const tooltipLabel = point?.dateLabel || point?.time || label;
        const showsSpeed = plotType === 'custom' ? effectiveCustomMetrics.avgSpeed : plotType !== 'people_bar';
        const showsVolume = plotType === 'custom' ? effectiveCustomMetrics.volume : plotType === 'people_bar' || plotType === 'combo';

        return (
            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px', boxShadow: '0 6px 18px rgba(15, 23, 42, 0.08)' }}>
                <div style={{ color: '#374151', fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>{tooltipLabel}</div>
                {showsSpeed && targetSeries.map((series) => {
                    const hasData = point[`${series.key}HasData`] !== false;
                    return (
                        <div key={series.key} style={{ color: hasData ? series.occupancyColor : '#6b7280', fontSize: '12px', fontWeight: 600, marginTop: '4px' }}>
                            {series.label} avg speed: {hasData ? `${point[series.occupancyKey] ?? 0} mph` : 'No samples'}
                        </div>
                    );
                })}
                {showsVolume && (
                    <>
                        {targetSeries.map((series) => {
                            const hasData = point[`${series.key}HasData`] !== false;
                            return hasData ? (
                                <div key={`${series.key}-people`} style={{ color: series.peopleColor, fontSize: '12px', marginTop: '4px' }}>
                                    {series.label} traffic volume: {point[series.peopleKey] ?? 0}
                                </div>
                            ) : null;
                        })}
                    </>
                )}
            </div>
        );
    };

    const renderGrid = () => <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />;
    const renderXAxis = () => (
        <XAxis
            dataKey={xAxisKey}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: '#888' }}
            tickMargin={10}
            minTickGap={type === 'weekly' ? 0 : 18}
            interval={tickInterval}
            tickFormatter={(value) => xAxisTickLabels.get(String(value)) || value}
        />
    );
    const renderOccupancyYAxis = (props = {}) => (
        <YAxis
            domain={[0, speedAxisMax]}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: '#888' }}
            allowDecimals={false}
            tickFormatter={(value) => `${value} mph`}
            label={props.yAxisId ? { value: 'Avg speed', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 } : undefined}
            {...props}
        />
    );
    const renderPeopleYAxis = (props = {}) => (
        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#888' }} allowDecimals={false} domain={[0, peopleAxisMax]} label={props.yAxisId ? { value: 'Traffic volume', angle: 90, position: 'insideRight', fill: '#94a3b8', fontSize: 11 } : undefined} {...props} />
    );
    const renderThresholdLine = (props = {}) => {
        const parsedValue = Number(thresholdValue);
        if (!thresholdEnabled || !Number.isFinite(parsedValue)) return null;

        return (
            <ReferenceLine
                y={parsedValue}
                stroke={thresholdColor}
                strokeDasharray="6 4"
                strokeWidth={1.5}
                label={{ value: thresholdLabel, fill: thresholdColor, fontSize: 11, position: 'insideTopRight' }}
                {...props}
            />
        );
    };

    const renderLegend = () => {
        if (!showLegend) return null;

        const entries = [];
        if (effectiveLegendItems.occupancy && plotType !== 'people_bar') {
            targetSeries.forEach((series) => {
                if (plotType !== 'custom' || effectiveCustomMetrics.avgSpeed) {
                    entries.push({
                        key: `${series.key}-occupancy`,
                        label: ['combo', 'custom'].includes(plotType) ? `${series.label} avg speed mph (left axis)` : `${series.label} avg speed mph`,
                        color: series.occupancyColor,
                        type: 'line',
                        dash: Boolean(series.dash),
                    });
                }
            });
        }
        if (effectiveLegendItems.people && (plotType === 'people_bar' || plotType === 'combo' || plotType === 'custom')) {
            targetSeries.forEach((series) => {
                if (plotType !== 'custom' || effectiveCustomMetrics.volume) {
                    entries.push({
                        key: `${series.key}-people`,
                        label: ['combo', 'custom'].includes(plotType) ? `${series.label} traffic volume (right axis)` : `${series.label} traffic volume`,
                        color: series.peopleColor,
                        type: 'bar',
                    });
                }
            });
        }
        if (effectiveLegendItems.threshold && thresholdEnabled && Number.isFinite(Number(thresholdValue))) {
            entries.push({
                key: 'threshold',
                label: thresholdLabel || 'Threshold',
                color: thresholdColor,
                type: 'threshold',
            });
        }

        if (!entries.length) return null;

        return (
            <div style={{ display: 'flex', gap: '10px 14px', flexWrap: 'wrap', margin: '0 0 10px', color: '#64748b', fontSize: '11px', fontWeight: 700 }}>
                {entries.map((entry) => (
                    <span key={entry.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: entry.color }}>
                        <span
                            aria-hidden="true"
                            style={{
                                width: entry.type === 'bar' ? 10 : 18,
                                height: entry.type === 'bar' ? 10 : 0,
                                borderRadius: entry.type === 'bar' ? 3 : 0,
                                background: entry.type === 'bar' ? entry.color : 'transparent',
                                borderTop: entry.type !== 'bar' ? `2px ${entry.type === 'threshold' || entry.dash ? 'dashed' : 'solid'} ${entry.color}` : '0',
                            }}
                        />
                        {entry.label}
                    </span>
                ))}
            </div>
        );
    };

    const renderChart = () => {
        const commonMargin = { top: 28, right: 10, left: -12, bottom: 18 };

        if (plotType === 'custom') {
            const hasSpeedMetric = Boolean(effectiveCustomMetrics.avgSpeed);
            const hasVolumeMetric = Boolean(effectiveCustomMetrics.volume);
            const thresholdAxisId = hasSpeedMetric ? 'occupancy' : 'people';

            return (
                <ComposedChart data={chartData} margin={{ top: 28, right: 14, left: 0, bottom: 18 }}>
                    {renderGrid()}
                    {renderXAxis()}
                    {hasSpeedMetric && renderOccupancyYAxis({ yAxisId: 'occupancy' })}
                    {hasVolumeMetric && renderPeopleYAxis({ yAxisId: 'people', orientation: 'right', width: 46 })}
                    {(hasSpeedMetric || hasVolumeMetric) && renderThresholdLine({ yAxisId: thresholdAxisId })}
                    <Tooltip content={renderTooltip} />
                    {effectiveCustomMetrics.volume && targetSeries.map((series) => (
                        <Bar key={series.peopleKey} yAxisId="people" dataKey={series.peopleKey} name={`${series.label} traffic volume`} fill={series.peopleColor} opacity={0.58} radius={[5, 5, 0, 0]} />
                    ))}
                    {effectiveCustomMetrics.avgSpeed && targetSeries.map((series) => (
                        <Line key={series.occupancyKey} yAxisId="occupancy" type="monotone" dataKey={series.occupancyKey} name={`${series.label} avg speed mph`} stroke={series.occupancyColor} strokeWidth={3} strokeDasharray={series.dash} dot={{ r: 3.5, strokeWidth: 2 }} activeDot={{ r: 5.5 }} connectNulls={type !== 'weekly'} isAnimationActive={false} />
                    ))}
                </ComposedChart>
            );
        }

        if (plotType === 'bar') {
            return (
                <BarChart data={chartData} margin={commonMargin}>
                    {renderGrid()}
                    {renderXAxis()}
                    {renderOccupancyYAxis()}
                    {renderThresholdLine()}
                    <Tooltip content={renderTooltip} />
                    {targetSeries.map((series) => (
                        <Bar key={series.occupancyKey} dataKey={series.occupancyKey} name={series.label} fill={series.occupancyColor} radius={[5, 5, 0, 0]} />
                    ))}
                </BarChart>
            );
        }

        if (plotType === 'people_bar') {
            return (
                <BarChart data={chartData} margin={commonMargin}>
                    {renderGrid()}
                    {renderXAxis()}
                    {renderPeopleYAxis()}
                    {renderThresholdLine()}
                    <Tooltip content={renderTooltip} />
                    {targetSeries.map((series) => (
                        <Bar key={series.peopleKey} dataKey={series.peopleKey} name={`${series.label} traffic volume`} fill={series.peopleColor} radius={[5, 5, 0, 0]} />
                    ))}
                </BarChart>
            );
        }

        if (plotType === 'combo') {
            return (
                <ComposedChart data={chartData} margin={{ top: 28, right: 14, left: 0, bottom: 18 }}>
                    {renderGrid()}
                    {renderXAxis()}
                    {renderOccupancyYAxis({ yAxisId: 'occupancy' })}
                    {renderPeopleYAxis({ yAxisId: 'people', orientation: 'right', width: 46 })}
                    {renderThresholdLine({ yAxisId: 'occupancy' })}
                    <Tooltip content={renderTooltip} />
                    {targetSeries.map((series) => (
                        <Bar key={series.peopleKey} yAxisId="people" dataKey={series.peopleKey} name={`${series.label} traffic volume (right axis)`} fill={series.peopleColor} opacity={0.58} radius={[5, 5, 0, 0]} />
                    ))}
                    {targetSeries.map((series) => (
                        <Line key={series.occupancyKey} yAxisId="occupancy" type="monotone" dataKey={series.occupancyKey} name={`${series.label} avg speed mph (left axis)`} stroke={series.occupancyColor} strokeWidth={3} strokeDasharray={series.dash} dot={{ r: 3.5, strokeWidth: 2 }} activeDot={{ r: 5.5 }} connectNulls={type !== 'weekly'} isAnimationActive={false} />
                    ))}
                </ComposedChart>
            );
        }

        if (plotType === 'area') {
            return (
                <AreaChart data={chartData} margin={commonMargin}>
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={PRIMARY_COLOR} stopOpacity={0.28}/>
                            <stop offset="95%" stopColor={PRIMARY_COLOR} stopOpacity={0}/>
                        </linearGradient>
                    </defs>
                    {renderGrid()}
                    {renderXAxis()}
                    {renderOccupancyYAxis()}
                    {renderThresholdLine()}
                    <Tooltip content={renderTooltip} />
                    {targetSeries.map((series, index) => (
                        <Area key={series.occupancyKey} type="monotone" dataKey={series.occupancyKey} name={series.label} stroke={series.occupancyColor} strokeWidth={3} strokeDasharray={series.dash} fill={index === 0 ? `url(#${gradientId})` : 'transparent'} connectNulls={type !== 'weekly'} isAnimationActive={false} />
                    ))}
                </AreaChart>
            );
        }

        return (
            <LineChart data={chartData} margin={commonMargin}>
                {renderGrid()}
                {renderXAxis()}
                {renderOccupancyYAxis()}
                {renderThresholdLine()}
                <Tooltip content={renderTooltip} />
                {targetSeries.map((series) => (
                    <Line key={series.occupancyKey} type="monotone" dataKey={series.occupancyKey} name={series.label} stroke={series.occupancyColor} strokeWidth={3} strokeDasharray={series.dash} dot={{ r: 3.5, strokeWidth: 2 }} activeDot={{ r: 5.5 }} connectNulls={type !== 'weekly'} isAnimationActive={false} />
                ))}
            </LineChart>
        );
    };

    return (
        <div style={{
            backgroundColor: frameless ? 'transparent' : '#ffffff',
            borderRadius: frameless ? 0 : '16px',
            padding: frameless ? '0' : 'clamp(18px, 2vw, 28px)',
            boxShadow: frameless ? 'none' : '0 4px 12px rgba(0, 0, 0, 0.03)',
            border: frameless ? '0' : '1px solid #f0f0f0',
            width: '100%',
            boxSizing: 'border-box',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0
        }}>
            {hasTargets && chartData.length > 0 && renderLegend()}
            <div style={{ flexGrow: 1, width: '100%', minHeight: 0 }}>
                {!hasTargets ? (
                    <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                        <p style={{ color: '#888', textAlign: 'center' }}>Select at least two data sources to compare.</p>
                    </div>
                ) : isChartLoading ? (
                    <div data-report-loading="true" style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                        <p style={{ color: '#888' }}>Loading Comparison...</p>
                    </div>
                ) : chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        {renderChart()}
                    </ResponsiveContainer>
                ) : (
                    <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                        <p style={{ color: '#888', textAlign: 'center' }}>No overlapping historical data available for these data sources.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ComparisonAggregateChart;
