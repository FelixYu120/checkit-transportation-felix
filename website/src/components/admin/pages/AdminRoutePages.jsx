import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import supabase from "../../helper/SupabaseClients";
import AdminBreadcrumb from '../layout/AdminBreadcrumb';
import styles from './FloorDashboard.module.css';
import {
    getAdminAreaPath,
    getAdminCollegePath,
    getAdminFloorPath,
    normalizeAdminPathSegment,
    slugifyAdminPathSegment,
} from '../routing/AdminRouteUtils';
import { fetchSensorDirectory, normalizeInstituteId } from '../data/SensorDirectoryData';
import { fetchTrafficDirectionRows } from '../data/TrafficSummaryData';
import AnalyticsControlBar from '../controls/AnalyticsControlBar';
import OperatingLens from '../controls/OperatingLens';
import { DEFAULT_ANALYTICS_FILTERS } from '../controls/AnalyticsFilterUtils';

const groupSensorsByArea = (sensors = []) =>
    sensors.reduce((areas, sensor) => {
        const areaName = sensor.area_name || 'Unassigned Area';
        if (!areas[areaName]) areas[areaName] = [];
        areas[areaName].push(sensor);
        return areas;
    }, {});

const roundOne = (value) => Math.round((Number(value) || 0) * 10) / 10;

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

const getTrafficExportRows = (rows = [], sensors = [], scopeType, fallbackInstitute = '') => {
    const sensorsById = new Map(sensors.map((sensor) => [sensor.sensor_id, sensor]));

    return rows
        .slice()
        .sort((a, b) => new Date(a.observed_at) - new Date(b.observed_at))
        .map((row) => {
            const sensor = sensorsById.get(row.sensor_id) || {};
            if (sensorsById.size > 0 && row.sensor_id && !sensor.sensor_id) return null;

            return {
                scope_type: scopeType,
                institute: sensor.institute_id || fallbackInstitute || '',
                area: sensor.area_name || '',
                corridor: sensor.corridor_name || '',
                observed_at_utc: row.observed_at || '',
                direction: row.direction || '',
                volume: row.volume ?? '',
                avg_speed_mph: row.avg_speed ?? '',
                v85_speed_mph: row.v85_speed ?? '',
                max_speed_mph: row.max_speed ?? '',
            };
        })
        .filter(Boolean);
};

const getTrafficHealth = ({ volume = 0, avgSpeed = 0, maxSpeed = 0, lastSeen }) => {
    if (!lastSeen) return { label: 'No data', tone: 'unknown' };
    if (maxSpeed >= 25) return { label: 'Speed anomaly', tone: 'warning' };
    if (volume >= 80 && avgSpeed <= 5) return { label: 'Congested', tone: 'danger' };
    if (volume >= 40 || avgSpeed <= 6) return { label: 'Moderate', tone: 'moderate' };
    return { label: 'Clear', tone: 'clear' };
};

const getSensorTrafficSummaries = (sensors = [], rows = []) => {
    const bySensor = rows.reduce((groups, row) => {
        if (!groups[row.sensor_id]) groups[row.sensor_id] = [];
        groups[row.sensor_id].push(row);
        return groups;
    }, {});

    return sensors.map((sensor) => {
        const sensorRows = (bySensor[sensor.sensor_id] || [])
            .slice()
            .sort((a, b) => new Date(a.observed_at) - new Date(b.observed_at));

        const latestTime = sensorRows.at(-1)?.observed_at;

        const latestRows = latestTime
            ? sensorRows.filter((row) => row.observed_at === latestTime)
            : [];

        const totalVolume = sensorRows.reduce(
            (sum, row) => sum + (Number(row.volume) || 0),
            0
        );

        const latestVolume = latestRows.reduce(
            (sum, row) => sum + (Number(row.volume) || 0),
            0
        );

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

        const speedWeight = latestRows.reduce(
            (sum, row) => sum + (Number(row.volume) || 1),
            0
        );

        const avgSpeed = speedWeight ? roundOne(weightedSpeed / speedWeight) : 0;

        const v85Speed = latestRows.length
            ? roundOne(
                latestRows.reduce(
                    (sum, row) => sum + (Number(row.v85_speed) || 0),
                    0
                ) / latestRows.length
            )
            : 0;

        const maxSpeed = latestRows.reduce(
            (max, row) => Math.max(max, Number(row.max_speed) || 0),
            0
        );

        const health = getTrafficHealth({
            volume: latestVolume,
            avgSpeed,
            maxSpeed,
            lastSeen: latestTime,
        });

        return {
            ...sensor,
            latestVolume,
            totalVolume,
            approach,
            away,
            avgSpeed,
            v85Speed,
            maxSpeed,
            lastSeen: latestTime,
            health,
        };
    });
};

