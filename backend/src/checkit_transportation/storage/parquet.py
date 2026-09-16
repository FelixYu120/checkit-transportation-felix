"""Schema-v1 Parquet encoding for detailed traffic passages.

``path_points`` is stored as deterministic compact JSON text in schema v1.
Every known production column is required; unexpected columns cause an error so
schema drift cannot be silently discarded.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

import pyarrow as pa
import pyarrow.parquet as pq


TRAFFIC_PASSAGE_COLUMNS = (
    "sensor_id", "boot_id", "track_id", "started_at", "ended_at", "direction",
    "traffic_class", "class_confidence", "quality_status", "quality_score",
    "association_confidence", "direction_consistency", "hit_count", "duration_ms",
    "median_speed_kmh", "p85_speed_kmh", "max_speed_kmh", "mean_snr", "max_snr",
    "peak_cluster_size", "travel_distance_m", "entry_distance_m", "entry_angle_deg",
    "exit_distance_m", "exit_angle_deg", "firmware_version", "model_version",
    "path_points", "created_at", "received_at", "human_label", "label_confidence",
    "label_notes", "labeled_at",
)


TRAFFIC_PASSAGE_SCHEMA = pa.schema(
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
    metadata={b"checkit.dataset": b"traffic_passages", b"checkit.schema_version": b"1"},
)


def deterministic_json(value: Any) -> str:
    """Normalize JSONB-compatible data to stable compact Unicode JSON."""

    if isinstance(value, str):
        value = json.loads(value)
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, sort_keys=True)


def _normalize_rows(rows: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    expected = set(TRAFFIC_PASSAGE_COLUMNS)
    for index, row in enumerate(rows):
        keys = set(row)
        missing, extra = expected - keys, keys - expected
        if missing or extra:
            raise ValueError(
                f"traffic_passages row {index} schema mismatch; "
                f"missing={sorted(missing)}, extra={sorted(extra)}"
            )
        item = dict(row)
        item["path_points"] = deterministic_json(item["path_points"])
        normalized.append(item)
    return normalized


def write_traffic_passages(rows: Iterable[Mapping[str, Any]], destination: str | Path) -> Path:
    path = Path(destination)
    path.parent.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pylist(_normalize_rows(rows), schema=TRAFFIC_PASSAGE_SCHEMA)
    pq.write_table(table, path, compression="zstd", version="2.6")
    return path


def read_archive(path: str | Path) -> pa.Table:
    return pq.read_table(path)


def count_rows(path: str | Path) -> int:
    return pq.ParquetFile(path).metadata.num_rows


def calculate_sha256(path: str | Path, *, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_schema(path: str | Path) -> pa.Schema:
    return pq.read_schema(path)


def file_size(path: str | Path) -> int:
    return Path(path).stat().st_size


def extract_keys(path: str | Path) -> list[tuple[str, int, int]]:
    table = pq.read_table(path, columns=["sensor_id", "boot_id", "track_id"])
    return [(r["sensor_id"], r["boot_id"], r["track_id"]) for r in table.to_pylist()]


def extract_timestamp_range(path: str | Path) -> tuple[Any | None, Any | None]:
    values = [row["ended_at"] for row in pq.read_table(path, columns=["ended_at"]).to_pylist()]
    values = [value for value in values if value is not None]
    return (min(values), max(values)) if values else (None, None)


def validate_path_points(path: str | Path) -> None:
    for index, value in enumerate(pq.read_table(path, columns=["path_points"])["path_points"].to_pylist()):
        try:
            json.loads(value)
        except (TypeError, json.JSONDecodeError) as exc:
            raise ValueError(f"Invalid path_points JSON at archived row {index}") from exc


def assert_required_columns(path: str | Path) -> None:
    names = set(inspect_schema(path).names)
    missing = set(TRAFFIC_PASSAGE_COLUMNS) - names
    if missing:
        raise ValueError(f"Parquet archive is missing required columns: {sorted(missing)}")
