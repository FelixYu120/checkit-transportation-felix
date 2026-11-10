-- Additive Insights Studio workflow. Apply this migration alone: other pending
-- telemetry migrations have separate rollout requirements.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create schema if not exists checkit_reports_private;
revoke all on schema checkit_reports_private from public, anon;
grant usage on schema checkit_reports_private to authenticated;

create table public.insight_report_versions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.saved_reports(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  status text not null check (status in ('draft','in_review','reviewed','published','changes_requested','superseded')),
  submitted_by uuid not null references public.profile(id),
  submitted_at timestamptz not null default now(),
  reviewer_id uuid references public.profile(id),
  reviewed_by uuid references public.profile(id),
  reviewed_at timestamptz,
  review_note text not null default '',
  published_by uuid references public.profile(id),
  published_at timestamptz,
  unique(report_id, version_number),
  check (reviewer_id <> submitted_by),
  check (status = 'draft' or reviewer_id is not null)
);
create table public.insight_report_workflows (
  report_id uuid primary key references public.saved_reports(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','in_review','reviewed','published')),
  active_version_id uuid references public.insight_report_versions(id),
  published_version_id uuid references public.insight_report_versions(id),
  updated_at timestamptz not null default now()
);
create table public.insight_report_comments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.saved_reports(id) on delete cascade,
  version_id uuid references public.insight_report_versions(id),
  element_id text,
  body text not null check (length(btrim(body)) between 1 and 5000),
  author_id uuid not null references public.profile(id),
  author_label text not null,
  created_at timestamptz not null default now()
);
create table public.insight_report_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.saved_reports(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 240),
  assigned_to uuid not null references public.profile(id),
  due_date date not null,
  intervention_date date,
  status text not null default 'open' check (status in ('open','in_progress','done')),
  outcome text not null default '' check (length(outcome) <= 5000),
  baseline_version_id uuid references public.insight_report_versions(id),
  followup_version_id uuid references public.insight_report_versions(id),
  created_by uuid not null references public.profile(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'done' or length(btrim(outcome)) >= 5)
);
create table public.insight_report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.saved_reports(id) on delete cascade,
  event text not null,
  actor_id uuid references public.profile(id),
  actor_label text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index insight_versions_reviewer_idx on public.insight_report_versions(reviewer_id);
create index insight_comments_report_idx on public.insight_report_comments(report_id, created_at desc);
create index insight_actions_report_idx on public.insight_report_actions(report_id, created_at desc);
create index insight_actions_assignee_idx on public.insight_report_actions(assigned_to, due_date);
create index insight_events_report_idx on public.insight_report_events(report_id, created_at desc);

