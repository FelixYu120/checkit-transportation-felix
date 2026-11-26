import EmailLinkConfirmation from './components/authentication/EmailLinkConfirmation.jsx';
import MfaPage from './components/authentication/MfaPage.jsx';
import {readMfaStatus,needsMfa} from './components/authentication/mfa.js';
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
import { isAuthenticationPath, readEmailCallback, resolveEmailCallback } from "./components/authentication/authRedirect.js";

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

// Capture before detectSessionInUrl clears an invite/recovery fragment.
const supabaseEmailCallback = readEmailCallback(window.location);
const supabaseAuthRedirectPath = supabaseEmailCallback.redirectPath;

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
                let accountReady = false;
                if (hasPortalAccess(data)) {
                    const mfa = await readMfaStatus(supabase);
                    if (mfa.user_id !== userId) throw new Error('Account changed.');
                    if (mfa.ready && needsMfa(mfa)) {
                        if (active && request === latestRequest) setAccess('mfa');
                        return;
                    }
                    const readiness = await supabase.rpc('portal_account_ready');
                    if (readiness.error) throw readiness.error;
                    accountReady = readiness.data === true;
                }

                if (active && request === latestRequest) {
                    revoked = !hasPortalAccess(data);
                    setAccess(revoked ? 'revoked' : accountReady ? 'allowed' : 'onboarding');
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
    if (access === 'mfa') return <Navigate to="/mfa" replace />;
    if (access === 'onboarding') return <Navigate to="/create-account" replace />;
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
            
            {!isAuthenticationPath(location.pathname) && (isLoggedIn && isAdminRoute ? <AdminHeader /> : <Header />)}
            
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
                    <Route path="/mfa" element={<MfaPage />} />
                    <Route path="/security" element={<MfaPage />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                    <Route path="/set-password" element={<SetPassword setIsLoggedIn={setIsLoggedIn} />} />
                    <Route path="/reset-password" element={<SetPassword setIsLoggedIn={setIsLoggedIn} />} />

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
    const [callbackApproved, setCallbackApproved] = useState(() => !supabaseEmailCallback.tokenHash || supabaseEmailCallback.error || supabaseEmailCallback.redirectPath === '/create-account');

    useEffect(() => {
        if (!supabase) {
            return undefined;
        }

        if (!callbackApproved) return;
        const callbackNeedsRedirect = Boolean(supabaseAuthRedirectPath && window.location.pathname !== supabaseAuthRedirectPath);
        let active = true;
        let authEventReceived = false;
        let resolvingCallback = supabaseEmailCallback.hasCallback;
        resolveEmailCallback(supabase, supabaseEmailCallback).then(({ data, error }) => {
            if (!active) return;
            // getSession waits for URL parsing AND session persistence. Redirecting
            // earlier can unload the page between hash clearing and storage.
            if (callbackNeedsRedirect) {
                window.location.replace(supabaseAuthRedirectPath);
                return;
            }
            if (supabaseEmailCallback.hasCallback) {
                window.history.replaceState(window.history.state, '', supabaseAuthRedirectPath);
            }
            resolvingCallback = false;
            if (authEventReceived) return;
            setSessionIdentity(data?.session?.user?.id || null);
            setIsLoggedIn(!error && Boolean(data?.session));
            setAuthReady(true);
        }).catch(error => {
            if (!active) return;
            if (supabaseEmailCallback.hasCallback) {
                const notice = ['invite_expired', 'invite_invalid', 'reset_expired', 'reset_invalid'].includes(error?.message)
                    ? error.message : supabaseEmailCallback.failureNotice;
                void leavePortal(supabase, () => window.location.replace(`/login?notice=${notice}`));
                return;
            }
            if (authEventReceived) return;
            setIsLoggedIn(false);
            setAuthReady(true);
        });

        const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
            if (!active) return;
            // Keep the shell hidden until the callback has been persisted and routed.
            if (resolvingCallback || callbackNeedsRedirect) return;
            authEventReceived = true;
            // Preserve the setup screen during its final local sign-out. A new
            // account identity still remounts it; private routes still reset.
            const passwordSetupRoute = ['/signup', '/create-account', '/set-password', '/reset-password']
                .includes(window.location.pathname.replace(/\/+$/, ''));
            setSessionIdentity(current => !session?.user?.id && passwordSetupRoute
                ? current : session?.user?.id || null);
            setIsLoggedIn(Boolean(session));
            setAuthReady(true);
        });

        return () => {
            active = false;
            authListener.subscription.unsubscribe();
        };
    }, [callbackApproved]);

    if (!callbackApproved) return <EmailLinkConfirmation callback={supabaseEmailCallback} onContinue={() => setCallbackApproved(true)} />;
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
