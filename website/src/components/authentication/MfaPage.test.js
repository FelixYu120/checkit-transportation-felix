import test,{after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Buffer} from 'node:buffer';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {transformWithEsbuild} from 'vite';
import {readMfaStatus,verifyAuthenticator,qrImage} from './mfa.js';
const dom=new JSDOM('<!doctype html><body/>',{url:'https://example.test/security'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
const fixture=globalThis.__mfaTest={};
const reset=()=>Object.assign(fixture,{status:{user_id:'owner',ready:true,required:true,enrolled:false,verified:false},factors:[],navigations:[],calls:[],codeError:false,enrollError:false});reset();
const client=fixture.client={
 rpc:async name=>{fixture.calls.push(name);return {data:name==='mfa_access_status'?{...fixture.status}:null,error:null};},
 auth:{onAuthStateChange:fn=>{fixture.event=fn;return {data:{subscription:{unsubscribe(){}}}}},
 mfa:{listFactors:async()=>({data:{totp:fixture.factors,all:fixture.factors}}),
 enroll:async()=>{fixture.calls.push('enroll');return fixture.enrollError?{error:new Error('Try again.')}:{data:{id:'new-factor',totp:{qr_code:'<svg xmlns="http://www.w3.org/2000/svg"></svg>',secret:'SYNTHETICSEED'}}};},
 challengeAndVerify:async input=>{fixture.calls.push(input);if(fixture.codeError)return {error:new Error('Invalid code.')};fixture.status.verified=true;fixture.status.enrolled=true;return {data:{}};},
 unenroll:async()=>({error:null})}}
};
const react=import.meta.resolve('react');const mod=s=>`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
const source=(await transformWithEsbuild(await readFile(new URL('./MfaPage.jsx',import.meta.url),'utf8'),'MfaPage.jsx',{loader:'jsx',jsx:'transform'})).code;
const code=source.replace(/(^import\s+([\s\S]*?)\s+from\s*)(["'])([^"']+)\3/gm,(_m,prefix,_clause,_q,path)=>{
 let url;
 if(path==='react')url=react;
 else if(path==='react-router-dom')url=mod("export const useNavigate=()=>globalThis.__mfaTest.navigate;");
 else if(path.endsWith('mfa.js'))url=new URL('./mfa.js',import.meta.url).href;
 else if(path.includes('SupabaseClients'))url=mod('export default globalThis.__mfaTest.client;');
 else if(path.includes('AdminRouteUtils'))url=mod("export const DEFAULT_ADMIN_ROUTE='/dashboard/ucsd';");
 else if(path.endsWith('.css'))url=mod('export default new Proxy({},{get:(_,key)=>String(key)});');
 else if(path.includes('portalExit'))url=mod("export const leavePortal=async()=>globalThis.__mfaTest.navigations.push('/login');");
 else throw new Error(path);
 return prefix+JSON.stringify(url);
});
fixture.navigate=path=>fixture.navigations.push(path);
const {default:MfaPage}=await import(mod(code));const {createRoot}=await import('react-dom/client');let root;
afterEach(async()=>{if(root)await act(async()=>root.unmount());root=null;reset();});after(()=>dom.window.close());
const mount=async(props={})=>{document.body.innerHTML='<div id="root"></div>';root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(MfaPage,props)));};
const clickText=async text=>act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent===text).click());
const enter=async code=>act(async()=>{const input=document.getElementById('mfa-code');Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,code);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
const submit=async()=>act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));

test('setup is user initiated, shows a local QR, then verified enrollment reaches the portal',async()=>{
 await mount();assert.equal(fixture.calls.includes('enroll'),false);await clickText('Set up authenticator');
 assert.match(document.querySelector('.mfaQr').src,/^data:image\/svg\+xml/);assert.equal(window.location.hash,'');
 await enter('123456');await submit();assert.ok(fixture.calls.includes('confirm_my_mfa_enrollment'));assert.deepEqual(fixture.navigations,['/dashboard/ucsd']);assert.equal(document.querySelector('.mfaQr'),null);
});
test('an incorrect code stays on MFA and permits retry',async()=>{
 fixture.factors=[{id:'verified-factor',status:'verified'}];fixture.status.enrolled=true;fixture.codeError=true;
 await mount();await enter('123456');await submit();assert.match(document.querySelector('[role="alert"]').textContent,/Invalid code/);assert.equal(fixture.navigations.length,0);assert.equal(document.getElementById('mfa-code').value,'');assert.equal(document.querySelector('[type="submit"]').disabled,true);
});
test('leaving the document clears setup secrets and codes before browser caching',async()=>{
 await mount();await clickText('Set up authenticator');await enter('123456');await act(async()=>window.dispatchEvent(new window.PageTransitionEvent('pagehide',{persisted:true})));assert.equal(document.body.textContent.includes('SYNTHETICSEED'),false);assert.equal(document.querySelector('.mfaQr'),null);
});
test('a service error cannot activate enrollment',async()=>{
 fixture.enrollError=true;await mount();await clickText('Set up authenticator');assert.ok(document.querySelector('[role="alert"]'));assert.equal(document.querySelector('.mfaQr'),null);assert.equal(fixture.calls.includes('confirm_my_mfa_enrollment'),false);
});
test('codes are validated before reaching Auth',async()=>{
 await assert.rejects(verifyAuthenticator(client,'id','123','owner'),/6-digit/);assert.equal(fixture.calls.length,0);
});
test('an unconfirmed or different-account response cannot activate MFA',async()=>{
 fixture.status.user_id='someone-else';await assert.rejects(verifyAuthenticator(client,'id','123456','owner'),/could not be confirmed/);assert.equal(fixture.calls.includes('confirm_my_mfa_enrollment'),false);
});
test('missing server policy fails closed',async()=>{
 await assert.rejects(readMfaStatus({rpc:async()=>({data:{}})}),/unavailable/);
});
test('QR images cannot load remote URLs',()=>{
 assert.throws(()=>qrImage('https://attacker.example/qr'),/unavailable/);
});


test('an already-verified session can manage security and return without another code',async()=>{
 fixture.status.verified=true;fixture.status.enrolled=true;fixture.factors=[{id:'factor',status:'verified',friendly_name:'Primary'}];
 await mount();assert.equal(document.querySelector('form'),null);assert.equal(document.getElementById('mfa-title').textContent,'Security');
 await clickText('Continue to portal');assert.deepEqual(fixture.navigations,['/dashboard/ucsd']);
});


test('embedded enrollment verifies with Auth then completes in the profile dialog',async()=>{
 let completed=0;const busy=[];
 await mount({embedded:true,onVerified:()=>completed++,onBusyChange:value=>busy.push(value)});
 assert.equal(document.querySelector('main'),null);
 await clickText('Set up authenticator');await enter('123456');await submit();
 assert.equal(completed,1);assert.deepEqual(fixture.navigations,[]);
 assert.ok(fixture.calls.includes('confirm_my_mfa_enrollment'));
 assert.ok(busy.includes(true));assert.equal(busy.at(-1),false);
});

test('embedded security retains backup setup and keeps incorrect codes outside the portal',async()=>{
 fixture.status.verified=true;fixture.status.enrolled=true;fixture.factors=[{id:'primary',status:'verified',friendly_name:'Primary'}];
 let completed=0;
 await mount({embedded:true,onVerified:()=>completed++});
 await clickText('Add backup authenticator');fixture.codeError=true;
 await enter('123456');await submit();
 assert.equal(completed,0);assert.equal(fixture.navigations.length,0);
 assert.match(document.querySelector('[role="alert"]').textContent,/Invalid code/);
 assert.ok(document.querySelector('.mfaQr'));
});
