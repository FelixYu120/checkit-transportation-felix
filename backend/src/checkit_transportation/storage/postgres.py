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


def count_traffic_passages(
    connection: Connection[Any], sensor_id: str | None = None, day: date | None = None
) -> int:
    query = "select count(*) as row_count from public.traffic_passages"
    params: list[Any] = []
    if sensor_id is not None and day is not None:
        query += (
            " where sensor_id = %s and ended_at >= %s::date"
            " and ended_at < (%s::date + interval '1 day')"
        )
        params.extend((sensor_id, day, day))
    elif sensor_id is not None:
        query += " where sensor_id = %s"
        params.append(sensor_id)
    elif day is not None:
        query += " where ended_at >= %s::date and ended_at < (%s::date + interval '1 day')"
        params.extend((day, day))
    with connection.cursor() as cursor:
        cursor.execute(query, params)
        row = cursor.fetchone()
    return int(row["row_count"])


def fetch_traffic_passages_for_day(
    connection: Connection[Any], sensor_id: str, day: date
) -> list[dict[str, Any]]:
    """Fetch one UTC database-calendar day using the required stable ordering."""

    with connection.cursor() as cursor:
        cursor.execute(
            """
            select *
            from public.traffic_passages
            where sensor_id = %s
              and ended_at >= %s::date
              and ended_at < (%s::date + interval '1 day')
            order by ended_at, boot_id, track_id
            """,
            (sensor_id, day, day),
        )
        return list(cursor.fetchall())


def fetch_passage_keys(
    connection: Connection[Any], sensor_id: str, day: date
) -> list[tuple[str, int, int]]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select sensor_id, boot_id, track_id
            from public.traffic_passages
            where sensor_id = %s
              and ended_at >= %s::date
              and ended_at < (%s::date + interval '1 day')
            order by ended_at, boot_id, track_id
            """,
            (sensor_id, day, day),
        )
        return [(row["sensor_id"], row["boot_id"], row["track_id"]) for row in cursor]


def fetch_passage_metadata(
    connection: Connection[Any], sensor_id: str, day: date
) -> dict[str, Any]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select count(*) as row_count,
                   min(ended_at) as min_timestamp,
                   max(ended_at) as max_timestamp
            from public.traffic_passages
            where sensor_id = %s
              and ended_at >= %s::date
              and ended_at < (%s::date + interval '1 day')
            """,
            (sensor_id, day, day),
        )
        return dict(cursor.fetchone())


def obtain_min_max_timestamps(rows: Sequence[Mapping[str, Any]]) -> tuple[datetime | None, datetime | None]:
    timestamps = [row["ended_at"] for row in rows if row.get("ended_at") is not None]
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
