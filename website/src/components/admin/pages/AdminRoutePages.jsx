import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import supabase from "../../helper/SupabaseClients";
import AdminBreadcrumb from '../layout/AdminBreadcrumb';
import styles from './FloorDashboard.module.css';
import { getAdminFloorPath } from '../routing/AdminRouteUtils';
import { fetchSensorDirectory, normalizeInstituteId } from '../data/SensorDirectoryData';

const groupSensorsByArea = (sensors = []) =>
    sensors.reduce((areas, sensor) => {
        const areaName = sensor.area_name || 'Unassigned Area';
        if (!areas[areaName]) areas[areaName] = [];
        areas[areaName].push(sensor);
        return areas;
    }, {});

export const CollegeOverview = () => {
    const { collegeId } = useParams();
    const normalizedCollegeId = normalizeInstituteId(collegeId);
    const [instituteName, setInstituteName] = useState(normalizedCollegeId || '');
    const [sensors, setSensors] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchInstitute = async () => {
            try {
                setLoading(true);

                const { institutes, sensors: sensorData } = await fetchSensorDirectory(supabase, normalizedCollegeId);
                const instituteData = institutes[0];
                setInstituteName(instituteData?.full_name || normalizedCollegeId);
                setSensors(sensorData || []);
            } catch (err) {
                console.error("Institute fetch error:", err);
                setSensors([]);
            } finally {
                setLoading(false);
            }
        };

        if (normalizedCollegeId) fetchInstitute();
    }, [collegeId, normalizedCollegeId]);

    if (loading) return <div className={styles.loading}>Loading institute corridors...</div>;

    const areas = groupSensorsByArea(sensors);

    return (
        <div className={styles.container} style={{ paddingTop: '0px' }}>
            <AdminBreadcrumb items={[{ label: instituteName }]} />

            {Object.keys(areas).length === 0 ? (
                <div className={styles.noData}>No corridors found for this institute.</div>
            ) : (
                <div className={styles.analyticsStack}>
                    {Object.entries(areas).map(([areaName, areaSensors]) => (
                        <section key={areaName} className={styles.corridorSection}>
                            <h2 className={styles.sectionTitle}>{areaName}</h2>
                            <div className={styles.roomGrid}>
                                {areaSensors.map((sensor) => (
                                    <Link
                                        key={sensor.sensor_id}
                                        to={getAdminFloorPath(normalizedCollegeId, sensor.sensor_id)}
                                        className={styles.roomCard}
                                    >
                                        <span className={styles.roomNameText}>
                                            {sensor.corridor_name || sensor.sensor_id}
                                        </span>
                                        <span className={`${styles.statusPill} ${styles[sensor.status] || ""}`}>
                                            {sensor.status || 'unknown'}
                                        </span>
                                    </Link>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            )}
        </div>
    );
};
