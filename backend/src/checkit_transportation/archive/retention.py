"""Retention reporting with deletion deliberately blocked pending dependency audit."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from psycopg import Connection
from checkit_transportation.storage.postgres import passage_schema_version


DEFAULT_RETENTION_DAYS = 7
CONFIRMATION_TEXT = "I-UNDERSTAND-THIS-DELETES-DATA"


class RetentionSafetyError(RuntimeError):
    """Raised before any destructive SQL could run."""


@dataclass(frozen=True, slots=True)
class RetentionReport:
    cutoff: datetime
    eligible_count: int
    verified_coverage_count: int
    unarchived_count: int
    would_delete_count: int
    dry_run: bool = True


def retention_cutoff(*, now: datetime | None = None, retention_days: int = DEFAULT_RETENTION_DAYS) -> datetime:
    if retention_days < 1:
        raise ValueError("retention_days must be positive")
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    return current - timedelta(days=retention_days)


def build_retention_report(
    connection: Connection[Any], *, now: datetime | None = None, retention_days: int = DEFAULT_RETENTION_DAYS
) -> RetentionReport:
    """Report passage-level verified coverage using only SELECT statements."""

    cutoff = retention_cutoff(now=now, retention_days=retention_days)
    version = passage_schema_version(connection)
    timestamp = "observed_at" if version == 2 else "ended_at"
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            select count(*) as eligible_count,
                   count(*) filter (where exists (
                     select 1 from public.historical_archives a
                     where a.dataset = 'traffic_passages'
                       and a.sensor_id = p.sensor_id
                       and a.status = 'verified'
                       and a.schema_version = {version}
                       and a.verified_at is not null
                       and a.started_at <= p.{timestamp}
                       and a.ended_at >= p.{timestamp}
                       and a.row_count > 0
                       and length(a.sha256_hex) = 64
                   )) as verified_coverage_count
            from public.traffic_passages p
            where p.{timestamp} < %s
            """,
            (cutoff,),
        )
        row = cursor.fetchone()
    eligible = int(row["eligible_count"])
    covered = int(row["verified_coverage_count"])
    return RetentionReport(
        cutoff=cutoff,
        eligible_count=eligible,
        verified_coverage_count=covered,
        unarchived_count=eligible - covered,
        would_delete_count=covered,
    )


def list_candidate_days(
    connection: Connection[Any], *, cutoff: datetime
) -> list[dict[str, Any]]:
    timestamp = "observed_at" if passage_schema_version(connection) == 2 else "ended_at"
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            select sensor_id, ({timestamp} AT TIME ZONE 'UTC')::date as day, count(*) as passage_count,
                   min({timestamp}) as min_ended_at, max({timestamp}) as max_ended_at
            from public.traffic_passages
            where {timestamp} < %s
            group by sensor_id, ({timestamp} AT TIME ZONE 'UTC')::date
            order by day, sensor_id
            """,
            (cutoff,),
        )
        return list(cursor.fetchall())


def list_candidate_rows(
    connection: Connection[Any], *, cutoff: datetime, limit: int = 1000
) -> list[dict[str, Any]]:
    """List bounded candidate identities for audit; this never deletes them."""

    if limit < 1:
        raise ValueError("limit must be positive")
    timestamp = "observed_at" if passage_schema_version(connection) == 2 else "ended_at"
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            select sensor_id, boot_id, track_id, {timestamp} as observed_at
            from public.traffic_passages
            where {timestamp} < %s
            order by {timestamp}, sensor_id, boot_id, track_id
            limit %s
            """,
            (cutoff, limit),
        )
        return list(cursor.fetchall())


def validate_delete_authorization(*, execute_delete: bool, confirmation: str | None) -> None:
    if not execute_delete or confirmation != CONFIRMATION_TEXT:
        raise RetentionSafetyError(
            "Deletion requires both --execute-delete and "
            f"--i-understand-this-deletes-data {CONFIRMATION_TEXT}"
        )


def execute_retention(
    connection: Connection[Any],
    *,
    execute_delete: bool = False,
    confirmation: str | None = None,
) -> None:
    """Refuse deletion because authoritative FK/view definitions are unavailable.

    Even with both safety flags, this release cannot prove that known
    ``reference_measurements`` and view dependencies are safe. There is
    intentionally no DELETE statement in this code path.
    """

    validate_delete_authorization(execute_delete=execute_delete, confirmation=confirmation)
    raise RetentionSafetyError(
        "Deletion is blocked: restore and inspect the authoritative production migration history, "
        "then explicitly implement and review dependency-safe deletion. No DELETE SQL ran."
    )
