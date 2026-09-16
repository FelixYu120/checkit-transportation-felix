from __future__ import annotations

from datetime import datetime, timezone

import pytest


@pytest.fixture
def passage_row() -> dict[str, object]:
    timestamp = datetime(2026, 8, 24, 12, 34, 56, 123456, tzinfo=timezone.utc)
    return {
        "sensor_id": "GILMAN2_15D9B4DC",
        "boot_id": 10,
        "track_id": 20,
        "started_at": timestamp,
        "ended_at": timestamp,
        "direction": "approach",
        "traffic_class": "car",
        "class_confidence": 0.9,
        "quality_status": "accepted",
        "quality_score": 95,
        "association_confidence": 0.8,
        "direction_consistency": 0.7,
        "hit_count": 12,
        "duration_ms": 1000,
        "median_speed_kmh": 23,
        "p85_speed_kmh": 25,
        "max_speed_kmh": 27,
        "mean_snr": 11,
        "max_snr": 18,
        "peak_cluster_size": 3,
        "travel_distance_m": 4.25,
        "entry_distance_m": 5,
        "entry_angle_deg": -10,
        "exit_distance_m": 6,
        "exit_angle_deg": 12,
        "firmware_version": "v2-test",
        "model_version": "v1",
        "path_points": {"z": 2, "a": [1, "✓"]},
        "created_at": timestamp,
        "received_at": timestamp,
        "human_label": None,
        "label_confidence": None,
        "label_notes": None,
        "labeled_at": None,
    }
