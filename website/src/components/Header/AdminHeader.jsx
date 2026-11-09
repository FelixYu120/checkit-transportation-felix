import styles from './AdminHeader.module.css'
import { NavLink, useLocation } from 'react-router-dom';
import React, { useState } from 'react';
import { ChartNoAxesCombined, PanelsTopLeft, UsersRound } from 'lucide-react';
import { DEFAULT_ADMIN_ROUTE } from '../admin/routing/AdminRouteUtils';
import ProfileDropdown from './ProfileDropdown';

function AdminHeader() {
    const location = useLocation();
    const isAnalyticsActive = location.pathname.startsWith('/dashboard');
    const [lastAnalyticsLocation, setLastAnalyticsLocation] = useState(DEFAULT_ADMIN_ROUTE);
    const analyticsLocation = isAnalyticsActive
        ? `${location.pathname}${location.search}${location.hash}`
        : lastAnalyticsLocation;

    if (isAnalyticsActive && analyticsLocation !== lastAnalyticsLocation) {
        setLastAnalyticsLocation(analyticsLocation);
    }

    return (
        <header className={styles.headerBar}>  
            <NavLink className={styles.brand} to={analyticsLocation} aria-label="CheckIt Transportation home">
                <img 
                    src="/checkit-logo.png" 
                    alt="CheckIt" 
                    className={styles.checkitLogo} 
                />
                <span className={styles.productName}>Transportation</span>
            </NavLink>

            <nav className={styles.primaryTabs} aria-label="Platform navigation">
                <NavLink
                    to={analyticsLocation}
                    className={`${styles.tabLink} ${isAnalyticsActive ? styles.activeTab : ""}`}
                    aria-current={isAnalyticsActive ? 'page' : undefined}
                >
                    <ChartNoAxesCombined size={17} aria-hidden="true" />
                    <span>Analytics</span>
                </NavLink>
                <NavLink
                    to="/insights-studio"
                    className={({ isActive }) => `${styles.tabLink} ${isActive ? styles.activeTab : ""}`}
                >
                    <PanelsTopLeft size={17} aria-hidden="true" />
                    <span>Insights Studio</span>
                </NavLink>
                <NavLink
                    to="/team"
                    className={({ isActive }) => `${styles.tabLink} ${isActive ? styles.activeTab : ""}`}
                >
                    <UsersRound size={17} aria-hidden="true" />
                    <span>Teams</span>
                </NavLink>
            </nav>

            <div className={styles.rightSection}>
                <ProfileDropdown />
            </div>

        </header>
    );
}

export default AdminHeader;
