import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// --- Public Components & Pages ---
import AdminHeader from "./components/Header/AdminHeader.jsx";
import Resources from "./components/pages/Resources.jsx";
import Terms from "./components/pages/Terms.jsx";
import Privacy from "./components/pages/Privacy.jsx";
import Contact from "./components/pages/Contact.jsx";

// --- Admin Dashboard Components (Protected Area) ---
import AdminLayout from './components/admin/layout/AdminLayout.jsx';
import { AreaOverview, CollegeOverview } from './components/admin/pages/AdminRoutePages.jsx';
import FloorDashboard from './components/admin/pages/FloorDashboard.jsx'; 
import InsightsStudio, { InsightBuilderPage } from './components/admin/insights/InsightsStudio.jsx';
import { DEFAULT_ADMIN_ROUTE } from './components/admin/routing/AdminRouteUtils.jsx';

import styles from "./App.module.css";

function App() {
    return (
        <Router>
            <div className={styles.appLayout} style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
                
                <AdminHeader />
                
                <div className={styles.mainContent} style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                    <Routes>
                        
                        {/* ------------------- HOME / MAP ------------------- */}
                        <Route path="/" element={<Navigate to={DEFAULT_ADMIN_ROUTE} replace />} />
                        <Route path="/map" element={<Navigate to={DEFAULT_ADMIN_ROUTE} replace />} />
                        <Route path="/dashboard/institute/pepper_canyon/*" element={<Navigate to={DEFAULT_ADMIN_ROUTE} replace />} />
                        <Route path="/dashboard/pepper_canyon/*" element={<Navigate to={DEFAULT_ADMIN_ROUTE} replace />} />

                        {/* ------------------- ADMIN DASHBOARD ROUTES ------------------- */}
                        <Route path="/dashboard/institute/:collegeId" element={<AdminLayout />}>
                            <Route index element={<CollegeOverview />} />
                            <Route path="corridors/:floorId" element={<FloorDashboard />} />
                            <Route path="corridors/:floorId/:legacyId" element={<Navigate to=".." replace />} />
                            <Route path="area/:buildingId">
                                <Route index element={<AreaOverview />} />
                                <Route path="corridors/:floorId" element={<FloorDashboard />} />
                                <Route path="corridors/:floorId/:legacyId" element={<Navigate to=".." replace />} />
                            </Route>
                        </Route>
                        <Route path="/dashboard/:collegeId" element={<AdminLayout />}>
                            <Route index element={<CollegeOverview />} />
                            <Route path="corridors/:floorId" element={<FloorDashboard />} />
                            <Route path="corridors/:floorId/:legacyId" element={<Navigate to=".." replace />} />
                            <Route path=":buildingId">
                                <Route index element={<Navigate to=".." replace />} />
                                <Route path=":floorId" element={<FloorDashboard />} />
                                <Route path=":floorId/:legacyId" element={<Navigate to=".." replace />} />
                            </Route>
                        </Route>
                        <Route path="/dashboard/college/:collegeId" element={<AdminLayout />}>
                            <Route index element={<CollegeOverview />} />
                            <Route path="floor/:floorId" element={<FloorDashboard />} />
                            <Route path="floor/:floorId/corridor/:legacyId" element={<Navigate to=".." replace />} />
                            <Route path="building/:buildingId">
                                <Route index element={<Navigate to=".." replace />} />
                                <Route path=":floorId" element={<FloorDashboard />} />
                                <Route path=":floorId/corridor/:legacyId" element={<Navigate to=".." replace />} />
                                <Route path="floor/:floorId" element={<FloorDashboard />} />
                                <Route path="floor/:floorId/corridor/:legacyId" element={<Navigate to=".." replace />} />
                            </Route>
                        </Route>
                        <Route path="/insights-studio" element={<InsightsStudio />} />
                        <Route path="/insights-studio/solo" element={<InsightBuilderPage type="solo" title="Solo Insight" />} />
                        <Route path="/insights-studio/comparison" element={<InsightBuilderPage type="comparison" title="Comparison Insight" />} />

                        {/* ------------------- STATIC PAGES ------------------- */}
                        <Route path="/resources" element={<div className={styles.centeredPageShell}><Resources/></div>} />
                        <Route path="/terms" element={<div className={styles.centeredPageShell}><Terms/></div>} />
                        <Route path="/privacy" element={<div className={styles.centeredPageShell}><Privacy/></div>} />
                        <Route path="/contact" element={<div className={styles.centeredPageShell}><Contact/></div>} />

                        {/* ------------------- AUTHENTICATION REDIRECTS ------------------- */}
                        <Route path="/login" element={<Navigate to={DEFAULT_ADMIN_ROUTE} replace />} />
                        <Route path="/signup" element={<Navigate to={DEFAULT_ADMIN_ROUTE} replace />} />
                        <Route path="/create-account" element={<Navigate to={DEFAULT_ADMIN_ROUTE} replace />} />
                        <Route path="/verify" element={<Navigate to={DEFAULT_ADMIN_ROUTE} replace />} />
                        <Route path="/forgot-password" element={<Navigate to={DEFAULT_ADMIN_ROUTE} replace />} />
                        <Route path="/set-password" element={<Navigate to={DEFAULT_ADMIN_ROUTE} replace />} />

                    </Routes>
                </div>
            </div>
        </Router>
    );
}

export default App;
