#!/usr/bin/env python3
"""Deterministically backfill traffic_daily; defaults to a no-write dry run."""

from __future__ import annotations

import argparse
import json
from dataclasses import replace
from datetime import date, timedelta

from checkit_transportation.aggregation.daily import DEFAULT_POLICY, aggregate_daily, upsert_daily
from checkit_transportation.config import Settings
from checkit_transportation.storage.postgres import connect, fetch_traffic_passages_for_day


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sensor", required=True)
    parser.add_argument("--start", required=True, type=date.fromisoformat)
    parser.add_argument("--end", required=True, type=date.fromisoformat)
    parser.add_argument("--speeding-threshold-kmh", type=int)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", dest="dry_run", action="store_true", default=True)
    mode.add_argument("--execute", dest="dry_run", action="store_false", help="Upsert traffic_daily")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.end < args.start:
        raise ValueError("--end must not precede --start")
    settings = Settings.from_env(require_database=True, require_r2=False)
    policy = replace(DEFAULT_POLICY, speeding_threshold_kmh=args.speeding_threshold_kmh)
    current = args.start
    with connect(settings.database_url) as connection:
        while current <= args.end:
            rows = fetch_traffic_passages_for_day(connection, args.sensor, current)
            aggregate = aggregate_daily(rows, args.sensor, current, policy=policy)
            print(json.dumps({"dry_run": args.dry_run, **aggregate.as_dict()}, default=str))
            if not args.dry_run:
                upsert_daily(connection, aggregate)
            current += timedelta(days=1)
    print("DRY RUN: no aggregate rows written." if args.dry_run else "Daily aggregates upserted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
