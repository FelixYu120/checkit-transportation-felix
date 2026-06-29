import React from 'react';
import styles from './Resources.module.css';

function Terms() {
    return (
        <div className={styles.pageContainer}>
            <h1 className={styles.heading}>TERMS OF USE</h1>
            
            <div className={styles.contentCard}>
                <p className={styles.legalText}>
                    <strong>Effective Date: January 25, 2026</strong>
                </p>

                <h3 className={styles.sectionTitle}>1. Introduction</h3>
                <p className={styles.legalText}>
                    Welcome to <strong>CheckIt</strong>.<br/>
                    CheckIt provides a platform that displays transportation sensor insights for corridors, traffic activity, utilization, and speed-limit monitoring.<br/>
                    By accessing or using CheckIt's website, dashboard, or services (the “Service”), you agree to these Terms of Use (“Terms”). If you do not agree, please do not use the Service.
                </p>

                <h3 className={styles.sectionTitle}>2. Eligibility</h3>
                <p className={styles.legalText}>You may use CheckIt if you are:</p>
                <ul className={styles.resourceList}>
                    <li>Using the Service for lawful purposes</li>
                    <li>Accessing the Service as an administrator, operator, visitor, or authorized user</li>
                </ul>
                <p className={styles.legalText}>
                    CheckIt is intended for informational purposes only and does not guarantee road, corridor, or traffic conditions.
                </p>

                <h3 className={styles.sectionTitle}>3. Description of Service</h3>
                <p className={styles.legalText}>CheckIt provides:</p>
                <ul className={styles.resourceList}>
                    <li>Transportation sensor indicators</li>
                    <li>Aggregated traffic trends for corridors and areas</li>
                    <li>A user interface for reviewing institutes, areas, and corridors</li>
                </ul>
                <p className={styles.legalText}>CheckIt does not:</p>
                <ul className={styles.resourceList}>
                    <li>Control transportation signals or speed limits</li>
                    <li>Track individuals</li>
                    <li>Identify specific users or devices</li>
                </ul>

                <h3 className={styles.sectionTitle}>4. Acceptable Use</h3>
                <p className={styles.legalText}>You agree not to:</p>
                <ul className={styles.resourceList}>
                    <li>Attempt to reverse-engineer or interfere with the Service</li>
                    <li>Misuse the data to harass, surveil, or target individuals</li>
                    <li>Use automated scripts or scraping tools without permission</li>
                    <li>Misrepresent sensor information as guaranteed traffic conditions</li>
                </ul>

                <h3 className={styles.sectionTitle}>5. Accuracy & Availability Disclaimer</h3>
                <p className={styles.legalText}>
                    CheckIt provides best-effort estimates based on aggregated sensor signals.
                </p>
                <ul className={styles.resourceList}>
                    <li>Sensor indicators may be delayed or inaccurate</li>
                    <li>Traffic conditions may change rapidly</li>
                    <li>CheckIt is not responsible for routing, enforcement, or operational conflicts</li>
                </ul>
                <p className={styles.legalText}>
                    The Service is provided “as is” without warranties of any kind.
                </p>

                <h3 className={styles.sectionTitle}>6. Intellectual Property</h3>
                <p className={styles.legalText}>
                    All content, branding, software, and system architecture are owned by CheckIt or its licensors.<br/><br/>
                    You may not copy, modify, distribute, or create derivative works without permission.
                </p>

                <h3 className={styles.sectionTitle}>7. Third-Party Corridors</h3>
                <p className={styles.legalText}>
                    CheckIt displays information about transportation areas not owned or controlled by CheckIt.<br/>
                    We do not control:
                </p>
                <ul className={styles.resourceList}>
                    <li>Transportation policies</li>
                    <li>Access rules or speed-limit enforcement</li>
                    <li>Traffic behavior within corridors</li>
                </ul>
                <p className={styles.legalText}>
                    Users remain responsible for following institutional policies.
                </p>

                <h3 className={styles.sectionTitle}>8. Limitation of Liability</h3>
                <p className={styles.legalText}>
                    To the fullest extent permitted by law, CheckIt shall not be liable for:
                </p>
                <ul className={styles.resourceList}>
                    <li>Inaccurate transportation sensor data</li>
                    <li>Traffic delays or loss of access to a corridor</li>
                    <li>Indirect or consequential damages</li>
                </ul>
                <p className={styles.legalText}>
                    Use of the Service is at your own discretion.
                </p>

                <h3 className={styles.sectionTitle}>9. Termination</h3>
                <p className={styles.legalText}>
                    We may suspend or terminate access to the Service at any time for misuse, security concerns, or operational reasons.
                </p>

                <h3 className={styles.sectionTitle}>10. Changes to Terms</h3>
                <p className={styles.legalText}>
                    We may update these Terms from time to time. Continued use of the Service constitutes acceptance of updated Terms.
                </p>

                <h3 className={styles.sectionTitle}>11. Contact</h3>
                <p className={styles.legalText}>
                    Questions?<br/>
                    check.it.team@gmail.com
                </p>
            </div>
        </div>
    );
}

export default Terms;
