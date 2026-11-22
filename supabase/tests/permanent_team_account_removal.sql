\set ON_ERROR_STOP on
-- Synthetic, transactional fixtures. Never run this against a hosted database.
-- Run through run_permanent_removal.py to keep both migrations inside the fixture transaction.
begin;
do $$ begin if current_database()<>'checkit_permanent_removal_test' then
  raise exception 'Use the isolated checkit_permanent_removal_test database.'; end if; end $$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create schema storage;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.email() returns text language sql stable as $$ select current_setting('request.jwt.claim.email',true) $$;
grant usage on schema auth to authenticated,service_role;
grant execute on all functions in schema auth to authenticated,service_role;
create table auth.users(id uuid primary key,email text,encrypted_password text,raw_user_meta_data jsonb default '{}');
create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade);
create table auth.refresh_tokens(id uuid primary key,session_id uuid references auth.sessions on delete cascade,user_id text);
create table auth.identities(user_id uuid references auth.users on delete cascade);
create table auth.mfa_factors(user_id uuid references auth.users on delete cascade);
create table auth.scim_users(user_id uuid references auth.users on delete set null,resource jsonb);
create table public.profile(id uuid primary key references auth.users on delete cascade,email text,full_name text,role text,assigned_institute varchar);
create table storage.buckets(id text primary key,owner uuid,owner_id text);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text);
alter table storage.objects enable row level security;
create table public.saved_reports(id uuid primary key default gen_random_uuid(),title text,author text,date text,period text,layout_data jsonb,
 owner_id uuid references auth.users on delete set null,assigned_institute varchar,shared_with_emails text[] default '{}',shared_access jsonb default '{}',updated_at timestamptz default now());
\i :workflow_file
\i :migration_file
\i :retirement_file
create function pg_temp.assert_true(value boolean,message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception '%',message; end if; end $$;
create function pg_temp.denied(statement text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then return; end;
  raise exception 'Unexpected success: %',statement;
end $$;
insert into auth.users(id,email,encrypted_password) values
 ('00000000-0000-0000-0000-000000000001','global@example.test','hash-global'),
 ('00000000-0000-0000-0000-000000000002','admin@example.test','hash-admin'),
 ('00000000-0000-0000-0000-000000000003','removed@example.test','old-password-hash'),
 ('00000000-0000-0000-0000-000000000004','outsider@example.test','hash-other'),
 ('00000000-0000-0000-0000-000000000005','protected@example.test','hash-protected');
insert into profile select id,email,case when id='00000000-0000-0000-0000-000000000003' then 'Removed Person' else email end,
 case when id='00000000-0000-0000-0000-000000000001' then 'checkit_admin'
 when id='00000000-0000-0000-0000-000000000003' then 'viewer' else 'admin' end,
 case when id='00000000-0000-0000-0000-000000000004' then 'other' else 'ucsd' end from auth.users;
insert into auth.sessions values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003');
insert into auth.refresh_tokens values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003');
insert into auth.refresh_tokens values('20000000-0000-0000-0000-000000000002',null,'00000000-0000-0000-0000-000000000003');
insert into auth.identities values('00000000-0000-0000-0000-000000000003');
insert into auth.mfa_factors values('00000000-0000-0000-0000-000000000003');
insert into auth.scim_users values('00000000-0000-0000-0000-000000000003','{"userName":"removed@example.test"}');
insert into storage.buckets values('firmware','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000003');
insert into storage.objects(bucket_id,name,owner,owner_id) values
 ('firmware','company.bin','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000003'),
 ('profile-photos','00000000-0000-0000-0000-000000000003/old.webp',null,null),
 ('profile-photos','orphan.webp',null,'00000000-0000-0000-0000-000000000003');
insert into saved_reports(id,title,author,owner_id,assigned_institute,shared_with_emails,shared_access,layout_data) values
 ('30000000-0000-0000-0000-000000000001','Company report','Removed Person','00000000-0000-0000-0000-000000000003','ucsd',
 array['removed@example.test','REMOVED@example.test','admin@example.test'],
 '{"removed@example.test":"editor","REMOVED@example.test":"viewer","admin@example.test":"editor"}',
 '{"author":"Removed Person","elements":[{"value":42}],"members":["removed@example.test"]}');
insert into insight_report_versions(id,report_id,version_number,status,submitted_by,reviewer_id,reviewed_by,published_by,snapshot) values
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'published',
 '00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002',
 '00000000-0000-0000-0000-000000000003','{"author":"Removed Person","values":[42]}'),
 ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',2,'reviewed',
 '00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000003',null,'{}');
