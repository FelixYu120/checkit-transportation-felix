import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, ArrowDown, ArrowUp, Gauge, Timer, Waves } from 'lucide-react';
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

const FloorDashboard = () => {
    const { collegeId, floorId } = useParams();
    const normalizedCollegeId = normalizeInstituteId(collegeId);
    const corridorId = getFloorNumberFromRouteSegment(floorId);
    const [instituteName, setInstituteName] = useState('');
    const [sensor, setSensor] = useState(null);
    const [trafficRows, setTrafficRows] = useState([]);
    const [filters, setFilters] = useState(DEFAULT_ANALYTICS_FILTERS);
    const [loading, setLoading] = useState(true);

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
    const directionTotal = summary.approach + summary.away;
    const approachShare = directionTotal ? Math.round((summary.approach / directionTotal) * 100) : 0;
    const awayShare = directionTotal ? 100 - approachShare : 0;
    const exportRows = getTrafficExportRows(trafficRows, sensor);

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
                        <div className={styles.snapshotCard}>
                            <Waves size={20} />
                            <span>Latest Volume</span>
                            <strong>{summary.volume}</strong>
                            <p>{summary.rangeVolume} total movements in this range</p>
                        </div>
                        <div className={styles.snapshotCard}>
                            <Gauge size={20} />
                            <span>Average Speed</span>
                            <strong>{summary.avgSpeed} mph</strong>
                            <p>85th percentile {summary.v85Speed} mph</p>
                        </div>
                        <div className={styles.snapshotCard}>
                            <ArrowUp size={20} />
                            <span>Approach</span>
                            <strong>{summary.approach}</strong>
                            <p>{approachShare}% of latest movement</p>
                        </div>
                        <div className={styles.snapshotCard}>
                            <ArrowDown size={20} />
                            <span>Away</span>
                            <strong>{summary.away}</strong>
                            <p>{awayShare}% of latest movement</p>
                        </div>
                    </section>

                    <section className={styles.insightGrid}>
                        <div className={styles.insightCard}>
                            <Timer size={18} />
                            <span>Peak bucket</span>
                            <strong>{summary.peakRow ? formatDateTime(summary.peakRow.observed_at) : 'No data'}</strong>
                            <p>{summary.peakRow ? `${summary.peakRow.volume} movements heading ${summary.peakRow.direction}.` : 'No peak detected for this range.'}</p>
                        </div>
                        <div className={styles.insightCard}>
                            <AlertTriangle size={18} />
                            <span>Safety signal</span>
                            <strong>{summary.maxSpeed} mph max</strong>
                            <p>{summary.maxSpeed >= 25 ? 'Review this speed spike.' : 'No high-speed anomaly in latest bucket.'}</p>
                        </div>
                        <div className={styles.insightCard}>
                            <Gauge size={18} />
                            <span>Location</span>
                            <strong>{sensor.latitude ?? 'Not set'}, {sensor.longitude ?? 'Not set'}</strong>
                            <p>Map panel uses sensor directory coordinates.</p>
                        </div>
                    </section>
                </>
            )}

            {sensor && (
                <div className={styles.analyticsStack}>
                    <section className={styles.chartSection}>
                        <TrafficTrendChart
                            sensorId={sensor.sensor_id}
                            filters={filters}
                            type="daily"
                            title="24h Volume and Speed"
                        />
                    </section>
                    <section className={styles.chartSection}>
                        <TrafficTrendChart
                            sensorId={sensor.sensor_id}
                            filters={filters}
                            type="weekly"
                            title="Weekly Volume and Speed"
                        />
                    </section>
                    <section className={styles.chartSection}>
                        <TrafficTrendChart
                            sensorId={sensor.sensor_id}
                            filters={filters}
                            type="monthly"
                            title="Monthly Volume and Speed"
                        />
                    </section>
                    <section className={styles.chartSection}>
                        <TrafficTrendChart
                            sensorId={sensor.sensor_id}
                            filters={filters}
                            type="daily"
                            mode="direction"
                            title="24h Direction Split"
                        />
                    </section>
                </div>
            )}
        </div>
    );
};

export default FloorDashboard;
