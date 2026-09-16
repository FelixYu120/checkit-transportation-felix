"""Safe Supabase-to-Parquet-to-R2 archive pipeline."""

from __future__ import annotations

import tempfile
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from typing import Any

from psycopg import Connection

from checkit_transportation.archive.verifier import verify_archive
from checkit_transportation.storage.parquet import (
    assert_required_columns,
    calculate_sha256,
    count_rows,
    file_size,
    validate_path_points,
    write_traffic_passages,
)
from checkit_transportation.storage.postgres import fetch_traffic_passages_for_day
from checkit_transportation.storage.r2 import (
    download_object,
    head_object,
    object_exists,
    traffic_passages_object_key,
    upload_file,
)


@dataclass(frozen=True, slots=True)
class ArchiveResult:
    sensor_id: str
    day: date
    source_row_count: int
    local_row_count: int
    downloaded_row_count: int
    object_key: str
    byte_size: int
    sha256: str
    min_timestamp: Any | None
    max_timestamp: Any | None
    verification_result: bool
    uploaded: bool
    local_path: str

    def as_dict(self) -> dict[str, Any]:
        result = asdict(self)
        for key in ("day", "min_timestamp", "max_timestamp"):
            value = result[key]
            if value is not None and hasattr(value, "isoformat"):
                result[key] = value.isoformat()
        return result


def archive_day(
    connection: Connection[Any],
    r2_client: Any,
    bucket: str,
    sensor_id: str,
    day: date,
    *,
    output_root: str | Path = "data",
    expected_rows: int | None = None,
    sample_size: int = 10,
    overwrite: bool = False,
) -> ArchiveResult:
    """Archive and fully verify one day; never mutates Supabase source data."""

    rows = fetch_traffic_passages_for_day(connection, sensor_id, day)
    if expected_rows is not None and len(rows) != expected_rows:
        raise ValueError(f"Expected {expected_rows} source rows, found {len(rows)}")
    if not rows:
        raise ValueError(f"No traffic_passages found for {sensor_id} on {day}")

    object_key = traffic_passages_object_key(sensor_id, day)
    local_path = Path(output_root) / object_key
    write_traffic_passages(rows, local_path)
    assert_required_columns(local_path)
    validate_path_points(local_path)
    if count_rows(local_path) != len(rows):
        raise RuntimeError("Local Parquet row count differs from source")

    uploaded = False
    exists = object_exists(r2_client, bucket, object_key)
    if exists and not overwrite:
        # Preserve the existing object and verify it. A mismatch is an explicit
        # operator decision, never an automatic overwrite.
        pass
    else:
        upload_file(r2_client, bucket, local_path, object_key)
        uploaded = True

    remote_head = head_object(r2_client, bucket, object_key)
    expected_size = file_size(local_path)
    if int(remote_head["ContentLength"]) != expected_size:
        raise RuntimeError("R2 HEAD ContentLength differs from local byte size")

    with tempfile.TemporaryDirectory(prefix="checkit-archive-") as temporary:
        downloaded_path = Path(temporary) / "downloaded.parquet"
        download_object(r2_client, bucket, object_key, downloaded_path)
        report = verify_archive(rows, local_path, downloaded_path, sample_size=sample_size)

    return ArchiveResult(
        sensor_id=sensor_id,
        day=day,
        source_row_count=report.source_row_count,
        local_row_count=report.local_row_count,
        downloaded_row_count=report.downloaded_row_count,
        object_key=object_key,
        byte_size=expected_size,
        sha256=calculate_sha256(local_path),
        min_timestamp=report.min_timestamp,
        max_timestamp=report.max_timestamp,
        verification_result=report.verification_result,
        uploaded=uploaded,
        local_path=str(local_path),
    )
