import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import supabase from '../helper/SupabaseClients';
import styles from './Login.module.css';
import { finishPasswordSetup, leavePortal } from './portalExit.js';

function SetPassword() {
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [message, setMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const completedRef = useRef(false);
    const [hasSession, setHasSession] = useState(false);

    useEffect(() => {
        let active = true;
        let version = 0;
        let deadlineTimer;
        const queued = new Set();
        if (!supabase) return undefined;
        const verify = async (session, request) => {
            if (!active || completedRef.current || request !== version) return;
            if (!session?.user?.id) { setHasSession(false); return; }
            try {
                const identity = await supabase.auth.getUser();
                if (identity.error) throw identity.error;
                const result = await supabase.rpc('password_reset_status');
                if (result.error) throw result.error;
                if (!active || completedRef.current || request !== version) return;
                const remaining = Number(result.data?.remaining_seconds);
                if (result.data?.eligible !== true || result.data.user_id !== identity.data?.user?.id || identity.data?.user?.id !== session.user.id || !Number.isFinite(remaining) || remaining <= 0) {
                    setHasSession(false);
                    setErrorMessage('Reset link is invalid or expired.');
                    return;
                }
                window.clearTimeout(deadlineTimer);
                setHasSession(true);
                setErrorMessage('');
                deadlineTimer = window.setTimeout(() => {
                    if (!completedRef.current) {
                        setHasSession(false);
                        setErrorMessage('Reset link expired. Request a new one.');
                    }
                }, remaining * 1000);
            } catch {
                if (active && request === version) {
                    setHasSession(false);
                    setErrorMessage('Reset link could not be verified.');
                }
            }
        };
        const refresh = () => {
            if (!active || completedRef.current) return;
            const request = ++version;
            supabase.auth.getSession().then(({data, error}) => {
                if (error) throw error;
                return verify(data?.session, request);
            }).catch(() => { if (active && request === version) setHasSession(false); });
        };
        refresh();
        const {data: listener} = supabase.auth.onAuthStateChange((_event, session) => {
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
    }, []);

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (loading || message) return;
        setErrorMessage('');
        setMessage('');
        if (!supabase || !hasSession) {
            setErrorMessage('Open a valid password reset link before saving your password.');
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
            const identity = await supabase.auth.getUser();
            if (identity.error) throw identity.error;
            const reset = await supabase.rpc('password_reset_status');
            if (reset.error) throw reset.error;
            if (reset.data?.eligible !== true || reset.data.user_id !== identity.data?.user?.id) {
                setHasSession(false);
                throw new Error('Reset link is invalid or expired.');
            }
            const { data, error } = await supabase.auth.updateUser({ password });
            if (error) throw error;
            if (data?.user?.id !== identity.data?.user?.id) throw new Error('Password update could not be confirmed.');
            completedRef.current = true;
            setMessage('Password updated.');
            await finishPasswordSetup(supabase);
        } catch (error) {
            setErrorMessage(error.message || 'Your password could not be saved. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.authcontainer}>
            <div className={styles.card}>
                <div className={styles.brandBlock}>
                    <a href="https://checkit.dev" aria-label="Go to CheckIt landing page" className={styles.logoLink}>
                        <img src="/checkit-logo.png" alt="CheckIt logo" className={styles.icon} />
                    </a>
                </div>

                {errorMessage && <div className={styles.errorMessage} role="alert">{errorMessage}</div>}
                {message && <div className={styles.successMessage}>{message}</div>}

                <div className={styles.fadein}>
                    <div className={styles.headerBlock}>
                        <h1 className={styles.logintitle}>Set password</h1>
                        <p className={styles.supportText}>
                            Choose your new password.
                        </p>
                    </div>

                    {!hasSession && (
                        <div className={styles.noticeMessage}>
                            Open the reset link from your email.
                        </div>
                    )}

                    {hasSession && <form className={styles.formlayout} onSubmit={handleSubmit}>
                        <div className={styles.fieldGroup}>
                            <label className={styles.fieldLabel} htmlFor="transportation-new-password">New password</label>
                            <div className={styles.passwordField}>
                                <input
                                    id="transportation-new-password"
                                    name="checkit-transportation-set-password"
                                    className={`${styles.loginemail} ${styles.passwordInput}`}
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    placeholder="Use at least 8 characters"
                                    autoComplete="section-checkit-transportation new-password"
                                    required
                                    onChange={(event) => setPassword(event.target.value)}
                                />
                                <button
                                    type="button"
                                    className={styles.passwordToggle}
                                    onClick={() => setShowPassword((current) => !current)}
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        <div className={styles.fieldGroup}>
                            <label className={styles.fieldLabel} htmlFor="transportation-confirm-password">Confirm password</label>
                            <div className={styles.passwordField}>
                                <input
                                    id="transportation-confirm-password"
                                    name="checkit-transportation-set-confirm-password"
                                    className={`${styles.loginemail} ${styles.passwordInput}`}
                                    type={showConfirmPassword ? 'text' : 'password'}
                                    value={confirmPassword}
                                    placeholder="Re-enter your password"
                                    autoComplete="section-checkit-transportation new-password"
                                    required
                                    onChange={(event) => setConfirmPassword(event.target.value)}
                                />
                                <button
                                    type="button"
                                    className={styles.passwordToggle}
                                    onClick={() => setShowConfirmPassword((current) => !current)}
                                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                                >
                                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        <div className={styles.navrow} style={{ marginTop: '24px' }}>
                            <button type="button" className={styles.backbutton} onClick={() => { void leavePortal(supabase); }}>Back</button>
                            <button type="submit" className={styles.continuebutton} disabled={loading || !hasSession || Boolean(message)}>
                                {loading ? 'Saving…' : 'Save password'}
                            </button>
                        </div>
                    </form>}
                    {!hasSession && <button type="button" className={styles.backbutton} onClick={() => navigate('/forgot-password')}>Request a new link</button>}
                </div>
            </div>
        </div>
    );
}

export default SetPassword;
