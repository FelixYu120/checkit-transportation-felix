import React, { useState, useEffect, useMemo } from 'react';
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip
} from 'recharts';
import supabase from "../../helper/SupabaseClients";
import { getDateBounds, getFilterTimeRange, hasActiveTimeFilter, isSingleDateFilter } from '../controls/AnalyticsFilterUtils';
import { fetchTrafficSummaryRows, getLatestTrafficSummaryDate } from '../data/TrafficSummaryData';

const getLocalDateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const createWeeklyDay = (date) => {
    const weekday = date.toLocaleDateString([], { weekday: 'short' });
    const dateLabel = date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });

    return {
        sortDate: getLocalDateKey(date),
        time: weekday,
        axisLabel: `${weekday} ${dateLabel}`,
        dateLabel,
        densitySum: 0,
        peopleSum: 0,
        count: 0,
    };
};

const getWeeklyAnchorDate = (rawData, filters) => {
    if (filters?.endDate) return new Date(`${filters.endDate}T00:00:00`);
    if (filters?.startDate && rawData.length) return new Date(rawData[rawData.length - 1].observed_at);
    if (rawData.length) return new Date(rawData[rawData.length - 1].observed_at);
    return new Date();
};

const normalizeDensity = (density, people = 0) => {
    const numericDensity = Number(density);
    if (Number.isFinite(numericDensity)) {
        return numericDensity > 0 && numericDensity <= 1 ? numericDensity * 100 : numericDensity;
    }

    return people > 0 ? 100 : 0;
};

const getNiceCeiling = (value) => {
    if (!Number.isFinite(value) || value <= 0) return 10;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    return Math.ceil(value / magnitude) * magnitude;
};

const matchesDayPreset = (date, filters) => {
    const day = date.getDay();
    if (filters?.dayPreset === 'weekdays') return day !== 0 && day !== 6;
    if (filters?.dayPreset === 'weekends') return day === 0 || day === 6;
    return true;
};

