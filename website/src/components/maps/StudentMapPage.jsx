import React, { useState, useEffect, useCallback } from 'react';
import Dashboard from '../pages/Dashboard'; // Import your student dashboard component
import EsriMap from '../maps/MapPage';      // Import your Esri map component
import styles from './StudentMapPage.module.css';

const API_URL = "https://checkit-api.vercel.app/api/influx";

function StudentMapPage() {
    const [currentTime, setCurrentTime] = useState(new Date());
    const [isSidebarOpen, setIsSidebarOpen] = useState(true); 

    const handleMapSelection = useCallback(() => {
        setIsSidebarOpen(true); 
    }, []);

    // Keep the clock ticking for that "Checking availability" look
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    return (
        <div className={styles.mainWrapper}>
            {/* --- LEFT SIDEBAR (Your Dashboard Logic) --- */}
            <aside className={`${styles.sidebarSection} ${!isSidebarOpen ? styles.sidebarClosed : ''}`}>
                {/* This inner div handles the padding now */}
                <div className={styles.sidebarContent}>
                    <div className={styles.availabilityHeader}>
                        <p>Checking availability for:</p>
                        <strong>{currentTime.toLocaleString()}</strong>
                    </div>

                    <div className={styles.dashboardScroll}>
                        <Dashboard />
                    </div>
                </div>

                <button 
                    className={styles.toggleButton} 
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                >
                    {isSidebarOpen ? '◀' : '▶'}
                </button>
            </aside>

            {/* --- RIGHT SIDE (The Esri Map) --- */}
            <main className={styles.mapSection}>
                <EsriMap onBuildingClick={handleMapSelection} />
            </main>
        </div>
    );
}

export default StudentMapPage;
