-- CheckIt simple Supabase security reset.
-- Goal: keep the schema close to the original app:
--   - keep public.profile
--   - keep public.saved_reports
--   - remove the extra collaboration/security tables
--   - store shared report emails directly on saved_reports
--
-- Run this in Supabase SQL Editor.
-- Institute defaults are inferred from the email domain:
--   user@ucsd.edu -> ucsd
--   user@example.edu -> example

begin;

-- Remove old triggers before touching saved_reports. Otherwise a legacy trigger can
-- call a function that this cleanup script has already removed.
drop trigger if exists saved_reports_security_fields on public.saved_reports;
drop trigger if exists saved_reports_simple_security_fields on public.saved_reports;
drop trigger if exists on_auth_user_created_checkit_profile on auth.users;

-- Remove overbuilt tables from the previous security draft.
drop table if exists public.security_audit_log cascade;
drop table if exists public.report_permissions cascade;
drop table if exists public.institute_email_domains cascade;
drop table if exists public.profiles cascade;

-- Remove helper functions from the previous security draft.
drop function if exists public.infer_institute_from_email(text) cascade;
drop function if exists public.handle_new_user_profile() cascade;
drop function if exists public.current_user_institute() cascade;
drop function if exists public.is_platform_admin() cascade;
drop function if exists public.can_read_saved_report(uuid) cascade;
drop function if exists public.can_edit_saved_report(uuid) cascade;
drop function if exists public.can_manage_report_permissions(uuid) cascade;
drop function if exists public.can_share_report_with(uuid, uuid) cascade;
drop function if exists public.audit_report_permission_change() cascade;
drop function if exists public.set_saved_report_security_fields() cascade;

create or replace function public.infer_assigned_institute_from_email(user_email text)
returns varchar
language sql
stable
security definer
set search_path = public
as $$
  with parsed as (
    select
      lower(split_part(coalesce(user_email, ''), '@', 2)) as email_domain,
      string_to_array(lower(split_part(coalesce(user_email, ''), '@', 2)), '.') as domain_parts
  ),
  normalized as (
    select
      email_domain,
      case
        when cardinality(domain_parts) >= 2 then domain_parts[cardinality(domain_parts) - 1]
        when cardinality(domain_parts) = 1 then domain_parts[1]
        else null
      end as domain_root
    from parsed
  )
  select institute_id::varchar
  from public.institutes, normalized
  where lower(institute_id::text) = normalized.domain_root
     or lower(replace(full_name, ' ', '')) = normalized.domain_root
  limit 1
$$;

-- Make sure every existing Auth user has an app profile row.
insert into public.profile (
  id,
  email,
  full_name,
  role,
  assigned_institute,
  created_at
)
select
  u.id,
  lower(u.email),
  coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
  'user',
  public.infer_assigned_institute_from_email(u.email),
  now()
from auth.users u
where u.email is not null
on conflict (id) do nothing;

-- Fill missing institute assignments from each user's email.
update public.profile
set assigned_institute = public.infer_assigned_institute_from_email(email)
where assigned_institute is null
  and email is not null;

create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profile (
    id,
    email,
    full_name,
    role,
    assigned_institute,
    created_at
  )
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    'user',
    public.infer_assigned_institute_from_email(new.email),
    now()
  )
  on conflict (id) do update
    set email = excluded.email,
        assigned_institute = coalesce(public.profile.assigned_institute, excluded.assigned_institute);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert or update of email on auth.users
for each row execute function public.handle_new_auth_user_profile();

-- Keep saved_reports, but add just enough columns for ownership and simple sharing.
alter table public.saved_reports add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table public.saved_reports add column if not exists assigned_institute varchar;
alter table public.saved_reports add column if not exists shared_with_emails text[] not null default '{}';
alter table public.saved_reports add column if not exists shared_access jsonb not null default '{}'::jsonb;
alter table public.saved_reports add column if not exists updated_at timestamptz not null default now();

create index if not exists saved_reports_owner_idx on public.saved_reports(owner_id);
create index if not exists saved_reports_assigned_institute_idx on public.saved_reports(assigned_institute);

-- Backfill existing reports from the original profile table when possible.
update public.saved_reports sr
set owner_id = p.id,
    assigned_institute = coalesce(sr.assigned_institute, p.assigned_institute)
from public.profile p
where sr.owner_id is null
  and lower(coalesce(sr.author, '')) = lower(p.email);

-- Backfill newer legacy reports that stored the saving user inside layout_data.
update public.saved_reports sr
set owner_id = p.id,
    assigned_institute = coalesce(sr.assigned_institute, p.assigned_institute)