const createHourlyTimeline = (anchorDate = new Date()) => {
    const now = new Date(anchorDate);

    return Array.from({ length: 24 }, (_, index) => {
        const date = new Date(now.getTime() - (23 - index) * 60 * 60 * 1000);
        date.setMinutes(0, 0, 0);

        return {
            key: `${getLocalDateKey(date)}-${date.getHours()}`,
            time: date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
            densitySum: 0,
            peopleSum: 0,
            count: 0,
        };
    });
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

const getHourLabel = (hour) => {
    const date = new Date();
    date.setHours(hour, 0, 0, 0);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const createSelectedHourTimeline = (filters) => getSelectedHours(filters).map((hour) => ({
    key: String(hour),
    time: getHourLabel(hour),
    densitySum: 0,
    peopleSum: 0,
    count: 0,
}));

const createSingleDateHourlyTimeline = (filters) => {
    const { start } = getDateBounds(filters);
    const date = new Date(start);
    date.setHours(0, 0, 0, 0);
    const hours = hasActiveTimeFilter(filters)
        ? getSelectedHours(filters)
        : Array.from({ length: 24 }, (_, index) => index);

    return hours.map((hour) => {
        const slotDate = new Date(date);
        slotDate.setHours(hour, 0, 0, 0);

        return {
            key: `${getLocalDateKey(slotDate)}-${hour}`,
            time: getHourLabel(hour),
            densitySum: 0,
            peopleSum: 0,
            count: 0,
        };
    });
};

const createDateTimeline = (filters) => {
    const { start, end } = getDateBounds(filters);
    const timeline = [];
    const cursor = new Date(start);
    const maxDays = 366;

    cursor.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    while (cursor <= end && timeline.length < maxDays) {
        const key = getLocalDateKey(cursor);
        timeline.push({
            key,
            time: cursor.toLocaleDateString([], { month: 'numeric', day: 'numeric' }),
            densitySum: 0,
            peopleSum: 0,
            count: 0,
        });
        cursor.setDate(cursor.getDate() + 1);
    }

    return timeline;
};

const mapRoomGroups = (timeline) => timeline.map((group) => ({
    time: group.time,
    density: group.count > 0 ? Math.round(group.densitySum / group.count) : 0,
    peopleCount: group.count > 0 ? Math.round(group.peopleSum / group.count) : 0,
}));

const buildDailyRoomData = (rawData, filters, anchorDate = new Date()) => {
    const hasDateFilters = filters?.startDate || filters?.endDate;
    const hasTimeFilters = hasActiveTimeFilter(filters);
    const hasSingleDate = isSingleDateFilter(filters);
    const hourlyTimeline = hasDateFilters
        ? hasSingleDate
            ? createSingleDateHourlyTimeline(filters)
            : createDateTimeline(filters)
        : hasTimeFilters
            ? createSelectedHourTimeline(filters)
            : createHourlyTimeline(anchorDate);
    const groupsByKey = hourlyTimeline.reduce((acc, group) => {
        acc[group.key] = group;
        return acc;
    }, {});

    rawData.forEach((row) => {
        const date = new Date(row.observed_at);
        date.setMinutes(0, 0, 0);
        const key = hasDateFilters
            ? hasSingleDate
                ? `${getLocalDateKey(date)}-${date.getHours()}`
                : getLocalDateKey(date)
            : hasTimeFilters
                ? String(date.getHours())
                : `${getLocalDateKey(date)}-${date.getHours()}`;
        const group = groupsByKey[key];

        if (!group) return;

        const people = row.people_count ?? 0;
        group.densitySum += normalizeDensity(row.density, people);
        group.peopleSum += people;
        group.count += 1;
    });

    return mapRoomGroups(hourlyTimeline);
};

const buildPeriodRoomData = (rawData, filters, days) => {
    const anchorDate = getWeeklyAnchorDate(rawData, filters);
    anchorDate.setHours(0, 0, 0, 0);

    const dayGroups = Array.from({ length: days }, (_, index) => {
        const date = new Date(anchorDate);
        date.setDate(anchorDate.getDate() - ((days - 1) - index));
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

        const people = row.people_count ?? 0;
        group.densitySum += normalizeDensity(row.density, people);
        group.peopleSum += people;
        group.count += 1;
    });

    return dayGroups
        .filter((group) => matchesDayPreset(new Date(`${group.sortDate}T00:00:00`), filters))
        .map((group) => ({
            time: group.time,
            axisLabel: group.axisLabel,
            dateLabel: group.dateLabel,
            hasData: group.count > 0,
            density: group.count > 0 ? Math.round(group.densitySum / group.count) : null,
            peopleCount: group.count > 0 ? Math.round(group.peopleSum / group.count) : null,
        }));
};

const buildWeeklyRoomData = (rawData, filters) => buildPeriodRoomData(rawData, filters, 7);

const buildMonthlyRoomData = (rawData, filters) => buildPeriodRoomData(rawData, filters, 30);

const OccupancyChart = ({ roomId, type = 'daily', filters }) => {
    const [chartData, setChartData] = useState([]);
    const [loading, setLoading] = useState(true);
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
    const hasDateFilters = effectiveFilters.startDate || effectiveFilters.endDate;
    const isDateAxis = type === 'weekly' || type === 'monthly' || (hasDateFilters && !isSingleDateFilter(effectiveFilters));
    const shouldCondenseDateTicks = isDateAxis && (type === 'monthly' || chartData.length > 14);
    const speedAxisMax = useMemo(() => getNiceCeiling(Math.max(10, ...chartData.map((point) => Number(point.density) || 0))), [chartData]);
    const formatDateAxisTick = (value) => {
        if (!shouldCondenseDateTicks) return value;

        const index = chartData.findIndex((point) => String(point.dateLabel || point.time) === String(value));
        const isMajorDateTick = index === 0 || index === chartData.length - 1 || index % 7 === 0;
        return isMajorDateTick ? value : '';
    };
    
    const lineColor = type === 'weekly' || type === 'monthly' ? "#6b8e23" : "#7cb49c";

    useEffect(() => {
        const fetchHistory = async ({ showLoading = true } = {}) => {
            if (!roomId) {
                setChartData([]);
                setLoading(false);
                return;
            }
            
            try {
                if (showLoading) setLoading(true);
                
                const rawData = await fetchTrafficSummaryRows(supabase, {
                    sensorId: roomId,
                    filters: effectiveFilters,
                    type,
                });

                if (rawData) {
                    const latestSummaryDate = getLatestTrafficSummaryDate(rawData);
                    let processedData = [];

                    if (hasDateFilters) {
                        processedData = buildDailyRoomData(rawData, effectiveFilters);
                    } else if (type === 'weekly') {
                        processedData = buildWeeklyRoomData(rawData, effectiveFilters);
                    } else if (type === 'monthly') {
                        processedData = buildMonthlyRoomData(rawData, effectiveFilters);
                    } else {
                        processedData = buildDailyRoomData(rawData, effectiveFilters, latestSummaryDate);
                    }
                    
                    setChartData(processedData);
                }
            } catch (err) {
                console.error("❌ Chart Fetch Error:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchHistory();
    }, [roomId, type, effectiveFilters, hasDateFilters]);

    if (loading) return <div data-report-loading="true" style={{ height: 'clamp(320px, 36vw, 460px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading Chart...</div>;

    return (
        <div style={{ width: '100%', minHeight: 'clamp(340px, 38vw, 480px)', backgroundColor: '#ffffff', padding: 'clamp(16px, 1.8vw, 24px)', borderRadius: '12px', boxSizing: 'border-box', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
                <h4 style={{ margin: 0, color: '#374151', fontSize: 'clamp(14px, 1.1vw, 18px)', fontWeight: '600' }}>
                    {type === 'monthly' ? 'Monthly Average Corridor Speed' : type === 'weekly' ? 'Weekly Average Corridor Speed' : '24h Corridor Speed Trend'}
                </h4>
            </div>
            
            <div style={{ width: '100%', height: 'clamp(260px, 30vw, 380px)', minWidth: 0 }}>
                {chartData.length === 0 ? (
                    <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
                        No historical data available yet for this corridor.
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 18, right: 16, left: -12, bottom: 22 }}>
                            <defs>
                                <linearGradient id={`colorOccupancy_${type}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={lineColor} stopOpacity={0.4}/>
                                    <stop offset="95%" stopColor={lineColor} stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                            
                            <XAxis 
                                dataKey={isDateAxis ? (type === 'weekly' || type === 'monthly' ? 'dateLabel' : 'time') : 'time'}
                                stroke="#9ca3af" 
                                fontSize={10} 
                                axisLine={false} 
                                tickLine={false} 
                                tickMargin={12}
                                minTickGap={isDateAxis ? 0 : 18}
                                interval={isDateAxis ? 0 : 2}
                                tickFormatter={formatDateAxisTick}
                            />
                            
                            <YAxis 
                                domain={[0, speedAxisMax]} 
                                stroke="#9ca3af" 
                                fontSize={10} 
                                axisLine={false} 
                                tickLine={false} 
                                tickFormatter={(val) => `${val} mph`}
                            />
                            
                            <Tooltip 
                                filterNull={true}
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                content={({ active, payload, label }) => {
                                    if (!active || !payload?.length) return null;

                                    const point = payload[0].payload;

                                    return (
                                        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 12px', boxShadow: '0 6px 18px rgba(15, 23, 42, 0.08)' }}>
                                            <div style={{ color: '#374151', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                                                {(type === 'weekly' || type === 'monthly') && point.dateLabel ? point.dateLabel : label}
                                            </div>
                                            {point.hasData === false ? (
                                                <div style={{ color: '#6b7280', fontSize: '12px', fontWeight: 600 }}>No samples recorded</div>
                                            ) : (
                                                <div style={{ color: lineColor, fontSize: '12px', fontWeight: 600 }}>Avg speed: {point.density ?? 0} mph</div>
                                            )}
                                        </div>
                                    );
                                }}
                            />
                            
                            <Area 
                                type="monotone" 
                                dataKey="density" 
                                stroke={lineColor}
                                strokeWidth={2.5} 
                                fillOpacity={1} 
                                fill={`url(#colorOccupancy_${type})`}
                                connectNulls={type !== 'weekly' && type !== 'monthly'}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
};

export default OccupancyChart;
