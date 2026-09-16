-- Additive only. Review and apply manually; this migration deletes no data.
create table if not exists public.historical_archives (
  archive_id uuid primary key default gen_random_uuid(),
  dataset text not null,
  sensor_id varchar not null references public.sensors(sensor_id),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  row_count bigint not null check (row_count >= 0),
  object_key text not null unique,
  format text not null,
  schema_version smallint not null check (schema_version > 0),
  byte_count bigint not null check (byte_count >= 0),
  sha256_hex char(64) not null,
  status text not null,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  deleted_from_hot_at timestamptz,
  constraint historical_archives_dataset_check
    check (dataset in ('traffic_passages', 'reference_measurements')),
  constraint historical_archives_format_check
    check (format in ('parquet', 'jsonl.gz')),
  constraint historical_archives_status_check
    check (status in ('building', 'uploaded', 'verified', 'deleted_from_hot', 'failed')),
  constraint historical_archives_time_range_check check (ended_at >= started_at),
  constraint historical_archives_sha256_check check (sha256_hex ~ '^[0-9a-f]{64}$'),
  constraint historical_archives_verified_state_check check (
    (status in ('verified', 'deleted_from_hot') and verified_at is not null)
    or status in ('building', 'uploaded', 'failed')
  ),
  constraint historical_archives_deleted_state_check check (
    (status = 'deleted_from_hot' and deleted_from_hot_at is not null)
    or (status <> 'deleted_from_hot' and deleted_from_hot_at is null)
  )
);

create index if not exists historical_archives_sensor_time_idx
  on public.historical_archives (sensor_id, started_at, ended_at);

alter table public.historical_archives enable row level security;

-- No client access model was available, so expose nothing through Data API roles.
revoke all on table public.historical_archives from anon, authenticated;

comment on table public.historical_archives is
  'Verified private-object archive manifests. No source deletion is performed by this migration.';
