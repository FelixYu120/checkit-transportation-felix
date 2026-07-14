-- Emergency fix for:
-- ERROR: function public.is_platform_admin() does not exist
-- CONTEXT: PL/pgSQL function set_saved_report_security_fields()
--
-- Run this first, then rerun docs/supabase-simple-security.sql.

begin;

drop trigger if exists saved_reports_security_fields on public.saved_reports;
drop trigger if exists saved_reports_simple_security_fields on public.saved_reports;
drop function if exists public.set_saved_report_security_fields() cascade;

alter table public.saved_reports add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table public.saved_reports add column if not exists assigned_institute varchar;
alter table public.saved_reports add column if not exists shared_with_emails text[] not null default '{}';
alter table public.saved_reports add column if not exists updated_at timestamptz not null default now();

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

update public.profile
set assigned_institute = public.infer_assigned_institute_from_email(email)
where assigned_institute is null
  and email is not null;

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
      new.owner_id := old.owner_id;
      new.assigned_institute := old.assigned_institute;
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger saved_reports_simple_security_fields
before insert or update on public.saved_reports
for each row execute function public.set_saved_report_simple_security_fields();

commit;
