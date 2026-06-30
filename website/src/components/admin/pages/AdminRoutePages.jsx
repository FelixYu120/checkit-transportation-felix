import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowDownUp, Gauge, MapPinned, Timer } from 'lucide-react';
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

const roundOne = (value) => Math.round(value * 10) / 10;

const formatUpdatedAt = (value) => {
    if (!value) return 'No data yet';
    return new Date(value).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
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
        const totalVolume = sensorRows.reduce((sum, row) => sum + (Number(row.volume) || 0), 0);
        const latestVolume = latestRows.reduce((sum, row) => sum + (Number(row.volume) || 0), 0);
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
        const health = getTrafficHealth({ volume: latestVolume, avgSpeed, maxSpeed, lastSeen: latestTime });

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
    return Object.entries(areas).find(([areaName]) => slugifyAdminPathSegment(areaName) === areaId);
};

const getOverviewMetrics = (trafficSummaries = []) => {
    const totalVolume = trafficSummaries.reduce((sum, sensor) => sum + sensor.latestVolume, 0);
    const totalApproach = trafficSummaries.reduce((sum, sensor) => sum + sensor.approach, 0);
    const totalAway = trafficSummaries.reduce((sum, sensor) => sum + sensor.away, 0);
    const activeSensors = trafficSummaries.filter((sensor) => sensor.lastSeen).length;
    const busiestSensor = trafficSummaries.reduce((busiest, sensor) => (
        !busiest || sensor.latestVolume > busiest.latestVolume ? sensor : busiest
    ), null);
    const slowestSensor = trafficSummaries
        .filter((sensor) => sensor.lastSeen)
        .reduce((slowest, sensor) => (!slowest || sensor.avgSpeed < slowest.avgSpeed ? sensor : slowest), null);

    return {
        totalVolume,
        totalApproach,
        totalAway,
        activeSensors,
        busiestSensor,
        slowestSensor,
    };
};

const getLatestObservedAt = (trafficSummaries = []) => (
    trafficSummaries.reduce((latest, sensor) => {
        if (!sensor.lastSeen) return latest;
        const sensorTime = new Date(sensor.lastSeen).getTime();
        const latestTime = latest ? new Date(latest).getTime() : 0;
        return Number.isFinite(sensorTime) && sensorTime > latestTime ? sensor.lastSeen : latest;
    }, null)
);

