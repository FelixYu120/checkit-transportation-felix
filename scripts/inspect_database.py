#!/usr/bin/env python3
"""Read-only database inventory: counts, sizes, and traffic_passages dependencies."""

from __future__ import annotations

import argparse
import json

from checkit_transportation.config import Settings
from checkit_transportation.storage.postgres import connect, table_inventory, traffic_passages_dependencies


def main() -> int:
    argparse.ArgumentParser(description=__doc__).parse_args()
    settings = Settings.from_env(require_database=True, require_r2=False)
    with connect(settings.database_url) as connection:
        result = {
            "tables": table_inventory(connection),
            "traffic_passages_dependencies": traffic_passages_dependencies(connection),
        }
    print(json.dumps(result, indent=2, default=str))
    print("Read-only inspection complete; no mutations ran.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
