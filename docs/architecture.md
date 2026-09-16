# V2 architecture

## Operational and archival paths

```text
┌───────────────────────────────────────────────────────────────────┐
│ RADAR NODE: ESP32-S3 / T-SIM7080-S3 + HLK-LD2451                │
│ local tracking, classification, watchdogs, buffering, safe retry │
└───────────┬───────────────────────────────────────────────────────┘
            │ passages, summaries, health, optional references
            v
┌──────────────────────── SUPABASE / POSTGRES ─────────────────────┐
│ traffic_passages       hot, detailed, temporarily retained       │
│ ten_minute_summaries   firmware-generated during migration       │
│ traffic_daily          permanent server-generated aggregates     │
│ sensor_health          operational telemetry                     │
│ historical_archives    archive state and verification evidence   │
└──────────────┬───────────────────────────────┬────────────────────┘
               │ verified export               │ aggregate queries
               v                               v
┌─────────────────────────────┐       ┌─────────────────────────────┐
│ PRIVATE CLOUDFLARE R2       │       │ API / WEBSITE               │
│ Parquet + Zstandard         │       │ daily / 10-minute rollups   │
│ SHA-256 verified            │       │ no old-detail dependency    │
└──────────────┬──────────────┘       └─────────────────────────────┘
               │
               v
┌───────────────────────────────────────────────────────────────────┐
│ FUTURE RESEARCH / ML: reproducible snapshots, labels, reprocessing│
└───────────────────────────────────────────────────────────────────┘
```

The Radar Node owns immediate local safety and reliable telemetry delivery. Cloud jobs own archival and durable aggregates. The Flash Node is a trusted operator/build workstation used to install and provision firmware; it is not a repository for production R2 credentials.

## Authority transition

Firmware currently supplies `ten_minute_summaries`. The backend helper can compute server-side summaries from passages and compare them with firmware output. During migration both may coexist. After value mappings and dashboard parity are verified, server-side passage aggregation should become authoritative. This avoids firmware-version changes altering historical aggregation semantics.

## Archive transaction boundary

```text
SELECT sensor/day -> write local Parquet -> validate -> upload/private R2
      -> HEAD byte count -> download -> verify hash/rows/keys/time/JSON
      -> eligible for manifest status=verified

Any failure ------------------------------------------------> keep source
```

An R2 upload is not proof of a valid archive. Only the complete downloaded verification result can support `verified`. The v1 CLI returns the result but does not yet update the manifest table automatically.

## Future exact radar stream

Exact UART frames should be batched as compressed CBOR under the documented raw prefix. Authentication must be one of:

- a short-lived, object-key-scoped presigned PUT URL issued to the ESP32; or
- an authenticated Cloudflare Worker that writes through an R2 binding.

Never provision permanent R2 access-key secrets onto a device. The current firmware source was absent, so the raw uploader is a documented interface/TODO rather than fabricated code.
