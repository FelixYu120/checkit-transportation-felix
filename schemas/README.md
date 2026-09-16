# Data contracts

These JSON Schemas document interchange contracts; they are not Postgres validators.

- `traffic_passage_v1.json` mirrors every known `public.traffic_passages` column. In Parquet schema v1, `path_points` is deterministic compact JSON text, although its logical contract remains JSON.
- `traffic_daily_v1.json` describes one deterministic sensor/day aggregate and its 25-bin speed histogram.
- `archive_manifest_v1.json` describes a verified R2 archive manifest.

Increment the contract version before making an incompatible field or meaning change.
