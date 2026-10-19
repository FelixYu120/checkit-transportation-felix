-- Check-It Transportation: verified cleanup after R2 archival
--
-- Run ONLY after:
--   1. backup_full_database_to_r2.py returns PASS
--   2. archive_all_passages_now.py returns PASS
--   3. historical_archives contains 12 verified schema-v1 manifests
--   4. sum(row_count) for those manifests is 79,266
--   5. the website has been smoke-tested against ten_minute_summaries/traffic_daily
--
-- This deletes detailed historical rows only.
-- It does NOT drop traffic_passages; the table remains for future sensor uploads.

begin;

do $$
declare
  source_total bigint;
  manifest_total bigint;
  manifest_files bigint;
  mismatch_count bigint;
  reference_count bigint;
begin
  select count(*) into source_total
  from public.traffic_passages;

  select
    count(*),
    coalesce(sum(row_count), 0)
  into manifest_files, manifest_total
  from public.historical_archives
  where dataset = 'traffic_passages'
    and schema_version = 1
    and status = 'verified'
    and verified_at is not null;

  select count(*) into reference_count
  from public.reference_measurements;

  if reference_count <> 0 then
    raise exception
      'ABORT: reference_measurements contains % rows that may reference traffic_passages',
      reference_count;
  end if;

  if source_total = 0 then
    raise exception 'ABORT: traffic_passages is already empty';
  end if;

  if manifest_files <> 12 then
    raise exception
      'ABORT: expected 12 verified archive manifests, found %',
      manifest_files;
  end if;

  if source_total <> manifest_total then
    raise exception
      'ABORT: source total % differs from verified manifest total %',
      source_total, manifest_total;
  end if;

  with source_days as (
    select
      sensor_id,
      (coalesce(ended_at, received_at) at time zone 'UTC')::date as day,
      count(*)::bigint as row_count
    from public.traffic_passages
    group by sensor_id, day
  ),
  manifest_days as (
    select
      sensor_id,
      (started_at at time zone 'UTC')::date as day,
      sum(row_count)::bigint as row_count
    from public.historical_archives
    where dataset = 'traffic_passages'
      and schema_version = 1
      and status = 'verified'
      and verified_at is not null
    group by sensor_id, day
  )
  select count(*) into mismatch_count
  from (
    select
      coalesce(s.sensor_id, m.sensor_id) as sensor_id,
      coalesce(s.day, m.day) as day,
      s.row_count as source_rows,
      m.row_count as archived_rows
    from source_days s
    full outer join manifest_days m
      on m.sensor_id = s.sensor_id
     and m.day = s.day
    where s.row_count is distinct from m.row_count
  ) mismatches;

  if mismatch_count <> 0 then
    raise exception
      'ABORT: % sensor/day partitions have source/archive count mismatches',
      mismatch_count;
  end if;
end $$;

with verified_days as (
  select
    sensor_id,
    (started_at at time zone 'UTC')::date as day
  from public.historical_archives
  where dataset = 'traffic_passages'
    and schema_version = 1
    and status = 'verified'
    and verified_at is not null
  group by sensor_id, day
),
deleted as (
  delete from public.traffic_passages p
  using verified_days v
  where p.sensor_id = v.sensor_id
    and (coalesce(p.ended_at, p.received_at) at time zone 'UTC')::date = v.day
  returning 1
)
select count(*) as deleted_rows
from deleted;

do $$
declare
  remaining bigint;
begin
  select count(*) into remaining
  from public.traffic_passages;

  if remaining <> 0 then
    raise exception
      'ABORT: % traffic_passages rows remain; transaction will roll back',
      remaining;
  end if;
end $$;

update public.historical_archives
set status = 'deleted_from_hot',
    deleted_from_hot_at = now()
where dataset = 'traffic_passages'
  and schema_version = 1
  and status = 'verified'
  and verified_at is not null;

commit;

-- Run separately after the transaction:
-- vacuum (analyze) public.traffic_passages;
