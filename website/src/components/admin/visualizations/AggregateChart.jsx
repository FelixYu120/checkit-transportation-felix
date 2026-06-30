import React, { useState, useEffect, useId, useMemo } from 'react';
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
    Cell,
    ComposedChart,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ReferenceLine
} from 'recharts';

const OCCUPANCY_COLOR = '#7cb49c';
const PEOPLE_COLOR = '#6b7280';
const HIGHLIGHT_COLOR = '#f59e0b';

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

const createWeeklyDay = (date) => {
    const weekday = date.toLocaleDateString([], { weekday: 'short' });
    const dateLabel = date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });

    return {
        sortDate: getLocalDateKey(date),
        time: weekday,
        axisLabel: `${weekday} ${dateLabel}`,
        dateLabel,
        peopleSum: 0,
        occupancySum: 0,
        count: 0,
    };
};

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

const getSelectedHourRange = (filters) => {
    const { startMinutes, endMinutes } = getFilterTimeRange(filters);
    const startHour = Math.floor(startMinutes / 60);
    const endHour = Math.floor(endMinutes / 60);
    return { startHour, endHour };
};

const getSelectedHours = (filters) => {
    const { startHour, endHour } = getSelectedHourRange(filters);
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

const buildDateAggregateData = (rawData, filters) => {
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

const buildHourOfDayAggregateData = (rawData, filters) => {
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

const buildSingleDateHourlyAggregateData = (rawData, filters) => {
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

const buildWeeklyAggregateData = (rawData, filters) => {
    const anchorDate = getWeeklyAnchorDate(rawData, filters);
    anchorDate.setHours(0, 0, 0, 0);

    const dayGroups = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(anchorDate);
        date.setDate(anchorDate.getDate() - (6 - index));
        return createWeeklyDay(date);
    });

    const groupsByDate = dayGroups.reduce((acc, group) => {
        acc[group.sortDate] = group;
        return acc;
    }, {});

    rawData.forEach((row) => {
        const dateKey = getLocalDateKey(new Date(row.observed_at));
        const group = groupsByDate[dateKey];

        if (!group) return;

        const people = row.people_count ?? row.total_people ?? 0;
        const capacity = row.total_capacity ?? 0;
        const occupancy = normalizeOccupancy(row.density, people, capacity);

        group.peopleSum += people;
        group.occupancySum += occupancy;
        group.count += 1;
    });

    return dayGroups
        .filter((group) => matchesDayPreset(new Date(`${group.sortDate}T00:00:00`), filters))
        .map((group) => ({
            sortKey: group.sortDate,
            time: group.time,
            axisLabel: group.axisLabel,
            dateLabel: group.dateLabel,
            hasData: group.count > 0,
            occupancy: group.count > 0 ? Math.round(group.occupancySum / group.count) : null,
            total_people: group.count > 0 ? Math.round(group.peopleSum / group.count) : 0,
        }));
};

const getHighlightIndex = (data, plotType, highlightMode) => {
    if (!highlightMode || highlightMode === 'none' || data.length === 0) return -1;
    const key = plotType === 'people_bar' ? 'total_people' : 'occupancy';
    return data.reduce((bestIndex, point, index) => {
        const bestValue = data[bestIndex]?.[key] ?? -Infinity;
        const nextValue = point?.[key] ?? -Infinity;
        return nextValue > bestValue ? index : bestIndex;
    }, 0);
};

const getPeopleAxisMax = (chartData) => {
    const maxPeople = Math.max(0, ...chartData.map((point) => Number(point.total_people) || 0));
    return getNiceCeiling(maxPeople);
};

const AggregateChart = ({
    level,
    id,
    type,
    title,
    filters,
    plotType = 'area',
    snapshotData,
    onSnapshotData,
    highlightMode = 'none',
    highlightLabel = 'Peak',
    occupancyColor = OCCUPANCY_COLOR,
    peopleColor = PEOPLE_COLOR,
    highlightColor = HIGHLIGHT_COLOR,
    thresholdEnabled = false,
    thresholdValue,
    thresholdLabel = 'Threshold',
    thresholdColor = '#ef4444',
    showLegend,
    legendItems,
    frameless = false,
}) => {
    const [liveChartData, setLiveChartData] = useState([]);
    const [isLoading, setIsLoading] = useState(!snapshotData?.length);
    const gradientId = `colorOccupancy-${useId().replace(/:/g, '')}`;
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
    const highlightIndex = getHighlightIndex(chartData, plotType, highlightMode);
    const highlightedPoint = highlightIndex >= 0 ? chartData[highlightIndex] : null;
    const peopleAxisMax = useMemo(() => getPeopleAxisMax(chartData), [chartData]);
    const speedAxisMax = useMemo(() => getNiceCeiling(Math.max(10, ...chartData.map((point) => Number(point.occupancy) || 0))), [chartData]);
    const effectiveLegendItems = { occupancy: true, people: true, threshold: true, ...(legendItems || {}) };
    const shouldShowLegend = showLegend ?? plotType === 'combo';

    useEffect(() => {
        if (snapshotData?.length) {
            return undefined;
        }

        let isMounted = true;

        const fetchViewData = async () => {
            setIsLoading(true);
            const sensorId = level === 'floor' || level === 'room' ? id : undefined;

            if (!id) {
                if (isMounted) {
                    setLiveChartData([]);
                    setIsLoading(false);
                }
                return;
            }

            try {
                const rawData = await fetchTrafficSummaryRows(supabase, {
                    sensorId,
                    filters: effectiveFilters,
                    type,
                });
                let processedData = [];

                if (type === 'weekly') {
                    processedData = buildWeeklyAggregateData(rawData, effectiveFilters);

                } else {
                    const hasDateFilters = effectiveFilters.startDate || effectiveFilters.endDate;
                    const hasTimeFilters = hasActiveTimeFilter(effectiveFilters);

                    if (hasDateFilters && isSingleDateFilter(effectiveFilters)) {
                        processedData = buildSingleDateHourlyAggregateData(rawData, effectiveFilters);
                    } else if (hasDateFilters) {
                        processedData = buildDateAggregateData(rawData, effectiveFilters);
                    } else if (hasTimeFilters) {
                        processedData = buildHourOfDayAggregateData(rawData, effectiveFilters);
                    } else {
                        const hourlyTimeline = createHourlyTimeline(rawData, effectiveFilters, type);
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

                        processedData = hourlyTimeline.map(group => ({
                            sortKey: group.sortKey,
                            time: group.time,
                            hasData: group.count > 0,
                            occupancy: group.count > 0 ? Math.round(group.occupancySum / group.count) : 0,
                            total_people: group.count > 0 ? Math.round(group.peopleSum / group.count) : 0,
                        }));
                    }
                }
                if (isMounted) {
                    setLiveChartData(processedData);
                    onSnapshotData?.(processedData);
                }
            } catch (error) {
                console.error(`Error fetching ${level} chart data:`, error);
            }
            if (isMounted) setIsLoading(false);
        };
        
        fetchViewData();
        return () => {
            isMounted = false;
        };
    }, [level, id, type, effectiveFilters, snapshotData, onSnapshotData]);

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

        return (
            <div style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px', boxShadow: '0 6px 18px rgba(15, 23, 42, 0.08)' }}>
                <div style={{ color: '#374151', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>{tooltipLabel}</div>
                {point.hasData === false ? (
                    <div style={{ color: '#6b7280', fontSize: '12px', fontWeight: 600 }}>No samples recorded</div>
                ) : 'occupancy' in point && (
                    <div style={{ color: occupancyColor, fontSize: '12px', fontWeight: 600 }}>Avg speed: {point.occupancy ?? 0} mph</div>
                )}
                {point.hasData !== false && 'total_people' in point && (
                    <div style={{ color: peopleColor, fontSize: '12px', marginTop: '4px' }}>Vehicles: {point.total_people ?? 0}</div>
                )}
            </div>
        );
    };

    const renderCommonGrid = () => (
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
    );

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
        <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: '#888' }}
            allowDecimals={false}
            domain={[0, peopleAxisMax]}
            label={props.yAxisId ? { value: 'Vehicle count', angle: 90, position: 'insideRight', fill: '#94a3b8', fontSize: 11 } : undefined}
            {...props}
        />
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
        if (!shouldShowLegend) return null;

        const entries = [];
        if (effectiveLegendItems.occupancy && plotType !== 'people_bar') {
            entries.push({
                key: 'occupancy',
                label: plotType === 'combo' ? 'Avg speed mph (left axis)' : 'Avg speed mph',
                color: occupancyColor,
                type: 'line',
            });
        }
        if (effectiveLegendItems.people && (plotType === 'people_bar' || plotType === 'combo')) {
            entries.push({
                key: 'people',
                label: plotType === 'combo' ? 'Vehicle count (right axis)' : 'Vehicle count',
                color: peopleColor,
                type: 'bar',
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
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', margin: highlightedPoint ? '0 0 8px' : '0 0 10px', color: '#64748b', fontSize: '11px', fontWeight: 700 }}>
                {entries.map((entry) => (
                    <span key={entry.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: entry.color }}>
                        <span
                            aria-hidden="true"
                            style={{
                                width: entry.type === 'bar' ? 10 : 18,
                                height: entry.type === 'bar' ? 10 : 0,
                                borderRadius: entry.type === 'bar' ? 3 : 0,
                                background: entry.type === 'bar' ? entry.color : 'transparent',
                                borderTop: entry.type !== 'bar' ? `2px ${entry.type === 'threshold' ? 'dashed' : 'solid'} ${entry.color}` : '0',
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

        if (plotType === 'line') {
            return (
                <LineChart data={chartData} margin={commonMargin}>
                    {renderCommonGrid()}
                    {renderXAxis()}
                    {renderOccupancyYAxis()}
                    {renderThresholdLine()}
                    <Tooltip content={renderTooltip} />
                    <Line
                        type="monotone"
                        dataKey="occupancy"
                        name="Average speed"
                        stroke={occupancyColor}
                        strokeWidth={2.5}
                        dot={({ index, cx, cy }) => (
                            <circle cx={cx} cy={cy} r={index === highlightIndex ? 6 : 3} fill={index === highlightIndex ? highlightColor : occupancyColor} stroke="#ffffff" strokeWidth={2} />
                        )}
                        activeDot={{ r: 5 }}
                        connectNulls={type !== 'weekly'}
                    />
                </LineChart>
            );
        }

        if (plotType === 'bar') {
            return (
                <BarChart data={chartData} margin={commonMargin}>
                    {renderCommonGrid()}
                    {renderXAxis()}
                    {renderOccupancyYAxis()}
                    {renderThresholdLine()}
                    <Tooltip content={renderTooltip} />
                    <Bar dataKey="occupancy" name="Average speed" fill={occupancyColor} radius={[6, 6, 0, 0]}>
                        {chartData.map((entry, index) => (
                            <Cell key={`${entry.time || entry.dateLabel}-${index}`} fill={index === highlightIndex ? highlightColor : occupancyColor} />
                        ))}
                    </Bar>
                </BarChart>
            );
        }

        if (plotType === 'people_bar') {
            return (
                <BarChart data={chartData} margin={commonMargin}>
                    {renderCommonGrid()}
                    {renderXAxis()}
                    {renderPeopleYAxis()}
                    {renderThresholdLine()}
                    <Tooltip content={renderTooltip} />
                    <Bar dataKey="total_people" name="Vehicles" fill={peopleColor} radius={[6, 6, 0, 0]}>
                        {chartData.map((entry, index) => (
                            <Cell key={`${entry.time || entry.dateLabel}-${index}`} fill={index === highlightIndex ? highlightColor : peopleColor} />
                        ))}
                    </Bar>
                </BarChart>
            );
        }

        if (plotType === 'combo') {
            return (
                <ComposedChart data={chartData} margin={{ top: 28, right: 14, left: 0, bottom: 18 }}>
                    {renderCommonGrid()}
                    {renderXAxis()}
                    {renderOccupancyYAxis({ yAxisId: "occupancy" })}
                    {renderPeopleYAxis({ yAxisId: "people", orientation: "right", width: 46 })}
                    {renderThresholdLine({ yAxisId: "occupancy" })}
                    <Tooltip content={renderTooltip} />
                    <Bar yAxisId="people" dataKey="total_people" name="Vehicle count (right axis)" fill={peopleColor} radius={[6, 6, 0, 0]} opacity={0.62}>
                        {chartData.map((entry, index) => (
                            <Cell key={`${entry.time || entry.dateLabel}-${index}`} fill={peopleColor} />
                        ))}
                    </Bar>
                    <Line
                        yAxisId="occupancy"
                        type="monotone"
                        dataKey="occupancy"
                        name="Average speed mph (left axis)"
                        stroke={occupancyColor}
                        strokeWidth={2.5}
                        dot={({ index, cx, cy }) => (
                            <circle cx={cx} cy={cy} r={index === highlightIndex ? 6 : 3} fill={index === highlightIndex ? highlightColor : occupancyColor} stroke="#ffffff" strokeWidth={2} />
                        )}
                        activeDot={{ r: 5 }}
                        connectNulls={type !== 'weekly'}
                    />
                </ComposedChart>
            );
        }

        return (
            <AreaChart data={chartData} margin={commonMargin}>
                <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={occupancyColor} stopOpacity={0.4}/>
                        <stop offset="95%" stopColor={occupancyColor} stopOpacity={0}/>
                    </linearGradient>
                </defs>
                {renderCommonGrid()}
                {renderXAxis()}
                {renderOccupancyYAxis()}
                {renderThresholdLine()}
                <Tooltip content={renderTooltip} />
                <Area
                    type="monotone"
                    dataKey="occupancy"
                    name="Average speed"
                    stroke={occupancyColor}
                    strokeWidth={2}
                    fillOpacity={1}
                    fill={`url(#${gradientId})`}
                    connectNulls={type !== 'weekly'}
                    activeDot={{ r: 5 }}
                    dot={({ index, cx, cy }) => (
                        index === highlightIndex ? <circle cx={cx} cy={cy} r={6} fill={highlightColor} stroke="#ffffff" strokeWidth={2} /> : null
                    )}
                />
            </AreaChart>
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
            {title && (
                <h3 style={{ fontSize: 'clamp(1rem, 1.25vw, 1.25rem)', fontWeight: '500', color: '#333', margin: '0 0 20px 0' }}>
                    {title}
                </h3>
            )}
            {highlightedPoint && (
                <div style={{ alignSelf: 'flex-start', margin: '0 0 8px', padding: '5px 9px', borderRadius: '999px', background: '#fffbeb', color: '#92400e', border: `1px solid ${highlightColor}`, fontSize: '11px', fontWeight: 700, lineHeight: 1.2 }}>
                    {highlightLabel}: {plotType === 'people_bar' ? highlightedPoint.total_people : highlightedPoint.occupancy}{plotType === 'people_bar' ? ' vehicles' : ' mph'} at {highlightedPoint.dateLabel || highlightedPoint.time}
                </div>
            )}
            {renderLegend()}

            <div style={{ flexGrow: 1, width: '100%', minHeight: 0 }}>
                {isChartLoading ? (
                    <div data-report-loading="true" style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                        <p style={{ color: '#888' }}>Loading Data...</p>
                    </div>
                ) : chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        {renderChart()}
                    </ResponsiveContainer>
                ) : (
                    <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                        <p style={{ color: '#888' }}>No historical data available yet.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AggregateChart;
