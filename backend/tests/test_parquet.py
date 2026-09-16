from __future__ import annotations

import json

from checkit_transportation.storage.parquet import (
    TRAFFIC_PASSAGE_COLUMNS,
    calculate_sha256,
    count_rows,
    deterministic_json,
    inspect_schema,
    read_archive,
    write_traffic_passages,
)


def test_deterministic_path_points_json() -> None:
    left = deterministic_json({"z": 1, "a": "✓"})
    right = deterministic_json({"a": "✓", "z": 1})
    assert left == right == '{"a":"✓","z":1}'


def test_parquet_round_trip_and_sha(tmp_path, passage_row) -> None:
    path = write_traffic_passages([passage_row], tmp_path / "day.parquet")
    assert count_rows(path) == 1
    assert set(inspect_schema(path).names) == set(TRAFFIC_PASSAGE_COLUMNS)
    archived = read_archive(path).to_pylist()[0]
    assert archived["sensor_id"] == passage_row["sensor_id"]
    assert archived["ended_at"] == passage_row["ended_at"]
    assert json.loads(archived["path_points"]) == passage_row["path_points"]
    digest = calculate_sha256(path)
    assert len(digest) == 64
    assert digest == calculate_sha256(path)


def test_writer_rejects_schema_drift(tmp_path, passage_row) -> None:
    row = dict(passage_row)
    row["unexpected"] = True
    try:
        write_traffic_passages([row], tmp_path / "bad.parquet")
    except ValueError as exc:
        assert "extra=['unexpected']" in str(exc)
    else:
        raise AssertionError("schema drift should fail")
