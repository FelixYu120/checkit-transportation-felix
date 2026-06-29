import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './Login.module.css';
import supabase from '../helper/SupabaseClients'; 

function Login({ setIsLoggedIn }) {
    const navigate = useNavigate();
    
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
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
                    <a href="/" aria-label="Go to CheckIt home page" className={styles.logoLink}>
                        <img src="/checkit-logo.png" alt="CheckIt logo" className={styles.icon} />
                    </a>
                </div>

                <div className={styles.fadein}>
                    <div className={styles.headerBlock}>
                        <h1 className={styles.logintitle}>WELCOME BACK!</h1>
                        <p className={styles.helperText}>
                            Please log in with your organization credentials.
                        </p>
                    </div>

                    {errorMessage && <div className={styles.errorMessage}>{errorMessage}</div>}
                    
                    <form className={styles.formlayout} onSubmit={handleSubmit}>
                        <div className={styles.fieldGroup}>
                            <label className={styles.fieldLabel} htmlFor="login-email">Email address</label>
                            <input 
                                id="login-email"
                                className={styles.loginemail} 
                                type="email" 
                                value={email}
                                placeholder="you@organization.edu" 
                                required 
                                onChange={(e) => setEmail(e.target.value)} 
                            />
                        </div>

                        <div className={styles.fieldGroup}>
                            <label className={styles.fieldLabel} htmlFor="login-password">Password</label>
                            <input 
                                id="login-password"
                                className={styles.loginemail} 
                                type="password" 
                                value={password}
                                placeholder="Enter your password" 
                                required 
                                onChange={(e) => setPassword(e.target.value)} 
                            />
                        </div>

                        <div className={styles.navrow}>
                            <button type="button" className={styles.backbutton} onClick={() => navigate('/')}>BACK</button>
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
