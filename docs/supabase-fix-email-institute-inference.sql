-- Fix institute inference so personal email domains such as gmail.com do not
-- get written into profile.assigned_institute.
--
-- This only returns an institute when the email domain maps to an existing
-- public.institutes.institute_id or normalized full_name. Otherwise it returns NULL.

begin;

create or replace function public.infer_assigned_institute_from_email(user_email text)
returns varchar
language sql
stable
security definer
set search_path = public
as $$
  with parsed as (
    select string_to_array(lower(split_part(coalesce(user_email, ''), '@', 2)), '.') as domain_parts
  ),
  normalized as (
    select
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

-- Clear any accidental non-institute assignments if they were inserted before
-- the foreign key was added or enforced.
update public.profile p
set assigned_institute = null
where assigned_institute is not null
  and not exists (
    select 1
    from public.institutes i
    where i.institute_id = p.assigned_institute
  );

-- Refill only emails that cleanly map to an existing institute.
update public.profile
set assigned_institute = public.infer_assigned_institute_from_email(email)
where assigned_institute is null
  and public.infer_assigned_institute_from_email(email) is not null;

commit;
