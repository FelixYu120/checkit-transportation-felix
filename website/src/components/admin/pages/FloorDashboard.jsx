import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import AdminBreadcrumb from '../layout/AdminBreadcrumb';
import AggregateChart from '../visualizations/AggregateChart';
import AnalyticsControlBar from '../controls/AnalyticsControlBar';
import { DEFAULT_ANALYTICS_FILTERS } from '../controls/AnalyticsFilterUtils';
import SummaryMetrics from '../summaries/SummaryMetrics';
import styles from './FloorDashboard.module.css';
import {
    formatAdminRouteLabel,
    getAdminCollegePath,
    getFloorNumberFromRouteSegment,
} from '../routing/AdminRouteUtils';

const FloorDashboard = () => {
    const { collegeId, floorId } = useParams();
    const [filters, setFilters] = useState(DEFAULT_ANALYTICS_FILTERS);
    const floorNumber = getFloorNumberFromRouteSegment(floorId);
    const areaLabel = formatAdminRouteLabel(collegeId);

    return (
        <div className={styles.container}>
            <AdminBreadcrumb
                items={[
                    {
                        label: areaLabel,
                        to: getAdminCollegePath(collegeId),
                    },
                    { label: `Corridor ${floorNumber}` },
                ]}
            />

            <AnalyticsControlBar
                filters={filters}
                onFilterChange={setFilters}
                exportLabel={`${areaLabel} Corridor ${floorNumber}`}
            />

            <SummaryMetrics level="floor" id={floorNumber} filters={filters} />

            <div style={{ 
                display: 'flex', 
                flexDirection: 'column', /* Stacks them vertically */
                gap: '40px',             /* Adds a big gap between the two charts */
                marginBottom: '80px',    /* Keeps them off the very bottom of the page */
                width: '100%', 
                boxSizing: 'border-box' 
            }}>
                <div className={styles.chartWrapper}>
                    <AggregateChart 
                        level="floor" 
                        id={floorNumber} 
                        type="daily" 
                        title="24h Corridor Traffic Trend" 
                        filters={filters}
                    />
                </div>
                <div className={styles.chartWrapper}>
                    <AggregateChart 
                        level="floor" 
                        id={floorNumber} 
                        type="weekly" 
                        title="7-Day Corridor Traffic Trend" 
                        filters={filters}
                    />
                </div>
            </div>
        </div>
    );
};

export default FloorDashboard;
