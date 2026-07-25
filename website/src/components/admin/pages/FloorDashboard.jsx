import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import supabase from "../../helper/SupabaseClients";
import AdminBreadcrumb from '../layout/AdminBreadcrumb';
import styles from './FloorDashboard.module.css';
import {
    formatAdminRouteLabel,
    getAdminAreaPath,
    getAdminCollegePath,
    getFloorNumberFromRouteSegment,
    slugifyAdminPathSegment,
} from '../routing/AdminRouteUtils';
import { fetchSensorById, fetchSensorDirectory, normalizeInstituteId } from '../data/SensorDirectoryData';
import { fetchTrafficDirectionRows } from '../data/TrafficSummaryData';
import AnalyticsControlBar from '../controls/AnalyticsControlBar';
import { DEFAULT_ANALYTICS_FILTERS } from '../controls/AnalyticsFilterUtils';
import TrafficTrendChart from '../visualizations/TrafficTrendChart';
import SummaryMetrics from '../summaries/SummaryMetrics';

const roundOne = (value) => Math.round(value * 10) / 10;

const getLatestRows = (rows = []) => {
    if (!rows.length) return [];
    const sorted = rows.slice().sort((a, b) => new Date(a.observed_at) - new Date(b.observed_at));
    const latestTime = sorted.at(-1)?.observed_at;
    return sorted.filter((row) => row.observed_at === latestTime);
};

const summarizeTraffic = (rows = []) => {
    const latestRows = getLatestRows(rows);
    const latestTime = latestRows[0]?.observed_at;
    const volume = latestRows.reduce((sum, row) => sum + (Number(row.volume) || 0), 0);
    const approach = latestRows
        .filter((row) => row.direction === 'approach')
        .reduce((sum, row) => sum + (Number(row.volume) || 0), 0);
    const away = latestRows
        .filter((row) => row.direction === 'away')
        .reduce((sum, row) => sum + (Number(row.volume) || 0), 0);
    const weightedSpeed = latestRows.reduce((sum, row) => {
        const weight = Number(row.volume) || 1;
        return sum + ((Number(row.avg_speed) || 0) * weight);
    }, 0);
    const speedWeight = latestRows.reduce((sum, row) => sum + (Number(row.volume) || 1), 0);
    const avgSpeed = speedWeight ? roundOne(weightedSpeed / speedWeight) : 0;
    const v85Speed = latestRows.length
        ? roundOne(latestRows.reduce((sum, row) => sum + (Number(row.v85_speed) || 0), 0) / latestRows.length)
        : 0;
    const maxSpeed = latestRows.reduce((max, row) => Math.max(max, Number(row.max_speed) || 0), 0);
    const rangeVolume = rows.reduce((sum, row) => sum + (Number(row.volume) || 0), 0);
    const peakRow = rows.reduce((peak, row) => (!peak || (Number(row.volume) || 0) > (Number(peak.volume) || 0) ? row : peak), null);

    return {
        latestTime,
        volume,
        approach,
        away,
        avgSpeed,
        v85Speed,
        maxSpeed,
        rangeVolume,
        peakRow,
    };
};

const formatDateTime = (value) => value
    ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'No data yet';

const getTrafficExportRows = (rows = [], sensor) => rows.map((row) => ({
    scope_type: 'corridor',
    institute: sensor?.institute_id || '',
    area: sensor?.area_name || '',
    corridor: sensor?.corridor_name || '',
    observed_at_utc: row.observed_at || '',
    direction: row.direction || '',
    volume: row.volume ?? '',
    avg_speed_mph: row.avg_speed ?? '',
    v85_speed_mph: row.v85_speed ?? '',
    max_speed_mph: row.max_speed ?? '',
}));

const createCsvFilename = (label) => (
    `${String(label || 'transportation-export')
        .trim()
        .replace(/['’]/g, '')
        .replace(/[_\s]+/g, '-')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/(^-|-$)/g, '') || 'transportation-export'}-traffic.csv`
);

