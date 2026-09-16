# Non-destructive migration plan

## Phase 0 — repository and tools

Install the backend, reconcile missing firmware/migration history, run unit tests, and use read-only database inspection. No production mutation.

## Phase 1 — one-day archive

Archive sensor `GILMAN2_15D9B4DC` for `2026-08-24`, with expected 1,406 rows supplied explicitly to the CLI. Confirm the exact R2 key, downloaded hash, rows, identities, timestamps, schema, and JSON. No source deletion.

## Phase 2 — archive manifest

Review and manually apply `add_historical_archives.sql`. Add a controlled orchestration step that records `building`, `uploaded`, and only then `verified` from the full verifier result. The v1 exporter does not auto-write this table.

## Phase 3 — daily aggregate

Confirm production direction/class/quality strings and site speeding policy. Review and manually apply `add_traffic_daily.sql`. Keep its RLS closed until a real authorization policy exists.

## Phase 4 — historical daily backfill

Run `backfill_daily.py` in default dry-run mode, compare results, then use `--execute` in bounded ranges. Reruns atomically upsert `(sensor_id, day)`.

## Phase 5 — website month queries

Move month-scale website/API reads to `traffic_daily`. Use sums/counts and merged histograms rather than averages of averages or averages of daily p85.

## Phase 6 — dashboard parity

Compare current firmware ten-minute output, server-side recomputation, daily rollups, and dashboard results over representative sensors/days.

## Phase 7 — retention dry runs

Run rolling seven-day reports. Reconcile every unarchived passage and dependency. Do not delete detail.

## Phase 8 — controlled one-day deletion test

Only after production FK/view dependencies are proven and a separately reviewed deletion implementation exists, test one fully verified day with backup/recovery procedures. This repository intentionally cannot perform this phase yet.

## Phase 9 — automated rolling retention

Automate only after repeated archive and dashboard parity, state-machine monitoring, alerting, audit logs, and restore drills. Nothing before Phase 8 deletes production detail.
