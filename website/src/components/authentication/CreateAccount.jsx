import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import SignupAuthenticator from './SignupAuthenticator.jsx';
import supabase from '../helper/SupabaseClients';
import styles from './LoginPage.module.css';
import { hasPortalAccess } from '../../lib/portalAccess.js';
import { leavePortal, finishPasswordSetup } from './portalExit.js';

function CreateAccount() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [errorMessage, setErrorMessage] = useState(() => (
        supabase ? '' : 'Account creation is not configured. Please contact an administrator.'
    ));
    const [successMessage, setSuccessMessage] = useState('');
    const [redirecting, setRedirecting] = useState(false);
    const [loading, setLoading] = useState(false);
    const setupFinishedRef = useRef(false);
    const savingPasswordRef = useRef(false);
    const [hasInviteSession, setHasInviteSession] = useState(false);
    const [inviteUserId, setInviteUserId] = useState('');
    const [mfaStatus, setMfaStatus] = useState({ busy: true, pending: true, verified: false });
    const [authReady, setAuthReady] = useState(() => !supabase);

    useEffect(() => { void import('./Login.jsx').catch(() => {}); }, []);

    useEffect(() => {
        let active = true;
        let version = 0;
        let exiting = false;
        let deadlineTimer;
        const queued = new Set();
        const closeSetup = (reason) => {
            if (exiting || setupFinishedRef.current || savingPasswordRef.current) return;
            exiting = true;
            setRedirecting(true);
            setHasInviteSession(false);
            setAuthReady(true);
            void leavePortal(supabase, () => {
                const notice = reason === 'expired' ? '?notice=invite_expired'
                    : ['completed', 'login_required', 'invitation_required'].includes(reason) ? '' : '?notice=invite_invalid';
                navigate(`/login${notice}`, { replace: true });
            });
        };
        const verify = async (session, request) => {
            if (!active || exiting || setupFinishedRef.current || savingPasswordRef.current || request !== version) return;
            if (!session?.user?.id) { closeSetup('invitation_required'); return; }
            setAuthReady(false);
            try {
                const identity = await supabase.auth.getUser();
                if (identity.error) throw identity.error;
                if (identity.data?.user?.id !== session.user.id) throw new Error('Account changed.');
                const result = await supabase.rpc('invitation_setup_status');
                if (result.error) throw result.error;
                if (!active || request !== version || exiting || setupFinishedRef.current || savingPasswordRef.current) return;
                if (result.data?.eligible !== true || result.data.user_id !== session.user.id) {
                    closeSetup(result.data?.reason);
                    return;
                }
                const remaining = Number(result.data.remaining_seconds);
                if (!Number.isFinite(remaining) || remaining <= 0) { closeSetup('expired'); return; }
                window.clearTimeout(deadlineTimer);
                setEmail(identity.data.user.email || '');
                setInviteUserId(session.user.id);
                setHasInviteSession(true);
                setAuthReady(true);
                deadlineTimer = window.setTimeout(() => closeSetup('expired'), remaining * 1000);
            } catch {
                if (active && request === version) closeSetup('verification_failed');
            }
        };
        const refresh = () => {
            if (!active || exiting || setupFinishedRef.current || savingPasswordRef.current) return;
            const request = ++version;
            setAuthReady(false);
            if (!supabase) { closeSetup('invitation_required'); return; }
            supabase.auth.getSession().then(({ data, error }) => {
                if (error) throw error;
                return verify(data?.session, request);
            }).catch(() => { if (active && request === version) closeSetup('verification_failed'); });
        };
        refresh();
        if (!supabase) return () => { active = false; };
        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
            const request = ++version;
            const timer = window.setTimeout(() => { queued.delete(timer); void verify(session, request); }, 0);
            queued.add(timer);
        });
        const focus = () => { if (document.visibilityState !== 'hidden') refresh(); };
        window.addEventListener('focus', focus);
        document.addEventListener('visibilitychange', focus);
        return () => {
            active = false;
            window.clearTimeout(deadlineTimer);
            queued.forEach(timer => window.clearTimeout(timer));
            listener?.subscription?.unsubscribe();
            window.removeEventListener('focus', focus);
            document.removeEventListener('visibilitychange', focus);
        };
    }, [navigate]);

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (loading || (hasInviteSession && successMessage)) return;
        setErrorMessage('');
        setSuccessMessage('');
        if (!supabase || !authReady) {
            setErrorMessage('Account verification is still loading. Please try again.');
            return;
        }


        if (!hasInviteSession) {
            setErrorMessage('Access is by invitation only. Ask your administrator for an invitation.');
            return;
        }

        if (mfaStatus.busy || mfaStatus.pending) {
            setErrorMessage('Finish the authenticator step or cancel setup.');
            return;
        }
        const fields = event.currentTarget.elements;
        const trimmedFirstName = String(fields.namedItem('new-admin-first-name')?.value || '').trim();
        const trimmedLastName = String(fields.namedItem('new-admin-last-name')?.value || '').trim();
        const password = fields.namedItem('checkit-transportation-new-account-password')?.value || '';
        const confirmPassword = fields.namedItem('checkit-transportation-new-account-confirm-password')?.value || '';
        const fullName = `${trimmedFirstName} ${trimmedLastName}`.trim();

        if (!trimmedFirstName || !trimmedLastName) {
            setErrorMessage('Enter your first and last name.');
            return;
        }

        if (password.length < 8) {
            setErrorMessage('Use at least 8 characters for your password.');
            return;
        }

        if (password !== confirmPassword) {
            setErrorMessage('Passwords do not match.');
            return;
        }

        setLoading(true);
        try {
            const metadata = { first_name: trimmedFirstName, last_name: trimmedLastName, full_name: fullName };
            const identity = await supabase.auth.getUser();
            if (identity.error) throw identity.error;
            const user = identity.data?.user;
            if (!user?.id) throw new Error('Your invitation session has expired. Reopen the invitation to retry.');
            const invitation = await supabase.rpc('invitation_setup_status');
            if (invitation.error) throw invitation.error;
            if (invitation.data?.eligible !== true || invitation.data.user_id !== user.id) {
                setRedirecting(true);
                setHasInviteSession(false);
                await leavePortal(supabase, () => navigate('/login', { replace: true }));
                return;
            }
            const { data: membership, error: membershipError } = await supabase.from('profile')
                .select('role,assigned_institute').eq('id', user.id).maybeSingle();
            if (membershipError) throw membershipError;
            if (!hasPortalAccess(membership)) {
                throw new Error('An active invitation is required. Ask your administrator to invite you.');
            }
            // Invitations already create the profile. Update only editable fields;
            // an upsert also requests UPDATE(id), which Occupancy correctly denies.
            const { data: savedProfile, error: profileError } = await supabase.from('profile')
                .update({ full_name: fullName }).eq('id', user.id)
                .select('id,full_name').single();
            if (profileError) throw new Error('Your profile could not be completed. Please try again.', { cause: profileError });
            if (savedProfile?.id !== user.id || savedProfile.full_name !== fullName) {
                throw new Error('Your profile update could not be confirmed. Reopen your invitation to retry.');
            }
            // USER_UPDATED fires before updateUser resolves. Keep the successful
            // password write from being rechecked as an already-used invitation.
            savingPasswordRef.current = true;
            const { data, error } = await supabase.auth.updateUser({ password, data: metadata });
            if (error) throw error;
            if (data?.user?.id !== user.id) throw new Error('Your account update could not be confirmed. Please try again.');
            setupFinishedRef.current = true;
            setSuccessMessage('Account ready.');
            await finishPasswordSetup(supabase, () => navigate('/login', { replace: true }));
        } catch (error) {
            setErrorMessage(error.message || 'Your account could not be saved. Please try again.');
        } finally {
            savingPasswordRef.current = false;
            setLoading(false);
        }
    };

    const retrySignIn = async () => {
        if (loading) return;
        setErrorMessage(''); setLoading(true);
        try { await finishPasswordSetup(supabase, () => navigate('/login', { replace: true })); }
        catch (error) { setErrorMessage(error.message || 'Sign out could not be completed. Try again.'); }
        finally { setLoading(false); }
    };

    return (
        <main className={styles.page} aria-labelledby="signup-title">
            <div className={styles.card}>
                <div className={styles.brandRow}>
                    <a href="https://checkit.dev" aria-label="CheckIt home" className={styles.logoLink}>
                        <img src="/checkit-logo.png" alt="CheckIt" className={styles.logo} />
                    </a>
                    <span className={styles.productName}>Transportation</span>
                </div>
                <h1 id="signup-title" className={styles.title}>{successMessage ? 'Account ready' : redirecting ? 'Opening sign in…' : hasInviteSession ? 'Complete your account' : 'Checking invitation…'}</h1>
                <p id="signup-intro" className={styles.intro}>
                    {successMessage ? 'Opening sign in…' : redirecting ? null : !authReady ? 'Checking your invitation…' : hasInviteSession ? 'Add your name and choose a password.' : 'Checking your invitation…'}
                </p>

                {errorMessage && <div id="signup-error" className={styles.errorMessage} role="alert">{errorMessage}</div>}
                {successMessage && <div className={styles.successMessage} role="status">{successMessage}</div>}
                {successMessage && errorMessage && <button className={styles.submitButton} type="button" onClick={() => void retrySignIn()} disabled={loading}>Try again</button>}

                {hasInviteSession && <form id="checkit-transportation-signup-form" name="checkit-transportation-signup-form" method="post" className={styles.form} hidden={Boolean(successMessage) || redirecting} onSubmit={handleSubmit} autoComplete="on" aria-busy={loading} aria-describedby={errorMessage ? 'signup-error' : 'signup-intro'}>
                    <div className={styles.nameRow}>
                        <div className={styles.fieldGroup}>
                            <label htmlFor="signup-first-name">First name<span className={styles.requiredMark} aria-hidden="true"> *</span></label>
                            <input
                                id="signup-first-name"
                                name="new-admin-first-name"
                                className={styles.input}
                                type="text"
                                defaultValue=""
                                placeholder="First name"
                                autoComplete="given-name"
                                required
                            />
                        </div>

                        <div className={styles.fieldGroup}>
                            <label htmlFor="signup-last-name">Last name<span className={styles.requiredMark} aria-hidden="true"> *</span></label>
                            <input
                                id="signup-last-name"
                                name="new-admin-last-name"
                                className={styles.input}
                                type="text"
                                defaultValue=""
                                placeholder="Last name"
                                autoComplete="family-name"
                                required
                            />
                        </div>
                    </div>

                    <div className={styles.fieldGroup}>
                        <label htmlFor="transportation-signup-email">Email address<span className={styles.requiredMark} aria-hidden="true"> *</span></label>
                        <input
                            id="transportation-signup-email"
                            name="checkit-transportation-new-account-email"
                            className={styles.input}
                            type="email"
                            value={email}
                            placeholder="name@organization.com"
                            autoComplete="section-checkit-transportation username"
                            readOnly
                            required
                        />
                    </div>

                    <div className={styles.fieldGroup}>
                        <label htmlFor="transportation-signup-password">Password<span className={styles.requiredMark} aria-hidden="true"> *</span></label>
                        <div className={styles.passwordField}>
                            <input
                                id="transportation-signup-password"
                                name="checkit-transportation-new-account-password"
                                className={`${styles.input} ${styles.passwordInput}`}
                                type={showPassword ? 'text' : 'password'}
                                defaultValue=""
                                placeholder="Use at least 8 characters"
                                autoComplete="section-checkit-transportation new-password"
                                required
                            />
                            <button
                                type="button"
                                className={styles.passwordToggle}
                                onClick={() => setShowPassword((current) => !current)}
                                aria-label={showPassword ? 'Hide password' : 'Show password'}
                                aria-pressed={showPassword}
                            >
                                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                            </button>
                        </div>
                    </div>

                    <div className={styles.fieldGroup}>
                        <label htmlFor="transportation-signup-confirm-password">Confirm password<span className={styles.requiredMark} aria-hidden="true"> *</span></label>
                        <div className={styles.passwordField}>
                            <input
                                id="transportation-signup-confirm-password"
                                name="checkit-transportation-new-account-confirm-password"
                                className={`${styles.input} ${styles.passwordInput}`}
                                type={showConfirmPassword ? 'text' : 'password'}
                                defaultValue=""
                                placeholder="Re-enter your password"
                                autoComplete="section-checkit-transportation new-password"
                                required
                            />
                            <button
                                type="button"
                                className={styles.passwordToggle}
                                onClick={() => setShowConfirmPassword((current) => !current)}
                                aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                                aria-pressed={showConfirmPassword}
                            >
                                {showConfirmPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                            </button>
                        </div>
                    </div>

                    <SignupAuthenticator key={inviteUserId} userId={inviteUserId} onStatusChange={setMfaStatus} disabled={loading || !authReady} />

                    <button type="submit" className={styles.submitButton} disabled={loading || mfaStatus.busy || mfaStatus.pending || !authReady || !supabase || (hasInviteSession && Boolean(successMessage))}>
                        {!authReady ? 'Checking invite…' : loading ? 'Saving…' : 'Save password'}
                    </button>
                </form>}
            </div>
        </main>
    );
}

export default CreateAccount;
