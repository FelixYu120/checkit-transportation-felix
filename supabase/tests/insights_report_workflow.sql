\set ON_ERROR_STOP on
-- Run only against the isolated test database described in docs/insights-studio-workflow.md.
do $$ begin if current_database() <> 'checkit_insights_test' then raise exception 'Use the isolated checkit_insights_test database.'; end if; end $$;
do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; end $$;
do $$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.email() returns text language sql stable as $$ select current_setting('request.jwt.claim.email',true) $$;
grant usage on schema auth to authenticated,anon;
grant execute on all functions in schema auth to authenticated,anon;
create table public.profile(id uuid primary key,email text,full_name text,role text,assigned_institute varchar);
create table public.saved_reports(id uuid primary key default gen_random_uuid(),title text,author text,date text,period text,layout_data jsonb,
 owner_id uuid references profile(id),assigned_institute varchar,shared_with_emails text[] default '{}',shared_access jsonb default '{}',updated_at timestamptz default now());
alter table public.saved_reports enable row level security;
grant select,insert,update,delete on public.saved_reports to authenticated;
grant select on public.profile to authenticated;
create policy reports_select on public.saved_reports for select to authenticated using(owner_id=auth.uid() or auth.email()=any(shared_with_emails));
create policy reports_update on public.saved_reports for update to authenticated using(owner_id=auth.uid() or shared_access->>auth.email()='editor') with check(owner_id=auth.uid() or shared_access->>auth.email()='editor');
insert into profile values
 ('00000000-0000-0000-0000-000000000001','owner@example.test','Owner','admin','ucsd'),
 ('00000000-0000-0000-0000-000000000002','editor@example.test','Editor','admin','ucsd'),
 ('00000000-0000-0000-0000-000000000003','viewer@example.test','Viewer','viewer','ucsd'),
 ('00000000-0000-0000-0000-000000000004','outsider@example.test','Outsider','admin','other');
insert into saved_reports(id,title,author,date,period,layout_data,owner_id,assigned_institute,shared_with_emails,shared_access) values
 ('10000000-0000-0000-0000-000000000001','Traffic decision','Owner','2026-11-09','Last 7 Days',
 '{"version":2,"mode":"solo","elements":[{"id":"chart-1","type":"chart","snapshotData":[{"hasData":true,"occupancy":12}],"dataEvidence":{"sourceRows":1,"sources":["ten_minute_summaries"],"generatedAt":"2026-11-09T12:00:00Z","timezone":"America/Los_Angeles"}}],"reportSettings":{}}',
 '00000000-0000-0000-0000-000000000001','ucsd',array['editor@example.test','viewer@example.test','outsider@example.test'],
 '{"editor@example.test":"editor","viewer@example.test":"viewer","outsider@example.test":"editor"}');
