import styles from './AdminHeader.module.css'
import { NavLink, useLocation } from 'react-router-dom';
import React from 'react';
import { DEFAULT_ADMIN_ROUTE } from '../admin/routing/AdminRouteUtils';
import ProfileDropdown from './ProfileDropdown';

function AdminHeader() {
    const location = useLocation();
    const isAnalyticsActive = location.pathname.startsWith('/dashboard');

    return (
        <header className={styles.headerBar}>  
            {/* Logo */}
            <NavLink to={DEFAULT_ADMIN_ROUTE} aria-label="Go to default analytics page">
                <img 
                    src="/checkit-logo.png" 
                    alt="logo" 
                    className={styles.checkitLogo} 
                />
            </NavLink>

            <nav className={styles.primaryTabs} aria-label="Admin sections">
                <NavLink
                    to={DEFAULT_ADMIN_ROUTE}
                    className={`${styles.tabLink} ${isAnalyticsActive ? styles.activeTab : ""}`}
                >
                    Analytics
                </NavLink>
                <NavLink
                    to="/insights-studio"
                    className={({ isActive }) => `${styles.tabLink} ${isActive ? styles.activeTab : ""}`}
                >
                    Insights Studio
                </NavLink>
            </nav>

            <div className={styles.rightSection}>
                <ProfileDropdown />
            </div>

        </header>
    );
}

export default AdminHeader;
