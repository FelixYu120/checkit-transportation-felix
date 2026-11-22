import React, { useState, useEffect } from 'react';
import { createBrowserRouter, RouterProvider, Routes, Route, Navigate, useLocation } from 'react-router-dom';

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
import { getSupabaseAuthRedirectPath } from "./components/authentication/authRedirect.js";

// --- Admin Dashboard Component (Protected Area) ---
import AdminLayout from './components/admin/layout/AdminLayout.jsx';
import { AreaOverview, CollegeOverview } from './components/admin/pages/AdminRoutePages.jsx';
import FloorDashboard from './components/admin/pages/FloorDashboard.jsx'; 
import InsightsStudio, { InsightBuilderPage } from './components/admin/insights/InsightsStudio.jsx';
import TeamPage from './components/admin/team/TeamPage.jsx';
import { DEFAULT_ADMIN_ROUTE } from './components/admin/routing/AdminRouteUtils.jsx';

import styles from "./App.module.css";
import supabase from "./components/helper/SupabaseClients.jsx";
import { hasPortalAccess } from './lib/portalAccess.js';
import { leavePortal, redirectToLanding } from './components/authentication/portalExit.js';

function AnalyticsAccessRoute({ isLoggedIn, children }) {
    const [access, setAccess] = useState('checking');

    useEffect(() => {
        let active = true;
        let revoked = false;
        let latestRequest = 0;

        const verifyAccess = async () => {
            if (!active || revoked) return;
            const request = ++latestRequest;
            if (!supabase || !isLoggedIn) {
                setAccess('signedOut');
                return;
            }

            try {
                const { data: userResult, error: authError } = await supabase.auth.getUser();
                if (authError) throw authError;
                const userId = userResult?.user?.id;
                if (!userId) {
                    if (active && request === latestRequest) {
                        revoked = true;
                        setAccess('revoked');
                    }
                    return;
                }

                const { data, error } = await supabase
                    .from('profile')
                    .select('role,assigned_institute')
                    .eq('id', userId)
                    .maybeSingle();
                if (error) throw error;

                if (active && request === latestRequest) {
                    revoked = !hasPortalAccess(data);
                    setAccess(revoked ? 'revoked' : 'allowed');
                }
            } catch (error) {
                if (active && request === latestRequest) {
                    revoked = [401, 403].includes(error?.status);
                    setAccess(revoked ? 'revoked' : 'unavailable');
                }
            }
        };

        void verifyAccess();
        if (!supabase || !isLoggedIn) return () => { active = false; };
        const timer = window.setInterval(verifyAccess, 30000);
        const refresh = () => { if (document.visibilityState === 'visible') void verifyAccess(); };
        document.addEventListener('visibilitychange', refresh);
        window.addEventListener('focus', refresh);
        const { data: listener } = supabase.auth.onAuthStateChange(() => {
            window.setTimeout(verifyAccess, 0);
        });
        return () => {
            active = false;
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', refresh);
            window.removeEventListener('focus', refresh);
            listener?.subscription?.unsubscribe();
        };
    }, [isLoggedIn]);

    useEffect(() => {
        // Remove the complete portal shell before starting session cleanup.
        if (access === 'revoked') void leavePortal(supabase);
        else if (access === 'unavailable') redirectToLanding();
    }, [access]);

    if (!isLoggedIn) return <Navigate to="/login" replace />;
    return access === 'allowed' ? children : null;
}

function AppShell({ isLoggedIn, setIsLoggedIn }) {
    const location = useLocation();
    const isAdminRoute =
        location.pathname.startsWith('/dashboard') ||
        location.pathname.startsWith('/insights-studio') ||
        location.pathname.startsWith('/team');

    const shell = (
        <div className={styles.appLayout} style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
            
            {!['/login', '/create-account'].includes(location.pathname) && (isLoggedIn && isAdminRoute ? <AdminHeader /> : <Header />)}
            
            <div className={styles.mainContent} style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <Routes>

                    {/* ------------------- HOME / MAP ------------------- */}
                    <Route path="/" element={isLoggedIn ? <Navigate to={DEFAULT_ADMIN_ROUTE} replace /> : <Navigate to="/login" replace />} />
                    <Route path="/map" element={isLoggedIn ? <Navigate to={DEFAULT_ADMIN_ROUTE} replace /> : <Navigate to="/login" replace />} />
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
                    <Route path="/team" element={<TeamPage />} />

                    {/* ------------------- STATIC PAGES ------------------- */}
                    <Route path="/resources" element={<div className={styles.centeredPageShell}><Resources/></div>} />
                    <Route path="/terms" element={<div className={styles.centeredPageShell}><Terms/></div>} />
                    <Route path="/privacy" element={<div className={styles.centeredPageShell}><Privacy/></div>} />
                    <Route path="/contact" element={<div className={styles.centeredPageShell}><Contact/></div>} />

                    {/* ------------------- AUTHENTICATION ------------------- */}
                    <Route path="/login" element={isLoggedIn ? <Navigate to={DEFAULT_ADMIN_ROUTE} replace /> : <Login page="login" setIsLoggedIn={setIsLoggedIn} />} />
                    <Route path="/signup" element={<CreateAccount setIsLoggedIn={setIsLoggedIn} />} />
                    <Route path="/create-account" element={<CreateAccount setIsLoggedIn={setIsLoggedIn} />} />
                    <Route path="/verify" element={<Login page="verify" setIsLoggedIn={setIsLoggedIn} />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                    <Route path="/set-password" element={<SetPassword setIsLoggedIn={setIsLoggedIn} />} />

                </Routes>
            </div>
        </div>
    );

    return isAdminRoute
        ? <AnalyticsAccessRoute isLoggedIn={isLoggedIn}>{shell}</AnalyticsAccessRoute>
        : shell;
}

function AppSession() {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [authReady, setAuthReady] = useState(() => !supabase);
    const [sessionIdentity, setSessionIdentity] = useState(null);

    useEffect(() => {
        if (!supabase) {
            return undefined;
        }

        const authRedirectPath = getSupabaseAuthRedirectPath(window.location);
        if (authRedirectPath && window.location.pathname !== authRedirectPath) {
            window.location.replace(`${authRedirectPath}${window.location.search}${window.location.hash}`);
            return undefined;
        }

        let active = true;
        let authEventReceived = false;
        supabase.auth.getSession().then(({ data, error }) => {
            if (!active || authEventReceived) return;
            setSessionIdentity(data?.session?.user?.id || null);
            setIsLoggedIn(!error && Boolean(data?.session));
            setAuthReady(true);
        }).catch(() => {
            if (!active || authEventReceived) return;
            setIsLoggedIn(false);
            setAuthReady(true);
        });

        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!active) return;
            authEventReceived = true;
            setSessionIdentity(session?.user?.id || null);
            setIsLoggedIn(Boolean(session));
            setAuthReady(true);
        });

        return () => {
            active = false;
            authListener.subscription.unsubscribe();
        };
    }, []);

    if (!authReady) {
        return <div className={styles.appLayout} />;
    }

    return <AppShell key={sessionIdentity} isLoggedIn={isLoggedIn} setIsLoggedIn={setIsLoggedIn} />;
}

// A data router lets the report editor protect browser Back as well as app links.
const appRouter = createBrowserRouter([{ path: '*', element: <AppSession /> }]);
if (import.meta.hot) import.meta.hot.dispose(() => appRouter.dispose());

function App() {
    return <RouterProvider router={appRouter} />;
}

export default App;
