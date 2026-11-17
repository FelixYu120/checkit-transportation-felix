-- Applied to the Transportation database on 2026-11-17.
-- Repair the live team-removal permission check without changing its signature,
-- SECURITY DEFINER behavior, existing EXECUTE grants, or self-removal protection.
-- Removing membership keeps the account, clears the institute, and resets its role.
CREATE OR REPLACE FUNCTION public.remove_team_member(target_profile_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor public.profile;
  target public.profile;
begin
  select * into actor from public.profile where id = auth.uid();
  select * into target from public.profile where id = target_profile_id;

  if actor.id is null or target.id is null then
    raise exception 'Profile not found.';
  end if;

  if actor.id = target.id then
    raise exception 'You cannot remove yourself.';
  end if;

  if actor.role is null or actor.role not in ('admin', 'checkit_admin') then
    raise exception 'Only admins can remove team members.';
  end if;

  if actor.role = 'admin' and (actor.assigned_institute is null or actor.assigned_institute is distinct from target.assigned_institute) then
    raise exception 'You can only remove members in your institution.';
  end if;

  -- Only institution admins are restricted by the target member's role.
  -- CheckIt admins may remove any other member, including system admins.
  if actor.role = 'admin' and (target.role is null or target.role not in ('field_operator', 'viewer', 'user')) then
    raise exception 'You can only remove field operators or viewers.';
  end if;

  update public.profile
  set assigned_institute = null,
      role = 'viewer'
  where id = target_profile_id;

  return true;
end;
$function$;