insert into insight_report_comments(report_id,body,author_id,author_label) values
 ('30000000-0000-0000-0000-000000000001','Keep company finding.','00000000-0000-0000-0000-000000000003','Removed Person');
insert into insight_report_actions(report_id,title,assigned_to,created_by,due_date) values
 ('30000000-0000-0000-0000-000000000001','Follow up','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000003','2026-12-01');
insert into insight_report_events(report_id,event,actor_id,actor_label,detail) values
 ('30000000-0000-0000-0000-000000000001','saved','00000000-0000-0000-0000-000000000003','Removed Person','{"email":"removed@example.test"}');

-- A missing receiving institution administrator fails before revocation.
update profile set assigned_institute='sole-institution' where id='00000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.denied($q$select public.prepare_team_account_removal('00000000-0000-0000-0000-000000000003')$q$);
select pg_temp.assert_true((select assigned_institute='sole-institution' from profile where id='00000000-0000-0000-0000-000000000003'),'Company records cannot be transferred across institutions');
update profile set assigned_institute='ucsd' where id='00000000-0000-0000-0000-000000000003';
-- Every non-administrative caller is denied, even with a real Auth identity.
do $$ declare tested_role text; begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
  foreach tested_role in array array['viewer','user','field_operator','checkit_field_operator'] loop
    update profile set role=tested_role where id='00000000-0000-0000-0000-000000000005';
    perform pg_temp.denied($q$select public.prepare_team_account_removal('00000000-0000-0000-0000-000000000003')$q$);
  end loop;
  update profile set role='admin' where id='00000000-0000-0000-0000-000000000005';
end $$;

-- Permission boundaries and the old detach-only entry point.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select pg_temp.denied($q$select public.prepare_team_account_removal('00000000-0000-0000-0000-000000000003')$q$);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.denied($q$select public.prepare_team_account_removal('00000000-0000-0000-0000-000000000002')$q$);
select pg_temp.denied($q$select public.prepare_team_account_removal('00000000-0000-0000-0000-000000000005')$q$);
select pg_temp.denied($q$select public.remove_team_member('00000000-0000-0000-0000-000000000003')$q$);
select pg_temp.denied($q$select public.finish_team_account_removal('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003')$q$);
select pg_temp.assert_true(public.portal_account_ready(),'Existing password accounts remain ready');
select pg_temp.assert_true(jsonb_array_length(public.prepare_team_account_removal('00000000-0000-0000-0000-000000000003')->'personal_objects')=2,'All orphaned/prefixed personal photos are queued');
select pg_temp.assert_true((select count(*)=1 from public.pending_team_account_removals()),'An interrupted removal remains retryable after reload');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.denied($q$select public.prepare_team_account_removal('00000000-0000-0000-0000-000000000002')$q$);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.assert_true(jsonb_array_length(public.prepare_team_account_removal('00000000-0000-0000-0000-000000000003')->'personal_objects')=2,'Preparation is retryable');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select pg_temp.assert_true(not public.can_upload_account_files(),'Old JWTs cannot re-upload photos during cleanup');
reset role;
select pg_temp.assert_true((select role='viewer' and assigned_institute is null from profile where id='00000000-0000-0000-0000-000000000003'),'All membership privileges revoked before cleanup');
select pg_temp.denied($q$update profile set role='admin',assigned_institute='ucsd' where id='00000000-0000-0000-0000-000000000003'$q$);
select pg_temp.denied($q$update profile set full_name='Changed' where id='00000000-0000-0000-0000-000000000003'$q$);
select set_config('request.jwt.claim.sub','',true);
set role service_role;
select pg_temp.denied($q$select public.finish_team_account_removal('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003')$q$);
reset role;
select pg_temp.assert_true(exists(select 1 from auth.users where id='00000000-0000-0000-0000-000000000003'),'Cleanup failure never claims account deletion');
-- Only the synthetic Storage mock is deleted here. Production uses the Storage API.
delete from storage.objects where bucket_id='profile-photos';
set role service_role;
select pg_temp.assert_true(public.finish_team_account_removal('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003'),'Authorized server finalization succeeds');
reset role;
select pg_temp.assert_true(not exists(select 1 from auth.users where email='removed@example.test'),'Login account and old password removed');
select pg_temp.assert_true(not exists(select 1 from profile where id='00000000-0000-0000-0000-000000000003'),'Profile removed');
select pg_temp.assert_true((select count(*)=0 from auth.sessions) and (select count(*)=0 from auth.refresh_tokens)
 and (select count(*)=0 from auth.identities) and (select count(*)=0 from auth.mfa_factors) and (select count(*)=0 from auth.scim_users),'Sessions and identity records removed');
