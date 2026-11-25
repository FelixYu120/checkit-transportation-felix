import React, { useEffect, useRef, useState } from 'react';
import supabase from '../helper/SupabaseClients';
import styles from './LoginPage.module.css';
import { requireInvitedUser, invitedFactors, enrollInvitedAuthenticator, verifyInvitedAuthenticator, cancelInvitedAuthenticator } from './signupMfa.js';

export default function SignupAuthenticator({ onStatusChange, userId, disabled = false }) {
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState('checking');
  const [factors, setFactors] = useState([]);
  const [factorId, setFactorId] = useState('');
  const [setup, setSetup] = useState(null);
  const [pendingFactorId, setPendingFactorId] = useState('');
  const [verified, setVerified] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const subject = useRef(null);
  const pending = useRef(false);
  const codeInput = useRef(null);
  const section = useRef(null);
  const busy = phase !== 'idle';
  const started = Boolean(factorId);

  useEffect(() => {
    onStatusChange({ busy, pending: !ready || (started && !verified), verified });
  }, [busy, ready, started, verified, onStatusChange]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const id = await requireInvitedUser(supabase, userId);
        const devices = await invitedFactors(supabase, id);
        if (!active) return;
        subject.current = id;
        setFactors(devices);
        setFactorId(devices[0]?.id || '');
        setReady(true);
      } catch { if (active) setError('Authenticator check failed. Retry.'); }
      finally { if (active) setPhase('idle'); }
    };
    void load();
    const hideSecrets = () => {
      setSetup(null); setCode('');
      if (codeInput.current) codeInput.current.value = '';
      section.current?.querySelectorAll('[data-mfa-secret]').forEach(node => { node.textContent = ''; });
      section.current?.querySelectorAll('img').forEach(node => node.removeAttribute('src'));
    };
    window.addEventListener('pagehide', hideSecrets);
    return () => { active = false; window.removeEventListener('pagehide', hideSecrets); };
  }, [userId]);

  const run = async (nextPhase, action) => {
    if (pending.current || disabled) return;
    pending.current = true;
    setPhase(nextPhase);
    setError('');
    try { await action(); }
    catch (failure) { setCode(''); setError(failure.message || 'Authenticator setup failed. Try again.'); }
    finally { pending.current = false; setPhase('idle'); }
  };
  const enroll = () => run('enrolling', async () => {
    const result = await enrollInvitedAuthenticator(supabase, subject.current, 'Transportation');
    setSetup(result);
    setPendingFactorId(result.id);
    setFactorId(result.id);
    setCode('');
  });
  const verify = () => run('verifying', async () => {
    await verifyInvitedAuthenticator(supabase, subject.current, factorId, codeInput.current?.value || code);
    setVerified(true);
    setPendingFactorId('');
    setSetup(null);
    setCode('');
  });
  const cancel = () => run('canceling', async () => {
    await cancelInvitedAuthenticator(supabase, subject.current, pendingFactorId);
    setSetup(null);
    setFactorId('');
    setPendingFactorId('');
    setCode('');
  });
  const retry = () => run('checking', async () => {
    const id = await requireInvitedUser(supabase, userId);
    const devices = await invitedFactors(supabase, id);
    subject.current = id;
    setFactors(devices);
    setFactorId(devices[0]?.id || '');
    setReady(true);
  });

  return <section ref={section} className={styles.signupAuthenticator} aria-label="Optional authenticator" aria-busy={busy}>
    {error && <p className={styles.errorMessage} role="alert">{error}</p>}
    {!ready ? <button type="button" className={styles.textLink} onClick={() => void retry()} disabled={busy || disabled}>{busy ? 'Checking authenticator…' : 'Retry authenticator check'}</button> : verified ? <p className={styles.authenticatorStatus} role="status">Two-step verification enabled.</p> : <>
      {!started && <><button type="button" className={styles.authenticatorButton} disabled={busy || disabled} onClick={() => void enroll()}>{busy ? 'Setting up…' : 'Set up two-step verification (optional)'}</button><p className={styles.authenticatorHint}>Use Google Authenticator or Microsoft Authenticator.</p></>}
      {setup && <div className={styles.mfaSetup}>
        <p>Scan with Google Authenticator or Microsoft Authenticator.</p>
        <img src={setup.image} className={styles.mfaQr} alt="Authenticator setup QR code" />
        <details><summary>Can’t scan?</summary><code className={styles.mfaSecret} data-mfa-secret>{setup.secret}</code></details>
      </div>}
      {pendingFactorId && !setup && <button type="button" className={styles.authenticatorButton} disabled={busy || disabled} onClick={() => void enroll()}>New setup code</button>}
      {started && <>
        {!setup && factors.length > 1 && <div className={styles.fieldGroup}><label htmlFor="signup-authenticator">Authenticator</label><select id="signup-authenticator" className={styles.input} disabled={busy || disabled} value={factorId} onChange={event => { setFactorId(event.target.value); setCode(''); }}>{factors.map(factor => <option key={factor.id} value={factor.id}>{factor.friendly_name || 'Authenticator'}</option>)}</select></div>}
        <div className={styles.fieldGroup}><label htmlFor="signup-authenticator-code">Authenticator code</label><input id="signup-authenticator-code" ref={codeInput} className={styles.input} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} disabled={busy || disabled} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void verify(); } }} /></div>
        <div className={styles.authenticatorActions}>
          <button type="button" className={styles.authenticatorButton} onClick={() => void verify()} disabled={busy || disabled}>{phase === 'verifying' ? 'Verifying…' : 'Verify'}</button>
          {pendingFactorId && <button type="button" className={styles.textLink} onClick={() => void cancel()} disabled={busy || disabled}>Cancel</button>}
        </div>
      </>}
    </>}
  </section>;
}
