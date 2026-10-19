#!/usr/bin/env python3
"""Create a full logical PostgreSQL backup and verify it through private R2.

This complements the analytical Parquet archive. The custom-format pg_dump
preserves schemas, tables, views, functions, policies, and data for disaster
recovery. It does not modify Supabase.

Run from the repository's backend directory:

    cd /Users/himan/Desktop/checkit-transportation-felix/backend
    source .venv/bin/activate
    python ../scripts/backup_full_database_to_r2.py

Requires `pg_dump` compatible with PostgreSQL 17.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from checkit_transportation.config import Settings
from checkit_transportation.storage.r2 import (
    create_client,
    download_object,
    head_object,
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", type=Path, default=Path("data/backups"))
    parser.add_argument("--project-name", default="transportation")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    settings = Settings.from_env(env_file=".env")

    pg_dump = shutil.which("pg_dump")
    if not pg_dump:
        raise RuntimeError(
            "pg_dump was not found. On macOS: brew install libpq && "
            'echo \'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"\' >> ~/.zshrc'
        )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = f"{args.project_name}-{stamp}.dump"
    local_path = args.output_root / filename
    local_path.parent.mkdir(parents=True, exist_ok=True)

    subprocess.run(
        [
            pg_dump,
            settings.database_url,
            "--format=custom",
            "--no-owner",
            "--no-acl",
            "--file",
            str(local_path),
        ],
        check=True,
    )

    local_size = local_path.stat().st_size
    local_sha = sha256(local_path)
    object_key = (
        f"backups/postgres/project={args.project_name}/snapshot={stamp}/{filename}"
    )

    client = create_client(settings)
    client.upload_file(
        str(local_path),
        settings.r2_bucket,
        object_key,
        ExtraArgs={
            "Metadata": {
                "sha256": local_sha,
                "format": "pg_dump_custom",
                "snapshot_utc": stamp,
            }
        },
    )

    head = head_object(client, settings.r2_bucket, object_key)
    if int(head["ContentLength"]) != local_size:
        raise RuntimeError("R2 database-backup size does not match local file")
    remote_metadata_sha = head.get("Metadata", {}).get("sha256")
    if remote_metadata_sha and remote_metadata_sha != local_sha:
        raise RuntimeError("R2 database-backup metadata SHA-256 mismatch")

    with tempfile.TemporaryDirectory(prefix="checkit-db-backup-") as temp_dir:
        downloaded = Path(temp_dir) / filename
        download_object(client, settings.r2_bucket, object_key, downloaded)
        downloaded_sha = sha256(downloaded)
        if downloaded_sha != local_sha:
            raise RuntimeError("Downloaded database-backup SHA-256 mismatch")

        # `pg_restore --list` proves the custom archive is readable.
        pg_restore = shutil.which("pg_restore")
        if not pg_restore:
            raise RuntimeError("pg_restore was not found beside pg_dump")
        subprocess.run(
            [pg_restore, "--list", str(downloaded)],
            check=True,
            stdout=subprocess.DEVNULL,
        )

    print(
        json.dumps(
            {
                "status": "PASS",
                "object_key": object_key,
                "bytes": local_size,
                "sha256": local_sha,
                "download_sha256_match": True,
                "pg_restore_list_passed": True,
                "supabase_modified": False,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
