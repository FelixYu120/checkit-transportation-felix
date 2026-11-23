import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import styles from './LoginPage.module.css';
import { EMAIL_LINK_MESSAGES } from './authRedirect.js';
import supabase from '../helper/SupabaseClients'; 
import { LOCAL_SIGN_OUT_MESSAGE } from './signOut.js';

const AUTOFILL_PREFIX = 'checkit-transportation';

const parseAutofillUsername = (value) => {
    const text = String(value || '').trim();
    const prefix = `${AUTOFILL_PREFIX}:`;
    return text.startsWith(prefix) ? text.slice(prefix.length) : text;
};

function Login({ setIsLoggedIn }) {
    const navigate = useNavigate();
    
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [errorMessage, setErrorMessage] = useState(() => EMAIL_LINK_MESSAGES[new URLSearchParams(window.location.search).get('notice')] || '');
    const [loading, setLoading] = useState(false);
    const locallySignedOut = new URLSearchParams(window.location.search).get('signedOut') === 'local';

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (loading) return;
        setErrorMessage('');

        if (!supabase) {
            setErrorMessage('Sign-in is not configured. Please contact an administrator.');
            return;
        }

        // Some password managers fill the DOM without dispatching React input events.
        const form = e.currentTarget;
        const loginEmail = parseAutofillUsername(form.elements.namedItem('checkit-transportation-username')?.value ?? email);
        const loginPassword = form.elements.namedItem('checkit-transportation-password')?.value ?? password;
        if (!loginEmail || !loginPassword) {
            setErrorMessage('Enter your email address and password.');
            return;
        }
        setEmail(loginEmail);
        setPassword(loginPassword);

        setLoading(true);

        try {
            // Standard Email & Password Login
            const { data, error } = await supabase.auth.signInWithPassword({
                email: loginEmail,
                password: loginPassword
            });

            if (error) {
                setErrorMessage(error.message);
            } else if (!data?.session?.access_token || !data?.session?.user?.id) {
                setErrorMessage('Sign-in could not be confirmed. Please try again.');
            } else {
                // Success! Log the user in and route them to the app
                setIsLoggedIn?.(true);
                navigate('/map');
                return;
            }
        } catch (err) {
            setErrorMessage(err?.message || 'Something went wrong. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className={styles.page} aria-labelledby="login-title">
            <div className={styles.card}>
                <div className={styles.brandRow}>
                    <a href="https://checkit.dev" aria-label="CheckIt home" className={styles.logoLink}>
                        <img src="/checkit-logo.png" alt="CheckIt" className={styles.logo} />
                    </a>
                    <span className={styles.productName}>Transportation</span>
                </div>
                <h1 id="login-title" className={styles.title}>Sign in</h1>

                {locallySignedOut && <div className={styles.successMessage} role="status">{LOCAL_SIGN_OUT_MESSAGE}</div>}

                {errorMessage && <div id="login-error" className={styles.errorMessage} role="alert">{errorMessage}</div>}

                <form
                    id="checkit-transportation-login-form"
                    name="checkit-transportation-login-form"
                    action="/transportation-login"
                    className={styles.form}
                    autoComplete="on"
                    aria-label="Sign in to Transportation"
                    aria-busy={loading}
                    aria-describedby={errorMessage ? 'login-error' : undefined}
                    onSubmit={handleSubmit}
                >
                    <div className={styles.fieldGroup}>
                        <label htmlFor="transportation-login-email">Email address</label>
                        <input
                            id="transportation-login-email"
                            name="checkit-transportation-username"
                            className={styles.input}
                            type="email"
                            value={email}
                            placeholder="name@organization.com"
                            autoComplete="section-checkit-transportation username"
                            autoCapitalize="none"
                            spellCheck={false}
                            required
                            onChange={(event) => setEmail(parseAutofillUsername(event.target.value))}
                        />
                    </div>
                    <div className={styles.fieldGroup}>
                        <div className={styles.passwordLabelRow}>
                            <label htmlFor="transportation-login-password">Password</label>
                            <Link to="/forgot-password" className={styles.textLink}>Forgot password?</Link>
                        </div>
                        <div className={styles.passwordField}>
                            <input
                                id="transportation-login-password"
                                name="checkit-transportation-password"
                                className={`${styles.input} ${styles.passwordInput}`}
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                placeholder="Enter your password"
                                autoComplete="section-checkit-transportation current-password"
                                required
                                onChange={(event) => setPassword(event.target.value)}
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
                    <button type="submit" className={styles.submitButton} disabled={loading}>
                        {loading ? 'Signing in…' : 'Sign in'}
                    </button>
                </form>
                <a className={styles.backLink} href="https://checkit.dev">Back to CheckIt</a>
            </div>
        </main>
    );
}

export default Login;