const SENSOR_STATUS_OPTIONS = ['active', 'down', 'offline'];
const TRAFFIC_TIMEFRAMES = [
    { value: 'daily', label: '24 hr' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
];
const TRAFFIC_VIEW_PRESETS = [
    { value: 'combined', label: 'Flow' },
    { value: 'volume', label: 'Speed' },
    { value: 'direction', label: 'Direction' },
];

const getFilterRangeDays = (filters = {}) => {
    if (!filters.startDate && !filters.endDate) return 1;
    const startValue = filters.startDate || filters.endDate;
    const endValue = filters.endDate || filters.startDate;
    const startDate = new Date(`${startValue}T00:00:00`);
    const endDate = new Date(`${endValue}T00:00:00`);
    if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) return 1;
    return Math.max(1, Math.round((endDate - startDate) / (24 * 60 * 60 * 1000)) + 1);
};

const getTimeframeForFilters = (filters = {}) => {
    const rangeDays = getFilterRangeDays(filters);
    if (rangeDays <= 1) return 'daily';
    if (rangeDays <= 14) return 'weekly';
    return 'monthly';
};

const getChartTitleLabel = (preset) => (
    preset?.value === 'combined' ? 'Flow' : preset?.label || 'Flow'
);

const FloorDashboard = () => {
    const { collegeId, floorId } = useParams();
    const normalizedCollegeId = normalizeInstituteId(collegeId);
    const corridorId = getFloorNumberFromRouteSegment(floorId);
    const [instituteName, setInstituteName] = useState('');
    const [sensor, setSensor] = useState(null);
    const [filters, setFilters] = useState(DEFAULT_ANALYTICS_FILTERS);
    const [loading, setLoading] = useState(true);
    const [trendViews, setTrendViews] = useState({
        daily: 'combined',
        weekly: 'combined',
        monthly: 'combined',
    });
    const [activeTrafficTimeframe, setActiveTrafficTimeframe] = useState('daily');
    const [activeChartData, setActiveChartData] = useState(null);

    useEffect(() => {
        let isMounted = true;

        const fetchCorridorContext = async () => {
            try {
                setLoading(true);
                setSensor(null);

                const [data, directory] = await Promise.all([
                    fetchSensorById(supabase, normalizedCollegeId, corridorId),
                    fetchSensorDirectory(supabase, normalizedCollegeId),
                ]);

                if (!isMounted) return;
                setSensor(data || null);
                setInstituteName(directory?.institutes?.[0]?.full_name || formatAdminRouteLabel(normalizedCollegeId));
            } catch (err) {
                if (!isMounted) return;
                console.error('Corridor fetch error:', err);
                setSensor(null);
                setInstituteName(formatAdminRouteLabel(normalizedCollegeId));
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        if (normalizedCollegeId && corridorId) fetchCorridorContext();

        return () => {
            isMounted = false;
        };
    }, [corridorId, normalizedCollegeId]);

    useEffect(() => {
        setActiveChartData(null);
        setActiveTrafficTimeframe(getTimeframeForFilters(filters));
    }, [filters]);

    const getCorridorExportRows = useCallback(async () => {
        const rows = await fetchTrafficDirectionRows(supabase, {
            sensorId: corridorId,
            filters,
            type: activeTrafficTimeframe,
            limit: 50000,
        });

        return getTrafficExportRows(rows || [], sensor);
    }, [activeTrafficTimeframe, corridorId, filters, sensor]);

    if (loading) return <div className={styles.loading}>Loading corridor...</div>;

    const corridorName = sensor?.corridor_name || formatAdminRouteLabel(corridorId);
    const instituteLabel = instituteName || formatAdminRouteLabel(normalizedCollegeId);
    const areaName = sensor?.area_name || 'Unassigned Area';
    const areaPath = getAdminAreaPath(normalizedCollegeId, slugifyAdminPathSegment(areaName));
    const updateTrendView = (timeframe, view) => {
        setTrendViews((current) => ({
            ...current,
            [timeframe]: view,
        }));
    };
    const activeView = trendViews[activeTrafficTimeframe] || 'combined';
    const activeTimeframe = TRAFFIC_TIMEFRAMES.find((timeframe) => timeframe.value === activeTrafficTimeframe) || TRAFFIC_TIMEFRAMES[0];
    const activePreset = TRAFFIC_VIEW_PRESETS.find((preset) => preset.value === activeView) || TRAFFIC_VIEW_PRESETS[0];

    return (
        <div className={styles.container}>
            <AdminBreadcrumb
                items={[
                    {
                        label: instituteLabel,
                        to: getAdminCollegePath(normalizedCollegeId),
                    },
                    {
                        label: areaName,
                        to: areaPath,
                    },
                    { label: corridorName },
                ]}
            />

            {!sensor ? (
                <div className={styles.noData}>Corridor not found.</div>
            ) : (
                <>
                    <section className={styles.corridorHeader}>
                        <div className={styles.sensorStatusLegend} aria-label="Sensor status">
                            <strong>Sensor Status:</strong>
                            {SENSOR_STATUS_OPTIONS.map((status) => (
                                <span key={status} className={sensor.status === status ? styles.currentStatus : ''}>
                                    <i className={`${styles.statusDot} ${styles[status]}`} aria-hidden="true" />
                                    {formatAdminRouteLabel(status)}
                                </span>
                            ))}
                        </div>
                    </section>

                    <AnalyticsControlBar
                        filters={filters}
                        onFilterChange={setFilters}
                        exportLabel={`${corridorName} traffic`}
                        exportFilename={createCsvFilename(corridorName)}
                        exportLoading={loading}
                        getExportRows={getCorridorExportRows}
                    />

                    <SummaryMetrics
                        level="floor"
                        id={sensor.sensor_id}
                        filters={filters}
                        timeframe={activeTrafficTimeframe}
                        sourceChartData={activeChartData}
                        preferSourceChartData
                    />
                </>
            )}

            {sensor && (
                <div className={styles.analyticsStack}>
                    <section className={styles.chartSection}>
                        <div className={styles.trendToolbar}>
                            <div className={styles.trendCopy}>
                                <span>{activeTimeframe.label} chart</span>
                                <strong>{activePreset.label}</strong>
                            </div>
                            <div className={styles.chartControls}>
                                <div className={styles.timeframeSegment} aria-label="Traffic chart timeframe">
                                    {TRAFFIC_TIMEFRAMES.map((timeframe) => (
                                        <button
                                            key={timeframe.value}
                                            type="button"
                                            className={`${styles.timeframeButton} ${activeTrafficTimeframe === timeframe.value ? styles.activeTimeframe : ''}`}
                                            onClick={() => {
                                                setActiveChartData(null);
                                                setActiveTrafficTimeframe(timeframe.value);
                                            }}
                                        >
                                            {timeframe.label}
                                        </button>
                                    ))}
                                </div>
                                <div className={styles.timeframeSegment} aria-label={`${activeTimeframe.label} traffic chart view`}>
                                    {TRAFFIC_VIEW_PRESETS.map((preset) => (
                                        <button
                                            key={preset.value}
                                            type="button"
                                            className={`${styles.timeframeButton} ${activeView === preset.value ? styles.activeTimeframe : ''}`}
                                            onClick={() => updateTrendView(activeTrafficTimeframe, preset.value)}
                                        >
                                            {preset.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <TrafficTrendChart
                            sensorId={sensor.sensor_id}
                            filters={filters}
                            type={activeTrafficTimeframe}
                            mode={activeView}
                            title={`${activeTimeframe.label} ${getChartTitleLabel(activePreset)}`}
                            onSnapshotData={setActiveChartData}
                        />
                    </section>
                </div>
            )}
        </div>
    );
};

export default FloorDashboard;
