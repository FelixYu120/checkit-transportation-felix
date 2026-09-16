# Cloudflare R2 layout

R2 prefixes are object-key strings, not directories. Do not create folders manually and do not require or publish a public bucket URL.

## Processed passages

```text
derived/
  traffic_passages/
    schema=v1/
      sensor=<sensor_id>/
        year=YYYY/
          month=MM/
            day=DD/
              part-000001.parquet
```

Exact first-test key:

```text
derived/traffic_passages/schema=v1/sensor=GILMAN2_15D9B4DC/year=2026/month=08/day=24/part-000001.parquet
```

Files use Parquet with Zstandard compression. Schema v1 contains all known passage columns and represents `path_points` as deterministic compact JSON text. SHA-256 is computed over the exact object bytes.

## Future raw radar data

```text
raw/
  ld2451/
    schema=v1/
      sensor=<sensor_id>/
        year=YYYY/
          month=MM/
            day=DD/
              hour=HH/
                boot=<boot_id>-batch=<sequence>.cbor.gz
```

Raw objects should contain an explicit envelope version, device identity, boot ID, monotonically increasing batch sequence, capture timestamps, and exact frame bytes. Authentication is short-lived presigned PUT or an authenticated Worker with R2 binding—never device-held permanent R2 keys.
