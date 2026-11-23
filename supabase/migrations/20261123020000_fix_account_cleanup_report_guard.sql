-- Preserve report ownership checks for normal users while allowing the verified,
-- server-only removal transaction to transfer company records before deletion.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create or replace function public.set_saved_report_simple_security_fields()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- Keep private-schema access inside the trusted-role branch. An ordinary
  -- client must not even plan a query against the private removal table.
  if current_user='postgres' then
    if nullif(current_setting('checkit.removal_target',true),'') is not null
      and exists(select 1 from checkit_accounts_private.removals
        where target_id::text=current_setting('checkit.removal_target',true)) then
      new.updated_at := now();
      return new;
    end if;
  end if;
  if tg_op='INSERT' then
    new.owner_id := coalesce(new.owner_id,auth.uid());
    new.assigned_institute := coalesce(new.assigned_institute,public.current_assigned_institute());
    new.updated_at := coalesce(new.updated_at,now());
  else
    if not public.current_profile_is_admin() then
      if public.current_user_owns_saved_report(old.owner_id,old.layout_data,old.author) then
        new.owner_id := coalesce(old.owner_id,new.owner_id,auth.uid());
      else
        new.owner_id := old.owner_id;
        new.shared_with_emails := old.shared_with_emails;
        new.shared_access := old.shared_access;
      end if;
      new.assigned_institute := old.assigned_institute;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
-- Retryable work stays in the ordinary directory with its original role.
create or replace function public.pending_team_account_removals()
returns table(id uuid,full_name text,email text,role text,assigned_institute text)
language sql stable security definer set search_path='' as $$
 select p.id,p.full_name,p.email,d.original_role,d.original_institute
 from public.profile p join checkit_accounts_private.removals d on d.target_id=p.id
 join public.profile a on a.id=auth.uid()
 where a.id<>p.id and (a.role='checkit_admin' or (a.role='admin'
   and a.assigned_institute=d.original_institute and d.original_role in ('viewer','user','field_operator')));
$$;
create or replace function public.remove_team_member(target_profile_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin raise exception 'Refresh the portal to remove this user.'; end $$;
commit;
