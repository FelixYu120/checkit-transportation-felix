#!/usr/bin/env python3
"""Archive and fully verify one sensor/day without deleting source rows."""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

from checkit_transportation.archive.exporter import archive_day
from checkit_transportation.config import Settings
from checkit_transportation.storage.postgres import connect
from checkit_transportation.storage.r2 import create_client


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sensor", required=True)
    parser.add_argument("--day", required=True, type=date.fromisoformat)
    parser.add_argument("--expected-rows", type=int)
    parser.add_argument("--output-root", type=Path, default=Path("data"))
    parser.add_argument("--sample-size", type=int, default=10)
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace an existing object key; default is preserve-and-verify",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    settings = Settings.from_env()
    client = create_client(settings)
    with connect(settings.database_url) as connection:
        result = archive_day(
            connection,
            client,
            settings.r2_bucket,
            args.sensor,
            args.day,
            output_root=args.output_root,
            expected_rows=args.expected_rows,
            sample_size=args.sample_size,
            overwrite=args.overwrite,
        )
    print(json.dumps({"status": "PASS", **result.as_dict()}, indent=2))
    print("Supabase source data was not modified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
