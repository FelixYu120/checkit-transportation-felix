-- Stage first; activate admin enforcement only after web and Field Teams publication.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table checkit_accounts_private.mfa_policy(singleton boolean primary key default true check(singleton),enforce_admins boolean not null default false);
insert into checkit_accounts_private.mfa_policy(singleton) values(true);
create table checkit_accounts_private.mfa_members(user_id uuid primary key references auth.users(id) on delete cascade,enabled_at timestamptz not null default now());
alter table checkit_accounts_private.mfa_policy enable row level security;
alter table checkit_accounts_private.mfa_members enable row level security;
revoke all on checkit_accounts_private.mfa_policy,checkit_accounts_private.mfa_members from public,anon,authenticated;

create function public.mfa_access_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare subject uuid:=auth.uid(); person public.profile; sid text:=auth.jwt()->>'session_id'; ready boolean; enrolled boolean; required boolean; verified boolean;
begin
  select * into person from public.profile where id=subject;
  ready:=checkit_accounts_private.active_setup_profile(subject) and checkit_accounts_private.password_setup_complete(subject)
    and exists(select 1 from auth.sessions s join auth.mfa_amr_claims a on a.session_id=s.id where s.user_id=subject and s.id::text=sid
      and (s.not_after is null or s.not_after>now()) and a.authentication_method='password');
  enrolled:=exists(select 1 from auth.mfa_factors f where f.user_id=subject and f.factor_type='totp' and f.status='verified');
  required:=exists(select 1 from checkit_accounts_private.mfa_members where user_id=subject)
    or ((select enforce_admins from checkit_accounts_private.mfa_policy where singleton) and (person.role in ('admin','checkit_admin') or enrolled));
  verified:=ready and enrolled and auth.jwt()->>'aal'='aal2';
  return jsonb_build_object('user_id',subject,'ready',coalesce(ready,false),'required',coalesce(required,false),'enrolled',enrolled,'verified',coalesce(verified,false));
end $$;
revoke all on function public.mfa_access_status() from public,anon;
grant execute on function public.mfa_access_status() to authenticated;

create function public.mfa_access_allowed() returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(not (s->>'required')::boolean or (s->>'verified')::boolean,false) from (select public.mfa_access_status() s) x;
$$;
revoke all on function public.mfa_access_allowed() from public,anon;
grant execute on function public.mfa_access_allowed() to authenticated;

create function public.confirm_my_mfa_enrollment() returns void language plpgsql security definer set search_path='' as $$
begin
  if not coalesce((public.mfa_access_status()->>'verified')::boolean,false) then raise exception 'Verify your authenticator code.' using errcode='42501'; end if;
  insert into checkit_accounts_private.mfa_members(user_id) values(auth.uid()) on conflict do nothing;
end $$;
revoke all on function public.confirm_my_mfa_enrollment() from public,anon;
grant execute on function public.confirm_my_mfa_enrollment() to authenticated;

-- Confirm enrollment in the same Auth transaction that verifies the first factor.
create function checkit_accounts_private.register_verified_mfa() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.factor_type='totp' and new.status='verified' then
    if tg_op='INSERT' or old.status is distinct from new.status then
      insert into checkit_accounts_private.mfa_members(user_id) values(new.user_id) on conflict do nothing;
    end if;
  end if;
  return new;
end $$;
create trigger checkit_register_mfa after insert or update of status on auth.mfa_factors for each row execute function checkit_accounts_private.register_verified_mfa();
revoke all on function checkit_accounts_private.register_verified_mfa() from public,anon,authenticated;

create function public.require_mfa() returns void language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.mfa_access_allowed() then raise exception 'Authenticator verification required.' using errcode='42501'; end if;
end $$;
revoke all on function public.require_mfa() from public,anon;
grant execute on function public.require_mfa() to authenticated;

