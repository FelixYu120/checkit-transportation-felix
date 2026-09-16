"""Ten-minute helpers for firmware/server parity and future authority migration."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Iterable, Mapping


def bucket_start(timestamp: datetime) -> datetime:
    return timestamp.replace(minute=(timestamp.minute // 10) * 10, second=0, microsecond=0)


def _percentile(values: list[int], percentile: float) -> float:
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int((len(ordered) - 1) * percentile + 0.5)))
    return float(ordered[index])


def aggregate_ten_minute(rows: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Aggregate accepted passages by sensor, bucket, and direction for parity tests."""

    groups: dict[tuple[str, datetime, str], list[int]] = defaultdict(list)
    for row in rows:
        if row.get("quality_status") != "accepted" or row.get("ended_at") is None:
            continue
        groups[(row["sensor_id"], bucket_start(row["ended_at"]), row["direction"])].append(
            int(row["median_speed_kmh"])
        )
    result = []
    for (sensor_id, bucket, direction), speeds in sorted(groups.items()):
        result.append(
            {
                "sensor_id": sensor_id,
                "time_bucket": bucket,
                "direction": direction,
                "volume": len(speeds),
                "avg_speed": sum(speeds) / len(speeds),
                "v85_speed": _percentile(speeds, 0.85),
                "max_speed": max(speeds),
            }
        )
    return result


def validate_summary_parity(
    generated: Iterable[Mapping[str, Any]], firmware: Iterable[Mapping[str, Any]], *, speed_tolerance: float = 0.51
) -> list[str]:
    """Return readable parity differences; no database writes are performed."""

    key = lambda row: (row["sensor_id"], row["time_bucket"], row["direction"])
    left = {key(row): row for row in generated}
    right = {key(row): row for row in firmware}
    errors: list[str] = []
    for missing in sorted(left.keys() - right.keys()):
        errors.append(f"firmware summary missing {missing}")
    for extra in sorted(right.keys() - left.keys()):
        errors.append(f"firmware summary has extra {extra}")
    for identity in sorted(left.keys() & right.keys()):
        if int(left[identity]["volume"]) != int(right[identity]["volume"]):
            errors.append(f"volume mismatch for {identity}")
        for field in ("avg_speed", "v85_speed", "max_speed"):
            if abs(float(left[identity][field]) - float(right[identity][field])) > speed_tolerance:
                errors.append(f"{field} mismatch for {identity}")
    return errors


TEN_MINUTE = timedelta(minutes=10)
