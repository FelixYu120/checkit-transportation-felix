-- Run the entire file in one connection. All fixtures are rolled back.
-- Exercises the installed profile grants, row policies and security triggers.
-- Creates no credentials, sends no emails, and changes no existing account.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $fixture$
declare actor_id uuid := gen_random_uuid(); other_id uuid := gen_random_uuid(); actor_email text;
begin
  actor_email := 'checkit-signup-test-'||actor_id::text||'@example.invalid';
  insert into auth.users(id,email,encrypted_password,raw_user_meta_data,aud,role) values
    (actor_id,actor_email,'','{}'::jsonb,'authenticated','authenticated'),
    (other_id,'checkit-signup-test-'||other_id::text||'@example.invalid','','{}'::jsonb,'authenticated','authenticated');
  insert into public.profile(id,email,full_name,role,assigned_institute) values
    (actor_id,actor_email,'Signup fixture','checkit_admin',null),
    (other_id,'checkit-signup-test-'||other_id::text||'@example.invalid','Other fixture','viewer',null)
    on conflict(id) do update set role=excluded.role,full_name=excluded.full_name,assigned_institute=null;
  perform set_config('checkit.signup_subject',actor_id::text,true);
  perform set_config('checkit.signup_other',other_id::text,true);
  perform set_config('checkit.signup_baseline',(select (to_jsonb(p)-'full_name')::text from public.profile p where id=actor_id),true);
  perform set_config('request.jwt.claim.sub',actor_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_id,'email',actor_email,'role','authenticated')::text,true);
end $fixture$;
set local role authenticated;
do $checks$
declare
  actor_id uuid := current_setting('checkit.signup_subject')::uuid;
  other_id uuid := current_setting('checkit.signup_other')::uuid;
  saved_id uuid; saved_name text; affected integer;
  legacy_denied boolean := false; role_change_denied boolean := false;
begin
  -- The old PostgREST upsert includes id in its ON CONFLICT UPDATE columns.
  begin
    insert into public.profile(id,email,full_name) values(actor_id,auth.jwt()->>'email','Legacy attempt')
      on conflict(id) do update set id=excluded.id,email=excluded.email,full_name=excluded.full_name;
  exception when insufficient_privilege then legacy_denied := true;
  end;
  if not has_column_privilege('authenticated','public.profile','id','UPDATE') and not legacy_denied then
    raise exception 'The legacy write unexpectedly bypassed the immutable-ID grant.';
  end if;

  update public.profile set full_name='Completed signup fixture' where id=actor_id
    returning id,full_name into saved_id,saved_name;
  if saved_id is distinct from actor_id or saved_name is distinct from 'Completed signup fixture' then
    raise exception 'The invited user cannot complete their own profile name.';
  end if;
  if (select to_jsonb(p)-'full_name' from public.profile p where id=actor_id)
    is distinct from current_setting('checkit.signup_baseline')::jsonb then
    raise exception 'Signup changed identity, membership, assignments or other protected metadata.';
  end if;

  update public.profile set full_name='Unauthorized change' where id=other_id;
  get diagnostics affected = row_count;
  if affected<>0 then raise exception 'Signup can edit another account.'; end if;
  begin
    update public.profile set role='viewer' where id=actor_id;
  exception when insufficient_privilege then role_change_denied := true;
  end;
  if not role_change_denied then raise exception 'Signup can change protected role fields.'; end if;
end $checks$;
reset role;
rollback;
