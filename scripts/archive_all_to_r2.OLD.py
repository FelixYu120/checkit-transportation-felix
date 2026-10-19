#!/usr/bin/env python3
"""Create a complete, verified R2 backup of Check-It Transportation data.

This script is intentionally non-destructive.

It performs two independent backups:

1. A full PostgreSQL custom-format dump containing schema, functions, RLS,
   configuration tables, summaries, health rows, and all table data.
2. Query-friendly Parquet archives of public.traffic_passages, partitioned by
   UTC day using COALESCE(ended_at, received_at). This includes records whose
   event timestamps are NULL.

Each Parquet object is downloaded from R2 and verified before a
public.historical_archives row is marked verified.

No Supabase rows are deleted.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import boto3
import psycopg
import pyarrow as pa
import pyarrow.parquet as pq
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from psycopg.rows import dict_row


ARCHIVE_SCHEMA_VERSION = 2
DATASET = "traffic_passages"

TRAFFIC_COLUMNS = (
    "sensor_id",
    "boot_id",
    "track_id",
    "started_at",
    "ended_at",
    "direction",
    "traffic_class",
    "class_confidence",
    "quality_status",
    "quality_score",
    "association_confidence",
    "direction_consistency",
    "hit_count",
    "duration_ms",
    "median_speed_kmh",
    "p85_speed_kmh",
    "max_speed_kmh",
    "mean_snr",
    "max_snr",
    "peak_cluster_size",
    "travel_distance_m",
    "entry_distance_m",
    "entry_angle_deg",
    "exit_distance_m",
    "exit_angle_deg",
    "firmware_version",
    "model_version",
    "path_points",
    "created_at",
    "received_at",
    "human_label",
    "label_confidence",
    "label_notes",
    "labeled_at",
)

TRAFFIC_SCHEMA = pa.schema(
    [
        pa.field("sensor_id", pa.string(), nullable=False),
        pa.field("boot_id", pa.int64(), nullable=False),
        pa.field("track_id", pa.int64(), nullable=False),
        pa.field("started_at", pa.timestamp("us", tz="UTC")),
        pa.field("ended_at", pa.timestamp("us", tz="UTC")),
        pa.field("direction", pa.string(), nullable=False),
        pa.field("traffic_class", pa.string(), nullable=False),
        pa.field("class_confidence", pa.float32(), nullable=False),
        pa.field("quality_status", pa.string(), nullable=False),
        pa.field("quality_score", pa.int16(), nullable=False),
        pa.field("association_confidence", pa.float32(), nullable=False),
        pa.field("direction_consistency", pa.float32(), nullable=False),
        pa.field("hit_count", pa.int32(), nullable=False),
        pa.field("duration_ms", pa.int64(), nullable=False),
        pa.field("median_speed_kmh", pa.int16(), nullable=False),
        pa.field("p85_speed_kmh", pa.int16(), nullable=False),
        pa.field("max_speed_kmh", pa.int16(), nullable=False),
        pa.field("mean_snr", pa.int16(), nullable=False),
        pa.field("max_snr", pa.int16(), nullable=False),
        pa.field("peak_cluster_size", pa.int16(), nullable=False),
        pa.field("travel_distance_m", pa.float32(), nullable=False),
        pa.field("entry_distance_m", pa.int16(), nullable=False),
        pa.field("entry_angle_deg", pa.int16(), nullable=False),
        pa.field("exit_distance_m", pa.int16(), nullable=False),
        pa.field("exit_angle_deg", pa.int16(), nullable=False),
        pa.field("firmware_version", pa.string(), nullable=False),
        pa.field("model_version", pa.string(), nullable=False),
        pa.field("path_points", pa.string(), nullable=False),
        pa.field("created_at", pa.timestamp("us", tz="UTC"), nullable=False),
        pa.field("received_at", pa.timestamp("us", tz="UTC"), nullable=False),
        pa.field("human_label", pa.string()),
        pa.field("label_confidence", pa.float32()),
        pa.field("label_notes", pa.string()),
        pa.field("labeled_at", pa.timestamp("us", tz="UTC")),
    ],
    metadata={
        b"checkit.dataset": b"traffic_passages",
        b"checkit.schema_version": b"2",
        b"checkit.partition_timestamp": b"coalesce(ended_at,received_at)",
    },
)


@dataclass(frozen=True)
class Settings:
    database_url: str
    r2_account_id: str
    r2_access_key_id: str
    r2_secret_access_key: str
    r2_bucket: str

    @property
    def r2_endpoint(self) -> str:
        return f"https://{self.r2_account_id}.r2.cloudflarestorage.com"


def load_settings() -> Settings:
    for candidate in (Path("backend/.env"), Path(".env")):
        if candidate.exists():
            load_dotenv(candidate, override=False)

    names = (
        "DATABASE_URL",
        "R2_ACCOUNT_ID",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET",
    )
    missing = [name for name in names if not os.getenv(name, "").strip()]
    if missing:
        raise RuntimeError(f"Missing environment variables: {', '.join(missing)}")

    return Settings(
        database_url=os.environ["DATABASE_URL"].strip(),
        r2_account_id=os.environ["R2_ACCOUNT_ID"].strip(),
        r2_access_key_id=os.environ["R2_ACCESS_KEY_ID"].strip(),
        r2_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"].strip(),
        r2_bucket=os.environ["R2_BUCKET"].strip(),
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def compact_json(value: Any) -> str:
    if isinstance(value, str):
        value = json.loads(value)
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def normalize_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    expected = set(TRAFFIC_COLUMNS)
    normalized: list[dict[str, Any]] = []

    for index, source in enumerate(rows):
        actual = set(source)
        if actual != expected:
            raise RuntimeError(
                f"Schema mismatch at row {index}; "
                f"missing={sorted(expected - actual)}, "
                f"extra={sorted(actual - expected)}"
            )
        row = dict(source)
        row["path_points"] = compact_json(row["path_points"])
        normalized.append(row)

    return normalized


def effective_timestamp(row: dict[str, Any]) -> datetime:
    value = row.get("ended_at") or row["received_at"]
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def partition_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=timezone.utc)
    return start, start + timedelta(days=1)


def object_key(sensor_id: str, day: date) -> str:
    safe_sensor = "".join(
        character if character.isalnum() or character in "-_.~" else f"%{ord(character):02X}"
        for character in sensor_id
    )
    return (
        f"derived/traffic_passages/schema=v{ARCHIVE_SCHEMA_VERSION}/"
        f"sensor={safe_sensor}/year={day:%Y}/month={day:%m}/day={day:%d}/"
        "part-000001.parquet"
    )


def create_r2_client(settings: Settings) -> Any:
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint,
        region_name="auto",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
    )


def r2_object_exists(client: Any, bucket: str, key: str) -> bool:
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as exc:
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if status == 404 or code in {"404", "NoSuchKey", "NotFound"}:
            return False
        raise


def list_partitions(connection: psycopg.Connection[Any]) -> list[dict[str, Any]]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select
              sensor_id,
              (coalesce(ended_at, received_at) at time zone 'UTC')::date as day,
              count(*)::bigint as row_count
            from public.traffic_passages
            group by sensor_id, day
            order by sensor_id, day
            """
        )
        return list(cursor.fetchall())


