import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// --- Public Components & Pages ---
import Header from "./components/Header/Header.jsx";
import AdminHeader from "./components/Header/AdminHeader.jsx";
import Resources from "./components/pages/Resources.jsx";
import Terms from "./components/pages/Terms.jsx";
import Privacy from "./components/pages/Privacy.jsx";
import Contact from "./components/pages/Contact.jsx";
import Login from "./components/authentication/Login.jsx";
import CreateAccount from "./components/authentication/CreateAccount.jsx";
import ForgotPassword from "./components/authentication/ForgotPassword.jsx";
import SetPassword from "./components/authentication/SetPassword.jsx";

// -- Admin Dashboard Components (Protected Area) ---
import AdminLayout from './components/admin/layout/AdminLayout.jsx';
import { AreaOverview, CollegeOverview } from './components/admin/pages/AdminRoutePages.jsx';
import FloorDashboard from './components/admin/pages/FloorDashboard.jsx'; 
import InsightsStudio, { InsightBuilderPage } from './components/admin/insights/InsightsStudio.jsx';
import { DEFAULT_ADMIN_ROUTE } from './components/admin/routing/AdminRouteUtils.jsx';

import styles from "./App.module.css";
import supabase from "./components/helper/SupabaseClients.jsx";

const getSupabaseAuthRedirectPath = () => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const searchParams = new URLSearchParams(window.location.search);
    const authType = hashParams.get('type') || searchParams.get('type');

    if (authType === 'invite' || authType === 'recovery') {
        return '/set-password';
    }

    return null;
};

function App() {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [authReady, setAuthReady] = useState(() => !supabase);

    useEffect(() => {
        if (!supabase) {
            return undefined;
        }

        const authRedirectPath = getSupabaseAuthRedirectPath();
        if (authRedirectPath && window.location.pathname !== authRedirectPath) {
            window.location.replace(`${authRedirectPath}${window.location.search}${window.location.hash}`);
            return undefined;
        }

        supabase.auth.getSession().then(({ data }) => {
            setIsLoggedIn(Boolean(data.session));
            setAuthReady(true);
        });

        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
            setIsLoggedIn(Boolean(session));
            setAuthReady(true);
        });

        return () => {
            authListener.subscription.unsubscribe();
        };
    }, []);

    if (!authReady) {
        return <div className={styles.appLayout} />;
    }

    return (
        <Router>
            <div className={styles.appLayout} style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
                
                {isLoggedIn ? <AdminHeader /> : <Header />}
                
                <div className={styles.mainContent} style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                    <Routes>
                        
                        {/* ------------------- HOME / MAP ------------------- */}
                        <Route path="/" element={isLoggedIn ? <Navigate to={DEFAULT_ADMIN_ROUTE} replace /> : <Navigate to="/login" replace />} />
                        <Route path="/map" element={isLoggedIn ? <Navigate to={DEFAULT_ADMIN_ROUTE} replace /> : <Navigate to="/login" replace />} />
                        <Route path="/dashboard/institute/pepper_canyon/*" element={<Navigate to={DEFAULT_ADMIN_ROUTE} replace />} />
                        <Route path="/dashboard/pepper_canyon/*" element={<Navigate to={DEFAULT_ADMIN_ROUTE} replace />} />

                        {/* ------------------- ADMIN DASHBOARD ROUTES ------------------- */}
                        <Route path="/dashboard/institute/:collegeId" element={isLoggedIn ? <AdminLayout /> : <Navigate to="/login" replace />}>
                            <Route index element={<CollegeOverview />} />
                            <Route path="corridors/:floorId" element={<FloorDashboard />} />
                            <Route path="corridors/:floorId/:legacyId" element={<Navigate to=".." replace />} />
                            <Route path="area/:buildingId">
                                <Route index element={<AreaOverview />} />
                                <Route path="corridors/:floorId" element={<FloorDashboard />} />
                                <Route path="corridors/:floorId/:legacyId" element={<Navigate to=".." replace />} />
                            </Route>
                        </Route>
                        <Route path="/dashboard/:collegeId" element={isLoggedIn ? <AdminLayout /> : <Navigate to="/login" replace />}>
                            <Route index element={<CollegeOverview />} />
                            <Route path="corridors/:floorId" element={<FloorDashboard />} />
                            <Route path="corridors/:floorId/:legacyId" element={<Navigate to=".." replace />} />
                            <Route path=":buildingId">
                                <Route index element={<Navigate to=".." replace />} />
                                <Route path=":floorId" element={<FloorDashboard />} />
                                <Route path=":floorId/:legacyId" element={<Navigate to=".." replace />} />
                            </Route>
                        </Route>
                        <Route path="/dashboard/college/:collegeId" element={isLoggedIn ? <AdminLayout /> : <Navigate to="/login" replace />}>
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
                        <Route path="/insights-studio" element={isLoggedIn ? <InsightsStudio /> : <Navigate to="/login" replace />} />
                        <Route path="/insights-studio/solo" element={isLoggedIn ? <InsightBuilderPage type="solo" title="Solo Insight" /> : <Navigate to="/login" replace />} />
                        <Route path="/insights-studio/comparison" element={isLoggedIn ? <InsightBuilderPage type="comparison" title="Comparison Insight" /> : <Navigate to="/login" replace />} />

                        {/* ------------------- STATIC PAGES ------------------- */}
                        <Route path="/resources" element={<div className={styles.centeredPageShell}><Resources/></div>} />
                        <Route path="/terms" element={<div className={styles.centeredPageShell}><Terms/></div>} />
                        <Route path="/privacy" element={<div className={styles.centeredPageShell}><Privacy/></div>} />
                        <Route path="/contact" element={<div className={styles.centeredPageShell}><Contact/></div>} />

                        {/* ------------------- AUTHENTICATION ------------------- */}
                        <Route path="/login" element={isLoggedIn ? <Navigate to={DEFAULT_ADMIN_ROUTE} replace /> : <Login page="login" setIsLoggedIn={setIsLoggedIn} />} />
                        <Route path="/signup" element={<CreateAccount />} />
                        <Route path="/create-account" element={<CreateAccount />} />
                        <Route path="/verify" element={<Login page="verify" setIsLoggedIn={setIsLoggedIn} />} />
                        <Route path="/forgot-password" element={<ForgotPassword />} />
                        <Route path="/set-password" element={<SetPassword setIsLoggedIn={setIsLoggedIn} />} />

                    </Routes>
                </div>
            </div>
        </Router>
    );
}

export default App;
