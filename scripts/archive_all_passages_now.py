#!/usr/bin/env python3
"""Archive every traffic_passages sensor/day partition to private R2.

This is intentionally non-destructive:
- Uses COALESCE(ended_at, received_at), so rows lacking device time are included.
- Writes Parquet with Zstandard using the repository's schema-v1 writer.
- Downloads every R2 object and verifies row counts, identity keys, fields,
  path_points JSON, and SHA-256 before recording a verified manifest.
- Never deletes or updates traffic_passages.

Run from the repository's backend directory so backend/.env is loaded:

    cd /Users/himan/Desktop/checkit-transportation-felix/backend
    source .venv/bin/activate
    python ../scripts/archive_all_passages_now.py

Use --overwrite only after reviewing an existing mismatched object.
"""


from __future__ import annotations

import argparse
import json
import tempfile
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any

from checkit_transportation.archive.verifier import verify_archive
from checkit_transportation.config import Settings
from checkit_transportation.storage.parquet import (
    assert_required_columns,
    calculate_sha256,
    count_rows,
    file_size,
    validate_path_points,
    write_traffic_passages,
)
from checkit_transportation.storage.postgres import connect
from checkit_transportation.storage.r2 import (
    create_client,
    download_object,
    head_object,
    object_exists,
    traffic_passages_object_key,
    upload_file,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sensor", help="Archive only one sensor ID")
    parser.add_argument("--start", type=date.fromisoformat, help="First UTC day, inclusive")
    parser.add_argument("--end", type=date.fromisoformat, help="Last UTC day, inclusive")
    parser.add_argument("--output-root", type=Path, default=Path("data"))
    parser.add_argument("--sample-size", type=int, default=25)
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace existing R2 objects. Default preserves and verifies them.",
    )
    return parser.parse_args()


def list_partitions(connection: Any, args: argparse.Namespace) -> list[dict[str, Any]]:
    clauses = ["coalesce(ended_at, received_at) is not null"]
    params: list[Any] = []

    if args.sensor:
        clauses.append("sensor_id = %s")
        params.append(args.sensor)
    if args.start:
        clauses.append("coalesce(ended_at, received_at) >= %s::date")
        params.append(args.start)
    if args.end:
        clauses.append("coalesce(ended_at, received_at) < (%s::date + interval '1 day')")
        params.append(args.end)

    where = " and ".join(clauses)
    query = f"""
        select
          sensor_id,
          (coalesce(ended_at, received_at) at time zone 'UTC')::date as day,
          count(*)::bigint as row_count,
          min(coalesce(ended_at, received_at)) as first_timestamp,
          max(coalesce(ended_at, received_at)) as last_timestamp
        from public.traffic_passages
        where {where}
        group by sensor_id, day
        order by day, sensor_id
    """
    with connection.cursor() as cursor:
        cursor.execute(query, params)
        return list(cursor.fetchall())


def fetch_rows(connection: Any, sensor_id: str, day: date) -> list[dict[str, Any]]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select *
            from public.traffic_passages
            where sensor_id = %s
              and coalesce(ended_at, received_at) >= %s::date
              and coalesce(ended_at, received_at) < (%s::date + interval '1 day')
            order by coalesce(ended_at, received_at), boot_id, track_id
            """,
            (sensor_id, day, day),
        )
        return list(cursor.fetchall())


def upsert_manifest(
    connection: Any,
    *,
    sensor_id: str,
    day: date,
    row_count: int,
    object_key: str,
    byte_count: int,
    sha256_hex: str,
) -> None:
    started_at = datetime.combine(day, time.min, tzinfo=timezone.utc)
    ended_at = started_at + timedelta(days=1)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            insert into public.historical_archives (
              dataset,
              sensor_id,
              started_at,
              ended_at,
              row_count,
              object_key,
              format,
              schema_version,
              byte_count,
              sha256_hex,
              status,
              verified_at
            )
            values (
              'traffic_passages',
              %s, %s, %s, %s, %s,
              'parquet', 1, %s, %s,
              'verified', now()
            )
            on conflict (object_key) do update set
              sensor_id = excluded.sensor_id,
              started_at = excluded.started_at,
              ended_at = excluded.ended_at,
              row_count = excluded.row_count,
              format = excluded.format,
              schema_version = excluded.schema_version,
              byte_count = excluded.byte_count,
              sha256_hex = excluded.sha256_hex,
              status = 'verified',
              verified_at = now(),
              deleted_from_hot_at = null
            """,
            (
                sensor_id,
                started_at,
                ended_at,
                row_count,
                object_key,
                byte_count,
                sha256_hex,
            ),
        )