def fetch_partition(
    connection: psycopg.Connection[Any],
    sensor_id: str,
    day: date,
) -> list[dict[str, Any]]:
    start, end = partition_bounds(day)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select *
            from public.traffic_passages
            where sensor_id = %s
              and coalesce(ended_at, received_at) >= %s
              and coalesce(ended_at, received_at) < %s
            order by coalesce(ended_at, received_at), boot_id, track_id
            """,
            (sensor_id, start, end),
        )
        return list(cursor.fetchall())


def write_parquet(rows: list[dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pylist(normalize_rows(rows), schema=TRAFFIC_SCHEMA)
    pq.write_table(table, path, compression="zstd", version="2.6")


def parquet_keys(path: Path) -> Counter[tuple[str, int, int]]:
    table = pq.read_table(path, columns=["sensor_id", "boot_id", "track_id"])
    return Counter(
        (row["sensor_id"], row["boot_id"], row["track_id"])
        for row in table.to_pylist()
    )


def parquet_effective_range(path: Path) -> tuple[datetime, datetime]:
    table = pq.read_table(path, columns=["ended_at", "received_at"])
    values = [
        (row["ended_at"] or row["received_at"]).astimezone(timezone.utc)
        for row in table.to_pylist()
    ]
    return min(values), max(values)


def validate_path_points(path: Path) -> None:
    values = pq.read_table(path, columns=["path_points"])["path_points"].to_pylist()
    for index, value in enumerate(values):
        try:
            json.loads(value)
        except (TypeError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"Invalid path_points JSON at archived row {index}") from exc


def verify_partition(
    source_rows: list[dict[str, Any]],
    local_path: Path,
    downloaded_path: Path,
) -> tuple[str, datetime, datetime]:
    local_rows = pq.ParquetFile(local_path).metadata.num_rows
    downloaded_rows = pq.ParquetFile(downloaded_path).metadata.num_rows
    if local_rows != len(source_rows) or downloaded_rows != len(source_rows):
        raise RuntimeError(
            f"Row mismatch: source={len(source_rows)}, "
            f"local={local_rows}, downloaded={downloaded_rows}"
        )

    local_sha = sha256_file(local_path)
    downloaded_sha = sha256_file(downloaded_path)
    if local_sha != downloaded_sha:
        raise RuntimeError("R2 round-trip SHA-256 mismatch")

    expected_keys = Counter(
        (row["sensor_id"], row["boot_id"], row["track_id"])
        for row in source_rows
    )
    if parquet_keys(local_path) != expected_keys:
        raise RuntimeError("Local Parquet identity-key mismatch")
    if parquet_keys(downloaded_path) != expected_keys:
        raise RuntimeError("Downloaded Parquet identity-key mismatch")

    source_range = (
        min(effective_timestamp(row) for row in source_rows),
        max(effective_timestamp(row) for row in source_rows),
    )
    if parquet_effective_range(local_path) != source_range:
        raise RuntimeError("Local effective timestamp range mismatch")
    if parquet_effective_range(downloaded_path) != source_range:
        raise RuntimeError("Downloaded effective timestamp range mismatch")

    validate_path_points(local_path)
    validate_path_points(downloaded_path)
    return local_sha, source_range[0], source_range[1]


def upsert_manifest(
    connection: psycopg.Connection[Any],
    *,
    sensor_id: str,
    key: str,
    row_count: int,
    byte_count: int,
    sha256_hex: str,
    started_at: datetime,
    ended_at: datetime,
) -> None:
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
              'parquet',
              %s, %s, %s,
              'verified',
              now()
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
                key,
                ARCHIVE_SCHEMA_VERSION,
                byte_count,
                sha256_hex,
            ),
        )
    connection.commit()


def archive_partition(
    connection: psycopg.Connection[Any],
    client: Any,
    settings: Settings,
    output_root: Path,
    sensor_id: str,
    day: date,
    expected_count: int,
    *,
    overwrite: bool,
) -> dict[str, Any]:
    rows = fetch_partition(connection, sensor_id, day)
    if len(rows) != expected_count:
        raise RuntimeError(
            f"{sensor_id} {day}: expected {expected_count} rows, found {len(rows)}"
        )

    key = object_key(sensor_id, day)
    local_path = output_root / key
    write_parquet(rows, local_path)

    if r2_object_exists(client, settings.r2_bucket, key) and not overwrite:
        print(f"[PRESERVE] {key} already exists; verifying existing object")
    else:
        client.upload_file(str(local_path), settings.r2_bucket, key)
        print(f"[UPLOAD] {key}")

    remote = client.head_object(Bucket=settings.r2_bucket, Key=key)
    if int(remote["ContentLength"]) != local_path.stat().st_size:
        raise RuntimeError(f"{key}: R2 ContentLength mismatch")

    with tempfile.TemporaryDirectory(prefix="checkit-r2-verify-") as temp:
        downloaded = Path(temp) / "downloaded.parquet"
        client.download_file(settings.r2_bucket, key, str(downloaded))
        digest, started_at, ended_at = verify_partition(rows, local_path, downloaded)

    upsert_manifest(
        connection,
        sensor_id=sensor_id,
        key=key,
        row_count=len(rows),
        byte_count=local_path.stat().st_size,
        sha256_hex=digest,
        started_at=started_at,
        ended_at=ended_at,
    )

    result = {
        "sensor_id": sensor_id,
        "day": day.isoformat(),
        "row_count": len(rows),
        "object_key": key,
        "byte_count": local_path.stat().st_size,
        "sha256": digest,
        "started_at": started_at.isoformat(),
        "ended_at": ended_at.isoformat(),
        "status": "verified",
    }
    print(json.dumps(result, indent=2))
    return result


def parse_database_url(database_url: str) -> tuple[list[str], dict[str, str]]:
    parsed = urlparse(database_url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise RuntimeError("DATABASE_URL must be a PostgreSQL connection URL")

    database = parsed.path.lstrip("/") or "postgres"
    command = [
        "pg_dump",
        "--format=custom",
        "--no-owner",
        "--no-acl",
        "--host",
        parsed.hostname or "",
        "--port",
        str(parsed.port or 5432),
        "--username",
        unquote(parsed.username or ""),
        "--dbname",
        database,
    ]
    environment = dict(os.environ)
    environment["PGPASSWORD"] = unquote(parsed.password or "")
    return command, environment


def create_and_upload_pg_dump(
    settings: Settings,
    client: Any,
    output_root: Path,
    *,
    skip_pg_dump: bool,
) -> dict[str, Any] | None:
    if skip_pg_dump:
        return None

    if shutil.which("pg_dump") is None:
        raise RuntimeError(
            "pg_dump was not found. On macOS run `brew install libpq` and "
            "add Homebrew's libpq bin directory to PATH, or rerun with "
            "--skip-pg-dump after accepting that only analytical Parquet "
            "archives will be created."
        )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    local = output_root / "backups" / "postgres" / f"transportation-{stamp}.dump"
    local.parent.mkdir(parents=True, exist_ok=True)

    command, environment = parse_database_url(settings.database_url)
    command.extend(["--file", str(local)])
    subprocess.run(command, env=environment, check=True)

    key = f"backups/postgres/project=transportation/snapshot={stamp}/transportation.dump"
    client.upload_file(str(local), settings.r2_bucket, key)

    with tempfile.TemporaryDirectory(prefix="checkit-db-backup-") as temp:
        downloaded = Path(temp) / "transportation.dump"
        client.download_file(settings.r2_bucket, key, str(downloaded))
        local_sha = sha256_file(local)
        remote_sha = sha256_file(downloaded)
        if local_sha != remote_sha:
            raise RuntimeError("Full PostgreSQL dump failed SHA-256 verification")

    result = {
        "object_key": key,
        "byte_count": local.stat().st_size,
        "sha256": local_sha,
        "status": "verified",
    }
    print(json.dumps({"postgres_backup": result}, indent=2))
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path("data"),
        help="Local archive output root; defaults to ./data",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace an existing schema-v2 R2 partition before verifying it",
    )
    parser.add_argument(
        "--skip-pg-dump",
        action="store_true",
        help="Skip the full PostgreSQL dump and create only Parquet archives",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    settings = load_settings()
    client = create_r2_client(settings)
    client.head_bucket(Bucket=settings.r2_bucket)

    print("[1/3] Creating full PostgreSQL backup")
    create_and_upload_pg_dump(
        settings,
        client,
        args.output_root,
        skip_pg_dump=args.skip_pg_dump,
    )

    print("[2/3] Archiving traffic_passages partitions")
    with psycopg.connect(
        settings.database_url,
        row_factory=dict_row,
    ) as connection:
        partitions = list_partitions(connection)
        source_total = sum(int(partition["row_count"]) for partition in partitions)
        results = [
            archive_partition(
                connection,
                client,
                settings,
                args.output_root,
                partition["sensor_id"],
                partition["day"],
                int(partition["row_count"]),
                overwrite=args.overwrite,
            )
            for partition in partitions
        ]

        with connection.cursor() as cursor:
            cursor.execute("select count(*)::bigint as count from public.traffic_passages")
            database_total = int(cursor.fetchone()["count"])
            cursor.execute(
                """
                select coalesce(sum(row_count), 0)::bigint as count
                from public.historical_archives
                where dataset = 'traffic_passages'
                  and schema_version = %s
                  and status = 'verified'
                """,
                (ARCHIVE_SCHEMA_VERSION,),
            )
            manifest_total = int(cursor.fetchone()["count"])

    archived_total = sum(result["row_count"] for result in results)
    if database_total != source_total or archived_total != source_total:
        raise RuntimeError(
            f"Total mismatch: database={database_total}, "
            f"partition_listing={source_total}, archived={archived_total}"
        )
    if manifest_total != source_total:
        raise RuntimeError(
            f"Manifest total {manifest_total} does not equal source total {source_total}"
        )

    print("[3/3] Complete")
    print(
        json.dumps(
            {
                "status": "PASS",
                "database_rows": database_total,
                "archived_rows": archived_total,
                "verified_manifest_rows": manifest_total,
                "partitions": len(results),
                "source_deleted": False,
            },
            indent=2,
        )
    )
    print("No Supabase source rows were deleted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
