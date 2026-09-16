"""Deterministic daily aggregation from detailed passages.

Production string values were not available in this checkout. All assumptions
are therefore centralized in ``AggregationPolicy`` instead of being scattered
through SQL. The default recognizes the likely V2 values documented below;
operators must confirm them against firmware/database inventory before backfill.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from datetime import date
from typing import Any, Iterable, Mapping, Sequence

from psycopg import Connection, sql


HISTOGRAM_BIN_SIZE_KMH = 5
HISTOGRAM_OVERFLOW_KMH = 120
HISTOGRAM_BIN_COUNT = HISTOGRAM_OVERFLOW_KMH // HISTOGRAM_BIN_SIZE_KMH + 1


@dataclass(frozen=True, slots=True)
class AggregationPolicy:
    """Centralized mappings that must be verified against production values."""

    counted_quality_statuses: frozenset[str] = field(default_factory=lambda: frozenset({"accepted"}))
    accepted_statuses: frozenset[str] = field(default_factory=lambda: frozenset({"accepted"}))
    review_statuses: frozenset[str] = field(default_factory=lambda: frozenset({"review"}))
    rejected_statuses: frozenset[str] = field(default_factory=lambda: frozenset({"rejected"}))
    approach_directions: frozenset[str] = field(default_factory=lambda: frozenset({"approach"}))
    away_directions: frozenset[str] = field(default_factory=lambda: frozenset({"away"}))
    motor_vehicle_classes: frozenset[str] = field(
        default_factory=lambda: frozenset({"car", "truck", "bus", "motorcycle", "motor_vehicle"})
    )
    micromobility_classes: frozenset[str] = field(
        default_factory=lambda: frozenset({"bicycle", "bike", "scooter", "micromobility"})
    )
    speeding_threshold_kmh: int | None = None


DEFAULT_POLICY = AggregationPolicy()


@dataclass(frozen=True, slots=True)
class DailyAggregate:
    sensor_id: str
    day: date
    volume: int
    approach_volume: int
    away_volume: int
    motor_vehicle_volume: int
    micromobility_volume: int
    unknown_volume: int
    speed_count: int
    speed_sum_kmh: int
    max_speed_kmh: int
    speed_histogram: list[int]
    histogram_bin_size_kmh: int
    histogram_version: int
    speeding_count: int
    accepted_count: int
    review_count: int
    rejected_count: int
    snr_sum: int
    snr_count: int
    source_passage_count: int

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def histogram_bin(speed_kmh: int | float) -> int:
    speed = max(0.0, float(speed_kmh))
    if speed >= HISTOGRAM_OVERFLOW_KMH:
        return HISTOGRAM_BIN_COUNT - 1
    return int(speed // HISTOGRAM_BIN_SIZE_KMH)


def build_speed_histogram(speeds: Iterable[int | float]) -> list[int]:
    histogram = [0] * HISTOGRAM_BIN_COUNT
    for speed in speeds:
        histogram[histogram_bin(speed)] += 1
    return histogram


def combine_histograms(histograms: Iterable[Sequence[int]]) -> list[int]:
    combined = [0] * HISTOGRAM_BIN_COUNT
    for histogram in histograms:
        if len(histogram) != HISTOGRAM_BIN_COUNT:
            raise ValueError(f"Expected {HISTOGRAM_BIN_COUNT} histogram bins")
        combined = [left + int(right) for left, right in zip(combined, histogram, strict=True)]
    return combined


def approximate_percentile_from_histogram(histogram: Sequence[int], percentile: float) -> float | None:
    """Return a linearly positioned estimate within the selected 5-km/h bin."""

    if len(histogram) != HISTOGRAM_BIN_COUNT:
        raise ValueError(f"Expected {HISTOGRAM_BIN_COUNT} histogram bins")
    if not 0 <= percentile <= 1:
        raise ValueError("percentile must be between 0 and 1")
    total = sum(histogram)
    if total == 0:
        return None
    rank = max(1, math.ceil(percentile * total))
    cumulative = 0
    for index, count in enumerate(histogram):
        cumulative += count
        if cumulative >= rank:
            if index == HISTOGRAM_BIN_COUNT - 1:
                return float(HISTOGRAM_OVERFLOW_KMH)
            previous = cumulative - count
            fraction = 0.5 if count == 0 else (rank - previous - 0.5) / count
            return index * HISTOGRAM_BIN_SIZE_KMH + max(0.0, min(1.0, fraction)) * HISTOGRAM_BIN_SIZE_KMH
    raise AssertionError("unreachable histogram rank")


def weighted_average_speed(aggregates: Iterable[Mapping[str, Any]]) -> float | None:
    rows = list(aggregates)
    count = sum(int(row["speed_count"]) for row in rows)
    return (sum(int(row["speed_sum_kmh"]) for row in rows) / count) if count else None


def aggregate_daily(
    rows: Iterable[Mapping[str, Any]], sensor_id: str, day: date, *, policy: AggregationPolicy = DEFAULT_POLICY
) -> DailyAggregate:
    source = list(rows)
    counted = [row for row in source if str(row.get("quality_status", "")) in policy.counted_quality_statuses]
    speeds = [int(row["median_speed_kmh"]) for row in counted if row.get("median_speed_kmh") is not None]

    def count_values(records: Iterable[Mapping[str, Any]], field_name: str, values: frozenset[str]) -> int:
        return sum(str(row.get(field_name, "")) in values for row in records)

    motor = count_values(counted, "traffic_class", policy.motor_vehicle_classes)
    micro = count_values(counted, "traffic_class", policy.micromobility_classes)
    speeding = (
        sum(speed >= policy.speeding_threshold_kmh for speed in speeds)
        if policy.speeding_threshold_kmh is not None
        else 0
    )
    return DailyAggregate(
        sensor_id=sensor_id,
        day=day,
        volume=len(counted),
        approach_volume=count_values(counted, "direction", policy.approach_directions),
        away_volume=count_values(counted, "direction", policy.away_directions),
        motor_vehicle_volume=motor,
        micromobility_volume=micro,
        unknown_volume=len(counted) - motor - micro,
        speed_count=len(speeds),
        speed_sum_kmh=sum(speeds),
        max_speed_kmh=max(speeds, default=0),
        speed_histogram=build_speed_histogram(speeds),
        histogram_bin_size_kmh=HISTOGRAM_BIN_SIZE_KMH,
        histogram_version=1,
        speeding_count=speeding,
        accepted_count=count_values(source, "quality_status", policy.accepted_statuses),
        review_count=count_values(source, "quality_status", policy.review_statuses),
        rejected_count=count_values(source, "quality_status", policy.rejected_statuses),
        snr_sum=sum(int(row["mean_snr"]) for row in counted if row.get("mean_snr") is not None),
        snr_count=sum(row.get("mean_snr") is not None for row in counted),
        source_passage_count=len(source),
    )


def upsert_daily(connection: Connection[Any], aggregate: DailyAggregate) -> None:
    """Atomically replace the sensor/day aggregate and commit via caller context."""

    values = aggregate.as_dict()
    columns = tuple(values)
    assignments = sql.SQL(", ").join(
        sql.SQL("{} = excluded.{}").format(sql.Identifier(column), sql.Identifier(column))
        for column in columns
        if column not in {"sensor_id", "day"}
    )
    query = sql.SQL(
        "insert into public.traffic_daily ({}) values ({}) "
        "on conflict (sensor_id, day) do update set {}, updated_at = now()"
    ).format(
        sql.SQL(", ").join(sql.Identifier(column) for column in columns),
        sql.SQL(", ").join(sql.Placeholder() for _ in columns),
        assignments,
    )
    with connection.cursor() as cursor:
        cursor.execute(query, [values[column] for column in columns])
