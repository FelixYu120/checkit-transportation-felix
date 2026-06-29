import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import supabase from "../../helper/SupabaseClients";
import AdminBreadcrumb from '../layout/AdminBreadcrumb';
import AggregateChart from '../visualizations/AggregateChart';
import AnalyticsControlBar from '../controls/AnalyticsControlBar';
import { DEFAULT_ANALYTICS_FILTERS } from '../controls/AnalyticsFilterUtils';
import SummaryMetrics from '../summaries/SummaryMetrics';
import styles from './FloorDashboard.module.css';
import { formatAdminRouteLabel, getAdminCollegePath } from '../routing/AdminRouteUtils';

export const CollegeOverview = () => {
    const { collegeId } = useParams(); 
    const [realAreaId, setRealAreaId] = useState(null);
    const [instituteName, setInstituteName] = useState(""); 
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState(DEFAULT_ANALYTICS_FILTERS);

    useEffect(() => {
        const fetchArea = async () => {
            try {
                setLoading(true);
                let aId = collegeId;
                let aName = formatAdminRouteLabel(collegeId); // Fallback

                // Check if the URL is a UUID or a slug
                const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(collegeId);
                
                if (!isUUID) {
                    const searchName = `%${collegeId.split('_').join('%')}%`;
                    const { data, error } = await supabase
                        .from('areas')
                        .select('id, name')
                        .or(`slug.eq.${collegeId},name.ilike.${searchName}`)
                        .limit(1);

                    if (data && data.length > 0) {
                        aId = data[0].id;
                        aName = data[0].name; // Get exact database name
                    }
                    if (error) console.error("Error fetching institute:", error);
                } else {
                    const { data } = await supabase.from('areas').select('name').eq('id', collegeId).limit(1);
                    if (data && data.length > 0) aName = data[0].name;
                }

                setRealAreaId(aId);
                setInstituteName(aName);

            } catch (err) {
                console.error("Institute fetch error:", err);
            } finally {
                setLoading(false);
            }
        };
        if (collegeId) fetchArea();
    }, [collegeId]);

    if (loading) return <div className={styles.loading}>Loading Institute Sensor Data...</div>;

    return (
        <div className={styles.container} style={{ paddingTop: '0px' }}>
            <AdminBreadcrumb items={[{ label: instituteName }]} />
            
            {realAreaId && (
                <div className={styles.analyticsStack}>
                    <AnalyticsControlBar
                        filters={filters}
                        onFilterChange={setFilters}
                        exportLabel={instituteName}
                    />

                    <SummaryMetrics level="area" id={realAreaId} filters={filters} />
                    
                    <div className={styles.chartWrapper}>
                        <AggregateChart level="area" id={realAreaId} type="daily" title="24h Institute Traffic Trend" filters={filters} />
                    </div>
                    <div className={styles.chartWrapper}>
                        <AggregateChart level="area" id={realAreaId} type="weekly" title="7-Day Institute Traffic Trend" filters={filters} />
                    </div>
                </div>
            )}
        </div>
    );
};

export const BuildingRedirect = () => {
    const { collegeId, buildingId } = useParams(); 
    const [realBuildingId, setRealBuildingId] = useState(null);
    const [buildingName, setBuildingName] = useState(""); 
    const [areaName, setAreaName] = useState("");
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState(DEFAULT_ANALYTICS_FILTERS);

    useEffect(() => {
        const fetchBuilding = async () => {
            try {
                setLoading(true);
                let bId = buildingId;
                let bName = formatAdminRouteLabel(buildingId); 
                let aName = formatAdminRouteLabel(collegeId);

                // 1. Resolve area name & ID from the existing buildings table.
                const isB_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(buildingId);
                if (!isB_UUID) {
                    const searchName = `%${buildingId.split('_').join('%')}%`;
                    const { data } = await supabase.from('buildings').select('id, name').ilike('name', searchName).limit(1);
                    if (data && data.length > 0) {
                        bId = data[0].id;
                        bName = data[0].name; 
                    }
                } else {
                    const { data } = await supabase.from('buildings').select('name').eq('id', buildingId).limit(1);
                    if (data && data.length > 0) bName = data[0].name; 
                }

                // 2. Resolve institute name from the existing areas table.
                const isA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(collegeId);
                if (!isA_UUID) {
                    const searchAName = `%${collegeId.split('_').join('%')}%`;
                    const { data } = await supabase.from('areas').select('name').or(`slug.eq.${collegeId},name.ilike.${searchAName}`).limit(1);
                    if (data && data.length > 0) aName = data[0].name;
                } else {
                    const { data } = await supabase.from('areas').select('name').eq('id', collegeId).limit(1);
                    if (data && data.length > 0) aName = data[0].name;
                }

                setRealBuildingId(bId);
                setBuildingName(bName); 
                setAreaName(aName);

            } catch (err) {
                console.error("Area fetch error:", err);
            } finally {
                setLoading(false);
            }
        };
        if (buildingId) fetchBuilding();
    }, [collegeId, buildingId]);

    if (loading) return <div className={styles.loading}>Loading Area Sensor Data...</div>;

    return (
        <div className={styles.container} style={{ paddingTop: '0px' }}>
            <AdminBreadcrumb
                items={[
                    { label: areaName, to: getAdminCollegePath(collegeId) },
                    { label: buildingName }, 
                ]}
            />

            {realBuildingId && (
                <div className={styles.analyticsStack}>
                    <AnalyticsControlBar
                        filters={filters}
                        onFilterChange={setFilters}
                        exportLabel={buildingName}
                    />

                    <SummaryMetrics level="building" id={realBuildingId} filters={filters} />

                    <div className={styles.chartWrapper}>
                        <AggregateChart level="building" id={realBuildingId} type="daily" title="24h Area Traffic Trend" filters={filters} />
                    </div>
                    <div className={styles.chartWrapper}>
                        <AggregateChart level="building" id={realBuildingId} type="weekly" title="7-Day Area Traffic Trend" filters={filters} />
                    </div>
                </div>
            )}
        </div>
    );
};