from public.profile p
where sr.owner_id is null
  and lower(coalesce(sr.layout_data->'reportSettings'->>'lastSavedBy', '')) = lower(p.email);

-- Infer older reports from the author email if no owner can be inferred.
update public.saved_reports
set assigned_institute = public.infer_assigned_institute_from_email(author)
where assigned_institute is null
  and author is not null;

-- Existing shared emails default to editor unless a role already exists.
update public.saved_reports sr
set shared_access = coalesce(roles.roles, '{}'::jsonb) || coalesce(sr.shared_access, '{}'::jsonb)
from (
  select
    id,
    jsonb_object_agg(lower(shared_email), 'editor') as roles
  from public.saved_reports,
    unnest(coalesce(shared_with_emails, '{}'::text[])) shared_email
  where shared_email is not null
  group by id
) roles
where sr.id = roles.id;

create or replace function public.current_assigned_institute()
returns varchar
language sql
stable
security definer
set search_path = public
as $$
  select assigned_institute
  from public.profile
  where id = auth.uid()
  limit 1
$$;

create or replace function public.current_profile_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profile
    where id = auth.uid()
      and role in ('admin', 'platform_admin')
  )
$$;

create or replace function public.current_user_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt()->>'email', auth.email(), ''))
$$;

create or replace function public.email_is_shared(shared_emails text[])
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from unnest(coalesce(shared_emails, '{}'::text[])) shared_email
    where lower(shared_email) = public.current_user_email()
  )
$$;

create or replace function public.current_user_owns_saved_report(report_owner_id uuid, report_layout_data jsonb, report_author text default null)
returns boolean
language sql
stable
as $$
  select
    report_owner_id = auth.uid()
    or (
      report_owner_id is null
      and (
        lower(coalesce(report_author, '')) = public.current_user_email()
        or (
          lower(coalesce(report_layout_data->'reportSettings'->>'lastSavedBy', '')) = public.current_user_email()
          and not exists (
            select 1
            from jsonb_array_elements_text(coalesce(report_layout_data->'reportSettings'->'sharedWith', '[]'::jsonb)) shared_email
            where lower(shared_email) = public.current_user_email()
          )
        )
      )
    )
$$;

create or replace function public.shared_email_can_edit(shared_emails text[], shared_access jsonb)
returns boolean
language sql
stable
as $$
  select
    public.email_is_shared(shared_emails)
    and coalesce(lower(shared_access ->> public.current_user_email()), 'editor') = 'editor'
$$;

