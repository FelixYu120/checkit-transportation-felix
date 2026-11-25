import React, {useEffect,useRef,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import supabase from '../helper/SupabaseClients';
import {DEFAULT_ADMIN_ROUTE} from '../admin/routing/AdminRouteUtils.jsx';
import {readMfaStatus,verifyAuthenticator,qrImage} from './mfa.js';
import {leavePortal} from './portalExit.js';
import styles from './LoginPage.module.css';

const factorLabel=(factor,index=0)=>/^CheckIt (Occupancy|Transportation) \d{4}-/.test(factor.friendly_name||'')?`Authenticator${index?` ${index+1}`:''}`:factor.friendly_name||'Authenticator';
const factorDate=factor=>{
  const value=factor.created_at||/ (\d{4}-\d{2}-\d{2}T[^ ]+)$/.exec(factor.friendly_name||'')?.[1];
  const date=value?new Date(value):null;
  return date&&!Number.isNaN(date.getTime())?date.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'';
};

export default function MfaPage({embedded=false,onVerified,onBusyChange}) {
  const navigate=useNavigate();
  const [status,setStatus]=useState(null);
  const [factors,setFactors]=useState([]);
  const [factorId,setFactorId]=useState('');
  const [setup,setSetup]=useState(null);
  const [code,setCode]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const request=useRef(false);
  const subject=useRef(null);
  useEffect(()=>{onBusyChange?.(busy);},[busy,onBusyChange]);
  useEffect(()=>{
    let active=true;
    const load=async()=>{
      try {
        const current=await readMfaStatus(supabase);
        if(!active) return;
        if(!current.ready) {navigate('/login',{replace:true});return;}
        subject.current=current.user_id;
        const response=await supabase.auth.mfa.listFactors();
        if(response.error) throw response.error;
        if(!active) return;
        const devices=(response.data?.totp||[]).filter(f=>f.status==='verified');
        setFactors(devices);setFactorId(devices[0]?.id||'');setStatus(current);
      } catch {if(active) setError('Authenticator setup could not be loaded. Sign in again.');}
    };
    void load();
    const hideSecrets=()=>{setSetup(null);setCode('');document.querySelectorAll('[data-mfa-secret]').forEach(node=>{node.textContent='';});document.querySelectorAll('[alt="Authenticator setup QR code"]').forEach(node=>node.removeAttribute('src'));};
    window.addEventListener('pagehide',hideSecrets);
    // Secrets live only in this screen. Account changes discard the complete screen.
    const {data:listener}=supabase.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_OUT' || (subject.current && session?.user?.id!==subject.current)) {
        active=false;setSetup(null);setCode('');navigate('/login',{replace:true});
      }
    });
    return ()=>{active=false;window.removeEventListener('pagehide',hideSecrets);listener?.subscription?.unsubscribe();};
  },[navigate]);
  const enroll=async()=>{
    if(request.current) return;
    request.current=true;setBusy(true);setError('');
    try {
      const current=await readMfaStatus(supabase);
      if(current.user_id!==subject.current || !current.ready || (factors.length && !current.verified)) throw new Error('Verify your current authenticator first.');
      const existing=await supabase.auth.mfa.listFactors();
      if(existing.error) throw existing.error;
      for(const f of existing.data?.all||[]) {
        if(f.factor_type==='totp'&&f.status==='unverified') {const removed=await supabase.auth.mfa.unenroll({factorId:f.id});if(removed.error)throw removed.error;}
      }
      const response=await supabase.auth.mfa.enroll({factorType:'totp',friendlyName:`CheckIt Transportation ${new Date().toISOString()}`,issuer:'CheckIt Transportation'});
      if(response.error) throw response.error;
      const image=qrImage(response.data?.totp?.qr_code);
      if((await readMfaStatus(supabase)).user_id!==subject.current) throw new Error('Account changed. Sign in again.');
      setSetup({id:response.data.id,image,secret:response.data.totp.secret});setFactorId(response.data.id);setCode('');
    } catch(e){setError(e.message||'Authenticator setup failed. Try again.');}
    finally {request.current=false;setBusy(false);}
  };
  const remove=async id=>{
    if(request.current || factors.length<2)return;
    request.current=true;setBusy(true);setError('');
    try {
      const current=await readMfaStatus(supabase);
      if(!current.verified||current.user_id!==subject.current)throw new Error('Verify your authenticator first.');
      const response=await supabase.auth.mfa.unenroll({factorId:id});if(response.error)throw response.error;
      const refreshed=await supabase.auth.refreshSession();if(refreshed.error)throw refreshed.error;
      const devices=await supabase.auth.mfa.listFactors();if(devices.error)throw devices.error;
      setFactors(devices.data.totp.filter(f=>f.status==='verified'));setFactorId(devices.data.totp[0]?.id||'');setStatus(await readMfaStatus(supabase));
    }catch(e){setError(e.message||'Authenticator could not be removed.');}
    finally{request.current=false;setBusy(false);}
  };
  const verify=async event=>{
    event.preventDefault();if(request.current) return;
    request.current=true;setBusy(true);setError('');
    try {
      await verifyAuthenticator(supabase,factorId,code.trim(),subject.current);
      setSetup(null);setCode('');
      if(embedded)onVerified?.();else navigate(DEFAULT_ADMIN_ROUTE,{replace:true});
    } catch(e){setCode('');setError(e.message||'Code could not be verified. Try again.');}
    finally {request.current=false;setBusy(false);}
  };
  const Title=embedded?'h3':'h1';
  const content=<>
    {!embedded&&<div className={styles.brandRow}><a href="https://checkit.dev" className={styles.logoLink} aria-label="CheckIt home"><img src="/checkit-logo.png" className={styles.logo} alt="CheckIt" /></a><span className={styles.productName}>Transportation</span></div>}
    <Title id="mfa-title" className={embedded?styles.embeddedTitle:styles.title}>{status?.verified&&!setup?'Two-step verification':setup||!factors.length?'Set up two-step verification':'Authenticator code'}</Title>
    {error&&<p className={styles.errorMessage} role="alert">{error}</p>}
    {!status&&!error&&<p role="status">Checking account…</p>}
    {status&&<>
      {!factorId&&<><p className={styles.intro}>Use Google Authenticator or Microsoft Authenticator.</p><button className={styles.submitButton} type="button" disabled={busy} onClick={enroll}>Set up two-step verification</button></>}
      {setup&&<div className={styles.mfaSetup}><p>Scan with Google Authenticator or Microsoft Authenticator.</p><img className={styles.mfaQr} src={setup.image} alt="Authenticator setup QR code" /><details><summary>Can’t scan?</summary><code className={styles.mfaSecret} data-mfa-secret>{setup.secret}</code></details></div>}
      {factorId&&(!status.verified||setup)&&<form className={styles.form} onSubmit={verify} aria-busy={busy}>
        {!setup&&factors.length>1&&<div className={styles.fieldGroup}><label htmlFor="mfa-device">Authenticator</label><select id="mfa-device" className={styles.input} value={factorId} onChange={e=>setFactorId(e.target.value)}>{factors.map((f,index)=><option key={f.id} value={f.id}>{factorLabel(f,index)}</option>)}</select></div>}
        <div className={styles.fieldGroup}><label htmlFor="mfa-code">6-digit code</label><input id="mfa-code" className={styles.input} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus disabled={busy}/></div>
        <button className={styles.submitButton} type="submit" disabled={busy||code.length!==6}>{busy?'Verifying…':'Verify'}</button>
      </form>}
      {status.verified&&!setup&&<p className={styles.mfaEnabled}>Enabled</p>}
      {status.verified&&!setup&&factors.map((f,index)=><div className={styles.mfaDevice} key={f.id}><span className={styles.mfaDeviceInfo}><strong>{factorLabel(f,index)}</strong>{factorDate(f)&&<span>Added {factorDate(f)}</span>}</span><button type="button" className={styles.textLink} disabled={busy||factors.length<2} onClick={()=>void remove(f.id)}>Remove</button></div>)}
      {status.verified&&!setup&&<button className={styles.backLink} type="button" onClick={enroll} disabled={busy}>Add backup authenticator</button>}
      {!embedded&&status.verified&&!setup&&<button className={styles.backLink} type="button" onClick={()=>navigate(DEFAULT_ADMIN_ROUTE,{replace:true})}>Continue to portal</button>}
      <p className={styles.mfaHelp}>Lost access? Contact your CheckIt administrator.</p>
    </>}
    {!embedded&&<button className={styles.backLink} type="button" onClick={()=>void leavePortal(supabase)} disabled={busy}>Sign out</button>}
  </>;
  return embedded?<section className={styles.embeddedSecurity} aria-labelledby="mfa-title">{content}</section>:<main className={styles.page} aria-labelledby="mfa-title"><div className={styles.card}>{content}</div></main>;
}