create function public.mfa_profile_setup_allowed(subject uuid) returns boolean language sql stable security definer set search_path='' as $$
  select subject=auth.uid() and checkit_accounts_private.active_setup_profile(subject) and exists(
    select 1 from checkit_accounts_private.invitation_setups where user_id=subject and used_at is null and expires_at>now());
$$;
revoke all on function public.mfa_profile_setup_allowed(uuid) from public,anon;
grant execute on function public.mfa_profile_setup_allowed(uuid) to authenticated;

create or replace function public.portal_account_ready() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((public.mfa_access_status()->>'ready')::boolean,false) and public.mfa_access_allowed();
$$;

-- RLS covers table access through REST, GraphQL, Realtime and Storage.
do $policy$ declare t record; begin
  for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and c.relrowsecurity and (n.nspname='public' or (n.nspname='storage' and c.relname='objects'))
  loop
    if t.nspname='public' and t.relname='profile' then
      execute 'create policy mfa_read on public.profile as restrictive for select to authenticated using(id=auth.uid() or (select public.mfa_access_allowed()))';
      execute 'create policy mfa_insert on public.profile as restrictive for insert to authenticated with check((select public.mfa_access_allowed()) or public.mfa_profile_setup_allowed(id))';
      execute 'create policy mfa_update on public.profile as restrictive for update to authenticated using((select public.mfa_access_allowed()) or public.mfa_profile_setup_allowed(id)) with check((select public.mfa_access_allowed()) or public.mfa_profile_setup_allowed(id))';
      execute 'create policy mfa_delete on public.profile as restrictive for delete to authenticated using((select public.mfa_access_allowed()))';
    else
      execute format('create policy mfa_boundary on %I.%I as restrictive for all to authenticated using((select public.mfa_access_allowed())) with check((select public.mfa_access_allowed()))',t.nspname,t.relname);
    end if;
  end loop;
end $policy$;
create function checkit_accounts_private.mfa_profile_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.jwt()->>'role'='authenticated' and not public.mfa_access_allowed()
    and (not public.mfa_profile_setup_allowed(new.id) or (to_jsonb(new)-'full_name') is distinct from (to_jsonb(old)-'full_name')) then
    raise exception 'Authenticator verification required.' using errcode='42501';
  end if;
  return new;
end $$;
create trigger mfa_profile_guard before update on public.profile for each row execute function checkit_accounts_private.mfa_profile_guard();
revoke all on function checkit_accounts_private.mfa_profile_guard() from public,anon,authenticated;

-- SECURITY DEFINER RPCs bypass RLS; guard REST entry before those functions run.
create function public.checkit_mfa_pre_request() returns void language plpgsql stable security definer set search_path='' as $$
declare path text:=current_setting('request.path',true); method text:=current_setting('request.method',true);
begin
  if auth.jwt()->>'role' is distinct from 'authenticated' or public.mfa_access_allowed() then return; end if;
  if path in ('/rpc/mfa_access_status','/rpc/confirm_my_mfa_enrollment','/rpc/require_mfa','/rpc/invitation_setup_status','/rpc/password_reset_status','/rpc/portal_account_ready') then return; end if;
  if path='/profile' and (method in ('GET','HEAD') or public.mfa_profile_setup_allowed(auth.uid())) then return; end if;
  raise exception 'Authenticator verification required.' using errcode='42501';
end $$;
revoke all on function public.checkit_mfa_pre_request() from public,anon;
grant execute on function public.checkit_mfa_pre_request() to authenticated,service_role,anon;
do $$ declare old_hook text; begin
  select split_part(config,'=',2) into old_hook from pg_roles r,unnest(r.rolconfig) config where r.rolname='authenticator' and config like 'pgrst.db_pre_request=%';
  if nullif(old_hook,'') is not null and old_hook<>'public.checkit_mfa_pre_request' then raise exception 'Review the existing API pre-request hook before installing MFA.'; end if;
  if exists(select 1 from pg_roles where rolname='authenticator') then execute 'alter role authenticator set pgrst.db_pre_request = ''public.checkit_mfa_pre_request'''; end if;
end $$;
notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;
