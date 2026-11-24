-- Respect GoTrue's provider password seed; track human completion explicitly.
-- Applying this repair does not reset, delete or sign in any account.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create function checkit_accounts_private.password_setup_complete(subject_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users u where u.id=subject_id and nullif(u.encrypted_password,'') is not null)
    and not exists(select 1 from checkit_accounts_private.invitation_setups t where t.user_id=subject_id and t.used_at is null);
$$;
revoke all on function checkit_accounts_private.password_setup_complete(uuid) from public,anon,authenticated;


create or replace function public.authorize_invitation_delivery(actor_profile_id uuid,target_profile_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profile; target public.profile;
begin
  select * into actor from public.profile where id=actor_profile_id;
  if actor.id is null or actor.role not in ('admin','checkit_admin')
    or not checkit_accounts_private.active_setup_profile(actor.id)
    or not checkit_accounts_private.password_setup_complete(actor.id) then
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
    if checkit_accounts_private.password_setup_complete(target.id) then
      raise exception 'User already has an account.' using errcode='23505';
    end if;
    if actor.role='admin' and (actor.assigned_institute is distinct from target.assigned_institute
      or target.role not in ('viewer','user','field_operator')) then
      raise exception 'Invite not allowed.' using errcode='42501';
    end if;
  end if;
  return jsonb_build_object('setup_required',target_profile_id is not null,'delivery_started_at',clock_timestamp());
end $$;

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
  if checkit_accounts_private.password_setup_complete(subject_id) then
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

create or replace function checkit_accounts_private.consume_first_password_setup()
returns trigger language plpgsql security definer set search_path='' as $$
declare ticket checkit_accounts_private.invitation_setups;
begin
  if new.encrypted_password is not distinct from old.encrypted_password then return new; end if;
  select * into ticket from checkit_accounts_private.invitation_setups where user_id=new.id for update;
  if ticket.user_id is not null and ticket.used_at is null then
    if ticket.expires_at<=clock_timestamp() or not checkit_accounts_private.active_setup_profile(new.id) then
      raise exception 'Invite expired or used.' using errcode='42501';
    end if;
    -- GoTrue verifies a new invitation by setting an unknown random password
    -- before confirming the email and before issuing its first OTP session.
    -- That provider step is not the invited person choosing their password.
    if session_user in ('supabase_auth_admin','postgres')
      and nullif(old.encrypted_password,'') is null and nullif(new.encrypted_password,'') is not null
      and old.email_confirmed_at is null and new.email_confirmed_at is null
      and not exists(select 1 from auth.sessions s where s.user_id=new.id and s.created_at>=ticket.issued_at) then
      return new;
    end if;
    if nullif(new.encrypted_password,'') is null or not exists(
      select 1 from auth.sessions s join auth.mfa_amr_claims a on a.session_id=s.id
      where s.user_id=new.id and s.created_at>=ticket.issued_at and (s.not_after is null or s.not_after>clock_timestamp())
        and a.authentication_method in ('invite','otp','magiclink')) then
      raise exception 'Open the latest invite.' using errcode='42501';
    end if;
    update checkit_accounts_private.invitation_setups set used_at=clock_timestamp() where user_id=new.id;
    return new;
  end if;
  if nullif(old.encrypted_password,'') is null and nullif(new.encrypted_password,'') is not null then
    raise exception 'Invite expired or used.' using errcode='42501';
  end if;
  update checkit_accounts_private.password_reset_setups set used_at=clock_timestamp()
    where user_id=new.id and used_at is null;
  return new;
end $$;

create or replace function checkit_accounts_private.seed_password_reset_setup()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.recovery_sent_at is null or not checkit_accounts_private.password_setup_complete(new.id) then return new; end if;
  if tg_op='UPDATE' and new.recovery_sent_at is not distinct from old.recovery_sent_at then return new; end if;
  insert into checkit_accounts_private.password_reset_setups(user_id,issued_at,expires_at,used_at)
  values(new.id,new.recovery_sent_at,new.recovery_sent_at+interval '15 minutes',null)
  on conflict(user_id) do update set issued_at=excluded.issued_at,expires_at=excluded.expires_at,used_at=null;
  return new;
end $$;

create or replace function public.password_reset_status()
returns jsonb language plpgsql security definer set search_path='' as $$
declare subject_id uuid:=auth.uid(); ticket checkit_accounts_private.password_reset_setups;
begin
  if subject_id is null or not checkit_accounts_private.active_setup_profile(subject_id)
    or not checkit_accounts_private.password_setup_complete(subject_id) then
    return jsonb_build_object('eligible',false);
  end if;
  select * into ticket from checkit_accounts_private.password_reset_setups where user_id=subject_id;
  if ticket.user_id is null or ticket.used_at is not null or ticket.expires_at<=clock_timestamp() then
    return jsonb_build_object('eligible',false);
  end if;
  if not exists(select 1 from auth.sessions s join auth.mfa_amr_claims a on a.session_id=s.id
    where s.user_id=subject_id and s.id::text=auth.jwt()->>'session_id'
      and s.created_at>=ticket.issued_at and (s.not_after is null or s.not_after>clock_timestamp())
      and a.authentication_method in ('recovery','otp')) then
    return jsonb_build_object('eligible',false);
  end if;
  return jsonb_build_object('eligible',true,'user_id',subject_id,
    'remaining_seconds',greatest(0,extract(epoch from ticket.expires_at-clock_timestamp())));
end $$;

create or replace function public.portal_account_ready()
returns boolean language sql stable security definer set search_path='' as $$
  select checkit_accounts_private.active_setup_profile(auth.uid())
    and checkit_accounts_private.password_setup_complete(auth.uid())
    and exists(select 1 from auth.sessions s join auth.mfa_amr_claims a on a.session_id=s.id
      where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id'
      and (s.not_after is null or s.not_after>clock_timestamp()) and a.authentication_method='password');
$$;

create function public.pending_team_invitations()
returns table(id uuid, invitation_sent_at timestamptz, invitation_expires_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare actor public.profile;
begin
  select p.* into actor from public.profile p where p.id=auth.uid();
  if actor.id is null or actor.role not in ('admin','checkit_admin') or not public.portal_account_ready() then
    raise exception 'Admin access required.' using errcode='42501';
  end if;
  return query select p.id,t.issued_at,t.expires_at
    from public.profile p join checkit_accounts_private.invitation_setups t on t.user_id=p.id
    where p.id<>actor.id and t.used_at is null and checkit_accounts_private.active_setup_profile(p.id)
      and (actor.role='checkit_admin' or (p.assigned_institute=actor.assigned_institute and p.role in ('viewer','user','field_operator')));
end $$;
revoke all on function public.pending_team_invitations() from public,anon,authenticated;
grant execute on function public.pending_team_invitations() to authenticated;

notify pgrst, 'reload schema';
commit;
