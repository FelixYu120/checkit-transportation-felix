# Deployment and operations

## Configuration

Copy `.env.example` to an ignored `.env` for local work. Supply all secrets through a platform secret manager in deployment:

- `DATABASE_URL`: preferably the appropriate Supabase pooler URL for scheduled/worker concurrency;
- `R2_ACCOUNT_ID`;
- `R2_ACCESS_KEY_ID`;
- `R2_SECRET_ACCESS_KEY`;
- `R2_BUCKET` (default `checkit-transportation`).

Use a database role with only the access each job needs. Archive and inspection jobs need `SELECT` on their input tables. A daily-writer job additionally needs narrowly scoped `INSERT`/`UPDATE` on `traffic_daily`. R2 keys should be limited to the archive bucket/prefix. Logs must report presence/status, never credential values.

## Local operator flow

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e './backend[dev]'
cp .env.example .env
pytest backend/tests
python scripts/test_connections.py
python scripts/inspect_database.py
```

Run the first archive only after connection tests:

```bash
python scripts/archive_day.py \
  --sensor GILMAN2_15D9B4DC \
  --day 2026-08-24 \
  --expected-rows 1406
```

The command keeps an existing R2 object by default and verifies it. `--overwrite` is an explicit operator choice. It never deletes Supabase data.

## Migration application

The SQL files are prepared but not applied. Reconcile the missing authoritative migration history first. With a locally installed current Supabase CLI, use its `--help`, create timestamped migrations if required by your workflow, test on a local/staging stack, review RLS/grants, run database tests/advisors, then deploy through the normal reviewed pipeline. Do not run a remote reset.

## Future schedulers

The same package can later run in:

- GitHub Actions with environment protection, OIDC/secret storage, concurrency guards, and artifact-free logs;
- a Supabase Cron/Edge Function orchestration layer (likely invoking a suitable worker for PyArrow rather than claiming native Python support);
- an external worker or VM with a scheduler, pooled DB connectivity, and scoped R2 credentials.

None of these deployments exists yet. Before scheduling, add manifest-state writes, idempotency/concurrency locking, metrics, retries that do not overwrite verified objects, and alerting.
