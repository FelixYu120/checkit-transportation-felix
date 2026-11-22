-- Apply only this migration; unrelated pending telemetry migrations are excluded.
-- No existing account is removed by applying this migration.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create schema if not exists checkit_accounts_private;
revoke all on schema checkit_accounts_private from public, anon, authenticated;
create table checkit_accounts_private.removals (
  target_id uuid primary key references auth.users(id) on delete cascade,
  original_institute text,
  original_role text not null,
  company_owner uuid not null references public.profile(id),
  started_at timestamptz not null default now()
);
revoke all on checkit_accounts_private.removals from public, anon, authenticated;
alter table checkit_accounts_private.removals enable row level security;

create function checkit_accounts_private.authorize_removal(actor_id uuid, target_id uuid, target_role text, target_institute text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor public.profile;
begin
  select * into actor from public.profile where id=actor_id for update;
  if actor.id is null then raise exception 'Sign in before removing a member.' using errcode='42501'; end if;
  if actor_id=target_id then raise exception 'You cannot remove yourself.' using errcode='42501'; end if;
  if actor.role is null or actor.role not in ('admin','checkit_admin') then
    raise exception 'Only admins can remove team members.' using errcode='42501';
  end if;
  if actor.role='admin' then
    if actor.assigned_institute is null or actor.assigned_institute is distinct from target_institute then
      raise exception 'You can only remove members in your institution.' using errcode='42501';
    end if;
    if target_role is null or target_role not in ('viewer','user','field_operator') then
      raise exception 'You can only remove field operators or viewers.' using errcode='42501';
    end if;
  end if;
end $$;

-- A pending removal must not be reactivated by a concurrent invitation or update.
create function checkit_accounts_private.guard_pending_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from checkit_accounts_private.removals where target_id=new.id)
    and (new.assigned_institute is not null or new.role is distinct from 'viewer'
      or (tg_op='UPDATE' and (to_jsonb(new)-array['assigned_institute','role']) is distinct from (to_jsonb(old)-array['assigned_institute','role']))) then
    raise exception 'Account removal is in progress. Finish removing this account before inviting it again.' using errcode='42501';
  end if;
  return new;
end $$;
create trigger account_removal_profile_guard before insert or update on public.profile
for each row execute function checkit_accounts_private.guard_pending_profile();

