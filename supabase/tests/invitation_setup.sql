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
alter table auth.users add column updated_at timestamptz;
alter table auth.users add column recovery_sent_at timestamptz;
create table auth.mfa_amr_claims(session_id uuid references auth.sessions on delete cascade,authentication_method text);
create table auth.refresh_tokens(user_id text,session_id uuid,created_at timestamptz default clock_timestamp());
\i :migration_file
\i :repair_file
\i :protocol_file
create function pg_temp.assert_true(value boolean,message text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception '%',message; end if; end $$;
create function pg_temp.denied(statement text) returns void language plpgsql as $$ begin begin execute statement; exception when others then return; end; raise exception 'Unexpected success: %',statement; end $$;
create function pg_temp.identify(subject_id uuid,session_id uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims',jsonb_build_object('sub',subject_id,'session_id',session_id,'role','authenticated')::text,true); end $$;
insert into auth.users(id,email,encrypted_password,invited_at,raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000001','admin@example.test','admin-hash',now()-interval '1 day','{}'),
 ('00000000-0000-0000-0000-000000000002','fresh@example.test','',now(),'{}'),
 ('00000000-0000-0000-0000-000000000003','expired@example.test','',now()-interval '16 minutes','{}'),
 ('00000000-0000-0000-0000-000000000004','completed@example.test','existing-hash',now(),'{}'),
 ('00000000-0000-0000-0000-000000000005','uninvited@example.test','',null,'{}');
insert into profile select id,case when id='00000000-0000-0000-0000-000000000001' then 'checkit_admin' else 'viewer' end,'ucsd' from auth.users;
insert into auth.sessions(id,user_id) select id,id from auth.users;
insert into auth.mfa_amr_claims select id,'invite' from auth.sessions;
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
insert into auth.mfa_amr_claims values('10000000-0000-0000-0000-000000000003','otp');
set role authenticated;
select pg_temp.identify('00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003');
select pg_temp.assert_true((public.invitation_setup_status()->>'eligible')::boolean,'Opening the latest invitation enables its new window');
reset role;
update auth.users set encrypted_password='new-hash' where id='00000000-0000-0000-0000-000000000003';
select pg_temp.assert_true((select used_at is not null from checkit_accounts_private.invitation_setups where user_id='00000000-0000-0000-0000-000000000003'),'First password consumes the setup ticket');
set role authenticated;
select pg_temp.assert_true(public.invitation_setup_status()->>'reason'='login_required','Completed accounts cannot reopen signup by URL');
reset role;
update auth.users set encrypted_password='normal-password-change' where id='00000000-0000-0000-0000-000000000003';
-- Completed active accounts are never reset or resurrected by Invite.
select pg_temp.denied($q$select public.authorize_invitation_delivery('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003')$q$);
select pg_temp.assert_true((select encrypted_password='normal-password-change' from auth.users where id='00000000-0000-0000-0000-000000000003'),'Inviting an existing account cannot clear its credentials');
select pg_temp.identify('00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003');
select pg_temp.assert_true(not public.portal_account_ready(),'Completing signup does not turn the email session into a password login');
insert into auth.sessions(id,user_id) values('20000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000003');
insert into auth.mfa_amr_claims values('20000000-0000-0000-0000-000000000003','password');
select pg_temp.identify('00000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003');
select pg_temp.assert_true(public.portal_account_ready(),'Signing in with the newly chosen password permits portal access');
select pg_temp.denied($q$select public.authorize_invitation_delivery('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001')$q$);
set role authenticated;
select pg_temp.identify('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004');
select pg_temp.assert_true(public.invitation_setup_status()->>'reason'='login_required','Existing password accounts remain closed to signup');
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
-- New Auth invitation seeding happens after delivery starts, before it is recorded.
select set_config('checkit.new_delivery',public.authorize_invitation_delivery('00000000-0000-0000-0000-000000000001',null)->>'delivery_started_at',true);
insert into auth.users(id,email,encrypted_password,invited_at) values('00000000-0000-0000-0000-000000000006','new-delivery@example.test','',clock_timestamp());
insert into profile values('00000000-0000-0000-0000-000000000006','viewer','ucsd');
insert into auth.sessions(id,user_id) values('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000006');
insert into auth.mfa_amr_claims values('00000000-0000-0000-0000-000000000006','invite');
insert into auth.refresh_tokens(user_id,session_id) values('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000006');
select public.record_invitation_delivery('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000006',current_setting('checkit.new_delivery')::timestamptz);
select pg_temp.identify('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000006');
select pg_temp.assert_true((public.invitation_setup_status()->>'eligible')::boolean,'A new Auth invite survives seeding and a fast click before delivery recording');
select pg_temp.assert_true(exists(select 1 from auth.refresh_tokens where user_id='00000000-0000-0000-0000-000000000006'),'Delivery recording preserves the new invitation session');
-- Applying an older overlapping delivery must not clear the latest password.
do $$ begin
  begin
    perform public.record_invitation_delivery('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000006',current_setting('checkit.new_delivery')::timestamptz-interval '1 second');
    raise exception 'Stale delivery unexpectedly succeeded';
  exception when others then
    if sqlerrm<>'Open the latest invite.' then raise; end if;
  end;
end $$;
select pg_temp.assert_true(not has_function_privilege('authenticated','public.record_invitation_delivery(uuid,uuid,timestamptz)','execute'),'A recipient cannot reissue their own setup deadline');

-- Recovery requires its own unexpired, unused ticket and recovery-authenticated session.
update auth.users set recovery_sent_at=clock_timestamp() where id='00000000-0000-0000-0000-000000000004';
insert into auth.sessions(id,user_id) values('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004');
insert into auth.mfa_amr_claims values('10000000-0000-0000-0000-000000000004','recovery');
select pg_temp.identify('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004');
select pg_temp.assert_true(not (public.password_reset_status()->>'eligible')::boolean,'An invitation session is not a recovery session');
select pg_temp.identify('00000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004');
select pg_temp.assert_true((public.password_reset_status()->>'eligible')::boolean,'A fresh recovery email opens password reset');
select pg_temp.assert_true(not public.portal_account_ready(),'Recovery does not sign the user into the portal');
update auth.users set encrypted_password='reset-password' where id='00000000-0000-0000-0000-000000000004';
select pg_temp.assert_true(not (public.password_reset_status()->>'eligible')::boolean,'Saving the password consumes recovery setup');
update auth.users set recovery_sent_at=clock_timestamp()-interval '16 minutes' where id='00000000-0000-0000-0000-000000000004';
select pg_temp.assert_true(not (public.password_reset_status()->>'eligible')::boolean,'Expired recovery setup stays blocked after email verification');
update auth.users set recovery_sent_at=clock_timestamp() where id='00000000-0000-0000-0000-000000000002';
select pg_temp.identify('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');
select pg_temp.assert_true(not (public.password_reset_status()->>'eligible')::boolean,'An unfinished or revoked invitation cannot bypass signup through reset');
delete from auth.users where id='00000000-0000-0000-0000-000000000004';
select pg_temp.assert_true(not exists(select 1 from checkit_accounts_private.password_reset_setups where user_id='00000000-0000-0000-0000-000000000004'),'Account removal also deletes recovery records');
select pg_temp.assert_true(not has_function_privilege('anon','public.password_reset_status()','execute'),'Anonymous callers cannot inspect recovery state');

rollback;
\echo Invitation setup checks passed.
