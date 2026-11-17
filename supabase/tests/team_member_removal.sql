\set ON_ERROR_STOP on
-- Run with psql -v migration_file=/absolute/path/to/migration.sql -f this_file.sql.
-- All fixtures are synthetic, restricted to this isolated database, and rolled back.
begin;
do $$ begin
  if current_database() <> 'checkit_team_permissions_test' then
    raise exception 'Use the isolated checkit_team_permissions_test database.';
  end if;
end $$;
create role authenticated nologin;
create role anon nologin;
create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create table public.profile(id uuid primary key, role text, assigned_institute varchar);
create function public.remove_team_member(target_profile_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$ begin return false; end $$;
revoke all on function public.remove_team_member(uuid) from public;
grant execute on function public.remove_team_member(uuid) to authenticated, service_role;
\i :migration_file
create function pg_temp.assert_true(condition boolean, message text) returns void language plpgsql as $$
begin if condition is distinct from true then raise exception '%', message; end if; end;
$$;
create function pg_temp.expect_denied(target_id uuid, expected_message text) returns void language plpgsql as $$
begin
  begin
    perform public.remove_team_member(target_id);
  exception when raise_exception then
    if sqlerrm = expected_message then return; end if;
    raise;
  end;
  raise exception 'Removal unexpectedly allowed: %', expected_message;
end;
$$;
insert into public.profile values
 ('00000000-0000-0000-0000-000000000001', 'checkit_admin', 'institute-a'),
 ('00000000-0000-0000-0000-000000000002', 'admin', 'institute-a'),
 ('00000000-0000-0000-0000-000000000003', 'viewer', 'institute-a');
do $$
declare
  system_admin uuid := '00000000-0000-0000-0000-000000000001';
  institute_admin uuid := '00000000-0000-0000-0000-000000000002';
  target_id uuid := '00000000-0000-0000-0000-000000000003';
  tested_role text;
begin
  perform set_config('request.jwt.claim.sub', system_admin::text, true);
  foreach tested_role in array array['admin','checkit_admin','checkit_field_operator','field_operator','viewer','user'] loop
    update public.profile set role=tested_role, assigned_institute='institute-b' where id=target_id;
    perform pg_temp.assert_true(public.remove_team_member(target_id), 'CheckIt admins can remove any other role across institutes');
    perform pg_temp.assert_true((select role='viewer' and assigned_institute is null from public.profile where id=target_id), 'Removal must clear membership and elevated privileges');
  end loop;
  perform pg_temp.expect_denied(system_admin, 'You cannot remove yourself.');
  perform pg_temp.assert_true((select role='checkit_admin' and assigned_institute='institute-a' from public.profile where id=system_admin), 'Self-removal must not change the caller');

  perform set_config('request.jwt.claim.sub', institute_admin::text, true);
  foreach tested_role in array array['field_operator','viewer','user'] loop
    update public.profile set role=tested_role, assigned_institute='institute-a' where id=target_id;
    perform pg_temp.assert_true(public.remove_team_member(target_id), 'Institution admins can remove allowed roles in their institute');
    update public.profile set role=tested_role, assigned_institute='institute-b' where id=target_id;
    perform pg_temp.expect_denied(target_id, 'You can only remove members in your institution.');
    perform pg_temp.assert_true((select role=tested_role and assigned_institute='institute-b' from public.profile where id=target_id), 'Cross-institute denial leaves membership unchanged');
  end loop;
  foreach tested_role in array array['admin','checkit_admin','checkit_field_operator'] loop
    update public.profile set role=tested_role, assigned_institute='institute-a' where id=target_id;
    perform pg_temp.expect_denied(target_id, 'You can only remove field operators or viewers.');
    perform pg_temp.assert_true((select role=tested_role and assigned_institute='institute-a' from public.profile where id=target_id), 'Institution admins cannot remove elevated members');
  end loop;

  foreach tested_role in array array['viewer','user','field_operator','checkit_field_operator',null] loop
    update public.profile set role=tested_role where id=institute_admin;
    update public.profile set role='viewer', assigned_institute='institute-a' where id=target_id;
    perform pg_temp.expect_denied(target_id, 'Only admins can remove team members.');
  end loop;
  update public.profile set role='admin', assigned_institute=null where id=institute_admin;
  update public.profile set role='viewer', assigned_institute=null where id=target_id;
  perform pg_temp.expect_denied(target_id, 'You can only remove members in your institution.');
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.expect_denied(target_id, 'Profile not found.');
  perform set_config('request.jwt.claim.sub', system_admin::text, true);
  perform pg_temp.expect_denied('00000000-0000-0000-0000-000000000099', 'Profile not found.');
end;
$$;
select pg_temp.assert_true(has_function_privilege('authenticated','public.remove_team_member(uuid)','execute'), 'Authenticated grant must be preserved');
select pg_temp.assert_true(has_function_privilege('service_role','public.remove_team_member(uuid)','execute'), 'Service-role grant must be preserved');
select pg_temp.assert_true(not has_function_privilege('anon','public.remove_team_member(uuid)','execute'), 'Anonymous callers must not gain access');
select pg_temp.assert_true((select prosecdef and proconfig @> array['search_path=public'] from pg_proc where oid='public.remove_team_member(uuid)'::regprocedure), 'Definer and search path protections must be preserved');
rollback;
\echo Team removal permission checks passed.
