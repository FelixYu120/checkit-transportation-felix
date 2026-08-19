import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import styles from './Login.module.css';
import supabase from '../helper/SupabaseClients'; 

const AUTOFILL_PREFIX = 'checkit-transportation';

const buildAutofillUsername = (value) => {
    const normalizedEmail = String(value || '').trim().toLowerCase();
    return normalizedEmail ? `${AUTOFILL_PREFIX}:${normalizedEmail}` : '';
};

const parseAutofillUsername = (value) => {
    const text = String(value || '').trim();
    const prefix = `${AUTOFILL_PREFIX}:`;
    return text.startsWith(prefix) ? text.slice(prefix.length) : text;
};

function Login({ setIsLoggedIn }) {
    const navigate = useNavigate();
    const goToMainWebsite = () => {
        window.location.assign('https://checkit.dev');
    };
    
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrorMessage('');
        setLoading(true);

        // Standard Email & Password Login
        const { error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            setErrorMessage(error.message);
            setLoading(false);
        } else {
            // Success! Log the user in and route them to the app
            setIsLoggedIn(true);
            navigate('/map');
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

                <div className={styles.fadein}>
                    <div className={styles.headerBlock}>
                        <div className={styles.domainBadge}>Transportation</div>
                        <h1 className={styles.logintitle}>WELCOME BACK!</h1>
                    </div>

                    {errorMessage && <div className={styles.errorMessage}>{errorMessage}</div>}
                    
                    <form
                        id="checkit-transportation-login-form"
                        name="checkit-transportation-login-form"
                        action="/transportation-login"
                        className={styles.formlayout}
                        autoComplete="on"
                        onSubmit={handleSubmit}
                    >
                        <input
                            className={styles.autofillUsernameInput}
                            type="text"
                            name="username"
                            value={buildAutofillUsername(email)}
                            autoComplete="section-checkit-transportation username"
                            tabIndex={-1}
                            aria-hidden="true"
                            onChange={(event) => setEmail(parseAutofillUsername(event.target.value))}
                        />
                        <div className={styles.fieldGroup}>
                            <label className={styles.fieldLabel} htmlFor="transportation-login-email">Email address</label>
                            <input 
                                id="transportation-login-email"
                                name="checkit-transportation-display-email"
                                className={styles.loginemail} 
                                type="email" 
                                value={email}
                                placeholder="you@organization.edu" 
                                autoComplete="off"
                                required 
                                onChange={(e) => setEmail(e.target.value)} 
                            />
                        </div>

                        <div className={styles.fieldGroup}>
                            <label className={styles.fieldLabel} htmlFor="transportation-login-password">Password</label>
                            <div className={styles.passwordField}>
                                <input
                                    id="transportation-login-password"
                                    name="checkit-transportation-password"
                                    className={`${styles.loginemail} ${styles.passwordInput}`}
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    placeholder="Enter your password"
                                    autoComplete="section-checkit-transportation current-password"
                                    required
                                    onChange={(e) => setPassword(e.target.value)}
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

                        <div className={styles.navrow}>
                            <button type="button" className={styles.backbutton} onClick={goToMainWebsite}>BACK</button>
                            <button type="submit" className={styles.continuebutton} disabled={loading}>
                                {loading ? 'VERIFYING...' : 'LOGIN'}
                            </button>
                        </div>
                    </form>

                    <div className={styles.loginrow}>
                        <button type="button" className={styles.linkbutton} onClick={() => navigate('/forgot-password')}>
                            Forgot password?
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Login;
