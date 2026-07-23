import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import supabase from '../helper/SupabaseClients';
import styles from './Login.module.css';

function CreateAccount({ setIsLoggedIn }) {
    const navigate = useNavigate();
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [hasInviteSession, setHasInviteSession] = useState(false);

    useEffect(() => {
        let mounted = true;

        supabase.auth.getSession().then(({ data }) => {
            if (mounted) {
                setHasInviteSession(Boolean(data.session));
                setEmail(data.session?.user?.email || '');
            }
        });

        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
            setHasInviteSession(Boolean(session));
            if (session?.user?.email) setEmail(session.user.email);
        });

        return () => {
            mounted = false;
            authListener.subscription.unsubscribe();
        };
    }, []);

    const handleSubmit = async (event) => {
        event.preventDefault();
        setErrorMessage('');
        setSuccessMessage('');

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
        const { data, error } = hasInviteSession
            ? await supabase.auth.updateUser({
                password,
                data: {
                    first_name: trimmedFirstName,
                    last_name: trimmedLastName,
                    full_name: fullName
                }
            })
            : await supabase.auth.signUp({
                email: normalizedEmail,
                password,
                options: {
                    data: {
                        first_name: trimmedFirstName,
                        last_name: trimmedLastName,
                        full_name: fullName
                    },
                    emailRedirectTo: `${window.location.origin}/login`
                }
            });

        if (error) {
            setErrorMessage(error.message);
        } else if (hasInviteSession) {
            const userId = data?.user?.id;
            if (userId) {
                await supabase
                    .from('profile')
                    .upsert({
                        id: userId,
                        email: normalizedEmail,
                        full_name: fullName
                    });
            }

            setSuccessMessage('Account created. Redirecting to your dashboard...');
            setIsLoggedIn?.(true);
            setTimeout(() => navigate('/map'), 900);
        } else {
            if (data?.session?.user?.id) {
                await supabase
                    .from('profile')
                    .upsert({
                        id: data.session.user.id,
                        email: normalizedEmail,
                        full_name: fullName
                    });
            }

            setSuccessMessage('Account request created. Check your email to confirm your account, then log in.');
            setFirstName('');
            setLastName('');
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
                    <a href="https://checkit.dev" aria-label="Go to CheckIt landing page" className={styles.logoLink}>
                        <img src="/checkit-logo.png" alt="CheckIt logo" className={styles.icon} />
                    </a>
                </div>

                <div className={styles.fadein}>
                    <div className={styles.headerBlock}>
                        <h1 className={styles.logintitle}>CREATE ACCOUNT</h1>
                        <p className={styles.helperText}>
                            {hasInviteSession
                                ? 'Add your name and choose a password.'
                                : 'Use the email approved for platform access.'}
                        </p>
                    </div>

                    {errorMessage && <div className={styles.errorMessage}>{errorMessage}</div>}
                    {successMessage && <div className={styles.successMessage}>{successMessage}</div>}

                    <form className={styles.formlayout} onSubmit={handleSubmit} autoComplete="off">
                        <div className={styles.nameRow}>
                            <div className={styles.fieldGroup}>
                                <label className={styles.fieldLabel} htmlFor="signup-first-name">First name</label>
                                <input
                                    id="signup-first-name"
                                    name="new-admin-first-name"
                                    className={styles.loginemail}
                                    type="text"
                                    value={firstName}
                                    placeholder="First name"
                                    autoComplete="given-name"
                                    required
                                    onChange={(event) => setFirstName(event.target.value)}
                                />
                            </div>

                            <div className={styles.fieldGroup}>
                                <label className={styles.fieldLabel} htmlFor="signup-last-name">Last name</label>
                                <input
                                    id="signup-last-name"
                                    name="new-admin-last-name"
                                    className={styles.loginemail}
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
                            <label className={styles.fieldLabel} htmlFor="signup-email">Email address</label>
                            <input
                                id="signup-email"
                                name="new-admin-account-email"
                                className={styles.loginemail}
                                type="email"
                                value={email}
                                placeholder="you@organization.edu"
                                autoComplete="off"
                                disabled={hasInviteSession}
                                required
                                onChange={(event) => setEmail(event.target.value)}
                            />
                        </div>

                        <div className={styles.fieldGroup}>
                            <label className={styles.fieldLabel} htmlFor="signup-password">Password</label>
                            <div className={styles.passwordField}>
                                <input
                                    id="signup-password"
                                    name="new-admin-account-password"
                                    className={`${styles.loginemail} ${styles.passwordInput}`}
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    placeholder="Use at least 8 characters"
                                    autoComplete="new-password"
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
                            <label className={styles.fieldLabel} htmlFor="signup-confirm-password">Confirm password</label>
                            <div className={styles.passwordField}>
                                <input
                                    id="signup-confirm-password"
                                    name="new-admin-account-confirm-password"
                                    className={`${styles.loginemail} ${styles.passwordInput}`}
                                    type={showConfirmPassword ? 'text' : 'password'}
                                    value={confirmPassword}
                                    placeholder="Re-enter your password"
                                    autoComplete="new-password"
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

                        <div className={styles.navrow}>
                            <button type="button" className={styles.backbutton} onClick={() => navigate('/login')}>BACK</button>
                            <button type="submit" className={styles.continuebutton} disabled={loading}>
                                {loading ? 'CREATING...' : hasInviteSession ? 'SAVE PASSWORD' : 'CREATE'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default CreateAccount;
