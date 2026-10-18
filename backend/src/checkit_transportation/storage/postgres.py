"""Parameterized PostgreSQL access for operational data.

Archive extraction methods in this module execute SELECT statements only. Daily
aggregate upserts are isolated in ``aggregation.daily``. Retention deletion is
intentionally not implemented until production dependencies can be proven safe.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime
from typing import Any, Iterator, Mapping, Sequence

import psycopg
from psycopg import Connection, sql
from psycopg.rows import dict_row
from checkit_transportation.storage.parquet import schema_for_version


TABLES_FOR_INVENTORY = (
    "sensors",
    "sensor_health",
    "traffic_passages",
    "ten_minute_summaries",
    "traffic_daily",
    "historical_archives",
    "reference_measurements",
)


@contextmanager
def connect(database_url: str, *, autocommit: bool = False) -> Iterator[Connection[Any]]:
    """Open and reliably close a psycopg connection."""

    with psycopg.connect(database_url, autocommit=autocommit, row_factory=dict_row) as connection:
        yield connection


def test_connection(connection: Connection[Any]) -> bool:
    """Perform a read-only connectivity check."""

    with connection.cursor() as cursor:
        cursor.execute("select 1 as ok")
        row = cursor.fetchone()
    return bool(row and row["ok"] == 1)


def passage_schema_version(connection: Connection[Any]) -> int:
    """Transition and final schemas export accepted rows as v2; legacy is v1."""
    with connection.cursor() as cursor:
        cursor.execute("select column_name from information_schema.columns "
                       "where table_schema = 'public' and table_name = 'traffic_passages'")
        names = {row["column_name"] for row in cursor}
    if {"observed_at", "speed_kmh"} <= names:
        return 2
    if {"ended_at", "median_speed_kmh", "quality_status"} <= names:
        return 1
    raise ValueError("Unrecognized traffic_passages schema")


def _passage_selection(connection: Connection[Any], version: int | None = None):
    current = passage_schema_version(connection)
    version = current if version is None else version
    columns = schema_for_version(version).names
    with connection.cursor() as cursor:
        cursor.execute("select column_name from information_schema.columns "
                       "where table_schema = 'public' and table_name = 'traffic_passages'")
        names = {row["column_name"] for row in cursor}
    if not set(columns) <= names:
        raise ValueError(f"Database no longer has schema-v{version} fields; verify historical archives using their saved checksum/manifest")
    # A transition database contains both new compact rows and old calibration
    # rows. Never erase quality distinctions by exporting reviews into v2.
    quality = (" and quality_status = 'accepted'" if version == 2 else " and quality_status is not null and median_speed_kmh is not null") if "quality_status" in names else ""
    timestamp = "observed_at" if version == 2 else "ended_at"
    return columns, timestamp, quality


def count_traffic_passages(connection: Connection[Any], sensor_id: str | None = None, day: date | None = None) -> int:
    _, timestamp, quality = _passage_selection(connection)
    query = "select count(*) as row_count from public.traffic_passages where true" + quality
    params: list[Any] = []
    if sensor_id is not None:
        query += " and sensor_id = %s"
        params.append(sensor_id)
    if day is not None:
        query += f" and {timestamp} >= %s and {timestamp} < %s"
        params.extend(_day_bounds(day))
    with connection.cursor() as cursor:
        cursor.execute(query, params)
        return int(cursor.fetchone()["row_count"])


def _day_bounds(day: date):
    from datetime import time, timedelta, timezone
    start = datetime.combine(day, time.min, tzinfo=timezone.utc)
    return start, start + timedelta(days=1)


def fetch_traffic_passages_for_day(connection: Connection[Any], sensor_id: str, day: date, *, schema_version: int | None = None) -> list[dict[str, Any]]:
    columns, timestamp, quality = _passage_selection(connection, schema_version)
    query = sql.SQL("select {} from public.traffic_passages where sensor_id = %s "
                    "and {} >= %s and {} < %s" + quality + " order by {}, boot_id, track_id").format(
        sql.SQL(", ").join(map(sql.Identifier, columns)),
        sql.Identifier(timestamp), sql.Identifier(timestamp), sql.Identifier(timestamp))
    with connection.cursor() as cursor:
        cursor.execute(query, (sensor_id, *_day_bounds(day)))
        return list(cursor.fetchall())


def fetch_passage_keys(connection: Connection[Any], sensor_id: str, day: date) -> list[tuple[str, int, int]]:
    return [(row["sensor_id"], row["boot_id"], row["track_id"])
            for row in fetch_traffic_passages_for_day(connection, sensor_id, day)]


def fetch_passage_metadata(connection: Connection[Any], sensor_id: str, day: date) -> dict[str, Any]:
    rows = fetch_traffic_passages_for_day(connection, sensor_id, day)
    minimum, maximum = obtain_min_max_timestamps(rows)
    return {"row_count": len(rows), "min_timestamp": minimum, "max_timestamp": maximum}


def obtain_min_max_timestamps(rows: Sequence[Mapping[str, Any]]) -> tuple[datetime | None, datetime | None]:
    timestamps = [row.get("observed_at", row.get("ended_at")) for row in rows]
    timestamps = [value for value in timestamps if value is not None]
    return (min(timestamps), max(timestamps)) if timestamps else (None, None)


def table_inventory(connection: Connection[Any]) -> list[dict[str, Any]]:
    """Return exact counts and total relation sizes for known tables that exist."""

    inventory: list[dict[str, Any]] = []
    with connection.cursor() as cursor:
        for name in TABLES_FOR_INVENTORY:
            cursor.execute("select to_regclass(%s) as relation", (f"public.{name}",))
            if cursor.fetchone()["relation"] is None:
                inventory.append({"table": name, "exists": False})
                continue
            identifier = sql.Identifier("public", name)
            cursor.execute(sql.SQL("select count(*) as row_count from {}").format(identifier))
            row_count = int(cursor.fetchone()["row_count"])
            cursor.execute("select pg_total_relation_size(%s::regclass) as byte_count", (f"public.{name}",))
            inventory.append(
                {
                    "table": name,
                    "exists": True,
                    "row_count": row_count,
                    "byte_count": int(cursor.fetchone()["byte_count"]),
                }
            )
    return inventory


def traffic_passages_dependencies(connection: Connection[Any]) -> dict[str, list[dict[str, Any]]]:
    """Inspect incoming FKs and views that directly depend on traffic_passages."""

    with connection.cursor() as cursor:
        cursor.execute(
            """
            select conrelid::regclass::text as dependent_table,
                   conname as constraint_name,
                   pg_get_constraintdef(oid) as definition
            from pg_constraint
            where contype = 'f'
              and confrelid = 'public.traffic_passages'::regclass
            order by conrelid::regclass::text, conname
            """
        )
        foreign_keys = list(cursor.fetchall())
        cursor.execute(
            """
            select distinct n.nspname as view_schema, c.relname as view_name
            from pg_depend d
            join pg_rewrite r on r.oid = d.objid
            join pg_class c on c.oid = r.ev_class
            join pg_namespace n on n.oid = c.relnamespace
            where d.refobjid = 'public.traffic_passages'::regclass
              and c.relkind in ('v', 'm')
            order by n.nspname, c.relname
            """
        )
        views = list(cursor.fetchall())
    return {"foreign_keys": foreign_keys, "views": views}
