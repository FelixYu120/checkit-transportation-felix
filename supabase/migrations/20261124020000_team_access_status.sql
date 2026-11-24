-- Distinguish unfinished invitations from completed signup awaiting password login.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table checkit_accounts_private.member_signin_tracking (
  singleton boolean primary key default true check(singleton),
  started_at timestamptz not null default clock_timestamp()
);
insert into checkit_accounts_private.member_signin_tracking(singleton) values(true);
create table checkit_accounts_private.member_password_signins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_signed_in_at timestamptz not null
);
alter table checkit_accounts_private.member_signin_tracking enable row level security;
alter table checkit_accounts_private.member_password_signins enable row level security;
revoke all on checkit_accounts_private.member_signin_tracking,checkit_accounts_private.member_password_signins from public,anon,authenticated;

-- Use server-created password AMR claims, never email confirmations or a client flag.
insert into checkit_accounts_private.member_password_signins(user_id,first_signed_in_at)
select s.user_id,min(s.created_at) from auth.sessions s join auth.mfa_amr_claims a on a.session_id=s.id
where a.authentication_method='password'
  and checkit_accounts_private.active_setup_profile(s.user_id)
  and checkit_accounts_private.password_setup_complete(s.user_id)
group by s.user_id;

create function checkit_accounts_private.record_member_password_signin()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.authentication_method='password' then
    insert into checkit_accounts_private.member_password_signins(user_id,first_signed_in_at)
      select s.user_id,clock_timestamp() from auth.sessions s where s.id=new.session_id
        and checkit_accounts_private.active_setup_profile(s.user_id)
        and checkit_accounts_private.password_setup_complete(s.user_id)
      on conflict(user_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function checkit_accounts_private.record_member_password_signin() from public,anon,authenticated;
create trigger checkit_record_member_password_signin after insert on auth.mfa_amr_claims
for each row execute function checkit_accounts_private.record_member_password_signin();

create function public.team_member_access_status()
returns table(id uuid,access_status text,first_signed_in_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare actor public.profile;
begin
  select p.* into actor from public.profile p where p.id=auth.uid();
  if actor.id is null or actor.role not in ('admin','checkit_admin') or not public.portal_account_ready() then
    raise exception 'Admin access required.' using errcode='42501';
  end if;
  return query select p.id,
    case when t.user_id is not null and t.used_at is null then 'pending_invite'
      when seen.user_id is not null then 'joined'
      when t.used_at >= (select started_at from checkit_accounts_private.member_signin_tracking where singleton) then 'awaiting_sign_in'
      else 'unknown' end,
    seen.first_signed_in_at
  from public.profile p
    left join checkit_accounts_private.invitation_setups t on t.user_id=p.id
    left join checkit_accounts_private.member_password_signins seen on seen.user_id=p.id
  where checkit_accounts_private.active_setup_profile(p.id)
    and (actor.role='checkit_admin' or p.assigned_institute=actor.assigned_institute);
end $$;
revoke all on function public.team_member_access_status() from public,anon,authenticated;
grant execute on function public.team_member_access_status() to authenticated;
notify pgrst,'reload schema';
commit;
