from __future__ import annotations

from datetime import date

import pytest

from checkit_transportation.aggregation.daily import (
    HISTOGRAM_BIN_COUNT,
    aggregate_daily,
    approximate_percentile_from_histogram,
    build_speed_histogram,
    combine_histograms,
    weighted_average_speed,
)


def test_histogram_bins_and_overflow() -> None:
    histogram = build_speed_histogram([0, 4, 5, 119, 120, 180, -2])
    assert len(histogram) == HISTOGRAM_BIN_COUNT == 25
    assert histogram[0] == 3
    assert histogram[1] == 1
    assert histogram[23] == 1
    assert histogram[24] == 2


def test_combine_and_percentile() -> None:
    first = build_speed_histogram([1, 6, 11])
    second = build_speed_histogram([16, 21])
    merged = combine_histograms([first, second])
    assert sum(merged) == 5
    assert approximate_percentile_from_histogram(merged, 0.85) == pytest.approx(22.5)
    assert approximate_percentile_from_histogram([0] * 25, 0.85) is None


def test_daily_aggregation_is_deterministic(passage_row) -> None:
    second = dict(passage_row, track_id=21, direction="away", median_speed_kmh=121, traffic_class="bicycle")
    rejected = dict(passage_row, track_id=22, quality_status="rejected", median_speed_kmh=90)
    aggregate = aggregate_daily([second, rejected, passage_row], passage_row["sensor_id"], date(2026, 8, 24))
    assert aggregate.source_passage_count == 3
    assert aggregate.volume == 2
    assert aggregate.approach_volume == 1
    assert aggregate.away_volume == 1
    assert aggregate.motor_vehicle_volume == 1
    assert aggregate.micromobility_volume == 1
    assert aggregate.speed_count == 2
    assert aggregate.speed_sum_kmh == 144
    assert aggregate.max_speed_kmh == 121
    assert aggregate.speed_histogram[-1] == 1
    assert aggregate.rejected_count == 1
    assert aggregate.speeding_count == 0


def test_weighted_average_does_not_average_daily_averages() -> None:
    assert weighted_average_speed(
        [{"speed_count": 1, "speed_sum_kmh": 100}, {"speed_count": 9, "speed_sum_kmh": 90}]
    ) == 19
