-- Email verification permits setup only; portal access requires password login.
-- No existing account or credential is removed by applying this migration.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table checkit_accounts_private.password_reset_setups (
  user_id uuid primary key references auth.users(id) on delete cascade,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at>issued_at)
);
alter table checkit_accounts_private.password_reset_setups enable row level security;
revoke all on checkit_accounts_private.password_reset_setups from public,anon,authenticated;
insert into checkit_accounts_private.password_reset_setups(user_id,issued_at,expires_at)
select id,recovery_sent_at,recovery_sent_at+interval '15 minutes' from auth.users
where nullif(encrypted_password,'') is not null and recovery_sent_at>clock_timestamp()-interval '15 minutes';

create function checkit_accounts_private.seed_password_reset_setup()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.recovery_sent_at is null or nullif(new.encrypted_password,'') is null then return new; end if;
  if tg_op='UPDATE' and new.recovery_sent_at is not distinct from old.recovery_sent_at then return new; end if;
  insert into checkit_accounts_private.password_reset_setups(user_id,issued_at,expires_at,used_at)
  values(new.id,new.recovery_sent_at,new.recovery_sent_at+interval '15 minutes',null)
  on conflict(user_id) do update set issued_at=excluded.issued_at,expires_at=excluded.expires_at,used_at=null;
  return new;
end $$;
create trigger checkit_seed_password_reset_setup after insert or update of recovery_sent_at on auth.users
  for each row execute function checkit_accounts_private.seed_password_reset_setup();
revoke all on function checkit_accounts_private.seed_password_reset_setup() from public,anon,authenticated;

create function public.password_reset_status()
returns jsonb language plpgsql security definer set search_path='' as $$
declare subject_id uuid:=auth.uid(); ticket checkit_accounts_private.password_reset_setups;
begin
  if subject_id is null or not checkit_accounts_private.active_setup_profile(subject_id)
    or not exists(select 1 from auth.users where id=subject_id and nullif(encrypted_password,'') is not null) then
    return jsonb_build_object('eligible',false);
  end if;
  select * into ticket from checkit_accounts_private.password_reset_setups where user_id=subject_id;
  if ticket.user_id is null or ticket.used_at is not null or ticket.expires_at<=clock_timestamp() then
    return jsonb_build_object('eligible',false);
  end if;
  if not exists(select 1 from auth.sessions s join auth.mfa_amr_claims a on a.session_id=s.id
    where s.user_id=subject_id and s.id::text=auth.jwt()->>'session_id'
      and s.created_at>=ticket.issued_at and (s.not_after is null or s.not_after>clock_timestamp())
      and a.authentication_method='recovery') then
    return jsonb_build_object('eligible',false);
  end if;
  return jsonb_build_object('eligible',true,'user_id',subject_id,
    'remaining_seconds',greatest(0,extract(epoch from ticket.expires_at-clock_timestamp())));
end $$;
revoke all on function public.password_reset_status() from public,anon,authenticated;
grant execute on function public.password_reset_status() to authenticated;


