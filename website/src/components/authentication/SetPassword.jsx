import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import supabase from '../helper/SupabaseClients';
import styles from './Login.module.css';

function SetPassword({ setIsLoggedIn }) {
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [message, setMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const redirectTimerRef = useRef(null);
    const [hasSession, setHasSession] = useState(false);

    useEffect(() => {
        let mounted = true;
        if (!supabase) {
            setErrorMessage('Password reset is not available. Please try again later.');
            return undefined;
        }
        supabase.auth.getSession().then(({ data, error }) => {
            if (!mounted) return;
            setHasSession(!error && Boolean(data?.session));
            if (error) setErrorMessage(error.message);
        }).catch(error => {
            if (mounted) setErrorMessage(error.message || 'Your reset link could not be verified. Please try again.');
        });
        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
            if (mounted) setHasSession(Boolean(session));
        });
        return () => { mounted = false; clearTimeout(redirectTimerRef.current); authListener.subscription.unsubscribe(); };
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
            const { error } = await supabase.auth.updateUser({ password });
            if (error) throw error;
            setMessage('Password updated. Redirecting to your dashboard…');
            setIsLoggedIn?.(true);
            redirectTimerRef.current = setTimeout(() => navigate('/map'), 900);
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
                            Choose a password for your CheckIt administrator account.
                        </p>
                    </div>

                    {!hasSession && (
                        <div className={styles.noticeMessage}>
                            Open this page from the secure email link. If the link expired, request a new one from the sign-in page.
                        </div>
                    )}

                    <form className={styles.formlayout} onSubmit={handleSubmit}>
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
                            <button type="button" className={styles.backbutton} onClick={() => navigate('/login')}>Back</button>
                            <button type="submit" className={styles.continuebutton} disabled={loading || !hasSession || Boolean(message)}>
                                {loading ? 'Saving…' : 'Save password'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default SetPassword;
