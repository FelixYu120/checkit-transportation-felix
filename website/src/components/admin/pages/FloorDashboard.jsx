import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import supabase from "../../helper/SupabaseClients";
import AdminBreadcrumb from '../layout/AdminBreadcrumb';
import styles from './FloorDashboard.module.css';
import {
    formatAdminRouteLabel,
    getAdminCollegePath,
    getFloorNumberFromRouteSegment,
} from '../routing/AdminRouteUtils';
import { fetchSensorById, normalizeInstituteId } from '../data/SensorDirectoryData';

const FloorDashboard = () => {
    const { collegeId, floorId } = useParams();
    const normalizedCollegeId = normalizeInstituteId(collegeId);
    const corridorId = getFloorNumberFromRouteSegment(floorId);
    const [sensor, setSensor] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchSensor = async () => {
            try {
                setLoading(true);
                const data = await fetchSensorById(supabase, normalizedCollegeId, corridorId);
                setSensor(data || null);
            } catch (err) {
                console.error('Corridor fetch error:', err);
                setSensor(null);
            } finally {
                setLoading(false);
            }
        };

        if (normalizedCollegeId && corridorId) fetchSensor();
    }, [corridorId, normalizedCollegeId]);

    if (loading) return <div className={styles.loading}>Loading corridor...</div>;

    const corridorName = sensor?.corridor_name || formatAdminRouteLabel(corridorId);
    const instituteLabel = formatAdminRouteLabel(normalizedCollegeId);

    return (
        <div className={styles.container}>
            <AdminBreadcrumb
                items={[
                    {
                        label: instituteLabel,
                        to: getAdminCollegePath(normalizedCollegeId),
                    },
                    { label: corridorName },
                ]}
            />

            {!sensor ? (
                <div className={styles.noData}>Corridor not found.</div>
            ) : (
                <div className={styles.sensorPanel}>
                    <div>
                        <span className={styles.metaLabel}>Area</span>
                        <strong>{sensor.area_name || 'Unassigned Area'}</strong>
                    </div>
                    <div>
                        <span className={styles.metaLabel}>Corridor</span>
                        <strong>{corridorName}</strong>
                    </div>
                    <div>
                        <span className={styles.metaLabel}>Sensor ID</span>
                        <strong>{sensor.sensor_id}</strong>
                    </div>
                    <div>
                        <span className={styles.metaLabel}>Status</span>
                        <strong className={`${styles.statusPill} ${styles[sensor.status] || ""}`}>
                            {sensor.status || 'unknown'}
                        </strong>
                    </div>
                    <div>
                        <span className={styles.metaLabel}>Latitude</span>
                        <strong>{sensor.latitude ?? 'Not set'}</strong>
                    </div>
                    <div>
                        <span className={styles.metaLabel}>Longitude</span>
                        <strong>{sensor.longitude ?? 'Not set'}</strong>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FloorDashboard;
