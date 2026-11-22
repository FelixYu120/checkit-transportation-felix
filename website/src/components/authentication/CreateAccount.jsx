import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import supabase from '../helper/SupabaseClients';
import styles from './LoginPage.module.css';
import { hasPortalAccess } from '../../lib/portalAccess.js';

function CreateAccount({ setIsLoggedIn }) {
    const navigate = useNavigate();
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [errorMessage, setErrorMessage] = useState(() => (
        supabase ? '' : 'Account creation is not configured. Please contact an administrator.'
    ));
    const [successMessage, setSuccessMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const redirectTimerRef = useRef(null);
    const [hasInviteSession, setHasInviteSession] = useState(false);
    const [authReady, setAuthReady] = useState(() => !supabase);

    useEffect(() => {
        let mounted = true;
        if (!supabase) return undefined;
        supabase.auth.getSession().then(({ data, error }) => {
            if (!mounted) return;
            if (error) throw error;
            setHasInviteSession(Boolean(data?.session));
            setEmail(data?.session?.user?.email || '');
            setAuthReady(true);
        }).catch(error => {
            if (mounted) setErrorMessage(error.message || 'Your account could not be verified. Reopen the invitation to retry.');
        });
        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!mounted) return;
            setHasInviteSession(Boolean(session));
            if (session?.user?.email) setEmail(session.user.email);
            setAuthReady(true);
        });
        return () => { mounted = false; clearTimeout(redirectTimerRef.current); authListener.subscription.unsubscribe(); };
    }, []);

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

        const trimmedFirstName = firstName.trim();
        const trimmedLastName = lastName.trim();
        const fullName = `${trimmedFirstName} ${trimmedLastName}`.trim();
        const normalizedEmail = email.trim();

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
            const { data: membership, error: membershipError } = await supabase.from('profile')
                .select('role,assigned_institute').eq('id', user.id).maybeSingle();
            if (membershipError) throw membershipError;
            if (!hasPortalAccess(membership)) {
                throw new Error('An active invitation is required. Ask your administrator to invite you.');
            }
            // Complete an existing invited account; public registration is disabled.
            const { error: profileError } = await supabase.from('profile').upsert({
                id: user.id, email: user.email || normalizedEmail, full_name: fullName
            });
            if (profileError) throw new Error('Your profile could not be completed. Please try again.');
            const { data, error } = await supabase.auth.updateUser({ password, data: metadata });
            if (error) throw error;
            if (data?.user?.id !== user.id) throw new Error('Your account update could not be confirmed. Please try again.');
            setSuccessMessage('Account ready. Redirecting to your dashboard…');
            setIsLoggedIn?.(true);
            redirectTimerRef.current = setTimeout(() => navigate('/map'), 900);
        } catch (error) {
            setErrorMessage(error.message || 'Your account could not be saved. Please try again.');
        } finally {
            setLoading(false);
        }
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
                <h1 id="signup-title" className={styles.title}>{hasInviteSession ? 'Complete your account' : 'Invitation required'}</h1>
                <p id="signup-intro" className={styles.intro}>
                    {!authReady ? 'Checking your invitation…' : hasInviteSession ? 'Add your name and choose a password.' : 'Access is by invitation only. Ask your institution administrator for an invitation.'}
                </p>

                {errorMessage && <div id="signup-error" className={styles.errorMessage} role="alert">{errorMessage}</div>}
                {successMessage && <div className={styles.successMessage} role="status">{successMessage}</div>}

                {(!authReady || hasInviteSession) && <form className={styles.form} onSubmit={handleSubmit} autoComplete="off" aria-busy={loading} aria-describedby={errorMessage ? 'signup-error' : 'signup-intro'}>
                    <div className={styles.nameRow}>
                        <div className={styles.fieldGroup}>
                            <label htmlFor="signup-first-name">First name</label>
                            <input
                                id="signup-first-name"
                                name="new-admin-first-name"
                                className={styles.input}
                                type="text"
                                value={firstName}
                                placeholder="First name"
                                autoComplete="given-name"
                                required
                                onChange={(event) => setFirstName(event.target.value)}
                            />
                        </div>

                        <div className={styles.fieldGroup}>
                            <label htmlFor="signup-last-name">Last name</label>
                            <input
                                id="signup-last-name"
                                name="new-admin-last-name"
                                className={styles.input}
                                type="text"
                                value={lastName}
                                placeholder="Last name"
                                autoComplete="family-name"
                                required
                                onChange={(event) => setLastName(event.target.value)}
                            />
                        </div>
                    </div>

                    <div className={styles.fieldGroup}>
                        <label htmlFor="transportation-signup-email">Email address</label>
                        <input
                            id="transportation-signup-email"
                            name="checkit-transportation-new-account-email"
                            className={styles.input}
                            type="email"
                            value={email}
                            placeholder="name@organization.com"
                            autoComplete="section-checkit-transportation username"
                            disabled={hasInviteSession}
                            required
                            onChange={(event) => setEmail(event.target.value)}
                        />
                    </div>

                    <div className={styles.fieldGroup}>
                        <label htmlFor="transportation-signup-password">Password</label>
                        <div className={styles.passwordField}>
                            <input
                                id="transportation-signup-password"
                                name="checkit-transportation-new-account-password"
                                className={`${styles.input} ${styles.passwordInput}`}
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
                                aria-pressed={showPassword}
                            >
                                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                            </button>
                        </div>
                    </div>

                    <div className={styles.fieldGroup}>
                        <label htmlFor="transportation-signup-confirm-password">Confirm password</label>
                        <div className={styles.passwordField}>
                            <input
                                id="transportation-signup-confirm-password"
                                name="checkit-transportation-new-account-confirm-password"
                                className={`${styles.input} ${styles.passwordInput}`}
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
                                aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                                aria-pressed={showConfirmPassword}
                            >
                                {showConfirmPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                            </button>
                        </div>
                    </div>

                    <button type="submit" className={styles.submitButton} disabled={loading || !authReady || !supabase || (hasInviteSession && Boolean(successMessage))}>
                        {!authReady ? 'Checking invite…' : loading ? 'Saving…' : 'Save password'}
                    </button>
                </form>}
                <Link className={styles.backLink} to="/login">Back to sign in</Link>
            </div>
        </main>
    );
}

export default CreateAccount;
