#!/usr/bin/env python3
"""Test required environment presence, Supabase SELECT, and private R2 access."""

from __future__ import annotations

import argparse

from dotenv import load_dotenv

from checkit_transportation.config import Settings, environment_presence
from checkit_transportation.storage.postgres import connect, test_connection
from checkit_transportation.storage.r2 import create_client, test_bucket_access


ENV_NAMES = (
    "DATABASE_URL", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"
)


def main() -> int:
    argparse.ArgumentParser(description=__doc__).parse_args()
    load_dotenv(".env", override=False)
    presence = environment_presence(ENV_NAMES)
    print("Environment presence (values hidden):")
    for name, present in presence.items():
        print(f"  {name}: {'set' if present else 'missing'}")
    settings = Settings.from_env()
    with connect(settings.database_url) as connection:
        if not test_connection(connection):
            raise RuntimeError("Database SELECT connectivity check failed")
    test_bucket_access(create_client(settings), settings.r2_bucket)
    print("PASS: Supabase SELECT and private R2 bucket access succeeded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
