import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, ArrowDown, ArrowUp, Clock, Gauge, Timer, Waves } from 'lucide-react';
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
import AnalyticsFilters from '../controls/AnalyticsFilters';
import { DEFAULT_ANALYTICS_FILTERS } from '../controls/AnalyticsFilterUtils';
import ExportCsvButton from '../controls/ExportCsvButton';
import TrafficTrendChart from '../visualizations/TrafficTrendChart';

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
    sensor_id: row.sensor_id || sensor?.sensor_id || '',
    corridor: sensor?.corridor_name || '',
    area: sensor?.area_name || '',
    observed_at: row.observed_at || '',
    direction: row.direction || '',
    volume: row.volume ?? '',
    avg_speed_mph: row.avg_speed ?? '',
    v85_speed_mph: row.v85_speed ?? '',
    max_speed_mph: row.max_speed ?? '',
}));

const SENSOR_STATUS_OPTIONS = ['active', 'down', 'offline'];
const TRAFFIC_TIMEFRAMES = [
    { value: 'daily', label: '24 hr' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
];
const TRAFFIC_VIEW_PRESETS = [
    { value: 'combined', label: 'Traffic' },
    { value: 'volume', label: 'Volume + Speed' },
    { value: 'direction', label: 'Directions' },
];

const getChartTitleLabel = (preset) => (
    preset?.value === 'combined' ? 'Overview' : preset?.label || 'Overview'
);

const FloorDashboard = () => {
    const { collegeId, floorId } = useParams();
    const normalizedCollegeId = normalizeInstituteId(collegeId);
    const corridorId = getFloorNumberFromRouteSegment(floorId);
    const [instituteName, setInstituteName] = useState('');
    const [sensor, setSensor] = useState(null);
    const [trafficRows, setTrafficRows] = useState([]);
    const [filters, setFilters] = useState(DEFAULT_ANALYTICS_FILTERS);
    const [loading, setLoading] = useState(true);
    const [trendViews, setTrendViews] = useState({
        daily: 'combined',
        weekly: 'combined',
        monthly: 'combined',
    });
    const [activeInsight, setActiveInsight] = useState(null);

    useEffect(() => {
        const fetchSensor = async () => {
            try {
                setLoading(true);
                const [data, rows, directory] = await Promise.all([
                    fetchSensorById(supabase, normalizedCollegeId, corridorId),
                    fetchTrafficDirectionRows(supabase, {
                        sensorId: corridorId,
                        filters,
                        type: 'daily',
                        limit: 5000,
                    }),
                    fetchSensorDirectory(supabase, normalizedCollegeId),
                ]);
                setSensor(data || null);
                setTrafficRows(rows || []);
                setInstituteName(directory?.institutes?.[0]?.full_name || formatAdminRouteLabel(normalizedCollegeId));
            } catch (err) {
                console.error('Corridor fetch error:', err);
                setSensor(null);
                setTrafficRows([]);
                setInstituteName(formatAdminRouteLabel(normalizedCollegeId));
            } finally {
                setLoading(false);
            }
        };

        if (normalizedCollegeId && corridorId) fetchSensor();
    }, [corridorId, normalizedCollegeId, filters]);

    if (loading) return <div className={styles.loading}>Loading corridor...</div>;

    const corridorName = sensor?.corridor_name || formatAdminRouteLabel(corridorId);
    const instituteLabel = instituteName || formatAdminRouteLabel(normalizedCollegeId);
    const areaName = sensor?.area_name || 'Unassigned Area';
    const areaPath = getAdminAreaPath(normalizedCollegeId, slugifyAdminPathSegment(areaName));
    const summary = summarizeTraffic(trafficRows);
    const exportRows = getTrafficExportRows(trafficRows, sensor);
    const summaryCards = [
        {
            key: 'volume',
            icon: <Waves size={20} />,
            label: 'Volume',
            value: summary.volume,
            description: 'Traffic movements recorded at this corridor for the latest reading.',
        },
        {
            key: 'average-speed',
            icon: <Gauge size={20} />,
            label: 'Average Speed',
            value: `${summary.avgSpeed} mph`,
            description: 'Average vehicle speed recorded at this corridor for the selected range.',
        },
        {
            key: 'approach',
            icon: <ArrowUp size={20} />,
            label: 'Approach',
            value: summary.approach,
            description: 'Traffic movements traveling toward the monitored approach direction.',
        },
        {
            key: 'away',
            icon: <ArrowDown size={20} />,
            label: 'Away',
            value: summary.away,
            description: 'Traffic movements traveling away from the monitored approach direction.',
        },
    ];
    const insightCards = [
        {
            key: 'peak',
            icon: <Timer size={18} />,
            label: 'Peak bucket',
            value: summary.peakRow ? formatDateTime(summary.peakRow.observed_at) : 'No data',
            description: 'Time period with the highest traffic volume for the selected range.',
        },
        {
            key: 'safety',
            icon: <AlertTriangle size={18} />,
            label: 'Safety signal',
            value: `${summary.maxSpeed} mph max`,
            description: 'Maximum vehicle speed recorded for the selected range.',
        },
        {
            key: 'updated',
            icon: <Clock size={18} />,
            label: 'Last updated',
            value: formatDateTime(summary.latestTime),
            description: "Most recent timestamp available for this corridor's traffic data.",
        },
    ];
    const updateTrendView = (timeframe, view) => {
        setTrendViews((current) => ({
            ...current,
            [timeframe]: view,
        }));
    };

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

                    <section className={styles.topControls} aria-label="Traffic controls">
                        <div className={styles.exportControl}>
                            <ExportCsvButton
                                exportLabel={`${corridorName} traffic`}
                                filename={`${corridorId}-traffic.csv`}
                                rows={exportRows}
                            />
                        </div>
                        <AnalyticsFilters filters={filters} onChange={setFilters} />
                    </section>

                    <section className={styles.snapshotGrid}>
                        {summaryCards.map((card) => (
                            <button
                                key={card.key}
                                type="button"
                                className={styles.snapshotCard}
                                onClick={() => setActiveInsight(card)}
                                aria-label={`${card.label} details`}
                            >
                                {card.icon}
                                <span>{card.label}</span>
                                <strong>{card.value}</strong>
                            </button>
                        ))}
                    </section>

                    <section className={styles.insightGrid}>
                        {insightCards.map((card) => (
                            <button
                                key={card.key}
                                type="button"
                                className={styles.insightCard}
                                onClick={() => setActiveInsight(card)}
                                aria-label={`${card.label} details`}
                            >
                                {card.icon}
                                <span>{card.label}</span>
                                <strong>{card.value}</strong>
                            </button>
                        ))}
                    </section>
                </>
            )}

            {activeInsight && (
                <div
                    className={styles.insightModalOverlay}
                    role="presentation"
                    onMouseDown={() => setActiveInsight(null)}
                >
                    <div
                        className={styles.insightModal}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="corridor-insight-title"
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <h2 id="corridor-insight-title">{activeInsight.label}</h2>
                        <p>{activeInsight.description}</p>
                        <strong>Value: {activeInsight.value}</strong>
                        <button
                            type="button"
                            className={styles.insightModalClose}
                            onClick={() => setActiveInsight(null)}
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}

            {sensor && (
                <div className={styles.analyticsStack}>
                    {TRAFFIC_TIMEFRAMES.map((timeframe) => {
                        const activeView = trendViews[timeframe.value] || 'combined';
                        const activePreset = TRAFFIC_VIEW_PRESETS.find((preset) => preset.value === activeView);

                        return (
                            <section className={styles.chartSection} key={timeframe.value}>
                                <div className={styles.trendToolbar}>
                                    <div className={styles.trendCopy}>
                                        <span>{timeframe.label} chart</span>
                                        <strong>{activePreset?.label || 'Traffic'}</strong>
                                    </div>
                                    <div className={styles.timeframeSegment} aria-label={`${timeframe.label} traffic chart view`}>
                                        {TRAFFIC_VIEW_PRESETS.map((preset) => (
                                            <button
                                                key={preset.value}
                                                type="button"
                                                className={`${styles.timeframeButton} ${activeView === preset.value ? styles.activeTimeframe : ''}`}
                                                onClick={() => updateTrendView(timeframe.value, preset.value)}
                                            >
                                                {preset.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <TrafficTrendChart
                                    sensorId={sensor.sensor_id}
                                    filters={filters}
                                    type={timeframe.value}
                                    mode={activeView}
                                    title={`${timeframe.label} ${getChartTitleLabel(activePreset)}`}
                                />
                            </section>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default FloorDashboard;
