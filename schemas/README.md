# Data contracts

These JSON Schemas document interchange contracts; they are not Postgres validators.

- `traffic_passage_v1.json` preserves the original detailed `public.traffic_passages` contract. In Parquet schema v1, `path_points` is deterministic compact JSON text, although its logical contract remains JSON.
- `traffic_daily_v1.json` describes one deterministic sensor/day aggregate and its 25-bin speed histogram.
- `traffic_passage_v2.json` describes the ten-field accepted passage contract and Parquet v2.
- `traffic_daily_v2.json` describes the lean daily row; its histogram retains the same 25 bins.
- `archive_manifest_v1.json` describes a verified R2 archive manifest.

Increment the contract version before making an incompatible field or meaning change.

## Lean telemetry transition

See [3.1.0-lean rollout and compatibility](../docs/lean-telemetry-transition.md) for the staged schema transition, archive v1/v2 support, validation, and firmware upload commands. Migration 2 is deferred; do not apply all pending migrations automatically.
