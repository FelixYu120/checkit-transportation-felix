import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeamRemovalHandler } from '../server/team-removal.js';

const actor = '00000000-0000-0000-0000-000000000001';
const member = '00000000-0000-0000-0000-000000000002';
const response = () => ({ statusCode:200, headers:{}, setHeader(k,v){this.headers[k]=v;}, status(v){this.statusCode=v;return this;},json(v){this.payload=v;return this;},end(){return this;} });
const request = (body={memberId:member}, token='verified-token') => ({method:'POST',headers:token?{authorization:`Bearer ${token}`}:{},body});
const setup = ({files=[],failAt='',confirmation=true}={}) => {
  const calls=[];
  return {calls,handler:createTeamRemovalHandler(async(path,options={})=>{
    calls.push({path,...options});
    if(path===failAt) throw Object.assign(new Error('Denied or unavailable'),{status:403});
    if(path==='/auth/v1/user') return {id:actor};
    if(path.endsWith('prepare_team_account_removal')) return {target_id:member,personal_objects:files};
    if(path.endsWith('finish_team_account_removal')) return confirmation;
    return [];
  })};
};

test('unauthenticated, malformed and unsupported requests cannot start deletion',async()=>{
  const {handler,calls}=setup();
  for(const [req,status] of [[request({},''),401],[request({memberId:'not-a-uuid'}),400],[request('{bad'),400],[{...request(),method:'GET'},405]]) {
    const res=response(); await handler(req,res); assert.equal(res.statusCode,status);
  }
  assert.equal(calls.length,0);
});
test('actor identity comes from verified Auth, preparation uses caller authority, finalization uses server authority',async()=>{
  const {handler,calls}=setup();const res=response();
  await handler(request({memberId:member,actor_profile_id:'spoofed',role:'checkit_admin'}),res);
  assert.equal(res.statusCode,200);
  assert.deepEqual(res.payload,{ok:true,removed:true,memberId:member});
  assert.equal(calls[0].token,'verified-token');
  assert.equal(calls[1].token,'verified-token');
  assert.equal(calls[2].token,'verified-token');
  assert.equal(calls[3].token,undefined);
  assert.deepEqual(calls[3].body,{actor_profile_id:actor,target_profile_id:member});
  assert.equal(res.headers['Cache-Control'],'no-store');
});
test('personal photos are physically removed in bounded batches before account deletion',async()=>{
  const files=Array.from({length:201},(_,i)=>({bucket_id:'profile-photos',name:`${member}/${i}.webp`}));
  const {handler,calls}=setup({files});const res=response();await handler(request(),res);
  const removals=calls.filter(c=>c.path.startsWith('/storage/'));
  assert.deepEqual(removals.map(c=>c.body.prefixes.length),[100,100,1]);
  assert.equal(removals.every(c=>c.method==='DELETE'),true);
  assert.match(calls.at(-1).path,/finish_team_account_removal$/);
  assert.equal(res.payload.removed,true);
});
test('a storage failure leaves cleanup retryable and never reports account deletion',async()=>{
  const {handler,calls}=setup({files:[{bucket_id:'profile-photos',name:`${member}/photo.webp`}],failAt:'/storage/v1/object/profile-photos'});
  const res=response();await handler(request(),res);
  assert.equal(res.payload.retryable,true);assert.match(res.payload.error,/Could not remove user/);
  assert.equal(calls.some(c=>c.path.endsWith('finish_team_account_removal')),false);
});
test('permission rejection cannot delete files or finalize',async()=>{
  const {handler,calls}=setup({failAt:'/rest/v1/rpc/prepare_team_account_removal'});
  const res=response();await handler(request(),res);
  assert.equal(res.statusCode,403);assert.equal(calls.length,3);
});
test('an unconfirmed finalization or unexpected company file cannot report success',async()=>{
  for(const config of [{confirmation:false},{files:[{bucket_id:'firmware',name:'company.bin'}]}]) {
    const {handler,calls}=setup(config);const res=response();await handler(request(),res);
    assert.equal(res.payload.ok,undefined);assert.equal(res.payload.retryable,true);
    assert.equal(calls.some(c=>c.path==='/storage/v1/object/firmware'),false);
  }
});


test('MFA failure cannot start removal or delete personal files',async()=>{
 const {handler,calls}=setup({failAt:'/rest/v1/rpc/require_mfa'});const res=response();await handler(request(),res);
 assert.equal(res.statusCode,403);assert.equal(calls.length,2);assert.equal(calls.some(c=>c.path.includes('prepare_team')||c.path.includes('/storage/')),false);
});
