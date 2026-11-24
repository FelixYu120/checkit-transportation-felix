import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import supabase from '../helper/SupabaseClients';
import styles from './LoginPage.module.css';

function ForgotPassword() {
    const [email, setEmail] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (loading) return;
        const resetEmail = String(event.currentTarget.elements.namedItem('checkit-transportation-reset-email')?.value ?? email).trim();
        setEmail(resetEmail);
        setErrorMessage('');
        setSuccessMessage('');
        setLoading(true);
        try {
            if (!supabase) throw new Error('Password reset is not available. Please try again later.');
            const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
                redirectTo: `${window.location.origin}/reset-password`
            });
            if (error) throw error;
            setSuccessMessage('Check your email for a reset link.');
        } catch (error) {
            setErrorMessage(error.message || 'The reset link could not be sent. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className={styles.page} aria-labelledby="reset-password-title">
            <div className={styles.card}>
                <div className={styles.brandRow}>
                    <a href="https://checkit.dev" aria-label="CheckIt home" className={styles.logoLink}>
                        <img src="/checkit-logo.png" alt="CheckIt" className={styles.logo} />
                    </a>
                    <span className={styles.productName}>Transportation</span>
                </div>
                <h1 id="reset-password-title" className={styles.title}>Reset password</h1>

                {errorMessage && <div className={styles.errorMessage} role="alert">{errorMessage}</div>}
                {successMessage && <div className={styles.successMessage} role="status">{successMessage}</div>}

                <form className={styles.form} onSubmit={handleSubmit} aria-label="Reset Transportation password" aria-busy={loading}>
                    <div className={styles.fieldGroup}>
                        <label htmlFor="transportation-reset-email">Email address</label>
                        <input
                            id="transportation-reset-email"
                            name="checkit-transportation-reset-email"
                            className={styles.input}
                            type="email"
                            value={email}
                            placeholder="name@organization.com"
                            autoComplete="section-checkit-transportation username"
                            autoCapitalize="none"
                            spellCheck={false}
                            required
                            onChange={event => setEmail(event.target.value)}
                        />
                    </div>
                    <button type="submit" className={styles.submitButton} disabled={loading}>
                        {loading ? 'Sending…' : 'Send link'}
                    </button>
                </form>
                <Link className={styles.backLink} to="/login">Back to sign in</Link>
            </div>
        </main>
    );
}

export default ForgotPassword;
