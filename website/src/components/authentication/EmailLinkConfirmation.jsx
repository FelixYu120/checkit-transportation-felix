import React from 'react';
import styles from './LoginPage.module.css';

export default function EmailLinkConfirmation({ callback, onContinue }) {
  const recovery = callback.type === 'recovery';
  return <main className={styles.page} aria-labelledby="email-link-title"><div className={styles.card}>
    <div className={styles.brandRow}><a href="https://checkit.dev" className={styles.logoLink} aria-label="CheckIt home"><img src="/checkit-logo.png" className={styles.logo} alt="CheckIt" /></a><span className={styles.productName}>Transportation</span></div>
    <h1 id="email-link-title" className={styles.title}>{recovery ? 'Reset password' : 'Accept invite'}</h1>
    <button type="button" className={styles.submitButton} onClick={onContinue}>{recovery ? 'Continue' : 'Accept invite'}</button>
  </div></main>;
}
