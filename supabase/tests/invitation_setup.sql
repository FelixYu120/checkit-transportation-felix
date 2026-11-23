\set ON_ERROR_STOP on
begin;
do $$ begin if current_database()<>'checkit_invitation_setup_test' then raise exception 'Use the isolated checkit_invitation_setup_test database.'; end if; end $$;
do $$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$;
create schema auth;
create schema checkit_accounts_private;
revoke all on schema checkit_accounts_private from public,anon,authenticated;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
grant usage on schema auth to authenticated,service_role;
grant execute on all functions in schema auth to authenticated,service_role;
create table auth.users(id uuid primary key,email text,encrypted_password text,invited_at timestamptz,raw_user_meta_data jsonb default '{}');
create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade,created_at timestamptz default clock_timestamp(),not_after timestamptz);
create table public.profile(id uuid primary key references auth.users on delete cascade,role text,assigned_institute text);
create table checkit_accounts_private.removals(target_id uuid primary key references auth.users on delete cascade);
\i :migration_file
create function pg_temp.assert_true(value boolean,message text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception '%',message; end if; end $$;
create function pg_temp.denied(statement text) returns void language plpgsql as $$ begin begin execute statement; exception when insufficient_privilege then return; end; raise exception 'Unexpected success: %',statement; end $$;
create function pg_temp.identify(subject_id uuid,session_id uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims',jsonb_build_object('sub',subject_id,'session_id',session_id,'role','authenticated')::text,true); end $$;
insert into auth.users values
 ('00000000-0000-0000-0000-000000000001','admin@example.test','admin-hash',now()-interval '1 day','{}'),
 ('00000000-0000-0000-0000-000000000002','fresh@example.test','',now(),'{}'),
 ('00000000-0000-0000-0000-000000000003','expired@example.test','',now()-interval '2 hours','{}'),
 ('00000000-0000-0000-0000-000000000004','completed@example.test','existing-hash',now(),'{}'),
 ('00000000-0000-0000-0000-000000000005','uninvited@example.test','',null,'{}');
insert into profile select id,case when id='00000000-0000-0000-0000-000000000001' then 'checkit_admin' else 'viewer' end,'ucsd' from auth.users;
insert into auth.sessions(id,user_id) select id,id from auth.users;
set role authenticated;
select pg_temp.identify('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');
select pg_temp.assert_true((public.invitation_setup_status()->>'eligible')::boolean,'Fresh invitation session may set up an account');
select pg_temp.denied($q$select public.record_invitation_delivery('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',clock_timestamp())$q$);
select pg_temp.identify('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000003');
select pg_temp.assert_true(public.invitation_setup_status()->>'reason'='expired','A recently signed-in session cannot extend an expired invite');
reset role;
select pg_temp.denied($q$update auth.users set encrypted_password='new-hash' where id='00000000-0000-0000-0000-000000000003'$q$);
select pg_temp.assert_true((select used_at is null from checkit_accounts_private.invitation_setups where user_id='00000000-0000-0000-0000-000000000003'),'Failed setup must not consume a valid future retry');
select pg_temp.denied($q$select public.authorize_invitation_delivery('00000000-0000-0000-0000-000000000002',null)$q$);
-- Only a completed administrator and accepted delivery can issue a fresh window.
select set_config('checkit.delivery_time',public.authorize_invitation_delivery('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003')->>'delivery_started_at',true);
select public.record_invitation_delivery('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003',current_setting('checkit.delivery_time')::timestamptz);
set role authenticated;
select pg_temp.assert_true(public.invitation_setup_status()->>'reason'='open_latest_invitation','An old session cannot use a reissued invitation');
reset role;
select pg_temp.denied($q$update auth.users set encrypted_password='new-hash' where id='00000000-0000-0000-0000-000000000003'$q$);
insert into auth.sessions(id,user_id,created_at) values('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000003',clock_timestamp());
set role authenticated;
select pg_temp.identify('00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003');
select pg_temp.assert_true((public.invitation_setup_status()->>'eligible')::boolean,'Opening the latest invitation enables its new window');
reset role;
update auth.users set encrypted_password='new-hash' where id='00000000-0000-0000-0000-000000000003';
select pg_temp.assert_true((select used_at is not null from checkit_accounts_private.invitation_setups where user_id='00000000-0000-0000-0000-000000000003'),'First password consumes the setup ticket');
set role authenticated;
select pg_temp.assert_true(public.invitation_setup_status()->>'reason'='completed','Completed accounts cannot reopen signup by URL');
reset role;
update auth.users set encrypted_password='normal-password-change' where id='00000000-0000-0000-0000-000000000003';
select pg_temp.assert_true(not (public.record_invitation_delivery('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003',clock_timestamp())->>'setup_required')::boolean,'Inviting an existing completed account cannot reopen signup');
set role authenticated;
select pg_temp.identify('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004');
select pg_temp.assert_true(public.invitation_setup_status()->>'reason'='completed','Existing password accounts remain closed to signup');
select pg_temp.identify('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000005');
select pg_temp.assert_true(public.invitation_setup_status()->>'reason'='invitation_required','Being signed in alone does not grant signup');
reset role;
select pg_temp.denied($q$update auth.users set encrypted_password='new-hash' where id='00000000-0000-0000-0000-000000000005'$q$);
insert into checkit_accounts_private.removals values('00000000-0000-0000-0000-000000000002');
select pg_temp.identify('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');
select pg_temp.assert_true(public.invitation_setup_status()->>'reason'='revoked','A removed account cannot complete signup');
delete from auth.users where id='00000000-0000-0000-0000-000000000003';
select pg_temp.assert_true(not exists(select 1 from checkit_accounts_private.invitation_setups where user_id='00000000-0000-0000-0000-000000000003'),'Account removal also deletes setup state');
select pg_temp.assert_true(not has_function_privilege('anon','public.invitation_setup_status()','execute'),'Anonymous callers cannot inspect invitation setup state');
rollback;
\echo Invitation setup checks passed.