const getAreaById = (sensors = [], areaId) => {
    const areas = groupSensorsByArea(sensors);
    const normalizedAreaId = normalizeAdminPathSegment(areaId);

    return Object.entries(areas).find(
        ([areaName]) => slugifyAdminPathSegment(areaName) === normalizedAreaId
    );
};

const getAreaTrafficSummary = (areaSensors = [], trafficSummaries = []) => {
    const areaSensorIds = new Set(areaSensors.map((sensor) => sensor.sensor_id));

    const areaSummaries = trafficSummaries.filter((summary) =>
        areaSensorIds.has(summary.sensor_id)
    );

    const activeSummaries = areaSummaries.filter((summary) => summary.lastSeen);

    const totalVolume = activeSummaries.reduce(
        (sum, summary) => sum + (summary.latestVolume || 0),
        0
    );

    const totalApproach = activeSummaries.reduce(
        (sum, summary) => sum + (summary.approach || 0),
        0
    );

    const totalAway = activeSummaries.reduce(
        (sum, summary) => sum + (summary.away || 0),
        0
    );

    const averageSpeed = activeSummaries.length
        ? roundOne(
            activeSummaries.reduce(
                (sum, summary) => sum + (summary.avgSpeed || 0),
                0
            ) / activeSummaries.length
        )
        : 0;

    return {
        activeCount: activeSummaries.length,
        totalCount: areaSensors.length,
        totalVolume,
        totalApproach,
        totalAway,
        averageSpeed,
    };
};

const AreaCards = ({ collegeId, areas, trafficSummaries }) => (
    <div className={styles.areaCardGrid}>
        {Object.entries(areas).map(([areaName, areaSensors]) => {
            const summary = getAreaTrafficSummary(areaSensors, trafficSummaries);
            const areaPath = getAdminAreaPath(
                collegeId,
                slugifyAdminPathSegment(areaName)
            );

            return (
                <Link key={areaName} to={areaPath} className={styles.areaCard}>
                    <div className={styles.areaCardTopline}>
                        <span className={styles.areaCardTitle}>{areaName}</span>

                        <span className={styles.healthPill}>
                            {summary.activeCount}/{summary.totalCount} active
                        </span>
                    </div>

                    <div className={styles.areaCardMetricRow}>
                        <div>
                            <strong>{summary.totalVolume}</strong>
                            <span>flow</span>
                        </div>

                        <div>
                            <strong>{summary.averageSpeed}</strong>
                            <span>avg mph</span>
                        </div>
                    </div>

                </Link>
            );
        })}
    </div>
);

const TRAFFIC_COMPARISON_METRICS = [
    { key: 'totalVolume', label: 'Flow', format: (sensor) => sensor.totalVolume || 0 },
    { key: 'avgSpeed', label: 'Avg Speed', format: (sensor) => `${sensor.avgSpeed || 0} mph` },
    { key: 'maxSpeed', label: 'Max Speed', format: (sensor) => `${sensor.maxSpeed || 0} mph` },
    { key: 'approach', label: 'Approach', format: (sensor) => sensor.approach || 0 },
    { key: 'away', label: 'Away', format: (sensor) => sensor.away || 0 },
];

const COMPARISON_PAGE_SIZE = 25;