-- These helpers are private to the database API. All authorization comes from
-- server-owned profiles and the existing explicit report shares, never user metadata.
create function checkit_reports_private.access(p_report_id uuid, p_user_id uuid, p_edit boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null and exists (
    select 1 from public.saved_reports r
    join public.profile owner on owner.id = r.owner_id
    join public.profile actor on actor.id = p_user_id
    where r.id = p_report_id
      and (actor.assigned_institute = coalesce(nullif(r.assigned_institute,''), nullif(to_jsonb(r)->>'institute_id',''), owner.assigned_institute) or actor.role = 'checkit_admin')
      and (not p_edit or lower(btrim(coalesce(actor.role,''))) in ('field_operator','admin','checkit_field_operator','checkit_admin'))
      and (r.owner_id = p_user_id or (
        lower(actor.email) = any(coalesce(r.shared_with_emails, array[]::text[]))
        and (not p_edit or r.shared_access ->> lower(actor.email) = 'editor')
      ))
  );
$$;
revoke all on function checkit_reports_private.access(uuid,uuid,boolean) from public, anon;
grant execute on function checkit_reports_private.access(uuid,uuid,boolean) to authenticated;

alter table public.insight_report_versions enable row level security;
alter table public.insight_report_workflows enable row level security;
alter table public.insight_report_comments enable row level security;
alter table public.insight_report_actions enable row level security;
alter table public.insight_report_events enable row level security;
revoke all on public.insight_report_versions, public.insight_report_workflows, public.insight_report_comments,
  public.insight_report_actions, public.insight_report_events from public, anon, authenticated;
grant select on public.insight_report_versions, public.insight_report_workflows, public.insight_report_comments,
  public.insight_report_actions, public.insight_report_events to authenticated;
create policy insight_versions_read on public.insight_report_versions for select to authenticated
  using (checkit_reports_private.access(report_id,(select auth.uid()),false));
create policy insight_workflows_read on public.insight_report_workflows for select to authenticated
  using (checkit_reports_private.access(report_id,(select auth.uid()),false));
create policy insight_comments_read on public.insight_report_comments for select to authenticated
  using (checkit_reports_private.access(report_id,(select auth.uid()),false));
create policy insight_actions_read on public.insight_report_actions for select to authenticated
  using (checkit_reports_private.access(report_id,(select auth.uid()),false));
create policy insight_events_read on public.insight_report_events for select to authenticated
  using (checkit_reports_private.access(report_id,(select auth.uid()),false));

create function checkit_reports_private.document(p_report public.saved_reports)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('title', p_report.title, 'author', p_report.author, 'date', p_report.date,
    'period', p_report.period, 'layout_data', p_report.layout_data);
$$;
-- Sharing and save timestamps do not change the data or conclusions being reviewed.
create function checkit_reports_private.comparable(p_document jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_document->'layout_data')='object' then
    jsonb_set(p_document, '{layout_data,reportSettings}',
      coalesce(p_document #> '{layout_data,reportSettings}', '{}'::jsonb)
        - 'sharedWith' - 'sharedAccess' - 'lastSavedAt' - 'lastSavedBy', true)
    else p_document end;
$$;
revoke all on function checkit_reports_private.document(public.saved_reports),
  checkit_reports_private.comparable(jsonb) from public, anon, authenticated;

create function checkit_reports_private.invalidate_review()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); actor_label text; saved_id uuid;
begin
  if actor is null or not checkit_reports_private.access(new.id,actor,true) then return new; end if;
  if tg_op='UPDATE' then
    if checkit_reports_private.comparable(checkit_reports_private.document(old))
      is not distinct from checkit_reports_private.comparable(checkit_reports_private.document(new)) then return new; end if;
    update public.insight_report_versions set status='superseded'
      where id=(select active_version_id from public.insight_report_workflows where report_id=new.id)
        and status in ('in_review','reviewed');
  end if;
  insert into public.insight_report_workflows(report_id) values(new.id) on conflict do nothing;
  update public.insight_report_workflows set status='draft',active_version_id=null,updated_at=now() where report_id=new.id;
  insert into public.insight_report_versions(report_id,version_number,snapshot,status,submitted_by)
    values(new.id,(select coalesce(max(version_number),0)+1 from public.insight_report_versions where report_id=new.id),
      checkit_reports_private.document(new),'draft',actor) returning id into saved_id;
  select coalesce(nullif(full_name,''),email) into actor_label from public.profile where id=actor;
  insert into public.insight_report_events(report_id,event,actor_id,actor_label,detail)
    values(new.id,'saved_draft',actor,actor_label,jsonb_build_object('record_id',saved_id));
  return new;
end;
$$;
revoke all on function checkit_reports_private.invalidate_review() from public, anon, authenticated;
create trigger insight_report_edit_invalidates_review after insert or update on public.saved_reports
  for each row execute function checkit_reports_private.invalidate_review();

create function checkit_reports_private.freeze_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.snapshot is distinct from old.snapshot or new.report_id <> old.report_id
    or new.version_number <> old.version_number or new.submitted_by <> old.submitted_by
    or new.submitted_at <> old.submitted_at or new.reviewer_id <> old.reviewer_id then
    raise exception 'Saved report versions are immutable.' using errcode='42501';
  end if;
  if old.status='published' and new is distinct from old then
    raise exception 'Published report versions are immutable.' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function checkit_reports_private.freeze_version() from public, anon, authenticated;
create trigger insight_version_frozen before update on public.insight_report_versions
  for each row execute function checkit_reports_private.freeze_version();

create function checkit_reports_private.command(p_report_id uuid, p_command text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  actor_label text;
  r public.saved_reports;
  w public.insight_report_workflows;
  v public.insight_report_versions;
  reviewer uuid;
  new_id uuid;
  version_id uuid;
  action_row public.insight_report_actions;
begin
  if not checkit_reports_private.access(p_report_id,actor,true) then
    raise exception 'Editor access to this report is required.' using errcode='42501';
  end if;
  select * into strict r from public.saved_reports where id=p_report_id for update;
  select coalesce(nullif(full_name,''), email) into actor_label from public.profile where id=actor;
  insert into public.insight_report_workflows(report_id) values(p_report_id) on conflict do nothing;
  select * into strict w from public.insight_report_workflows where report_id=p_report_id for update;

  if p_command='submit' then
    if w.status='in_review' then raise exception 'This report is already in review.'; end if;
    reviewer := (p_payload->>'reviewer_id')::uuid;
    if reviewer=actor or not checkit_reports_private.access(p_report_id,reviewer,true) then
      raise exception 'Choose a different editor from this report''s team to review it.';
    end if;
    if jsonb_typeof(r.layout_data->'elements') is distinct from 'array' then raise exception 'Save the report before requesting review.'; end if;
    if exists(select 1 from jsonb_array_elements(r.layout_data->'elements') e where e->'dataEvidence'->>'isDemo'='true') then
      raise exception 'Demo data cannot be submitted for enterprise review. Connect to live report data first.';
    end if;
    if not exists(select 1 from jsonb_array_elements(r.layout_data->'elements') e
      where e->>'type'='chart' and jsonb_typeof(e->'snapshotData')='array' and jsonb_array_length(e->'snapshotData')>0 and coalesce((e->'dataEvidence'->>'sourceRows')::integer,0)>0) then
      raise exception 'Load and save at least one chart with observed data before requesting review.';
    end if;
    if exists(select 1 from jsonb_array_elements(r.layout_data->'elements') e
      where e->>'type'='chart' and (jsonb_typeof(e->'snapshotData') is distinct from 'array'
        or jsonb_array_length(e->'snapshotData')=0 or jsonb_typeof(e->'dataEvidence') is distinct from 'object')) then
      raise exception 'Every chart needs saved data and source details. Refresh missing charts and save again.';
    end if;
    if exists(select 1 from jsonb_array_elements(r.layout_data->'elements') e where e->>'type'='summary'
      and (jsonb_typeof(e->'snapshotData') is distinct from 'object' or e->'snapshotData'='{}'::jsonb)) then
      raise exception 'Save the displayed KPI values before requesting review. Wait for the cards to finish loading.';
    end if;
    insert into public.insight_report_versions(report_id,version_number,snapshot,status,submitted_by,reviewer_id)
      values(p_report_id,(select coalesce(max(version_number),0)+1 from public.insight_report_versions where report_id=p_report_id),
        checkit_reports_private.document(r),'in_review',actor,reviewer) returning id into new_id;
    update public.insight_report_workflows set status='in_review',active_version_id=new_id,updated_at=now() where report_id=p_report_id;
  elsif p_command in ('approve','request_changes','publish') then
    select * into v from public.insight_report_versions where id=w.active_version_id for update;
    if v.id is null or checkit_reports_private.comparable(v.snapshot)
      is distinct from checkit_reports_private.comparable(checkit_reports_private.document(r)) then
      raise exception 'The report changed. Save and request a new review.';
    end if;
    if p_command='publish' then
      if r.owner_id<>actor or w.status<>'reviewed' or v.reviewed_by is null then
        raise exception 'Only the owner can publish a reviewed version.' using errcode='42501';
      end if;
      update public.insight_report_versions set status='published',published_by=actor,published_at=now() where id=v.id;
      update public.insight_report_workflows set status='published',published_version_id=v.id,updated_at=now() where report_id=p_report_id;
    else
      if w.status<>'in_review' or v.reviewer_id<>actor or v.submitted_by=actor then
        raise exception 'Only the assigned independent reviewer can review this version.' using errcode='42501';
      end if;
      if p_command='request_changes' and length(btrim(coalesce(p_payload->>'note','')))<5 then raise exception 'Explain the requested changes.'; end if;
      if length(coalesce(p_payload->>'note',''))>5000 then raise exception 'Review notes are limited to 5,000 characters.'; end if;
      update public.insight_report_versions set status=case when p_command='approve' then 'reviewed' else 'changes_requested' end,
        reviewed_by=actor,reviewed_at=now(),review_note=coalesce(p_payload->>'note','') where id=v.id;
      update public.insight_report_workflows set status=case when p_command='approve' then 'reviewed' else 'draft' end,updated_at=now() where report_id=p_report_id;
    end if;
    new_id:=v.id;
  elsif p_command='comment' then
    version_id:=nullif(p_payload->>'version_id','')::uuid;
    if version_id is not null and not exists(select 1 from public.insight_report_versions where id=version_id and report_id=p_report_id) then raise exception 'That version belongs to another report.'; end if;
    insert into public.insight_report_comments(report_id,version_id,element_id,body,author_id,author_label)
      values(p_report_id,version_id,nullif(p_payload->>'element_id',''),btrim(p_payload->>'body'),actor,actor_label) returning id into new_id;
  elsif p_command='add_action' then
    reviewer:=(p_payload->>'assigned_to')::uuid;
    if not checkit_reports_private.access(p_report_id,reviewer,true) then raise exception 'Assign an editor who has access to this report.'; end if;
    version_id:=nullif(p_payload->>'baseline_version_id','')::uuid;
    if version_id is not null and not exists(select 1 from public.insight_report_versions where id=version_id and report_id=p_report_id) then raise exception 'That baseline belongs to another report.'; end if;
    insert into public.insight_report_actions(report_id,title,assigned_to,due_date,intervention_date,baseline_version_id,created_by)
      values(p_report_id,btrim(p_payload->>'title'),reviewer,(p_payload->>'due_date')::date,
        nullif(p_payload->>'intervention_date','')::date,version_id,actor) returning id into new_id;
  elsif p_command='update_action' then
    select * into strict action_row from public.insight_report_actions where id=(p_payload->>'id')::uuid and report_id=p_report_id for update;
    version_id:=nullif(p_payload->>'followup_version_id','')::uuid;
    if version_id is not null and not exists(select 1 from public.insight_report_versions where id=version_id and report_id=p_report_id) then raise exception 'That follow-up belongs to another report.'; end if;
    update public.insight_report_actions set status=coalesce(p_payload->>'status',status),outcome=coalesce(p_payload->>'outcome',outcome),
      followup_version_id=version_id,updated_at=now() where id=action_row.id returning id into new_id;
  elsif p_command='restore' then
    select * into strict v from public.insight_report_versions where id=(p_payload->>'version_id')::uuid and report_id=p_report_id;
    update public.saved_reports set title=v.snapshot->>'title',author=v.snapshot->>'author',date=v.snapshot->>'date',period=v.snapshot->>'period',
      layout_data=jsonb_set(v.snapshot->'layout_data','{reportSettings}',coalesce(v.snapshot#>'{layout_data,reportSettings}','{}'::jsonb)
        || jsonb_build_object('sharedWith',coalesce(r.layout_data#>'{reportSettings,sharedWith}','[]'::jsonb),
          'sharedAccess',coalesce(r.layout_data#>'{reportSettings,sharedAccess}','{}'::jsonb))),updated_at=now() where id=p_report_id;
    new_id:=v.id;
  else raise exception 'Unknown report command.';
  end if;
  insert into public.insight_report_events(report_id,event,actor_id,actor_label,detail)
    values(p_report_id,p_command,actor,actor_label,jsonb_build_object('record_id',new_id));
  return jsonb_build_object('id',new_id,'status',(select status from public.insight_report_workflows where report_id=p_report_id));
end;
$$;
revoke all on function checkit_reports_private.command(uuid,text,jsonb) from public, anon;
grant execute on function checkit_reports_private.command(uuid,text,jsonb) to authenticated;
create function public.insights_report_command(p_report_id uuid,p_command text,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select checkit_reports_private.command(p_report_id,p_command,p_payload);
$$;
revoke all on function public.insights_report_command(uuid,text,jsonb) from public, anon;
grant execute on function public.insights_report_command(uuid,text,jsonb) to authenticated;

create function public.insights_report_workspace(p_report_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if not checkit_reports_private.access(p_report_id,auth.uid(),false) then
    raise exception 'This report is not available to your account.' using errcode='42501';
  end if;
  select jsonb_build_object('workflow',(select to_jsonb(w) from public.insight_report_workflows w where report_id=p_report_id),
    'versions',coalesce((select jsonb_agg(to_jsonb(v) - 'snapshot' order by version_number desc) from public.insight_report_versions v where report_id=p_report_id),'[]'::jsonb),
    'comments',coalesce((select jsonb_agg(to_jsonb(c) order by created_at desc) from (select * from public.insight_report_comments where report_id=p_report_id order by created_at desc limit 200) c),'[]'::jsonb),
    'actions',coalesce((select jsonb_agg(to_jsonb(a) order by created_at desc) from public.insight_report_actions a where report_id=p_report_id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by created_at desc) from (select * from public.insight_report_events where report_id=p_report_id order by created_at desc limit 100) e),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'label',coalesce(nullif(p.full_name,''),p.email)) order by p.full_name)
      from public.profile p where checkit_reports_private.access(p_report_id,p.id,true)),'[]'::jsonb),
    'user_id',auth.uid(),'can_edit',checkit_reports_private.access(p_report_id,auth.uid(),true),
    'is_owner',(select owner_id=auth.uid() from public.saved_reports where id=p_report_id)) into result;
  return result;
end;
$$;
revoke all on function public.insights_report_workspace(uuid) from public, anon;
grant execute on function public.insights_report_workspace(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
