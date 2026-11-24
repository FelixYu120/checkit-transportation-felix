import test, {after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {JSDOM} from 'jsdom';
import {createClient} from '@supabase/supabase-js';
import {readEmailCallback, resolveEmailCallback} from './authRedirect.js';
import {finishPasswordSetup} from './portalExit.js';

const dom = new JSDOM('<!doctype html><body></body>', {url:'https://platform.example/signup'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document});
const previousChannel=globalThis.BroadcastChannel;
globalThis.BroadcastChannel=undefined;
const clients=[];
afterEach(async()=>{for(const client of clients.splice(0)) await client.auth.stopAutoRefresh();});
after(()=>{dom.window.close();globalThis.BroadcastChannel=previousChannel;});
const subject='00000000-0000-0000-0000-000000000001';
const user={id:subject,email:'member@example.test',aud:'authenticated',role:'authenticated'};
let fixtureId=0;
function fixture({implicit=true,reject=false,storedSession=null}={}) {
  const payload={sub:subject,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600};
  const access=[Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),Buffer.from(JSON.stringify(payload)).toString('base64url'),'fixture'].join('.');
  const session={access_token:access,refresh_token:'fixture-refresh',expires_in:3600,expires_at:payload.exp,token_type:'bearer',user};
  const key=`email-flow-${++fixtureId}`;
  const storage=new Map(storedSession?[[key,JSON.stringify(storedSession)]]:[]);
  const requests=[];
  const client=createClient('https://auth.example.invalid','fixture-public-key',{
    auth:{storageKey:key,persistSession:true,autoRefreshToken:false,detectSessionInUrl:implicit,storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}},
    global:{fetch:async(url,options={})=>{
      const path=new URL(url).pathname;
      requests.push({path,method:options.method,body:options.body&&JSON.parse(options.body)});
      if(path==='/auth/v1/verify') return new Response(JSON.stringify(reject?{code:'otp_expired',error_code:'otp_expired',msg:'Email link is invalid or has expired'}:session),{status:reject?403:200,headers:{'Content-Type':'application/json'}});
      if(path==='/auth/v1/user') return new Response(JSON.stringify(user),{status:200,headers:{'Content-Type':'application/json'}});
      if(path==='/auth/v1/logout') return new Response(null,{status:204});
      if(path==='/auth/v1/token') return new Response(JSON.stringify(session),{status:200,headers:{'Content-Type':'application/json'}});
      throw new Error(`Unexpected Auth request ${path}`);
    }},
  });
  clients.push(client);
  return {client,requests,session,storage,key};
}

for(const type of ['invite','magiclink','recovery']) test(`${type} token is exchanged once, then credentials are required after setup`,async()=>{
  const pathname=type==='recovery'?'/reset-password':'/signup';
  window.history.replaceState(null,'',`${pathname}#token_hash=fixture-token-hash&type=${type}`);
  const callback=readEmailCallback(window.location);
  const {client,requests}=fixture();
  const one=resolveEmailCallback(client,callback);
  const two=resolveEmailCallback(client,callback);
  assert.equal(one,two);
  const result=await one;
  assert.equal(result.data.session.user.id,subject);
  assert.equal(callback.redirectPath,type==='recovery'?'/set-password':'/create-account');
  assert.deepEqual(requests.filter(r=>r.path==='/auth/v1/verify').map(r=>({token_hash:r.body.token_hash,type:r.body.type})),[{token_hash:'fixture-token-hash',type}]);
  assert.equal((await client.auth.getSession()).data.session.user.id,subject);
  const redirects=[];
  await finishPasswordSetup(client,()=>redirects.push('/login'));
  assert.deepEqual(redirects,['/login']);
  assert.equal((await client.auth.getSession()).data.session,null);
  await client.auth.signInWithPassword({email:user.email,password:'new-fixture-password'});
  assert.equal(requests.find(r=>r.path==='/auth/v1/token').body.password,'new-fixture-password');
});

test('an expired email token is not treated as an existing login session',async()=>{
  window.history.replaceState(null,'','/signup#token_hash=expired-fixture&type=invite');
  const callback=readEmailCallback(window.location);
  const {client}=fixture({reject:true});
  await assert.rejects(resolveEmailCallback(client,callback),/invite_expired/);
});

test('a legacy implicit invite persists its session before routing to signup',async()=>{
  window.history.replaceState(null,'','/login');
  const initial=fixture();
  await initial.client.auth.stopAutoRefresh();
  const hash=new URLSearchParams({...initial.session,user:undefined,type:'invite'});
  window.history.replaceState(null,'',`/login#${hash}`);
  const callback=readEmailCallback(window.location);
  const {client,requests}=fixture({implicit:true});
  const result=await resolveEmailCallback(client,callback);
  assert.equal(result.data.session.user.id,subject);
  assert.equal(callback.redirectPath,'/create-account');
  assert.equal(window.location.hash,'');
  assert.equal(requests.filter(r=>r.path==='/auth/v1/verify').length,0);
});

test('legacy verification errors are preserved rather than silently becoming a blank login',async()=>{
  const callback=readEmailCallback({pathname:'/create-account',hash:'#error=access_denied&error_code=otp_expired&error_description=Expired'});
  assert.equal(callback.failureNotice,'invite_expired');
  await assert.rejects(resolveEmailCallback({auth:{getSession:()=>{throw new Error('Must not reuse a saved session');}}},callback),/invite_expired/);
});

test('a stale saved session cannot satisfy a different implicit invitation token',async()=>{
  window.history.replaceState(null,'','/login');
  const previous=fixture();
  const oldUserId='00000000-0000-0000-0000-000000000002';
  const oldPayload={sub:oldUserId,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600};
  const oldToken=[Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),Buffer.from(JSON.stringify(oldPayload)).toString('base64url'),'stored-fixture'].join('.');
  const storedSession={...previous.session,access_token:oldToken,user:{...user,id:oldUserId}};
  const {client}=fixture({storedSession});
  assert.equal((await client.auth.getSession()).data.session.user.id,oldUserId);
  await assert.rejects(resolveEmailCallback(client,readEmailCallback({pathname:'/signup',hash:'#access_token=other-account-token&type=invite'})),/invite_invalid/);
});
