import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import OperatingLens from '../controls/OperatingLens';
import { DEFAULT_ANALYTICS_FILTERS } from '../controls/AnalyticsFilterUtils';
import TrafficTrendChart from '../visualizations/TrafficTrendChart';
import SummaryMetrics from '../summaries/SummaryMetrics';

const formatDateTime = (value) => value
    ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'No data yet';

const formatSensorDownTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

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
const TRAFFIC_SUMMARY_GROUPS = [
    {
        label: 'Traffic Pattern',
        metrics: ['peak', 'busiestDay', 'busiestTime', 'total', 'averageSpeed'],
    },
    {
        label: 'Speed And Reliability',
        metrics: ['overThresholdCount', 'lowNoMovementPeriods', 'maxSpeed', 'v85Speed'],
    },
];

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
    const [drilldownHistory, setDrilldownHistory] = useState([]);
    const [drilldownForwardHistory, setDrilldownForwardHistory] = useState([]);
    const filterSignature = useMemo(() => JSON.stringify({
        startDate: filters?.startDate || '',
        endDate: filters?.endDate || '',
        startTime: filters?.startTime || '',
        endTime: filters?.endTime || '',
        dayPreset: filters?.dayPreset || 'all',
    }), [filters]);

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
    }, [filterSignature]);

    const getCorridorExportRows = useCallback(async () => {
        const rows = await fetchTrafficDirectionRows(supabase, {
            sensorId: corridorId,
            filters,
            type: activeTrafficTimeframe,
            limit: 50000,
        });

        return getTrafficExportRows(rows || [], sensor);
    }, [activeTrafficTimeframe, corridorId, filters, sensor]);

    const pushDrilldownHistory = useCallback(() => {
        setDrilldownHistory((history) => [
            ...history,
            {
                filters,
                timeframe: activeTrafficTimeframe,
                view: trendViews[activeTrafficTimeframe] || 'combined',
            },
        ]);
        setDrilldownForwardHistory([]);
    }, [activeTrafficTimeframe, filters, trendViews]);

    const handleChartBack = useCallback(() => {
        const previous = drilldownHistory[drilldownHistory.length - 1];
        if (!previous) return;

        setActiveChartData(null);
        setDrilldownForwardHistory((history) => [
            ...history,
            {
                filters,
                timeframe: activeTrafficTimeframe,
                view: trendViews[activeTrafficTimeframe] || 'combined',
            },
        ]);
        setFilters(previous.filters);
        setActiveTrafficTimeframe(previous.timeframe);
        if (previous.view) {
            setTrendViews((current) => ({
                ...current,
                [previous.timeframe]: previous.view,
            }));
        }
        setDrilldownHistory((history) => history.slice(0, -1));
    }, [activeTrafficTimeframe, drilldownHistory, filters, trendViews]);

    const handleChartForward = useCallback(() => {
        const next = drilldownForwardHistory[drilldownForwardHistory.length - 1];
        if (!next) return;

        setActiveChartData(null);
        setDrilldownHistory((history) => [
            ...history,
            {
                filters,
                timeframe: activeTrafficTimeframe,
                view: trendViews[activeTrafficTimeframe] || 'combined',
            },
        ]);
        setFilters(next.filters);
        setActiveTrafficTimeframe(next.timeframe);
        if (next.view) {
            setTrendViews((current) => ({
                ...current,
                [next.timeframe]: next.view,
            }));
        }
        setDrilldownForwardHistory((history) => history.slice(0, -1));
    }, [activeTrafficTimeframe, drilldownForwardHistory, filters, trendViews]);

    const handleChartTimeframeChange = useCallback((timeframe) => {
        if (activeTrafficTimeframe === timeframe) return;

        setDrilldownHistory((history) => [
            ...history,
            {
                filters,
                timeframe: activeTrafficTimeframe,
                view: trendViews[activeTrafficTimeframe] || 'combined',
            },
        ]);
        setDrilldownForwardHistory([]);
        setActiveChartData(null);
        setActiveTrafficTimeframe(timeframe);
    }, [activeTrafficTimeframe, filters, trendViews]);

    const handleHeatmapDayClick = useCallback((selectedDay) => {
        pushDrilldownHistory();
        setActiveChartData(null);
        setFilters((currentFilters) => ({
            ...currentFilters,
            startDate: selectedDay,
            endDate: selectedDay,
        }));
        setActiveTrafficTimeframe('daily');
    }, [pushDrilldownHistory]);

    const handleHeatmapMonthClick = useCallback((selectedMonth) => {
        const [year, month] = String(selectedMonth || '').split('-').map(Number);
        if (!year || !month) return;

        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0);
        pushDrilldownHistory();
        setActiveChartData(null);
        setFilters((currentFilters) => ({
            ...currentFilters,
            startDate: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
            endDate: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`,
        }));
        setActiveTrafficTimeframe('monthly');
    }, [pushDrilldownHistory]);

    if (loading) return <div className={styles.loading}>Loading corridor...</div>;

    const corridorName = sensor?.corridor_name || formatAdminRouteLabel(corridorId);
    const instituteLabel = instituteName || formatAdminRouteLabel(normalizedCollegeId);
    const areaName = sensor?.area_name || 'Unassigned Area';
    const areaPath = getAdminAreaPath(normalizedCollegeId, slugifyAdminPathSegment(areaName));
    const updateTrendView = (timeframe, view) => {
        setDrilldownForwardHistory([]);
        setTrendViews((current) => ({
            ...current,
            [timeframe]: view,
        }));
    };
    const activeView = trendViews[activeTrafficTimeframe] || 'combined';
    const activeTimeframe = TRAFFIC_TIMEFRAMES.find((timeframe) => timeframe.value === activeTrafficTimeframe) || TRAFFIC_TIMEFRAMES[0];
    const activePreset = TRAFFIC_VIEW_PRESETS.find((preset) => preset.value === activeView) || TRAFFIC_VIEW_PRESETS[0];
    const maxSpeedThreshold = Number(sensor?.max_cap ?? sensor?.max_speed_cap_threshold);
    const summaryThreshold = Number.isFinite(maxSpeedThreshold) ? maxSpeedThreshold : undefined;

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
                                    <i className={`${styles.statusDot} ${sensor.status === status ? styles[status] : ''}`} aria-hidden="true" />
                                    {formatAdminRouteLabel(status)}
                                </span>
                            ))}
                            {sensor.status === 'down' && formatSensorDownTime(sensor.last_seen_at || sensor.updated_at) ? (
                                <em title={formatDateTime(sensor.last_seen_at || sensor.updated_at)}>
                                    Down at {formatSensorDownTime(sensor.last_seen_at || sensor.updated_at)}
                                </em>
                            ) : null}
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
                    <OperatingLens filters={filters} onChange={setFilters} />

                    <SummaryMetrics
                        level="floor"
                        id={sensor.sensor_id}
                        filters={filters}
                        timeframe={activeTrafficTimeframe}
                        sourceChartData={activeChartData}
                        preferSourceChartData
                        metricGroups={TRAFFIC_SUMMARY_GROUPS}
                        thresholdValue={summaryThreshold}
                    />
                </>
            )}

            {sensor && (
                <div className={styles.analyticsStack}>
                    <section className={styles.chartSection}>
                        <div className={styles.trendToolbar}>
                            <div className={styles.trendCopy}>
                                <strong>{activePreset.label}</strong>
                            </div>
                            <div className={styles.chartControls}>
                                <div className={styles.timeframeSegment} aria-label="Traffic chart timeframe">
                                    {TRAFFIC_TIMEFRAMES.map((timeframe) => (
                                        <button
                                            key={timeframe.value}
                                            type="button"
                                            className={`${styles.timeframeButton} ${activeTrafficTimeframe === timeframe.value ? styles.activeTimeframe : ''}`}
                                            onClick={() => handleChartTimeframeChange(timeframe.value)}
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
                            onHeatmapDayClick={handleHeatmapDayClick}
                            onHeatmapMonthClick={handleHeatmapMonthClick}
                            canGoBack={drilldownHistory.length > 0}
                            onBack={handleChartBack}
                            canGoForward={drilldownForwardHistory.length > 0}
                            onForward={handleChartForward}
                        />
                    </section>
                </div>
            )}
        </div>
    );
};

export default FloorDashboard;