\i :migration_file
create function pg_temp.assert_true(condition boolean,message text) returns void language plpgsql as $$ begin if condition is distinct from true then raise exception '%',message; end if; end $$;
create function pg_temp.denied(statement text) returns void language plpgsql as $$ begin execute statement; raise exception 'Unexpected success: %',statement; exception when insufficient_privilege or raise_exception or check_violation or not_null_violation then if sqlerrm like 'Unexpected success:%' then raise; end if; end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false), set_config('request.jwt.claim.email','owner@example.test',false);
select pg_temp.denied($q$select public.insights_report_command('10000000-0000-0000-0000-000000000001','submit','{"reviewer_id":"00000000-0000-0000-0000-000000000001"}')$q$);
select public.insights_report_command('10000000-0000-0000-0000-000000000001','submit','{"reviewer_id":"00000000-0000-0000-0000-000000000002"}');
select pg_temp.assert_true((public.insights_report_workspace('10000000-0000-0000-0000-000000000001')->'workflow'->>'status')='in_review','Submit must enter review');
select pg_temp.denied($q$select public.insights_report_command('10000000-0000-0000-0000-000000000001','approve','{}')$q$);
select pg_temp.denied($q$select public.insights_report_command('10000000-0000-0000-0000-000000000001','submit','{"reviewer_id":"00000000-0000-0000-0000-000000000002"}')$q$);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false), set_config('request.jwt.claim.email','editor@example.test',false);
select public.insights_report_command('10000000-0000-0000-0000-000000000001','approve','{"note":"Reviewed data coverage."}');
select pg_temp.denied($q$select public.insights_report_command('10000000-0000-0000-0000-000000000001','publish','{}')$q$);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false), set_config('request.jwt.claim.email','owner@example.test',false);
select public.insights_report_command('10000000-0000-0000-0000-000000000001','publish','{}');
select pg_temp.assert_true((select count(*)=1 from insight_report_versions where status='published'),'Owner publishes independently reviewed version');
select pg_temp.denied($q$update insight_report_versions set snapshot='{}'$q$);
select public.insights_report_command('10000000-0000-0000-0000-000000000001','comment','{"body":"The morning period needs investigation.","element_id":"chart-1"}');
select pg_temp.assert_true((select author_label='Owner' from insight_report_comments limit 1),'Comment author must be stamped by server');
select pg_temp.denied($q$select public.insights_report_command('10000000-0000-0000-0000-000000000001','add_action','{"title":"Review morning hours","assigned_to":"00000000-0000-0000-0000-000000000003","due_date":"2026-12-01"}')$q$);
select public.insights_report_command('10000000-0000-0000-0000-000000000001','add_action',jsonb_build_object('title','Review morning hours','assigned_to','00000000-0000-0000-0000-000000000002','due_date','2026-12-01','baseline_version_id',(select id from insight_report_versions order by version_number limit 1)));
select pg_temp.denied(format($q$select public.insights_report_command('10000000-0000-0000-0000-000000000001','update_action','{"id":"%s","status":"done","outcome":""}')$q$,(select id from insight_report_actions limit 1)));
select public.insights_report_command('10000000-0000-0000-0000-000000000001','update_action',jsonb_build_object('id',(select id from insight_report_actions limit 1),'status','done','outcome','Opening hours reviewed; results pending.'));
update saved_reports set title='Changed working title' where id='10000000-0000-0000-0000-000000000001';
select pg_temp.assert_true((select count(*)>=2 from insight_report_versions),'Each meaningful save creates a version');
select pg_temp.assert_true((select status='draft' and published_version_id is not null from insight_report_workflows),'Editing returns to draft but retains publication');
select pg_temp.assert_true((select snapshot->>'title'='Traffic decision' from insight_report_versions where version_number=1),'Published numbers and metadata must stay frozen');
select public.insights_report_command('10000000-0000-0000-0000-000000000001','restore',jsonb_build_object('version_id',(select id from insight_report_versions order by version_number limit 1)));
select pg_temp.assert_true((select title='Traffic decision' and shared_access->>'editor@example.test'='editor' from saved_reports limit 1),'Restore creates a working draft and preserves sharing');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false), set_config('request.jwt.claim.email','viewer@example.test',false);
select pg_temp.assert_true((select count(*)>=2 from insight_report_versions),'Shared viewers can read saved versions');
select pg_temp.denied($q$select public.insights_report_command('10000000-0000-0000-0000-000000000001','comment','{"body":"Viewer cannot edit"}')$q$);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false), set_config('request.jwt.claim.email','outsider@example.test',false);
select pg_temp.assert_true((select count(*)=0 from insight_report_versions),'Cross-institute shares must not expose version history');
select pg_temp.denied($q$select public.insights_report_workspace('10000000-0000-0000-0000-000000000001')$q$);
select pg_temp.denied($q$select public.insights_report_command('10000000-0000-0000-0000-000000000001','comment','{"body":"Cross institute denied"}')$q$);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false), set_config('request.jwt.claim.email','owner@example.test',false);
select public.insights_report_command('10000000-0000-0000-0000-000000000001','submit','{"reviewer_id":"00000000-0000-0000-0000-000000000002"}');
update saved_reports set title='Edited during review' where id='10000000-0000-0000-0000-000000000001';
select pg_temp.assert_true((select count(*)>=1 from insight_report_versions where status='superseded'),'Edits supersede stale review requests');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false), set_config('request.jwt.claim.email','editor@example.test',false);
select pg_temp.denied($q$select public.insights_report_command('10000000-0000-0000-0000-000000000001','approve','{}')$q$);
reset role;
select pg_temp.denied($q$update insight_report_versions set snapshot='{}'$q$);
select pg_temp.assert_true((select count(*)>=6 from insight_report_events),'Workflow commands must leave an audit trail');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false), set_config('request.jwt.claim.email','owner@example.test',false);
update saved_reports set layout_data=jsonb_set(layout_data,'{elements,0,dataEvidence,isDemo}','true'::jsonb) where id='10000000-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.denied($q$select public.insights_report_command('10000000-0000-0000-0000-000000000001','submit','{"reviewer_id":"00000000-0000-0000-0000-000000000002"}')$q$);
reset role;
update saved_reports set layout_data=jsonb_set(jsonb_set(layout_data,'{elements,0,dataEvidence,isDemo}','false'::jsonb),'{elements,0,dataEvidence,sourceRows}','0'::jsonb) where id='10000000-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.denied($q$select public.insights_report_command('10000000-0000-0000-0000-000000000001','submit','{"reviewer_id":"00000000-0000-0000-0000-000000000002"}')$q$);
reset role;
select pg_temp.assert_true(checkit_reports_private.comparable('{"layout_data":[]}'::jsonb)='{"layout_data":[]}'::jsonb,'Legacy array layouts must remain writable');
update saved_reports set layout_data='[]'::jsonb where id='10000000-0000-0000-0000-000000000001';
update saved_reports set layout_data='{"version":2,"elements":[],"reportSettings":{}}'::jsonb where id='10000000-0000-0000-0000-000000000001';
update profile set role='' where id='00000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false), set_config('request.jwt.claim.email','editor@example.test',false);
set role authenticated;
select pg_temp.denied($q$select public.insights_report_command('10000000-0000-0000-0000-000000000001','comment','{"body":"Unknown role cannot edit"}')$q$);
reset role;
\echo Insights workflow database checks passed.