create or replace function public.update_saved_report_access(
  p_report_id uuid,
  p_shared_with_emails text[],
  p_shared_access jsonb,
  p_layout_data jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_report public.saved_reports%rowtype;
  normalized_emails text[];
  normalized_access jsonb;
begin
  select *
  into target_report
  from public.saved_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'Report not found';
  end if;

  if not (
    public.current_profile_is_admin()
    or public.current_user_owns_saved_report(target_report.owner_id, target_report.layout_data, target_report.author)
  ) then
    raise exception 'Only the report owner can update access';
  end if;

  select coalesce(array_agg(distinct lower(trim(email_value))) filter (where trim(email_value) <> ''), '{}'::text[])
  into normalized_emails
  from unnest(coalesce(p_shared_with_emails, '{}'::text[])) email_value;

  normalized_access := coalesce(p_shared_access, '{}'::jsonb);

  update public.saved_reports
  set shared_with_emails = normalized_emails,
      shared_access = normalized_access,
      layout_data = p_layout_data,
      owner_id = coalesce(owner_id, auth.uid()),
      assigned_institute = coalesce(assigned_institute, public.current_assigned_institute()),
      updated_at = now()
  where id = p_report_id;
end;
$$;

create or replace function public.set_saved_report_simple_security_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := coalesce(new.owner_id, auth.uid());
    new.assigned_institute := coalesce(new.assigned_institute, public.current_assigned_institute());
  else
    if not public.current_profile_is_admin() then
      if public.current_user_owns_saved_report(old.owner_id, old.layout_data, old.author) then
        new.owner_id := coalesce(old.owner_id, new.owner_id, auth.uid());
      else
        new.owner_id := old.owner_id;
      end if;
      new.assigned_institute := old.assigned_institute;
      if not public.current_user_owns_saved_report(old.owner_id, old.layout_data, old.author) then
        new.shared_with_emails := old.shared_with_emails;
        new.shared_access := old.shared_access;
      end if;
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger saved_reports_simple_security_fields
before insert or update on public.saved_reports
for each row execute function public.set_saved_report_simple_security_fields();

alter table public.profile enable row level security;
alter table public.saved_reports enable row level security;

grant select on public.profile to authenticated;
grant update (full_name, last_logged_in) on public.profile to authenticated;
grant select, insert, update, delete on public.saved_reports to authenticated;
grant execute on function public.update_saved_report_access(uuid, text[], jsonb, jsonb) to authenticated;

drop policy if exists "profile read self or same institute" on public.profile;
create policy "profile read self or same institute"
on public.profile for select to authenticated
using (
  id = auth.uid()
  or assigned_institute = public.current_assigned_institute()
  or public.current_profile_is_admin()
);

drop policy if exists "profile update self" on public.profile;
create policy "profile update self"
on public.profile for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Remove older broad report policies and recursive draft policies.
drop policy if exists "Authenticated users can read saved reports" on public.saved_reports;
drop policy if exists "Authenticated users can create saved reports" on public.saved_reports;
drop policy if exists "Authenticated users can update saved reports" on public.saved_reports;
drop policy if exists "Authenticated users can delete saved reports" on public.saved_reports;
drop policy if exists "reports select scoped" on public.saved_reports;
drop policy if exists "reports insert own institute" on public.saved_reports;
drop policy if exists "reports update owner editor admin" on public.saved_reports;
drop policy if exists "reports delete owner admin" on public.saved_reports;
drop policy if exists "saved reports read simple" on public.saved_reports;
drop policy if exists "saved reports insert simple" on public.saved_reports;
drop policy if exists "saved reports update simple" on public.saved_reports;
drop policy if exists "saved reports delete simple" on public.saved_reports;

create policy "saved reports read simple"
on public.saved_reports for select to authenticated
using (
  public.current_user_owns_saved_report(owner_id, layout_data, author)
  or (
    assigned_institute = public.current_assigned_institute()
    and public.email_is_shared(shared_with_emails)
  )
  or (
    assigned_institute = public.current_assigned_institute()
    and public.current_profile_is_admin()
  )
);

create policy "saved reports insert simple"
on public.saved_reports for insert to authenticated
with check (
  owner_id = auth.uid()
  and assigned_institute = public.current_assigned_institute()
);

create policy "saved reports update simple"
on public.saved_reports for update to authenticated
using (
  public.current_user_owns_saved_report(owner_id, layout_data, author)
  or (
    assigned_institute = public.current_assigned_institute()
    and public.shared_email_can_edit(shared_with_emails, shared_access)
  )
  or (
    assigned_institute = public.current_assigned_institute()
    and public.current_profile_is_admin()
  )
)
with check (
  public.current_user_owns_saved_report(owner_id, layout_data, author)
  or (
    assigned_institute = public.current_assigned_institute()
    and public.shared_email_can_edit(shared_with_emails, shared_access)
  )
  or (
    assigned_institute = public.current_assigned_institute()
    and public.current_profile_is_admin()
  )
);

create policy "saved reports delete simple"
on public.saved_reports for delete to authenticated
using (public.current_user_owns_saved_report(owner_id, layout_data, author));

-- Transportation sensor data read security.
-- Service-role ingestion still bypasses RLS, but browser clients only see their institute.
create or replace function public.sensor_belongs_to_current_institute(target_sensor_id varchar)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sensors s
    where s.sensor_id = target_sensor_id
      and (
        s.institute_id = public.current_assigned_institute()
        or public.current_profile_is_admin()
      )
  )
$$;

alter table public.institutes enable row level security;
alter table public.sensors enable row level security;
alter table public.ten_minute_summaries enable row level security;

grant select on public.institutes to authenticated;
grant select on public.sensors to authenticated;
grant select on public.ten_minute_summaries to authenticated;

drop policy if exists "institutes read assigned simple" on public.institutes;
create policy "institutes read assigned simple"
on public.institutes for select to authenticated
using (
  institute_id = public.current_assigned_institute()
  or public.current_profile_is_admin()
);

drop policy if exists "sensors read assigned simple" on public.sensors;
create policy "sensors read assigned simple"
on public.sensors for select to authenticated
using (
  institute_id = public.current_assigned_institute()
  or public.current_profile_is_admin()
);

drop policy if exists "traffic summaries read assigned simple" on public.ten_minute_summaries;
create policy "traffic summaries read assigned simple"
on public.ten_minute_summaries for select to authenticated
using (public.sensor_belongs_to_current_institute(sensor_id));

commit;
