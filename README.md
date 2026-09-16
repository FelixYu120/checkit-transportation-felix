# CheckIt Transportation V2

CheckIt Transportation is a privacy-conscious traffic sensing system. Radar nodes turn local HLK-LD2451 observations into passage records and health telemetry. Supabase holds operational detail and durable aggregates; Cloudflare R2 holds verified historical files for research and reprocessing.

## Architecture

```text
Radar Node (ESP32-S3 + radar)          Flash Node (maintenance workstation)
  local tracking and safety logic        builds/signs/flashes firmware
  passage + health uploads               provisions non-R2 device identity
                 |                                  |
                 +---------------+------------------+
                                 v
                  Supabase / PostgreSQL (hot)
             passages | health | 10-minute | daily
                    |                         |
          verified archive export            +--> API / website
                    v
          Cloudflare R2 (private archive)
             Parquet + Zstandard + SHA-256
                    |
                    +--> future ML / research
```

The Radar Node is the deployed sensor. The Flash Node is a trusted maintenance/build role, not a second data pipeline. Permanent R2 credentials must never be stored on an ESP32 or in source control.

## Data lifecycle

1. Firmware uploads `traffic_passages`, `sensor_health`, current firmware-generated `ten_minute_summaries`, and optional `reference_measurements` to Supabase.
2. Server-side jobs deterministically build `traffic_daily`; server-side passage aggregation is the long-term authority while firmware summaries remain available for parity checks.
3. A sensor/day of detailed passages is encoded as schema-v1 Parquet with Zstandard compression.
4. The exporter uploads the file to private R2, downloads it again, and verifies bytes, rows, keys, timestamps, schema, and JSON payloads.
5. Retention stays in dry-run mode. This repository deliberately refuses real deletion until production foreign-key/view dependencies have been inspected and approved.
6. API and website month-scale queries should move to aggregates rather than historical detail.

Future exact UART archives use compressed CBOR under `raw/ld2451/`. A device will obtain a short-lived presigned PUT URL or call an authenticated Cloudflare Worker with an R2 binding; permanent R2 secrets do not belong on the device.

## Repository

```text
backend/          Python archive, aggregation, and storage package
data/             ignored local outputs (only .gitkeep is committed)
docs/             architecture, data model, deployment, and migration plans
schemas/          versioned JSON data contracts
scripts/          operator CLIs
supabase/          additive SQL migrations (not auto-applied)
v2/firmware/      reserved for V2 firmware when its source is restored
website/          existing web application
```

The current Git checkout did not contain V2 firmware or prior Supabase migrations, including in `origin/main` and the existing stash. No firmware was fabricated or changed. Restore the production firmware into `v2/firmware/` and import the authoritative migration history before firmware or dependency-parity work.

## Local development

Python 3.12 or newer is required.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e './backend[dev]'
cp .env.example .env
pytest backend/tests
```

Set these only in `.env` or a secret manager: `DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET`. Never commit `.env`. Prefer a Supabase pooled database URL for scheduled applications; operator scripts make short-lived connections.

Connection checks:

```bash
python scripts/test_connections.py
python scripts/inspect_database.py
```

First non-destructive archive test:

```bash
python scripts/archive_day.py \
  --sensor GILMAN2_15D9B4DC \
  --day 2026-08-24 \
  --expected-rows 1406
```

This command reads Supabase and writes R2/local files only. It never deletes Supabase rows. See [the migration plan](docs/migration-plan.md) before applying the additive migrations, and [retention safety](docs/retention.md) before considering any hot-data removal.