create or replace function public.authorize_invitation_delivery(actor_profile_id uuid,target_profile_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profile; target public.profile;
begin
  select * into actor from public.profile where id=actor_profile_id;
  if actor.id is null or actor.role not in ('admin','checkit_admin')
    or not checkit_accounts_private.active_setup_profile(actor.id)
    or not exists(select 1 from auth.users where id=actor.id and nullif(encrypted_password,'') is not null) then
    raise exception 'Admin access required.' using errcode='42501';
  end if;
  if target_profile_id=actor_profile_id then
    raise exception 'You cannot invite yourself.' using errcode='42501';
  end if;
  if target_profile_id is not null then
    select * into target from public.profile where id=target_profile_id;
    if target.id is null or not checkit_accounts_private.active_setup_profile(target.id) then
      raise exception 'Invite unavailable.' using errcode='42501';
    end if;
    if exists(select 1 from auth.users where id=target.id and nullif(encrypted_password,'') is not null) then
      raise exception 'User already has an account.' using errcode='23505';
    end if;
    if actor.role='admin' and (actor.assigned_institute is distinct from target.assigned_institute
      or target.role not in ('viewer','user','field_operator')) then
      raise exception 'Invite not allowed.' using errcode='42501';
    end if;
  end if;
  return jsonb_build_object('setup_required',target_profile_id is not null,'delivery_started_at',clock_timestamp());
end $$;

create or replace function public.record_invitation_delivery(actor_profile_id uuid,target_profile_id uuid,delivery_started_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare allowed jsonb; ticket checkit_accounts_private.invitation_setups; deadline timestamptz;
begin
  perform 1 from auth.users where id=target_profile_id for update;
  if not found then raise exception 'User not found.'; end if;
  allowed := public.authorize_invitation_delivery(actor_profile_id,target_profile_id);
  if delivery_started_at is null or delivery_started_at>clock_timestamp()
    or delivery_started_at<clock_timestamp()-interval '5 minutes' then
    raise exception 'Send a new invite.';
  end if;
  select * into ticket from checkit_accounts_private.invitation_setups where user_id=target_profile_id for update;
  if ticket.delivery_recorded and ticket.issued_at>delivery_started_at then raise exception 'Open the latest invite.'; end if;
  -- A retry of the same successful delivery must not undo completed setup.
  if ticket.delivery_recorded and ticket.issued_at=delivery_started_at then
    return jsonb_build_object('setup_required',ticket.used_at is null,'expires_at',ticket.expires_at);
  end if;
  deadline := delivery_started_at+interval '15 minutes';
  insert into checkit_accounts_private.invitation_setups(user_id,issued_at,expires_at,used_at,delivery_recorded)
  values(target_profile_id,delivery_started_at,deadline,null,true)
  on conflict(user_id) do update set issued_at=excluded.issued_at,expires_at=excluded.expires_at,used_at=null,delivery_recorded=true;
  delete from auth.refresh_tokens r where r.user_id=target_profile_id::text and not exists(
    select 1 from auth.sessions s join auth.mfa_amr_claims a on a.session_id=s.id
    where s.id=r.session_id and s.user_id=target_profile_id and s.created_at>=delivery_started_at
      and a.authentication_method in ('invite','otp','magiclink'));
  delete from auth.sessions s where s.user_id=target_profile_id and not (
    s.created_at>=delivery_started_at and exists(select 1 from auth.mfa_amr_claims a
      where a.session_id=s.id and a.authentication_method in ('invite','otp','magiclink')));
  return jsonb_build_object('setup_required',true,'expires_at',deadline);
end $$;

create or replace function checkit_accounts_private.consume_first_password_setup()
returns trigger language plpgsql security definer set search_path='' as $$
declare ticket checkit_accounts_private.invitation_setups;
begin
  if new.encrypted_password is not distinct from old.encrypted_password then return new; end if;
  if nullif(old.encrypted_password,'') is not null then
    -- Normal account password changes also invalidate outstanding reset links.
    update checkit_accounts_private.password_reset_setups set used_at=clock_timestamp()
      where user_id=new.id and used_at is null;
    return new;
  end if;
  if nullif(new.encrypted_password,'') is null then return new; end if;
  select * into ticket from checkit_accounts_private.invitation_setups where user_id=new.id for update;
  if ticket.user_id is null or ticket.used_at is not null or ticket.expires_at<=clock_timestamp()
    or not checkit_accounts_private.active_setup_profile(new.id)
    or not exists(select 1 from auth.sessions s where s.user_id=new.id and s.created_at>=ticket.issued_at and (s.not_after is null or s.not_after>clock_timestamp()) and exists(select 1 from auth.mfa_amr_claims a where a.session_id=s.id and a.authentication_method in ('invite','otp','magiclink'))) then
    raise exception 'Invite expired or used.' using errcode='42501';
  end if;
  update checkit_accounts_private.invitation_setups set used_at=clock_timestamp() where user_id=new.id;
  return new;
end $$;

-- Older clients sign out for login_required, avoiding a signup/login redirect loop.
create or replace function public.invitation_setup_status()
returns jsonb language plpgsql security definer set search_path='' as $$
declare subject_id uuid:=auth.uid(); person auth.users; ticket checkit_accounts_private.invitation_setups; session_id text;
begin
  if subject_id is null then return jsonb_build_object('eligible',false,'reason','invitation_required'); end if;
  select * into person from auth.users where id=subject_id;
  if person.id is null or not checkit_accounts_private.active_setup_profile(subject_id) then
    return jsonb_build_object('eligible',false,'reason','revoked','user_id',subject_id);
  end if;
  select * into ticket from checkit_accounts_private.invitation_setups where user_id=subject_id;
  if nullif(person.encrypted_password,'') is not null then
    return jsonb_build_object('eligible',false,'reason','login_required','user_id',subject_id);
  end if;
  if ticket.used_at is not null then return jsonb_build_object('eligible',false,'reason','invitation_required','user_id',subject_id); end if;
  if ticket.user_id is null then return jsonb_build_object('eligible',false,'reason','invitation_required','user_id',subject_id); end if;
  if ticket.expires_at<=clock_timestamp() then return jsonb_build_object('eligible',false,'reason','expired','user_id',subject_id); end if;
  session_id := auth.jwt()->>'session_id';
  if not exists(select 1 from auth.sessions s where s.id::text=session_id and s.user_id=subject_id and s.created_at>=ticket.issued_at and (s.not_after is null or s.not_after>clock_timestamp()) and exists(select 1 from auth.mfa_amr_claims a where a.session_id=s.id and a.authentication_method in ('invite','otp','magiclink'))) then
    return jsonb_build_object('eligible',false,'reason','open_latest_invitation','user_id',subject_id);
  end if;
  return jsonb_build_object('eligible',true,'user_id',subject_id,'expires_at',ticket.expires_at,
    'remaining_seconds',greatest(0,extract(epoch from ticket.expires_at-clock_timestamp())));
end $$;

create or replace function public.portal_account_ready()
returns boolean language sql stable security definer set search_path='' as $$
  select checkit_accounts_private.active_setup_profile(auth.uid())
    and exists(select 1 from auth.users u where u.id=auth.uid() and nullif(u.encrypted_password,'') is not null)
    and exists(select 1 from auth.sessions s join auth.mfa_amr_claims a on a.session_id=s.id
      where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id'
      and (s.not_after is null or s.not_after>clock_timestamp()) and a.authentication_method='password');
$$;

commit;