const TrafficComparisonPanel = ({ summaries, loading, collegeId }) => {
    const [selectedMetric, setSelectedMetric] = useState('totalVolume');
    const [sortDirection, setSortDirection] = useState('desc');
    const [page, setPage] = useState(1);
    const metric = TRAFFIC_COMPARISON_METRICS.find((item) => item.key === selectedMetric) || TRAFFIC_COMPARISON_METRICS[0];
    const comparisonRows = useMemo(() => (
        [...summaries].sort((left, right) => {
            const order = (Number(left[selectedMetric]) || 0) - (Number(right[selectedMetric]) || 0);
            return sortDirection === 'asc' ? order : -order;
        })
    ), [selectedMetric, sortDirection, summaries]);
    const totalPages = Math.max(1, Math.ceil(comparisonRows.length / COMPARISON_PAGE_SIZE));
    const activePage = Math.min(page, totalPages);
    const visibleComparisonRows = useMemo(() => {
        const start = (activePage - 1) * COMPARISON_PAGE_SIZE;
        return comparisonRows.slice(start, start + COMPARISON_PAGE_SIZE);
    }, [activePage, comparisonRows]);
    const maxValue = Math.max(1, ...visibleComparisonRows.map((sensor) => Number(sensor[selectedMetric]) || 0));

    return (
        <section className={styles.comparisonPanel}>
            <div className={styles.comparisonHeader}>
                <div>
                    <h2>Corridor Comparison</h2>
                </div>
                <div className={styles.comparisonSortControls}>
                    <label className={styles.sortSelectLabel}>
                        <span>Sort</span>
                        <select
                            value={selectedMetric}
                            onChange={(event) => {
                                setPage(1);
                                setSelectedMetric(event.target.value);
                            }}
                            aria-label="Sort corridor comparison by"
                        >
                            {TRAFFIC_COMPARISON_METRICS.map((item) => (
                                <option key={item.key} value={item.key}>{item.label}</option>
                            ))}
                        </select>
                    </label>
                    <div className={styles.sortDirectionGroup} aria-label="Sort direction">
                        {[
                            ['asc', 'Ascending'],
                            ['desc', 'Descending'],
                        ].map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                className={`${styles.sortDirectionButton} ${sortDirection === value ? styles.activeSortDirection : ''}`}
                                onClick={() => {
                                    setPage(1);
                                    setSortDirection(value);
                                }}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {loading && comparisonRows.length === 0 && (
                <div className={styles.comparisonLoading} role="status">
                    <span className={styles.loadingSpinner} aria-hidden="true" />
                    Loading comparison...
                </div>
            )}

            <div className={styles.comparisonRows}>
                {visibleComparisonRows.map((sensor) => {
                    const metricValue = Number(sensor[selectedMetric]) || 0;
                    const width = `${Math.max(4, Math.round((metricValue / maxValue) * 100))}%`;

                    return (
                        <div key={sensor.sensor_id} className={styles.comparisonRow}>
                            <div className={styles.comparisonLabel}>
                                <Link
                                    className={styles.comparisonLink}
                                    to={getAdminFloorPath(collegeId, sensor.sensor_id)}
                                >
                                    {sensor.corridor_name || sensor.sensor_id}
                                </Link>
                                <span>{sensor.area_name || sensor.institute_id || ''}</span>
                            </div>

                            <div className={styles.comparisonTrack} aria-hidden="true">
                                <span style={{ width }} />
                            </div>

                            <div className={styles.comparisonMetrics}>
                                <strong>{metric.format(sensor)}</strong>
                                <span>{sensor.avgSpeed || 0} mph avg · peak {sensor.maxSpeed || 0} mph</span>
                            </div>
                        </div>
                    );
                })}

                {comparisonRows.length === 0 && (
                    <p className={styles.noData}>No corridor data found for this filter range.</p>
                )}
            </div>
            {comparisonRows.length > 0 ? (
                <div className={styles.comparisonPagination} aria-label="Corridor comparison pages">
                    <span>
                        Page {activePage} of {totalPages}
                    </span>
                    {totalPages > 1 ? (
                        <div className={styles.paginationButtons}>
                            <button
                                type="button"
                                onClick={() => setPage((current) => Math.max(1, current - 1))}
                                disabled={activePage <= 1}
                            >
                                Previous
                            </button>
                            <button
                                type="button"
                                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                                disabled={activePage >= totalPages}
                            >
                                Next
                            </button>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
};

export const CollegeOverview = () => {
    const { collegeId } = useParams();
    const normalizedCollegeId = normalizeInstituteId(collegeId);
    const [instituteName, setInstituteName] = useState(normalizedCollegeId || '');
    const [sensors, setSensors] = useState([]);
    const [trafficRows, setTrafficRows] = useState([]);
    const [filters, setFilters] = useState(DEFAULT_ANALYTICS_FILTERS);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchInstitute = async () => {
            try {
                setLoading(true);

                const { institutes, sensors: sensorData } = await fetchSensorDirectory(
                    supabase,
                    normalizedCollegeId
                );

                const instituteData = institutes[0];
                const sensorIds = (sensorData || []).map((sensor) => sensor.sensor_id).filter(Boolean);
                const trafficData = sensorIds.length
                    ? await fetchTrafficDirectionRows(supabase, {
                        sensorIds,
                        filters,
                        type: 'daily',
                        limit: 50000,
                    })
                    : [];

                setInstituteName(instituteData?.full_name || normalizedCollegeId);
                setSensors(sensorData || []);
                setTrafficRows(trafficData || []);
            } catch (err) {
                console.error("Institute fetch error:", err);
                setSensors([]);
                setTrafficRows([]);
            } finally {
                setLoading(false);
            }
        };

        if (normalizedCollegeId) fetchInstitute();
    }, [collegeId, filters, normalizedCollegeId]);

    if (loading && sensors.length === 0) {
        return <div className={styles.loading}>Loading institute corridors...</div>;
    }

    const areas = groupSensorsByArea(sensors);
    const areaCount = Object.keys(areas).length;
    const trafficSummaries = getSensorTrafficSummaries(sensors, trafficRows);
    const exportRows = getTrafficExportRows(trafficRows, sensors, 'institute', normalizedCollegeId);

    return (
        <div className={styles.container} style={{ paddingTop: '0px' }}>
            <AdminBreadcrumb items={[{ label: instituteName }]} />

            {areaCount === 0 ? (
                <div className={styles.noData}>
                    No transportation areas found for this institute.
                </div>
            ) : (
                <div className={styles.analyticsStack}>
                    <AnalyticsControlBar
                        filters={filters}
                        onFilterChange={setFilters}
                        exportLabel={`${instituteName} traffic`}
                        exportFilename={createCsvFilename(instituteName)}
                        exportRows={exportRows}
                        exportLoading={loading}
                    />
                    <OperatingLens filters={filters} onChange={setFilters} />

                    <TrafficComparisonPanel
                        summaries={trafficSummaries}
                        loading={loading}
                        collegeId={normalizedCollegeId}
                    />

                    <section className={styles.corridorSection}>
                        <div className={styles.sectionHeader}>
                            <h2>Transportation Areas</h2>
                            <span>
                                {areaCount} {areaCount === 1 ? 'area' : 'areas'}
                            </span>
                        </div>

                        <AreaCards
                            collegeId={normalizedCollegeId}
                            areas={areas}
                            trafficSummaries={trafficSummaries}
                        />
                    </section>

                </div>
            )}
        </div>
    );
};

export const AreaOverview = () => {
    const { collegeId, buildingId } = useParams();
    const normalizedCollegeId = normalizeInstituteId(collegeId);
    const [instituteName, setInstituteName] = useState(normalizedCollegeId || '');
    const [areaName, setAreaName] = useState('');
    const [areaSensors, setAreaSensors] = useState([]);
    const [trafficRows, setTrafficRows] = useState([]);
    const [filters, setFilters] = useState(DEFAULT_ANALYTICS_FILTERS);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchArea = async () => {
            try {
                setLoading(true);

                const { institutes, sensors: sensorData } = await fetchSensorDirectory(
                    supabase,
                    normalizedCollegeId
                );

                const [matchedAreaName, matchedSensors] =
                    getAreaById(sensorData || [], buildingId) || [];

                const sensorIds = (matchedSensors || []).map((sensor) => sensor.sensor_id).filter(Boolean);
                const trafficData = sensorIds.length
                    ? await fetchTrafficDirectionRows(supabase, {
                        sensorIds,
                        filters,
                        type: 'daily',
                        limit: 50000,
                    })
                    : [];

                setInstituteName(institutes?.[0]?.full_name || normalizedCollegeId);
                setAreaName(matchedAreaName || '');
                setAreaSensors(matchedSensors || []);
                setTrafficRows(trafficData || []);
            } catch (err) {
                console.error("Area fetch error:", err);
                setAreaName('');
                setAreaSensors([]);
                setTrafficRows([]);
            } finally {
                setLoading(false);
            }
        };

        if (normalizedCollegeId && buildingId) fetchArea();
    }, [buildingId, filters, normalizedCollegeId]);

    if (loading && areaSensors.length === 0) {
        return <div className={styles.loading}>Loading area...</div>;
    }

    const trafficSummaries = getSensorTrafficSummaries(areaSensors, trafficRows);
    const exportRows = getTrafficExportRows(trafficRows, areaSensors, 'area', normalizedCollegeId);

    return (
        <div className={styles.container} style={{ paddingTop: '0px' }}>
            <AdminBreadcrumb
                items={[
                    {
                        label: instituteName,
                        to: getAdminCollegePath(normalizedCollegeId),
                    },
                    {
                        label: areaName || 'Area not found',
                    },
                ]}
            />

            {!areaName ? (
                <div className={styles.noData}>Area not found.</div>
            ) : (
                <div className={styles.analyticsStack}>
                    <AnalyticsControlBar
                        filters={filters}
                        onFilterChange={setFilters}
                        exportLabel={`${areaName} traffic`}
                        exportFilename={createCsvFilename(areaName)}
                        exportRows={exportRows}
                        exportLoading={loading}
                    />
                    <OperatingLens filters={filters} onChange={setFilters} />

                    <TrafficComparisonPanel
                        summaries={trafficSummaries}
                        loading={loading}
                        collegeId={normalizedCollegeId}
                    />
                </div>
            )}
        </div>
    );
};
