-- Apply ONLY after the permanent-removal API and website are deployed.
-- This second phase prevents an unavailable deployment from blocking revocation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$ begin
  if to_regprocedure('public.finish_team_account_removal(uuid,uuid)') is null then
    raise exception 'Deploy permanent account-removal support first.';
  end if;
end $$;
-- Old clients must fail explicitly instead of reporting a partial detach as deletion.
create or replace function public.remove_team_member(target_profile_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin raise exception 'Refresh the portal to permanently remove this account.'; end $$;

commit;