def archive_partition(
    connection: Any,
    client: Any,
    bucket: str,
    *,
    sensor_id: str,
    day: date,
    expected_rows: int,
    output_root: Path,
    sample_size: int,
    overwrite: bool,
) -> dict[str, Any]:
    rows = fetch_rows(connection, sensor_id, day)
    if len(rows) != expected_rows:
        raise RuntimeError(
            f"{sensor_id} {day}: expected {expected_rows} rows, fetched {len(rows)}"
        )

    object_key = traffic_passages_object_key(sensor_id, day)
    local_path = output_root / object_key
    write_traffic_passages(rows, local_path)
    assert_required_columns(local_path)
    validate_path_points(local_path)

    if count_rows(local_path) != expected_rows:
        raise RuntimeError(f"{sensor_id} {day}: local Parquet row count mismatch")

    existed = object_exists(client, bucket, object_key)
    if overwrite or not existed:
        upload_file(client, bucket, local_path, object_key)

    expected_size = file_size(local_path)
    remote_head = head_object(client, bucket, object_key)
    if int(remote_head["ContentLength"]) != expected_size:
        raise RuntimeError(
            f"{sensor_id} {day}: R2 size mismatch "
            f"(remote={remote_head['ContentLength']}, local={expected_size})"
        )

    with tempfile.TemporaryDirectory(prefix="checkit-r2-verify-") as temp_dir:
        downloaded = Path(temp_dir) / "downloaded.parquet"
        download_object(client, bucket, object_key, downloaded)
        report = verify_archive(
            rows,
            local_path,
            downloaded,
            sample_size=min(sample_size, len(rows)),
        )

    sha256_hex = calculate_sha256(local_path)
    if sha256_hex != report.sha256_hex:
        raise RuntimeError(f"{sensor_id} {day}: verifier SHA-256 mismatch")

    upsert_manifest(
        connection,
        sensor_id=sensor_id,
        day=day,
        row_count=expected_rows,
        object_key=object_key,
        byte_count=expected_size,
        sha256_hex=sha256_hex,
    )
    connection.commit()

    return {
        "sensor_id": sensor_id,
        "day": day.isoformat(),
        "rows": expected_rows,
        "object_key": object_key,
        "bytes": expected_size,
        "sha256": sha256_hex,
        "uploaded_now": overwrite or not existed,
        "verified": report.verification_result,
    }


def main() -> int:
    args = parse_args()
    if args.start and args.end and args.end < args.start:
        raise ValueError("--end must not precede --start")

    settings = Settings.from_env(env_file=".env")
    client = create_client(settings)

    with connect(settings.database_url) as connection:
        partitions = list_partitions(connection, args)
        if not partitions:
            raise RuntimeError("No traffic_passages partitions matched the request")

        expected_total = sum(int(part["row_count"]) for part in partitions)
        print(
            json.dumps(
                {
                    "phase": "plan",
                    "partition_count": len(partitions),
                    "expected_total_rows": expected_total,
                    "bucket": settings.r2_bucket,
                },
                indent=2,
                default=str,
            )
        )

        archived_total = 0
        for index, part in enumerate(partitions, start=1):
            result = archive_partition(
                connection,
                client,
                settings.r2_bucket,
                sensor_id=part["sensor_id"],
                day=part["day"],
                expected_rows=int(part["row_count"]),
                output_root=args.output_root,
                sample_size=args.sample_size,
                overwrite=args.overwrite,
            )
            archived_total += result["rows"]
            print(
                json.dumps(
                    {
                        "phase": "partition_verified",
                        "partition": f"{index}/{len(partitions)}",
                        **result,
                    },
                    indent=2,
                )
            )

        with connection.cursor() as cursor:
            cursor.execute(
                """
                select coalesce(sum(row_count), 0)::bigint as verified_rows
                from public.historical_archives
                where dataset = 'traffic_passages'
                  and status = 'verified'
                """
            )
            verified_rows = int(cursor.fetchone()["verified_rows"])

        if archived_total != expected_total:
            raise RuntimeError(
                f"Archived total {archived_total} does not match planned total {expected_total}"
            )
        if verified_rows < expected_total:
            raise RuntimeError(
                f"Manifest has only {verified_rows} verified rows; expected at least {expected_total}"
            )

    print(
        json.dumps(
            {
                "status": "PASS",
                "partition_count": len(partitions),
                "source_rows_archived_and_verified": archived_total,
                "manifest_verified_rows": verified_rows,
                "source_deleted": False,
            },
            indent=2,
        )
    )
    print("No Supabase traffic_passages rows were deleted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