select pg_temp.assert_true((select count(*)=0 from checkit_accounts_private.removals),'Temporary removal record is deleted too');
select pg_temp.assert_true((select owner_id='00000000-0000-0000-0000-000000000002' and author='Former member'
 and shared_with_emails=array['admin@example.test'] and shared_access='{"admin@example.test":"editor"}'::jsonb
 and layout_data->'elements'='[{"value":42}]'::jsonb from saved_reports),'Company report transferred without stale identity or email grants');
select pg_temp.assert_true((select count(*)=1 from storage.objects where name='company.bin' and owner_id='00000000-0000-0000-0000-000000000002'),'Company firmware preserved with new ownership');
select pg_temp.assert_true((select count(*)=2 from insight_report_versions),'Report history preserved');
select pg_temp.assert_true((select submitted_by is null and published_by is null and snapshot->>'author'='Former member'
 from insight_report_versions where version_number=1),'Published historical identity is redacted');
select pg_temp.assert_true((select reviewer_id is null and reviewed_by is null from insight_report_versions where version_number=2),'Deleted reviewers are anonymized');
select pg_temp.assert_true((select author_id is null and author_label='Former member' and body='Keep company finding.' from insight_report_comments),'Company comments preserved without author identity');
select pg_temp.assert_true((select assigned_to is null and created_by is null from insight_report_actions),'Follow-up work remains unassigned');
select pg_temp.assert_true((select actor_id is null and actor_label='Former member' and detail->>'email'='Former member' from insight_report_events),'Workflow event identity removed');
select pg_temp.denied($q$update insight_report_versions set snapshot='{"tampered":true}' where version_number=1$q$);
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select pg_temp.assert_true(not public.can_upload_account_files() and not public.portal_account_ready(),'Deleted JWT identity remains denied');
reset role;
-- Reinvitation creates a new UUID with no old credential and no inherited shares.
insert into auth.users(id,email,encrypted_password) values('00000000-0000-0000-0000-000000000009','removed@example.test','');
insert into profile values('00000000-0000-0000-0000-000000000009','removed@example.test',null,'viewer','ucsd');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000009',true);
select pg_temp.assert_true(not public.portal_account_ready(),'Reinvited email must choose a new password');
reset role;
update auth.users set encrypted_password='new-password-hash' where id='00000000-0000-0000-0000-000000000009';
set role authenticated;
select pg_temp.assert_true(public.portal_account_ready(),'Fresh setup unlocks portal access');
reset role;
-- CheckIt-wide administrators retain authority over elevated roles across institutions.
update profile set assigned_institute='other' where id='00000000-0000-0000-0000-000000000005';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select public.prepare_team_account_removal('00000000-0000-0000-0000-000000000005');
reset role;
select set_config('request.jwt.claim.sub','',true);
set role service_role;
select pg_temp.assert_true(public.finish_team_account_removal('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005'),'Global administrators can remove elevated roles across institutions');
reset role;
select pg_temp.assert_true(not has_function_privilege('anon','public.prepare_team_account_removal(uuid)','execute'),'Anonymous removals denied');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.finish_team_account_removal(uuid,uuid)','execute'),'Finalization is server-only');
rollback;
\echo Permanent account removal checks passed.
