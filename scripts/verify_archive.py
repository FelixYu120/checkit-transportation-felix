#!/usr/bin/env python3
"""Download and inspect an R2 archive, optionally comparing live source rows."""

from __future__ import annotations

import argparse
import json
import tempfile
from datetime import date
from pathlib import Path

from checkit_transportation.archive.verifier import verify_source_archive
from checkit_transportation.config import Settings
from checkit_transportation.storage.parquet import (
    assert_required_columns,
    calculate_sha256,
    count_rows,
    file_size,
    inspect_schema,
    validate_path_points,
)
from checkit_transportation.storage.postgres import connect, fetch_traffic_passages_for_day
from checkit_transportation.storage.r2 import create_client, download_object, traffic_passages_object_key


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sensor", required=True)
    parser.add_argument("--day", required=True, type=date.fromisoformat)
    parser.add_argument("--object-key")
    parser.add_argument("--expected-sha256")
    parser.add_argument("--compare-source", action="store_true")
    parser.add_argument("--sample-size", type=int, default=10)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    settings = Settings.from_env(require_database=args.compare_source, require_r2=True)
    key = args.object_key or traffic_passages_object_key(args.sensor, args.day)
    with tempfile.TemporaryDirectory(prefix="checkit-verify-") as temporary:
        path = download_object(
            create_client(settings), settings.r2_bucket, key, Path(temporary) / "archive.parquet"
        )
        assert_required_columns(path)
        validate_path_points(path)
        digest = calculate_sha256(path)
        if args.expected_sha256 and digest != args.expected_sha256.lower():
            raise RuntimeError("Downloaded SHA-256 does not match --expected-sha256")
        result: dict[str, object] = {
            "status": "PASS",
            "object_key": key,
            "row_count": count_rows(path),
            "byte_count": file_size(path),
            "sha256": digest,
            "schema": str(inspect_schema(path)),
        }
        if args.compare_source:
            with connect(settings.database_url) as connection:
                rows = fetch_traffic_passages_for_day(connection, args.sensor, args.day)
            report = verify_source_archive(rows, path, sample_size=args.sample_size)
            result["source_comparison"] = {
                "source_row_count": report.source_row_count,
                "min_timestamp": report.min_timestamp.isoformat() if report.min_timestamp else None,
                "max_timestamp": report.max_timestamp.isoformat() if report.max_timestamp else None,
            }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
