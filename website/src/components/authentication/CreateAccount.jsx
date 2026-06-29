import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../helper/SupabaseClients';
import styles from './Login.module.css';

function CreateAccount() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (event) => {
        event.preventDefault();
        setErrorMessage('');
        setSuccessMessage('');

        if (password.length < 8) {
            setErrorMessage('Use at least 8 characters for your password.');
            return;
        }

        if (password !== confirmPassword) {
            setErrorMessage('Passwords do not match.');
            return;
        }

        setLoading(true);
        const { error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo: `${window.location.origin}/login`
            }
        });

        if (error) {
            setErrorMessage(error.message);
        } else {
            setSuccessMessage('Account request created. Check your email to confirm your account, then log in.');
            setEmail('');
            setPassword('');
            setConfirmPassword('');
        }

        setLoading(false);
    };

    return (
        <div className={styles.authcontainer}>
            <div className={styles.card}>
                <div className={styles.brandBlock}>
                    <a href="/" aria-label="Go to CheckIt home page" className={styles.logoLink}>
                        <img src="/checkit-logo.png" alt="CheckIt logo" className={styles.icon} />
                    </a>
                </div>

                <div className={styles.fadein}>
                    <div className={styles.headerBlock}>
                        <h1 className={styles.logintitle}>CREATE ACCOUNT</h1>
                        <p className={styles.helperText}>
                            Use the email approved for administrator access.
                        </p>
                    </div>

                    {errorMessage && <div className={styles.errorMessage}>{errorMessage}</div>}
                    {successMessage && <div className={styles.successMessage}>{successMessage}</div>}

                    <form className={styles.formlayout} onSubmit={handleSubmit} autoComplete="off">
                        <div className={styles.fieldGroup}>
                            <label className={styles.fieldLabel} htmlFor="signup-email">Email address</label>
                            <input
                                id="signup-email"
                                name="new-admin-account-email"
                                className={styles.loginemail}
                                type="email"
                                value={email}
                                placeholder="you@organization.edu"
                                autoComplete="off"
                                required
                                onChange={(event) => setEmail(event.target.value)}
                            />
                        </div>

                        <div className={styles.fieldGroup}>
                            <label className={styles.fieldLabel} htmlFor="signup-password">Password</label>
                            <input
                                id="signup-password"
                                name="new-admin-account-password"
                                className={styles.loginemail}
                                type="password"
                                value={password}
                                placeholder="Use at least 8 characters"
                                autoComplete="new-password"
                                required
                                onChange={(event) => setPassword(event.target.value)}
                            />
                        </div>

                        <div className={styles.fieldGroup}>
                            <label className={styles.fieldLabel} htmlFor="signup-confirm-password">Confirm password</label>
                            <input
                                id="signup-confirm-password"
                                name="new-admin-account-confirm-password"
                                className={styles.loginemail}
                                type="password"
                                value={confirmPassword}
                                placeholder="Re-enter your password"
                                autoComplete="new-password"
                                required
                                onChange={(event) => setConfirmPassword(event.target.value)}
                            />
                        </div>

                        <div className={styles.navrow}>
                            <button type="button" className={styles.backbutton} onClick={() => navigate('/login')}>BACK</button>
                            <button type="submit" className={styles.continuebutton} disabled={loading}>
                                {loading ? 'CREATING...' : 'CREATE'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default CreateAccount;
