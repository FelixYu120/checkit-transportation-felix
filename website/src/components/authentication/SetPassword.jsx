import React, { useEffect, useState } from 'react';
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
    const [hasSession, setHasSession] = useState(false);

    useEffect(() => {
        let mounted = true;

        supabase.auth.getSession().then(({ data }) => {
            if (mounted) setHasSession(Boolean(data.session));
        });

        const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
                setHasSession(Boolean(session));
            }
        });

        return () => {
            mounted = false;
            authListener.subscription.unsubscribe();
        };
    }, []);

    const handleSubmit = async (event) => {
        event.preventDefault();
        setErrorMessage('');
        setMessage('');

        if (password.length < 8) {
            setErrorMessage('Use at least 8 characters for your password.');
            return;
        }

        if (password !== confirmPassword) {
            setErrorMessage('Passwords do not match.');
            return;
        }

        setLoading(true);
        const { error } = await supabase.auth.updateUser({ password });

        if (error) {
            setErrorMessage(error.message);
        } else {
            setMessage('Password updated. Redirecting to your dashboard...');
            setIsLoggedIn(true);
            setTimeout(() => navigate('/map'), 900);
        }

        setLoading(false);
    };

    return (
        <div className={styles.authcontainer}>
            <div className={styles.card}>
                <div className={styles.brandBlock}>
                    <a href="https://checkit.dev" aria-label="Go to CheckIt landing page" className={styles.logoLink}>
                        <img src="/checkit-logo.png" alt="CheckIt logo" className={styles.icon} />
                    </a>
                </div>

                {errorMessage && <div className={styles.errorMessage}>{errorMessage}</div>}
                {message && <div className={styles.successMessage}>{message}</div>}

                <div className={styles.fadein}>
                    <div className={styles.headerBlock}>
                        <h1 className={styles.logintitle}>SET PASSWORD</h1>
                        <p className={styles.supportText}>
                            Choose a password for your CheckIt administrator account.
                        </p>
                    </div>

                    {!hasSession && (
                        <div className={styles.noticeMessage}>
                            Open this page from the secure email link. If the link expired, request a new one from the login page.
                        </div>
                    )}

                    <form className={styles.formlayout} onSubmit={handleSubmit}>
                        <div className={styles.fieldGroup}>
                            <label className={styles.fieldLabel} htmlFor="new-password">New password</label>
                            <div className={styles.passwordField}>
                                <input
                                    id="new-password"
                                    className={`${styles.loginemail} ${styles.passwordInput}`}
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    placeholder="Use at least 8 characters"
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
                            <label className={styles.fieldLabel} htmlFor="confirm-password">Confirm password</label>
                            <div className={styles.passwordField}>
                                <input
                                    id="confirm-password"
                                    className={`${styles.loginemail} ${styles.passwordInput}`}
                                    type={showConfirmPassword ? 'text' : 'password'}
                                    value={confirmPassword}
                                    placeholder="Re-enter your password"
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
                            <button type="button" className={styles.backbutton} onClick={() => navigate('/login')}>BACK</button>
                            <button type="submit" className={styles.continuebutton} disabled={loading || !hasSession}>
                                {loading ? 'SAVING...' : 'SAVE PASSWORD'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default SetPassword;
