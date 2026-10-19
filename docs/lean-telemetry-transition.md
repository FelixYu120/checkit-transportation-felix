# Lean telemetry 3.1.0-lean

The connected radar keeps its quality gates, association, hit counts, direction
consistency, SNR filtering, classification and path calculation. Only cloud
persistence changes. UART, display, Wi-Fi/modem, BLE, warnings and ESP-NOW are
unchanged.

## Firmware contract

Only `TRACK_ACCEPTED` passages enter the durable cloud journal. Review/rejected
tracks are reported locally and removed from the completed-track queue even if
storage is unavailable. Accepted tracks remain queued if persistence fails.

`traffic_passages` JSON has exactly these ten keys:
`sensor_id`, `boot_id`, `track_id`, `observed_at`, `direction`, `traffic_class`,
`speed_kmh`, `max_speed_kmh`, `firmware_version`, `received_at`.
`observed_at` is the track's end time; `speed_kmh` is its median. The unchanged
primary key is `(sensor_id, boot_id, track_id)`. Firmware sends `received_at: null`;
the database trigger stamps server receipt time and preserves it on retries.
Unsynchronized event times remain null rather than inventing a measurement time.

The journal layout and CRC are unchanged. Legacy accepted records serialize to
the compact format. Legacy review/rejected records are explicitly discarded.
For a mixed batch the cursor advances past all valid records only after accepted
rows upload successfully. HTTP failures retain the batch; acknowledgement failures
cause an idempotent retry. Review-only batches need no passage POST.

Health uploads retain the 15 specified columns. Experimental counters and prior
metadata move into `diagnostics`. Ten-minute firmware aggregation and upload
meaning remain unchanged.

## Deployment order

1. Run backend tests, frontend tests/build, and `pio run -e radar_connected`.
2. Apply **only** `20261018201101_prepare_lean_telemetry_transition.sql`.
   This adds compact fields, backfills old event times/median speeds, relaxes
   omitted legacy columns, and adds the transition/receipt trigger. It deletes
   no data and preserves RLS, grants, old columns and identity keys.
3. Deploy the backend/website code and flash `3.1.0-lean` on the radars.
4. Drain every pending journal through an hourly/manual upload. Verify fresh
   health reports from every relevant sensor. Investigate or explicitly retire
   stale/offline sensor records; do not simply zero their pending counts.
5. Only then review and manually apply
   `20261018201102_finalize_lean_telemetry_schema.sql`.

**Do not run an unattended `supabase db push` over both files.** Finalization is
intentionally deferred. Its transaction aborts for any nonzero/unknown pending
count, old firmware, missing health for an active sensor, or health older than
24 hours. It also requires at least one health report. All reported sensors must
show `3.1.0-lean`; future firmware requires reviewing this explicit gate.

Finalization removes review/rejected rows and obsolete columns, preserves old
health metadata under `diagnostics` (new diagnostics win on conflicts), and makes
`(sensor_id,time_bucket,direction)` the summary primary key. It uses no CASCADE;
unexpected dependent views/policies/FKs abort the transaction for review.
Historical archive manifests and R2 objects are untouched by both migrations.

## Archive compatibility

- Unmigrated detailed databases export the existing schema-v1 format.
- Transition/final databases automatically export compact accepted passages to
  `derived/traffic_passages/schema=v2/sensor=.../year=.../month=.../day=.../part-000001.parquet`.
- Transition queries exclude explicit legacy review/rejected rows from v2.
- Existing v1 R2 objects cannot be overwritten, even with `--overwrite`.
  Conditional object creation also prevents concurrent overwrite races.
- V1 verification remains available using `--schema-version 1` or an explicit
  object key. During transition its source query selects detailed records only.
  After finalization, v1 source comparison is unavailable because those detailed
  fields were intentionally removed; verify downloaded v1 files against their
  existing manifest checksum/schema instead.
- Both versions verify row counts, identity keys, timestamp ranges, every field
  on every row, downloaded bytes and SHA-256. `--sample-size` is retained for CLI
  compatibility but no longer limits field verification.
- UTC day boundaries are explicit and independent of the connection timezone.
- Daily aggregation accepts lean speeds and legacy median speeds. Explicit legacy
  review/rejected statuses never count. Only lean daily columns are upserted;
  histogram bins remain fixed at 5 km/h, 25 bins, with the final bin >=120 km/h.
- The retention module remains read-only and refuses deletion. Its coverage
  report matches archive schema versions as well as sensor/time ranges.

## Validation and upload

```sh
cd /Users/himan/Desktop/checkit-transportation-felix/backend
source .venv/bin/activate
python -m pip install -e ".[dev]"
# Optional but required for migration regression coverage: a disposable LOCAL
# database. These tests recreate its public schema; never point at real data.
CHECKIT_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55487/postgres pytest -s -v

cd ../website
npm test
node --test tests/*.test.js
npm run build

cd ../v2/firmware
pio run -e radar_connected
pio run -e radar_connected -t upload
pio device monitor -e radar_connected -b 115200
```

If multiple boards are connected, add `--upload-port /dev/cu.YOUR_BOARD` to the
upload command and `--port /dev/cu.YOUR_BOARD` to the monitor command.
The upload command does not erase provisioning or the durable journal.

The host telemetry regression compiles the actual production serialization,
enqueue and upload methods with fake I/O. It verifies exact payload keys,
accepted-only storage, legacy mixed batches, upload/acknowledgement failures and
safe retries. Local PostgreSQL tests use a schema-only fixture of production;
no production rows or secrets are committed.

## Deployment record — 2026-10-18

Migration 1 was applied successfully to Transportation and recorded by Supabase
as `20261018201101_prepare_lean_telemetry_transition`. The local filename matches
that recorded version. Before/after checks confirmed unchanged row counts
(0 live passages, 4 health rows, 2,951 summaries, 12 daily rows, 12 archive
manifests), RLS policies, grants, and archive-manifest content. No R2 objects
were modified. Security advisor findings were unchanged from the baseline.

Migration 2 remains unapplied. The latest stored health reports still show
706 pending passages for GILMAN1 and 487 for GILMAN2, with firmware 2.6.2.
The other two reporting sensors show 3.0.0-connected. No sensor has yet
reported the new version, and all four reports are stale. Deployment and
journal-drain conditions are therefore not satisfied.

Validation passed: 29 backend tests including real local PostgreSQL migration
tests and compiled firmware telemetry regressions; 10 standard website tests
and 15 additional website tests; production website build; and the
`radar_connected` firmware build. The website build retains its existing
large-chunk warning. Firmware was built, not uploaded to hardware.
