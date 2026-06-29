import React from 'react';
import styles from './Resources.module.css';

function Privacy() {
    return (
        <div className={styles.pageContainer}>
            <h1 className={styles.heading}>PRIVACY POLICY</h1>
            
            <div className={styles.contentCard}>
                <p className={styles.legalText}>
                    <strong>Effective Date: January 25, 2026</strong>
                </p>

                <h3 className={styles.sectionTitle}>1. Our Privacy Commitment</h3>
                <p className={styles.legalText}>
                    CheckIt is built on a privacy-first philosophy.<br/>
                    We are committed to:
                </p>
                <ul className={styles.resourceList}>
                    <li>Not identifying individuals</li>
                    <li>Not collecting personal data</li>
                    <li>Not tracking user behavior across locations</li>
                </ul>

                <h3 className={styles.sectionTitle}>2. Information We Do NOT Collect</h3>
                <p className={styles.legalText}>
                    CheckIt does <strong>not</strong> and will <strong>not</strong> collect:
                </p>
                <ul className={styles.resourceList}>
                    <li>Names, emails, license plates, or driver IDs</li>
                    <li>Precise device identifiers</li>
                    <li>Location histories tied to individuals</li>
                    <li>Login credentials (unless explicitly added later)</li>
                </ul>
                <p className={styles.legalText}>
                    We do <strong>not</strong> attempt to identify or follow people or vehicles.
                </p>

                <h3 className={styles.sectionTitle}>3. Data Sharing</h3>
                <p className={styles.legalText}>
                    Aggregated insights may be shared with:
                </p>
                <ul className={styles.resourceList}>
                    <li>Transportation administrators</li>
                    <li>Area and corridor managers</li>
                </ul>
                <p className={styles.legalText}>
                    These insights:<br/>
                    • Do not include personal data<br/>
                    • Are used solely for transportation planning and optimization
                </p>

                <h3 className={styles.sectionTitle}>4. Data Security</h3>
                <p className={styles.legalText}>
                    We implement reasonable technical and organizational safeguards to protect system data from unauthorized access or misuse.
                </p>

                <h3 className={styles.sectionTitle}>5. Data Retention</h3>
                <p className={styles.legalText}>
                    Aggregated data may be retained for operational analysis and historical trends.<br/>
                    No personal data is retained because none is collected.
                </p>

                <h3 className={styles.sectionTitle}>6. Changes to This Policy</h3>
                <p className={styles.legalText}>
                    We may update this Privacy Policy periodically. Updates will be posted with a revised effective date.
                </p>
                <h3 className={styles.sectionTitle}>7. Contact Us</h3>
                <p className={styles.legalText}>
                    Questions about privacy?<br/>
                    check.it.team0828@gmail.com
                </p>
            </div>
        </div>
    );
}

export default Privacy;
