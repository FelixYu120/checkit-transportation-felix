import test,{afterEach}from'node:test';
import assert from'node:assert/strict';
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-role-key';
process.env.APP_PUBLIC_URL='https://transportation.example';
const {default:rawHandler}=await import('../api/team/invite.js');
const originalFetch=global.fetch;
let state;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
afterEach(()=>{global.fetch=originalFetch;});
function setup(options={}) {
  state={role:'admin',institute:'ucsd',target:null,confirmed:false,completed:false,requests:[],...options};
  global.fetch=async(input,options={})=>{
    const url=new URL(input);const path=url.pathname;
    const body=options.body?JSON.parse(options.body):null;
    state.requests.push({url,path,body,options});
    if(path==='/rest/v1/rpc/require_mfa') { assert.equal(options.headers.Authorization,'Bearer caller-token'); return state.mfaError?json({message:'Authenticator verification required.'},403):json(null); }
    if(path==='/auth/v1/user') {
      assert.equal(options.headers.Authorization,'Bearer caller-token');
      return json({id:'verified-actor'});
    }
    if(path==='/rest/v1/rpc/find_invite_profile_by_email'||(path==='/rest/v1/profile'&&url.searchParams.has('email'))) return json(state.target?[state.target]:[]);
    if(path==='/rest/v1/profile'&&(!options.method||options.method==='GET')) return json([{id:'verified-actor',role:state.role,assigned_institute:state.institute}]);
    if(path==='/rest/v1/rpc/authorize_invitation_delivery') {
      assert.equal(body.actor_profile_id,'verified-actor');
      return json({setup_required:Boolean(body.target_profile_id)&&!state.completed,delivery_started_at:'2026-11-23T00:00:00Z'});
    }
    if(path.startsWith('/auth/v1/admin/users/')) return json({id:state.target.id,email:state.mismatchedAuth?'other@example.test':state.target.email,email_confirmed_at:state.confirmed?'2026-11-22T00:00:00Z':null});
    if(path==='/auth/v1/invite'||path==='/auth/v1/otp') {
      assert.equal(options.headers.Authorization,'Bearer test-service-role-key');
      if(state.mailError)return json({message:'Email delivery failed.'},502);
      if(state.duplicate)return json({message:'A user with this email address has already been registered'},422);
      return json(state.missingIdentity?{}:{id:state.target?.id||'fresh-account',email:body.email});
    }
    if(path==='/rest/v1/profile'&&options.method==='POST') return json(state.profileError?[]:body);
    if(path==='/rest/v1/rpc/record_invitation_delivery') {
      assert.equal(options.headers.Authorization,'Bearer test-service-role-key');
      assert.equal(body.actor_profile_id,'verified-actor');
      assert.equal(body.delivery_started_at,'2026-11-23T00:00:00Z');
      return state.recordError?json({message:'Delivery could not be recorded.'},503):json({setup_required:true});
    }
    throw new Error(`Unexpected request ${options.method||'GET'} ${path}`);
  };
}
async function invoke(body={email:'new@example.test',role:'viewer'},token='caller-token', handler=rawHandler) {
  const res={headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(code){this.statusCode=code;return this;},json(payload){this.payload=payload;return this;},end(){return this;}};
  await handler({method:'POST',headers:token?{authorization:`Bearer ${token}`}:{},body},res);
  return res;
}
const writes=()=>state.requests.filter(r=>['POST','PATCH','DELETE'].includes(r.options.method)&&!r.path.startsWith('/rest/v1/rpc/authorize')&&r.path!=='/rest/v1/rpc/require_mfa');
const emails=()=>state.requests.filter(r=>['/auth/v1/invite','/auth/v1/otp'].includes(r.path));

