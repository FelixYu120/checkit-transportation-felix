"""Full archive verification with explicit, source-preserving failures."""

from __future__ import annotations

import json
import math
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

from checkit_transportation.storage.parquet import (
    TRAFFIC_PASSAGE_COLUMNS,
    assert_required_columns,
    calculate_sha256,
    count_rows,
    extract_keys,
    extract_timestamp_range,
    read_archive,
    validate_path_points,
)
from checkit_transportation.storage.postgres import obtain_min_max_timestamps


class ArchiveVerificationError(RuntimeError):
    """Raised when an archive cannot be proven equivalent to its source."""


@dataclass(frozen=True, slots=True)
class VerificationReport:
    source_row_count: int
    local_row_count: int
    downloaded_row_count: int
    sha256_hex: str
    min_timestamp: Any | None
    max_timestamp: Any | None
    verification_result: bool = True


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise ArchiveVerificationError(message)


def _normalize_value(value: Any) -> Any:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _sample_values_equal(source: Any, archived: Any) -> bool:
    """Compare values using float32-appropriate tolerance for Postgres REAL."""

    if isinstance(source, float) and isinstance(archived, float):
        return math.isclose(source, archived, rel_tol=1e-6, abs_tol=1e-6)
    return _normalize_value(source) == _normalize_value(archived)


def _verify_source_against_path(
    source_rows: Sequence[Mapping[str, Any]], path: str | Path, *, sample_size: int = 0
) -> tuple[Any | None, Any | None]:
    assert_required_columns(path)
    validate_path_points(path)
    _assert(count_rows(path) == len(source_rows), "Source and archived row counts differ")
    source_keys = Counter((row["sensor_id"], row["boot_id"], row["track_id"]) for row in source_rows)
    archived_keys = Counter(extract_keys(path))
    _assert(source_keys == archived_keys, "Source and archived identity keys differ")
    source_range = obtain_min_max_timestamps(source_rows)
    archive_range = extract_timestamp_range(path)
    _assert(source_range == archive_range, "Source and archived ended_at ranges differ")

    if sample_size > 0:
        archived_by_key = {
            (row["sensor_id"], row["boot_id"], row["track_id"]): row
            for row in read_archive(path).to_pylist()
        }
        fields = tuple(field for field in TRAFFIC_PASSAGE_COLUMNS if field != "path_points")
        for source in source_rows[:sample_size]:
            identity = (source["sensor_id"], source["boot_id"], source["track_id"])
            archived = archived_by_key[identity]
            for field in fields:
                _assert(
                    _sample_values_equal(source[field], archived[field]),
                    f"Sample field {field} differs for key {identity}",
                )
            source_json = json.loads(source["path_points"]) if isinstance(source["path_points"], str) else source["path_points"]
            _assert(source_json == json.loads(archived["path_points"]), f"path_points differs for key {identity}")
    return source_range


def _verify_archive_impl(
    source_rows: Sequence[Mapping[str, Any]],
    local_path: str | Path,
    downloaded_path: str | Path,
    *,
    sample_size: int = 0,
) -> VerificationReport:
    source_count = len(source_rows)
    local_count = count_rows(local_path)
    downloaded_count = count_rows(downloaded_path)
    _assert(source_count == local_count, "Source and local Parquet row counts differ")
    _assert(local_count == downloaded_count, "Local and downloaded Parquet row counts differ")
    local_sha = calculate_sha256(local_path)
    downloaded_sha = calculate_sha256(downloaded_path)
    _assert(local_sha == downloaded_sha, "Local and downloaded SHA-256 digests differ")
    source_range = _verify_source_against_path(source_rows, local_path, sample_size=sample_size)
    _verify_source_against_path(source_rows, downloaded_path, sample_size=sample_size)
    return VerificationReport(
        source_row_count=source_count,
        local_row_count=local_count,
        downloaded_row_count=downloaded_count,
        sha256_hex=local_sha,
        min_timestamp=source_range[0],
        max_timestamp=source_range[1],
    )


def verify_archive(
    source_rows: Sequence[Mapping[str, Any]],
    local_path: str | Path,
    downloaded_path: str | Path,
    *,
    sample_size: int = 0,
) -> VerificationReport:
    """Verify both local and downloaded copies, normalizing all failures."""

    try:
        return _verify_archive_impl(
            source_rows, local_path, downloaded_path, sample_size=sample_size
        )
    except ArchiveVerificationError:
        raise
    except Exception as exc:
        raise ArchiveVerificationError(f"Archive verification failed: {exc}") from exc


def _verify_source_archive_impl(
    source_rows: Sequence[Mapping[str, Any]], archive_path: str | Path, *, sample_size: int = 0
) -> VerificationReport:
    timestamp_range = _verify_source_against_path(source_rows, archive_path, sample_size=sample_size)
    row_count = count_rows(archive_path)
    return VerificationReport(
        source_row_count=len(source_rows),
        local_row_count=row_count,
        downloaded_row_count=row_count,
        sha256_hex=calculate_sha256(archive_path),
        min_timestamp=timestamp_range[0],
        max_timestamp=timestamp_range[1],
    )


def verify_source_archive(
    source_rows: Sequence[Mapping[str, Any]], archive_path: str | Path, *, sample_size: int = 0
) -> VerificationReport:
    """Compare one archive with source, normalizing corrupt-file failures."""

    try:
        return _verify_source_archive_impl(source_rows, archive_path, sample_size=sample_size)
    except ArchiveVerificationError:
        raise
    except Exception as exc:
        raise ArchiveVerificationError(f"Archive verification failed: {exc}") from exc
