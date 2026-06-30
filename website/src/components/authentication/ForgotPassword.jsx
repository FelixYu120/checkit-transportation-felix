import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import supabase from '../helper/SupabaseClients';
import styles from './Login.module.css';

function ForgotPassword() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (event) => {
        event.preventDefault();
        setErrorMessage('');
        setSuccessMessage('');
        setLoading(true);

        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/set-password`
        });

        if (error) {
            setErrorMessage(error.message);
        } else {
            setSuccessMessage('Check your email for a secure password setup link.');
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

                <div className={styles.fadein}>
                    <div className={styles.headerBlock}>
                        <h1 className={styles.logintitle}>RESET PASSWORD</h1>
                        <p className={styles.helperText}>
                            Enter your email and we will send a secure link to set your password.
                        </p>
                    </div>

                    {errorMessage && <div className={styles.errorMessage}>{errorMessage}</div>}
                    {successMessage && <div className={styles.successMessage}>{successMessage}</div>}

                    <form className={styles.formlayout} onSubmit={handleSubmit}>
                        <div className={styles.fieldGroup}>
                            <label className={styles.fieldLabel} htmlFor="reset-email">Email address</label>
                            <input
                                id="reset-email"
                                className={styles.loginemail}
                                type="email"
                                value={email}
                                placeholder="you@organization.edu"
                                required
                                onChange={(event) => setEmail(event.target.value)}
                            />
                        </div>

                        <div className={styles.navrow} style={{ marginTop: '24px' }}>
                            <button type="button" className={styles.backbutton} onClick={() => navigate('/login')}>BACK</button>
                            <button type="submit" className={styles.continuebutton} disabled={loading}>
                                {loading ? 'SENDING...' : 'SEND LINK'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default ForgotPassword;