test('invites require a verified authenticated administrator',async()=>{
  setup();assert.equal((await invoke(undefined,'')).statusCode,401);assert.equal(state.requests.length,0);
  setup({role:'viewer'});assert.equal((await invoke()).statusCode,403);assert.equal(writes().length,0);
});
for(const role of ['viewer','field_operator'])test(`an institution administrator can invite ${role} with a fresh identity`,async()=>{
  setup();const res=await invoke({email:' NEW@Example.Test ',role,assigned_institute:'other'});
  assert.equal(res.statusCode,200);assert.equal(res.payload.ok,true);assert.equal(res.payload.email,'new@example.test');
  const sent=emails()[0];assert.equal(new URL(sent.url).searchParams.get('redirect_to'),process.env.APP_PUBLIC_URL+'/signup');
  assert.equal(sent.body.data.assigned_institute,'ucsd');assert.equal(sent.body.data.role,role);
  const stored=state.requests.find(r=>r.path==='/rest/v1/profile'&&r.options.method==='POST');
  assert.equal(stored.body[0].id,'fresh-account');assert.equal(stored.body[0].role,role);
  assert.equal(state.requests.at(-1).path,'/rest/v1/rpc/record_invitation_delivery');
});
for(const role of ['admin','checkit_admin','checkit_field_operator'])test(`institution administrators cannot grant ${role}`,async()=>{
  setup();assert.equal((await invoke({email:'new@example.test',role})).statusCode,403);assert.equal(writes().length,0);
});
for(const role of ['admin','checkit_admin','checkit_field_operator','field_operator','viewer'])test(`system administrators can grant ${role}`,async()=>{
  setup({role:'checkit_admin'});assert.equal((await invoke({email:'new@example.test',role})).statusCode,200);
});
for(const confirmed of [false,true])test(`unfinished ${confirmed?'confirmed':'unconfirmed'} invitations resend to signup without changing roles`,async()=>{
  setup({confirmed,target:{id:'pending-account',email:'new@example.test',role:'viewer',assigned_institute:'ucsd'}});
  const res=await invoke({email:'new@example.test',role:'field_operator'});
  assert.equal(res.statusCode,200);assert.equal(res.payload.role,'viewer');
  assert.equal(emails()[0].path,confirmed?'/auth/v1/otp':'/auth/v1/invite');
  assert.equal(emails()[0].url.searchParams.get('redirect_to'),process.env.APP_PUBLIC_URL+'/signup');
  assert.equal(state.requests.some(r=>r.path==='/rest/v1/profile'&&r.options.method==='POST'),false);
});
test('completed active accounts cannot receive sign-in links or have passwords reset by Invite',async()=>{
  setup({confirmed:true,completed:true,target:{id:'existing',email:'new@example.test',role:'viewer',assigned_institute:'ucsd'}});
  const res=await invoke();assert.equal(res.statusCode,409);assert.equal(emails().length,0);assert.equal(writes().length,0);
});
test('a detached removed account is never silently restored',async()=>{
  setup({target:{id:'removed',email:'new@example.test',role:'viewer',assigned_institute:null}});
  assert.equal((await invoke()).statusCode,409);assert.equal(writes().length,0);
});
test('an orphaned Auth identity is never reused for a new invitation',async()=>{
  setup({duplicate:true});const res=await invoke();assert.equal(res.statusCode,409);
  assert.equal(state.requests.some(r=>r.path==='/auth/v1/admin/users'),false);
  assert.equal(state.requests.some(r=>r.path==='/rest/v1/profile'&&r.options.method==='POST'),false);
});
test('a removed email with no remaining account receives a fresh identity',async()=>{
  setup();assert.equal((await invoke({email:'removed@example.test',role:'viewer'})).statusCode,200);
  assert.equal(state.requests.find(r=>r.path==='/rest/v1/profile'&&r.options.method==='POST').body[0].id,'fresh-account');
});
test('cross-institution accounts and mismatched Auth identities are rejected before mail',async()=>{
  setup({target:{id:'other',email:'new@example.test',role:'viewer',assigned_institute:'other'}});
  assert.equal((await invoke()).statusCode,409);assert.equal(emails().length,0);
  setup({mismatchedAuth:true,target:{id:'existing',email:'new@example.test',role:'viewer',assigned_institute:'ucsd'}});
  assert.equal((await invoke()).statusCode,409);assert.equal(emails().length,0);
});
for(const failure of ['mailError','missingIdentity','profileError','recordError'])test(`${failure} cannot report a successful invitation`,async()=>{
  setup({[failure]:true});const res=await invoke();assert.ok(res.statusCode>=400);assert.notEqual(res.payload?.ok,true);
  if(failure!=='recordError')assert.equal(state.requests.some(r=>r.path==='/rest/v1/rpc/record_invitation_delivery'),false);
});
test('invalid email and unsupported roles do not send mail',async()=>{
  setup();assert.equal((await invoke({email:'invalid',role:'viewer'})).statusCode,400);assert.equal(emails().length,0);
  setup();assert.equal((await invoke({email:'new@example.test',role:'owner'})).statusCode,403);assert.equal(emails().length,0);
});

for(const publicUrl of ['https://custom.example', ' https://custom.example/old/login/ '])test(`invitation callback uses the public origin even with an old configured path: ${publicUrl}`,async()=>{
  const previous=process.env.APP_PUBLIC_URL;
  try {
    process.env.APP_PUBLIC_URL=publicUrl;
    const module=await import('../api/team/invite.js'+'?emailFlow='+encodeURIComponent(publicUrl));
    const handler=module.default;
    setup();const result=await invoke(undefined,'caller-token',handler);
    assert.equal(result.statusCode,200);
    assert.equal(emails()[0].url.searchParams.get('redirect_to'),'https://custom.example/signup');
  } finally {process.env.APP_PUBLIC_URL=previous;}
});

for(const [method,status] of [['OPTIONS',204],['GET',405],['HEAD',405]])test(`${method} cannot send an invitation`,async()=>{
  setup();const res={setHeader(){},status(code){this.statusCode=code;return this;},json(){return this;},end(){return this;}};
  await rawHandler({method,headers:{},body:{}},res);
  assert.equal(res.statusCode,status);assert.equal(state.requests.length,0);
});


test('system administrators can resend unfinished invitations across institutions without changing membership',async()=>{
  setup({role:'checkit_admin',confirmed:true,target:{id:'pending-other',email:'new@example.test',role:'field_operator',assigned_institute:'other'}});
  const res=await invoke({email:'new@example.test',role:'viewer'});
  assert.equal(res.statusCode,200);assert.equal(res.payload.role,'field_operator');
  assert.equal(emails()[0].path,'/auth/v1/otp');
  assert.equal(state.requests.some(r=>r.path==='/rest/v1/profile'&&r.options.method==='POST'),false);
});

test('delivery authorization failures stop resend before any email',async()=>{
  setup({target:{id:'no-longer-pending',email:'new@example.test',role:'viewer',assigned_institute:'ucsd'}});
  const baseFetch=global.fetch;
  global.fetch=async(input,options)=>{
    if(new URL(input).pathname==='/rest/v1/rpc/authorize_invitation_delivery'&&JSON.parse(options.body).target_profile_id) {
      return json({message:'User already has an account.'},409);
    }
    return baseFetch(input,options);
  };
  const res=await invoke();assert.equal(res.statusCode,409);assert.equal(emails().length,0);assert.equal(writes().length,0);
});


test('a password-only MFA-required session cannot send an invitation',async()=>{
 setup({mfaError:true});const res=await invoke();assert.equal(res.statusCode,403);assert.equal(emails().length,0);assert.equal(writes().length,0);
});
