import React from 'react';
import { Link } from 'react-router-dom';
import styles from './Resources.module.css';

function Resources() {
    return (
        <div className={styles.pageContainer}>
            <h1 className={styles.heading}>Resources</h1>

            <div className={styles.contentCard}>
                
                {/* LEGAL SECTION */}
                <h2 className={styles.sectionTitle}>Terms of Service</h2>
                
                <p className={styles.legalText}>
                    Welcome to CheckIt. We provide transportation sensor analytics for traffic activity, corridor utilization, and speed-limit monitoring.
                </p>

                <p className={styles.legalText}>
                    By accessing or using this application, you acknowledge and agree to be bound by our{' '}
                    <Link to="/terms" className={styles.link}>Terms of Use</Link>
                    {' '}and{' '}
                    <Link to="/privacy" className={styles.link}>Privacy Policy</Link>.
                </p>

                <p className={styles.legalText}>
                    If you do not agree to these terms, please discontinue use of the application immediately.
                </p>

            </div>
        </div>
    );
}

export default Resources;
