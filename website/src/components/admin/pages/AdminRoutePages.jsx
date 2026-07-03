import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Activity, ArrowDownUp, Gauge } from 'lucide-react';
import supabase from "../../helper/SupabaseClients";
import AdminBreadcrumb from '../layout/AdminBreadcrumb';
import styles from './FloorDashboard.module.css';
import {
    getAdminAreaPath,
    getAdminCollegePath,
    getAdminFloorPath,
    slugifyAdminPathSegment,
} from '../routing/AdminRouteUtils';
import { fetchSensorDirectory, normalizeInstituteId } from '../data/SensorDirectoryData';
import { fetchTrafficDirectionRows } from '../data/TrafficSummaryData';

const groupSensorsByArea = (sensors = []) =>
    sensors.reduce((areas, sensor) => {
        const areaName = sensor.area_name || 'Unassigned Area';
        if (!areas[areaName]) areas[areaName] = [];
        areas[areaName].push(sensor);
        return areas;
    }, {});

const roundOne = (value) => Math.round((Number(value) || 0) * 10) / 10;

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

    return Object.entries(areas).find(
        ([areaName]) => slugifyAdminPathSegment(areaName) === areaId
    );
};

const getOverviewMetrics = (trafficSummaries = []) => {
    const activeSensors = trafficSummaries.filter((sensor) => sensor.lastSeen);
    const activeCount = activeSensors.length;

    const totalVolume = activeSensors.reduce(
        (sum, sensor) => sum + (sensor.latestVolume || 0),
        0
    );

    const totalApproach = activeSensors.reduce(
        (sum, sensor) => sum + (sensor.approach || 0),
        0
    );

    const totalAway = activeSensors.reduce(
        (sum, sensor) => sum + (sensor.away || 0),
        0
    );

    const averageSpeed = activeCount > 0
        ? activeSensors.reduce((sum, sensor) => sum + (sensor.avgSpeed || 0), 0) / activeCount
        : 0;

    const busiestSensor = activeSensors.reduce((top, sensor) => (
        !top || sensor.latestVolume > top.latestVolume ? sensor : top
    ), null);

    const peakVelocity = activeSensors.reduce((top, sensor) => (
        !top || sensor.v85Speed > top.v85Speed ? sensor : top
    ), null);

    const highestInbound = activeSensors.reduce((top, sensor) => (
        !top || sensor.approach > top.approach ? sensor : top
    ), null);

    return {
        totalVolume,
        totalApproach,
        totalAway,
        averageSpeed,
        activeCount,
        busiestSensor,
        peakVelocity,
        highestInbound,
    };
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

const PlaceSuperlatives = ({ busiestSensor, peakVelocity, highestInbound }) => (
    <section className={styles.insightGrid} aria-label="Place transportation superlatives">
        <div className={styles.insightCard}>
            <Activity size={18} />
            <span>Busiest Corridor</span>
            <strong>{busiestSensor?.corridor_name || busiestSensor?.sensor_id || 'No data'}</strong>
            <p>
                {busiestSensor
                    ? `${busiestSensor.latestVolume} movements in the latest interval.`
                    : 'No movement data yet.'}
            </p>
        </div>

        <div className={styles.insightCard}>
            <Gauge size={18} />
            <span>Fastest Corridor</span>
            <strong>{peakVelocity?.corridor_name || peakVelocity?.sensor_id || 'No data'}</strong>
            <p>
                {peakVelocity
                    ? `${peakVelocity.v85Speed} mph 85th percentile speed.`
                    : 'No speed samples yet.'}
            </p>
        </div>

        <div className={styles.insightCard}>
            <ArrowDownUp size={18} />
            <span>Most Inbound Flow</span>
            <strong>{highestInbound?.corridor_name || highestInbound?.sensor_id || 'No data'}</strong>
            <p>
                {highestInbound
                    ? `${highestInbound.approach} approach movements in the latest interval.`
                    : 'No inbound data yet.'}
            </p>
        </div>
    </section>
);

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
                            <span>traffic volume</span>
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

const TrafficSensorCards = ({ collegeId, sensors, trafficSummaries }) => (
    <div className={styles.trafficCardGrid}>
        {sensors.map((sensor) => {
            const summary =
                trafficSummaries.find((item) => item.sensor_id === sensor.sensor_id) ||
                sensor;

            return (
                <Link
                    key={sensor.sensor_id}
                    to={getAdminFloorPath(collegeId, sensor.sensor_id)}
                    className={styles.trafficSensorCard}
                >
                    <div className={styles.cardTopline}>
                        <span className={styles.roomNameText}>
                            {sensor.corridor_name || sensor.sensor_id}
                        </span>

                        <span className={`${styles.healthPill} ${styles[summary.health?.tone] || ""}`}>
                            {summary.health?.label || 'Unknown'}
                        </span>
                    </div>

                    <div className={styles.cardMetricRow}>
                        <div>
                            <strong>{summary.latestVolume ?? 0}</strong>
                            <span>traffic volume</span>
                        </div>

                        <div>
                            <strong>{summary.avgSpeed ?? 0}</strong>
                            <span>avg mph</span>
                        </div>
                    </div>

                    <div className={styles.directionBar} aria-hidden="true">
                        <span style={{ flex: Math.max(summary.approach || 0, 1) }} />
                        <span style={{ flex: Math.max(summary.away || 0, 1) }} />
                    </div>

                    <div className={styles.cardFooter}>
                        <span>Approach {summary.approach ?? 0}</span>
                        <span>Away {summary.away ?? 0}</span>
                    </div>

                </Link>
            );
        })}
    </div>
);

export const CollegeOverview = () => {
    const { collegeId } = useParams();
    const normalizedCollegeId = normalizeInstituteId(collegeId);
    const [instituteName, setInstituteName] = useState(normalizedCollegeId || '');
    const [sensors, setSensors] = useState([]);
    const [trafficRows, setTrafficRows] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchInstitute = async () => {
            try {
                setLoading(true);

                const { institutes, sensors: sensorData } = await fetchSensorDirectory(
                    supabase,
                    normalizedCollegeId
                );

                const trafficData = await fetchTrafficDirectionRows(supabase, {
                    type: 'daily',
                    limit: 5000,
                });

                const instituteData = institutes[0];

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
    }, [collegeId, normalizedCollegeId]);

    if (loading) {
        return <div className={styles.loading}>Loading institute corridors...</div>;
    }

    const areas = groupSensorsByArea(sensors);
    const areaCount = Object.keys(areas).length;
    const trafficSummaries = getSensorTrafficSummaries(sensors, trafficRows);

    const {
        totalVolume,
        totalApproach,
        totalAway,
        averageSpeed,
        activeCount,
        busiestSensor,
        peakVelocity,
        highestInbound,
    } = getOverviewMetrics(trafficSummaries);

    return (
        <div className={styles.container} style={{ paddingTop: '0px' }}>
            <AdminBreadcrumb items={[{ label: instituteName }]} />

            {areaCount === 0 ? (
                <div className={styles.noData}>
                    No transportation areas found for this institute.
                </div>
            ) : (
                <div className={styles.analyticsStack}>
                    <section className={styles.placeSummaryBox}>
                        <div className={styles.placeSummaryTop}>
                            <div className={styles.placeSummaryCopy}>
                                <span className={styles.eyebrow}>
                                    Transportation Operations
                                </span>

                                <h1>{instituteName}</h1>

                                <p>
                                    Campus-wide transportation summary across {areaCount}{' '}
                                    {areaCount === 1 ? 'area' : 'areas'} and {activeCount}{' '}
                                    active {activeCount === 1 ? 'corridor' : 'corridors'}.
                                </p>
                            </div>

                            <div className={styles.heroMetricGrid}>
                                <div>
                                    <Activity size={18} />
                                    <strong>{totalVolume}</strong>
                                    <span>Total latest movements</span>
                                </div>

                                <div>
                                    <ArrowDownUp size={18} />
                                    <strong>{totalApproach}/{totalAway}</strong>
                                    <span>Inbound / outbound</span>
                                </div>

                                <div>
                                    <Gauge size={18} />
                                    <strong>{roundOne(averageSpeed)} mph</strong>
                                    <span>Average speed</span>
                                </div>
                            </div>
                        </div>

                        <div className={styles.placeSummaryDivider} />

                        <PlaceSuperlatives
                            busiestSensor={busiestSensor}
                            peakVelocity={peakVelocity}
                            highestInbound={highestInbound}
                        />
                    </section>

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

                const trafficData = await fetchTrafficDirectionRows(supabase, {
                    type: 'daily',
                    limit: 5000,
                });

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
    }, [buildingId, normalizedCollegeId]);

    if (loading) {
        return <div className={styles.loading}>Loading area...</div>;
    }

    const trafficSummaries = getSensorTrafficSummaries(areaSensors, trafficRows);

    const {
        totalVolume,
        totalApproach,
        totalAway,
        averageSpeed,
        activeCount,
        busiestSensor,
        peakVelocity,
        highestInbound,
    } = getOverviewMetrics(trafficSummaries);

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
                    <section className={styles.placeSummaryBox}>
                        <div className={styles.placeSummaryTop}>
                            <div className={styles.placeSummaryCopy}>
                                <span className={styles.eyebrow}>
                                    Transportation Area
                                </span>

                                <h1>{areaName}</h1>

                                <p>
                                    {instituteName} movement summary across {activeCount}{' '}
                                    active {activeCount === 1 ? 'corridor' : 'corridors'}.
                                </p>
                            </div>

                            <div className={styles.heroMetricGrid}>
                                <div>
                                    <Activity size={18} />
                                    <strong>{totalVolume}</strong>
                                    <span>Total latest movements</span>
                                </div>

                                <div>
                                    <ArrowDownUp size={18} />
                                    <strong>{totalApproach}/{totalAway}</strong>
                                    <span>Approach / away</span>
                                </div>

                                <div>
                                    <Gauge size={18} />
                                    <strong>{roundOne(averageSpeed)} mph</strong>
                                    <span>Average speed</span>
                                </div>
                            </div>
                        </div>

                        <div className={styles.placeSummaryDivider} />

                        <PlaceSuperlatives
                            busiestSensor={busiestSensor}
                            peakVelocity={peakVelocity}
                            highestInbound={highestInbound}
                        />
                    </section>

                    <section className={styles.corridorSection}>
                        <div className={styles.sectionHeader}>
                            <h2>{areaName} Corridors</h2>
                            <span>
                                {areaSensors.length}{' '}
                                {areaSensors.length === 1 ? 'corridor' : 'corridors'}
                            </span>
                        </div>

                        <TrafficSensorCards
                            collegeId={normalizedCollegeId}
                            sensors={areaSensors}
                            trafficSummaries={trafficSummaries}
                        />
                    </section>
                </div>
            )}
        </div>
    );
};