const TrafficSensorCards = ({ collegeId, sensors, trafficSummaries }) => (
    <div className={styles.trafficCardGrid}>
        {sensors.map((sensor) => {
            const summary = trafficSummaries.find((item) => item.sensor_id === sensor.sensor_id) || sensor;
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
                        <div><strong>{summary.latestVolume ?? 0}</strong><span>volume</span></div>
                        <div><strong>{summary.avgSpeed ?? 0}</strong><span>avg mph</span></div>
                        <div><strong>{summary.v85Speed ?? 0}</strong><span>85th mph</span></div>
                    </div>
                    <div className={styles.directionBar} aria-hidden="true">
                        <span style={{ flex: Math.max(summary.approach || 0, 1) }} />
                        <span style={{ flex: Math.max(summary.away || 0, 1) }} />
                    </div>
                    <div className={styles.cardFooter}>
                        <span>Approach {summary.approach ?? 0}</span>
                        <span>Away {summary.away ?? 0}</span>
                    </div>
                    <span className={styles.updatedText}>{formatUpdatedAt(summary.lastSeen)}</span>
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

                const { institutes, sensors: sensorData } = await fetchSensorDirectory(supabase, normalizedCollegeId);
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

    if (loading) return <div className={styles.loading}>Loading institute corridors...</div>;

    const areas = groupSensorsByArea(sensors);
    const trafficSummaries = getSensorTrafficSummaries(sensors, trafficRows);
    const {
        totalVolume,
        totalApproach,
        totalAway,
        busiestSensor,
        slowestSensor,
    } = getOverviewMetrics(trafficSummaries);
    const latestObservedAt = getLatestObservedAt(trafficSummaries);

    return (
        <div className={styles.container} style={{ paddingTop: '0px' }}>
            <AdminBreadcrumb items={[{ label: instituteName }]} />

            {Object.keys(areas).length === 0 ? (
                <div className={styles.noData}>No corridors found for this institute.</div>
            ) : (
                <div className={styles.analyticsStack}>
                    <section className={styles.overviewHero}>
                        <div>
                            <span className={styles.eyebrow}>Transportation Operations</span>
                            <h1>{instituteName}</h1>
                            <p>Live 10-minute movement summaries across campus sensors.</p>
                        </div>
                        <div className={styles.heroMetricGrid}>
                            <div><Activity size={18} /><strong>{totalVolume}</strong><span>volume</span></div>
                            <div><ArrowDownUp size={18} /><strong>{totalApproach}/{totalAway}</strong><span>approach / away</span></div>
                            <div><Timer size={18} /><strong>{formatUpdatedAt(latestObservedAt)}</strong><span>last updated</span></div>
                        </div>
                    </section>

                    <section className={styles.insightGrid}>
                        <div className={styles.insightCard}>
                            <Gauge size={18} />
                            <span>Busiest sensor</span>
                            <strong>{busiestSensor?.corridor_name || busiestSensor?.sensor_id || 'No data'}</strong>
                            <p>{busiestSensor ? `${busiestSensor.latestVolume} movements in the latest bucket.` : 'No recent movement summaries found.'}</p>
                        </div>
                        <div className={styles.insightCard}>
                            <AlertTriangle size={18} />
                            <span>Slowest flow</span>
                            <strong>{slowestSensor?.corridor_name || slowestSensor?.sensor_id || 'No data'}</strong>
                            <p>{slowestSensor ? `${slowestSensor.avgSpeed} mph average speed.` : 'No speed samples in this range.'}</p>
                        </div>
                        <div className={styles.insightCard}>
                            <MapPinned size={18} />
                            <span>Network coverage</span>
                            <strong>{Object.keys(areas).length} areas</strong>
                            <p>{trafficSummaries.length} transportation sensors in the directory.</p>
                        </div>
                    </section>

                    {Object.entries(areas).map(([areaName, areaSensors]) => (
                        <section key={areaName} className={styles.corridorSection}>
                            <div className={styles.sectionHeader}>
                                <h2>
                                    <Link className={styles.sectionTitleLink} to={getAdminAreaPath(normalizedCollegeId, slugifyAdminPathSegment(areaName))}>
                                        {areaName}
                                    </Link>
                                </h2>
                            </div>
                            <TrafficSensorCards
                                collegeId={normalizedCollegeId}
                                sensors={areaSensors}
                                trafficSummaries={trafficSummaries}
                            />
                        </section>
                    ))}
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
                const { institutes, sensors: sensorData } = await fetchSensorDirectory(supabase, normalizedCollegeId);
                const [matchedAreaName, matchedSensors] = getAreaById(sensorData || [], buildingId) || [];
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

    if (loading) return <div className={styles.loading}>Loading area...</div>;

    const trafficSummaries = getSensorTrafficSummaries(areaSensors, trafficRows);
    const {
        totalVolume,
        totalApproach,
        totalAway,
        busiestSensor,
        slowestSensor,
    } = getOverviewMetrics(trafficSummaries);
    const latestObservedAt = getLatestObservedAt(trafficSummaries);

    return (
        <div className={styles.container} style={{ paddingTop: '0px' }}>
            <AdminBreadcrumb
                items={[
                    { label: instituteName, to: getAdminCollegePath(normalizedCollegeId) },
                    { label: areaName || 'Area not found' },
                ]}
            />

            {!areaName ? (
                <div className={styles.noData}>Area not found.</div>
            ) : (
                <div className={styles.analyticsStack}>
                    <section className={styles.overviewHero}>
                        <div>
                            <span className={styles.eyebrow}>Transportation Area</span>
                            <h1>{areaName}</h1>
                            <p>{instituteName} movement summaries for this area.</p>
                        </div>
                        <div className={styles.heroMetricGrid}>
                            <div><Activity size={18} /><strong>{totalVolume}</strong><span>volume</span></div>
                            <div><ArrowDownUp size={18} /><strong>{totalApproach}/{totalAway}</strong><span>approach / away</span></div>
                            <div><Timer size={18} /><strong>{formatUpdatedAt(latestObservedAt)}</strong><span>last updated</span></div>
                        </div>
                    </section>

                    <section className={styles.insightGrid}>
                        <div className={styles.insightCard}>
                            <Gauge size={18} />
                            <span>Busiest sensor</span>
                            <strong>{busiestSensor?.corridor_name || busiestSensor?.sensor_id || 'No data'}</strong>
                            <p>{busiestSensor ? `${busiestSensor.latestVolume} movements in the latest bucket.` : 'No recent movement summaries found.'}</p>
                        </div>
                        <div className={styles.insightCard}>
                            <AlertTriangle size={18} />
                            <span>Slowest flow</span>
                            <strong>{slowestSensor?.corridor_name || slowestSensor?.sensor_id || 'No data'}</strong>
                            <p>{slowestSensor ? `${slowestSensor.avgSpeed} mph average speed.` : 'No speed samples in this range.'}</p>
                        </div>
                        <div className={styles.insightCard}>
                            <MapPinned size={18} />
                            <span>Area coverage</span>
                            <strong>{areaSensors.length} sensors</strong>
                            <p>From the {instituteName} transportation directory.</p>
                        </div>
                    </section>

                    <section className={styles.corridorSection}>
                        <div className={styles.sectionHeader}>
                            <h2>{areaName} Corridors</h2>
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
