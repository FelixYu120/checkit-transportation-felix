from __future__ import annotations

from datetime import date

import pytest

from checkit_transportation.archive.retention import (
    CONFIRMATION_TEXT,
    RetentionSafetyError,
    execute_retention,
    validate_delete_authorization,
)
from checkit_transportation.archive.verifier import ArchiveVerificationError, verify_archive
from checkit_transportation.storage.parquet import write_traffic_passages
from checkit_transportation.storage.r2 import traffic_passages_object_key


def test_exact_r2_key() -> None:
    assert traffic_passages_object_key("GILMAN2_15D9B4DC", date(2026, 8, 24)) == (
        "derived/traffic_passages/schema=v1/sensor=GILMAN2_15D9B4DC/"
        "year=2026/month=08/day=24/part-000001.parquet"
    )


def test_archive_verification_success_and_mismatch(tmp_path, passage_row) -> None:
    local = write_traffic_passages([passage_row], tmp_path / "local.parquet")
    downloaded = tmp_path / "downloaded.parquet"
    downloaded.write_bytes(local.read_bytes())
    report = verify_archive([passage_row], local, downloaded, sample_size=1)
    assert report.verification_result is True

    changed = dict(passage_row, track_id=999)
    with pytest.raises(ArchiveVerificationError, match="identity keys"):
        verify_archive([changed], local, downloaded)


@pytest.mark.parametrize(
    ("execute_delete", "confirmation"),
    [(False, None), (True, None), (False, CONFIRMATION_TEXT), (True, "wrong")],
)
def test_retention_requires_both_flags(execute_delete, confirmation) -> None:
    with pytest.raises(RetentionSafetyError):
        validate_delete_authorization(execute_delete=execute_delete, confirmation=confirmation)


def test_retention_still_refuses_after_both_flags() -> None:
    with pytest.raises(RetentionSafetyError, match="Deletion is blocked"):
        execute_retention(None, execute_delete=True, confirmation=CONFIRMATION_TEXT)
