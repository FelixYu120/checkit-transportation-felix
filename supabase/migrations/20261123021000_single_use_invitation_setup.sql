-- Account setup requires an unused invitation, a fresh invitation session and
-- a server-enforced one-hour deadline. Existing password accounts keep login.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table auth.users in share row exclusive mode;
create table checkit_accounts_private.invitation_setups (
  user_id uuid primary key references auth.users(id) on delete cascade,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at>issued_at)
);
alter table checkit_accounts_private.invitation_setups enable row level security;
revoke all on checkit_accounts_private.invitation_setups from public,anon,authenticated;

insert into checkit_accounts_private.invitation_setups(user_id,issued_at,expires_at,used_at)
select id,invited_at,invited_at+interval '1 hour',
  case when nullif(encrypted_password,'') is not null then clock_timestamp() end
from auth.users where invited_at is not null;

create function checkit_accounts_private.active_setup_profile(subject_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profile p where p.id=subject_id
    and (p.role='checkit_admin' or (p.role in ('admin','field_operator','checkit_field_operator','viewer','user')
      and nullif(btrim(p.assigned_institute),'') is not null))
    and not exists(select 1 from checkit_accounts_private.removals r where r.target_id=p.id));
$$;

create function checkit_accounts_private.seed_invitation_setup()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.invited_at is null then return new; end if;
  if tg_op='UPDATE' and old.invited_at is not null then return new; end if;
  insert into checkit_accounts_private.invitation_setups(user_id,issued_at,expires_at,used_at)
  values(new.id,new.invited_at,new.invited_at+interval '1 hour',
    case when nullif(new.encrypted_password,'') is not null then clock_timestamp() end)
  on conflict(user_id) do nothing;
  return new;
end $$;
create trigger checkit_seed_invitation_setup after insert or update of invited_at on auth.users
  for each row execute function checkit_accounts_private.seed_invitation_setup();

create function public.authorize_invitation_delivery(actor_profile_id uuid,target_profile_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.profile; target public.profile; needs_setup boolean;
begin
  select * into actor from public.profile where id=actor_profile_id;
  if actor.id is null or actor.role not in ('admin','checkit_admin')
    or not checkit_accounts_private.active_setup_profile(actor.id)
    or not exists(select 1 from auth.users where id=actor.id and nullif(encrypted_password,'') is not null) then
    raise exception 'Admin access required.' using errcode='42501';
  end if;
  if target_profile_id is not null then
    select * into target from public.profile where id=target_profile_id;
    if target.id is null or not checkit_accounts_private.active_setup_profile(target.id) then
      raise exception 'Invite unavailable.' using errcode='42501';
    end if;
    if actor.role='admin' and (actor.assigned_institute is distinct from target.assigned_institute
      or target.role not in ('viewer','user','field_operator')) then
      raise exception 'Invite not allowed.' using errcode='42501';
    end if;
    select nullif(encrypted_password,'') is null into needs_setup from auth.users where id=target.id;
  end if;
  return jsonb_build_object('setup_required',coalesce(needs_setup,false),'delivery_started_at',clock_timestamp());
end $$;

create function public.record_invitation_delivery(actor_profile_id uuid,target_profile_id uuid,delivery_started_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare allowed jsonb; password_exists boolean; deadline timestamptz;
begin
  select nullif(encrypted_password,'') is not null into password_exists from auth.users where id=target_profile_id for update;
  if not found then raise exception 'User not found.'; end if;
  allowed := public.authorize_invitation_delivery(actor_profile_id,target_profile_id);
  if password_exists then return jsonb_build_object('setup_required',false); end if;
  if delivery_started_at is null or delivery_started_at>clock_timestamp()
    or delivery_started_at<clock_timestamp()-interval '5 minutes' then
    raise exception 'Send a new invite.';
  end if;
  if exists(select 1 from checkit_accounts_private.invitation_setups where user_id=target_profile_id and used_at is not null) then
    raise exception 'Invite already used.';
  end if;
  deadline := delivery_started_at+interval '1 hour';
  insert into checkit_accounts_private.invitation_setups(user_id,issued_at,expires_at)
  values(target_profile_id,delivery_started_at,deadline)
  on conflict(user_id) do update set issued_at=excluded.issued_at,expires_at=excluded.expires_at;
  return jsonb_build_object('setup_required',true,'expires_at',deadline);
end $$;

create function public.invitation_setup_status()
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
    return jsonb_build_object('eligible',false,'reason','completed','user_id',subject_id);
  end if;
  if ticket.used_at is not null then return jsonb_build_object('eligible',false,'reason','invitation_required','user_id',subject_id); end if;
  if ticket.user_id is null then return jsonb_build_object('eligible',false,'reason','invitation_required','user_id',subject_id); end if;
  if ticket.expires_at<=clock_timestamp() then return jsonb_build_object('eligible',false,'reason','expired','user_id',subject_id); end if;
  session_id := auth.jwt()->>'session_id';
  if not exists(select 1 from auth.sessions s where s.id::text=session_id and s.user_id=subject_id and s.created_at>=ticket.issued_at and (s.not_after is null or s.not_after>clock_timestamp())) then
    return jsonb_build_object('eligible',false,'reason','open_latest_invitation','user_id',subject_id);
  end if;
  return jsonb_build_object('eligible',true,'user_id',subject_id,'expires_at',ticket.expires_at,
    'remaining_seconds',greatest(0,extract(epoch from ticket.expires_at-clock_timestamp())));
end $$;

create function checkit_accounts_private.consume_first_password_setup()
returns trigger language plpgsql security definer set search_path='' as $$
declare ticket checkit_accounts_private.invitation_setups;
begin
  if nullif(old.encrypted_password,'') is not null or nullif(new.encrypted_password,'') is null then return new; end if;
  select * into ticket from checkit_accounts_private.invitation_setups where user_id=new.id for update;
  if ticket.user_id is null or ticket.used_at is not null or ticket.expires_at<=clock_timestamp()
    or not checkit_accounts_private.active_setup_profile(new.id)
    or not exists(select 1 from auth.sessions s where s.user_id=new.id and s.created_at>=ticket.issued_at and (s.not_after is null or s.not_after>clock_timestamp())) then
    raise exception 'Invite expired or used.' using errcode='42501';
  end if;
  update checkit_accounts_private.invitation_setups set used_at=clock_timestamp() where user_id=new.id;
  return new;
end $$;
create trigger checkit_consume_first_password_setup before update of encrypted_password on auth.users
  for each row execute function checkit_accounts_private.consume_first_password_setup();

revoke all on all functions in schema checkit_accounts_private from public,anon,authenticated;
revoke all on function public.authorize_invitation_delivery(uuid,uuid),public.record_invitation_delivery(uuid,uuid,timestamptz),public.invitation_setup_status() from public,anon,authenticated;
grant execute on function public.authorize_invitation_delivery(uuid,uuid),public.record_invitation_delivery(uuid,uuid,timestamptz) to service_role;
grant execute on function public.invitation_setup_status() to authenticated;
commit;