create function public.prepare_team_account_removal(target_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target public.profile; pending checkit_accounts_private.removals; recipient uuid;
begin
  select * into target from public.profile where id=target_profile_id for update;
  if target.id is null then raise exception 'Member not found.' using errcode='P0002'; end if;
  select * into pending from checkit_accounts_private.removals where target_id=target.id for update;
  perform checkit_accounts_private.authorize_removal(auth.uid(),target.id,
    coalesce(pending.original_role,target.role),
    case when pending.target_id is not null then pending.original_institute else target.assigned_institute end);
  if pending.target_id is null then
    if exists(select 1 from checkit_accounts_private.removals where company_owner=target.id) then
      raise exception 'Finish other pending removals before removing their receiving administrator.';
    end if;
    select p.id into recipient from public.profile p
    where p.id<>target.id and p.assigned_institute=target.assigned_institute
      and p.role in ('admin','checkit_admin')
      and not exists(select 1 from checkit_accounts_private.removals d where d.target_id=p.id)
    order by (p.id=auth.uid()) desc, p.id limit 1 for update;
    if recipient is null and exists(select 1 from public.saved_reports where owner_id=target.id) then
      raise exception 'Assign another administrator in this institution before removing this report owner.';
    end if;
    if exists(select 1 from storage.objects where (owner_id=target.id::text or owner=target.id)
      and bucket_id not in ('profile-photos','firmware')) then
      raise exception 'This account owns files that require an administrator to review before removal.';
    end if;
    insert into checkit_accounts_private.removals(target_id,original_institute,original_role,company_owner)
      values(target.id,target.assigned_institute,target.role,coalesce(recipient,auth.uid()));
    -- Revoke portal/data membership immediately, including CheckIt-wide privileges.
    update public.profile set assigned_institute=null,role='viewer' where id=target.id;
  end if;
  return jsonb_build_object('target_id',target.id,'personal_objects',coalesce((
    select jsonb_agg(jsonb_build_object('bucket_id',bucket_id,'name',name)) from storage.objects
    where bucket_id='profile-photos' and (owner_id=target.id::text or owner=target.id or split_part(name,'/',1)=target.id::text)
  ),'[]'::jsonb));
end $$;

-- Retryable blocked accounts remain visible to administrators in the directory.
create function public.pending_team_account_removals()
returns table(id uuid,full_name text,email text,role text,assigned_institute text) language sql stable security definer set search_path = '' as $$
  select p.id,p.full_name,p.email,p.role,p.assigned_institute::text from public.profile p
  join checkit_accounts_private.removals d on d.target_id=p.id
  join public.profile a on a.id=auth.uid()
  where a.id<>p.id and (a.role='checkit_admin' or (a.role='admin'
    and a.assigned_institute=d.original_institute and d.original_role in ('viewer','user','field_operator')));
$$;

-- Retire the old detach-only RPC separately, after the new API is live.
-- See 20261123010100_retire_membership_only_removal.sql.

-- Nullable historical references preserve company records without retaining identity.
alter table public.insight_report_versions alter column submitted_by drop not null;
alter table public.insight_report_versions drop constraint insight_report_versions_check1;
alter table public.insight_report_comments alter column author_id drop not null;
alter table public.insight_report_actions alter column assigned_to drop not null;
alter table public.insight_report_actions alter column created_by drop not null;

create function checkit_accounts_private.scrub_identity(value jsonb, identity_id text, identity_email text, identity_name text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare result jsonb;
begin
  if jsonb_typeof(value)='object' then
    select coalesce(jsonb_object_agg(key,checkit_accounts_private.scrub_identity(v,identity_id,identity_email,identity_name)),'{}'::jsonb)
      into result from jsonb_each(value) as e(key,v)
      where lower(key)<>lower(identity_email) and key<>identity_id;
    return result;
  elsif jsonb_typeof(value)='array' then
    select coalesce(jsonb_agg(checkit_accounts_private.scrub_identity(v,identity_id,identity_email,identity_name) order by ord),'[]'::jsonb)
      into result from jsonb_array_elements(value) with ordinality as e(v,ord);
    return result;
  elsif jsonb_typeof(value)='string' and (
    lower(value#>>'{}')=lower(identity_email) or value#>>'{}'=identity_id
    or (nullif(identity_name,'') is not null and value#>>'{}'=identity_name)) then
    return to_jsonb('Former member'::text);
  end if;
  return value;
end $$;

-- Keep normal report immutability. Only the owner-executed removal transaction
-- can redact identity from a published snapshot; normal workflow commands cannot.
create or replace function checkit_reports_private.freeze_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user='postgres' and nullif(current_setting('checkit.removal_target',true),'') is not null
    and exists(select 1 from checkit_accounts_private.removals
      where target_id::text=current_setting('checkit.removal_target',true)) then return new; end if;
  if new.snapshot is distinct from old.snapshot or new.report_id<>old.report_id
    or new.version_number<>old.version_number or new.submitted_by is distinct from old.submitted_by
    or new.submitted_at<>old.submitted_at or new.reviewer_id is distinct from old.reviewer_id then
    raise exception 'Saved report versions are immutable.' using errcode='42501';
  end if;
  if old.status='published' and new is distinct from old then
    raise exception 'Published report versions are immutable.' using errcode='42501';
  end if;
  return new;
end $$;

create function public.finish_team_account_removal(actor_profile_id uuid,target_profile_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare target public.profile; pending checkit_accounts_private.removals;
begin
  select * into target from public.profile where id=target_profile_id for update;
  if target.id is null then raise exception 'Removal cannot be verified. Refresh the team directory.'; end if;
  select * into pending from checkit_accounts_private.removals where target_id=target.id for update;
  if pending.target_id is null then raise exception 'Prepare account removal first.'; end if;
  perform checkit_accounts_private.authorize_removal(actor_profile_id,target.id,pending.original_role,pending.original_institute);
  perform 1 from public.profile where id=pending.company_owner and id<>target.id
    and not exists(select 1 from checkit_accounts_private.removals where target_id=pending.company_owner)
    and (not exists(select 1 from public.saved_reports where owner_id=target.id)
      or (role in ('admin','checkit_admin') and assigned_institute=pending.original_institute)) for update;
  if not found then raise exception 'The receiving administrator is unavailable. Contact CheckIt support to resume removal.'; end if;
  if exists(select 1 from storage.objects where bucket_id='profile-photos'
    and (owner_id=target.id::text or owner=target.id or split_part(name,'/',1)=target.id::text)) then
    raise exception 'Personal file cleanup is incomplete. Retry account removal.';
  end if;
  if exists(select 1 from storage.objects where (owner_id=target.id::text or owner=target.id)
    and bucket_id<>'firmware') then raise exception 'Unexpected owned files. Contact CheckIt support.'; end if;
  -- Reassign metadata only; physical company firmware objects remain unchanged.
  update storage.objects set owner_id=pending.company_owner::text,owner=pending.company_owner
    where bucket_id='firmware' and (owner_id=target.id::text or owner=target.id);
  update storage.buckets set owner_id=pending.company_owner::text,owner=pending.company_owner
    where owner_id=target.id::text or owner=target.id;

  perform set_config('checkit.removal_target',target.id::text,true);
  update public.saved_reports set owner_id=pending.company_owner where owner_id=target.id;
  update public.saved_reports set author='Former member' where lower(author)=lower(target.email) or author=nullif(target.full_name,'') or author=target.id::text;
  update public.saved_reports r set
    shared_with_emails=array(select e from unnest(r.shared_with_emails) e where lower(e)<>lower(target.email)),
    shared_access=coalesce((select jsonb_object_agg(key,value) from jsonb_each(coalesce(r.shared_access,'{}'::jsonb))
      where lower(key)<>lower(target.email)),'{}'::jsonb),
    layout_data=checkit_accounts_private.scrub_identity(layout_data,target.id::text,target.email,target.full_name)
  where target.email is not null and (exists(select 1 from unnest(r.shared_with_emails) e where lower(e)=lower(target.email))
    or exists(select 1 from jsonb_object_keys(coalesce(r.shared_access,'{}'::jsonb)) k where lower(k)=lower(target.email)) or r.layout_data::text like '%'||target.id::text||'%'
    or lower(r.layout_data::text) like '%'||lower(target.email)||'%' or r.layout_data::text like '%'||nullif(target.full_name,'')||'%');
  update public.insight_report_versions set
    submitted_by=case when submitted_by=target.id then null else submitted_by end,
    reviewer_id=case when reviewer_id=target.id then null else reviewer_id end,
    reviewed_by=case when reviewed_by=target.id then null else reviewed_by end,
    published_by=case when published_by=target.id then null else published_by end,
    snapshot=checkit_accounts_private.scrub_identity(snapshot,target.id::text,target.email,target.full_name)
  where submitted_by=target.id or reviewer_id=target.id or reviewed_by=target.id or published_by=target.id
    or snapshot::text like '%'||target.id::text||'%' or lower(snapshot::text) like '%'||lower(target.email)||'%'
    or snapshot::text like '%'||nullif(target.full_name,'')||'%';
  update public.insight_report_comments set author_id=null,author_label='Former member' where author_id=target.id;
  update public.insight_report_actions set
    assigned_to=case when assigned_to=target.id then null else assigned_to end,
    created_by=case when created_by=target.id then null else created_by end
    where assigned_to=target.id or created_by=target.id;
  update public.insight_report_events set
    actor_id=case when actor_id=target.id then null else actor_id end,
    actor_label=case when actor_id=target.id then 'Former member' else actor_label end,
    detail=checkit_accounts_private.scrub_identity(detail,target.id::text,target.email,target.full_name)
    where actor_id=target.id or detail::text like '%'||target.id::text||'%' or lower(detail::text) like '%'||lower(target.email)||'%';
  perform set_config('checkit.removal_target','',true);
  update auth.users set raw_user_meta_data=raw_user_meta_data-'invited_by'
    where raw_user_meta_data->>'invited_by'=target.id::text;
  delete from auth.scim_users where user_id=target.id;
  delete from auth.refresh_tokens where user_id=target.id::text;
  -- Supabase supports direct Auth user deletion. Auth sessions, identities,
  -- refresh tokens, MFA factors and the public profile cascade in this transaction.
  delete from auth.users where id=target.id;
  if exists(select 1 from public.profile where id=target.id) then raise exception 'Profile deletion could not be verified.'; end if;
  return true;
end $$;

create function public.portal_account_ready()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.users u where u.id=auth.uid() and nullif(u.encrypted_password,'') is not null);
$$;

-- Existing user JWTs cannot upload personal files after membership revocation.
create function public.can_upload_account_files()
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  -- Serialize uploads with preparation/finalization so an in-flight upload
  -- cannot recreate a personal file after the cleanup list was captured.
  perform 1 from public.profile p where p.id=auth.uid()
    and (p.role='checkit_admin' or p.assigned_institute is not null)
    and not exists(select 1 from checkit_accounts_private.removals d where d.target_id=p.id)
    for key share;
  return found;
end $$;
create policy account_removal_blocks_uploads on storage.objects as restrictive for insert to authenticated
  with check ((select public.can_upload_account_files()));
create policy account_removal_blocks_file_updates on storage.objects as restrictive for update to authenticated
  using ((select public.can_upload_account_files())) with check ((select public.can_upload_account_files()));

revoke all on all functions in schema checkit_accounts_private from public, anon, authenticated;
revoke all on function public.prepare_team_account_removal(uuid), public.pending_team_account_removals(),
  public.portal_account_ready(),public.can_upload_account_files(),public.finish_team_account_removal(uuid,uuid) from public, anon, authenticated;
grant execute on function public.prepare_team_account_removal(uuid),public.pending_team_account_removals(),
  public.portal_account_ready(),public.can_upload_account_files() to authenticated;
grant execute on function public.finish_team_account_removal(uuid,uuid) to service_role;
commit;
