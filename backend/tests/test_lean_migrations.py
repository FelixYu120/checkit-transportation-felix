"""Exercise both migrations on a disposable LOCAL database, never production.

CHECKIT_TEST_DATABASE_URL must point to a dedicated empty local database.
"""
import os
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
import pytest
from checkit_transportation.storage.postgres import fetch_traffic_passages_for_day, passage_schema_version
from checkit_transportation.aggregation.daily import aggregate_daily, upsert_daily

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def db():
    url = os.getenv('CHECKIT_TEST_DATABASE_URL')
    if not url:
        pytest.skip('Set CHECKIT_TEST_DATABASE_URL to a disposable local PostgreSQL database')
    if urlparse(url).hostname not in ('localhost', '127.0.0.1'):
        pytest.fail('Migration tests only accept localhost')
    with psycopg.connect(url, autocommit=True, row_factory=dict_row) as c:
        # Dedicated test database: recreate the four fixture tables per test.
        c.execute('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
        c.execute((Path(__file__).parent/'fixtures/legacy_telemetry.sql').read_text())
        c.execute("INSERT INTO public.sensors VALUES ('fixture','active')")
        yield c


def migrate(db, name):
    db.execute(next((ROOT/'supabase/migrations').glob('*_'+name+'.sql')).read_text())


def insert(db, table, row):
    from psycopg import sql
    db.execute(sql.SQL('INSERT INTO public.{} ({}) VALUES ({})').format(
        sql.Identifier(table), sql.SQL(',').join(map(sql.Identifier,row)),
        sql.SQL(',').join(sql.Placeholder() for _ in row)), list(row.values()))


def health(**extra):
    return dict(sensor_id='fixture', last_seen_at=datetime.now(timezone.utc),
                last_radar_frame_at=None, last_passage_at=None, health_status='online',
                boot_id=1, uptime_ms=10, radar_active=True, wifi_rssi_dbm=-50,
                pending_passages=0, storage_free_bytes=1000, last_http_status=200,
                firmware_version='3.1.0-lean', diagnostics=Jsonb({'storage_errors':9}), **extra)


def legacy(passage_row, **extra):
    return dict(passage_row, sensor_id='fixture', traffic_class='motor_vehicle', path_points=Jsonb([]), **extra)


def policy_snapshot(db):
    return db.execute("select tablename, policyname, qual from pg_policies where schemaname='public' order by tablename,policyname").fetchall()


def test_transition_and_finalization_contract(db, passage_row):
    before = policy_snapshot(db)
    insert(db, 'traffic_passages', legacy(passage_row))
    assert passage_schema_version(db) == 1
    assert len(fetch_traffic_passages_for_day(db,'fixture',date(2026,8,24))) == 1
    migrate(db, 'prepare_lean_telemetry_transition')
    # Old firmware still inserts full accepted/review/rejected records.
    for track, quality in [(21,'accepted'),(22,'review'),(23,'rejected')]:
        row=legacy(passage_row);row.update(track_id=track,quality_status=quality)
        insert(db,'traffic_passages',row)
    compact=dict(sensor_id='fixture',boot_id=10,track_id=24,observed_at=passage_row['ended_at'],
                 direction='away',traffic_class='micromobility',speed_kmh=17,max_speed_kmh=20,
                 firmware_version='3.1.0-lean',received_at=None)
    insert(db,'traffic_passages',compact)
    received=db.execute('select received_at from traffic_passages where track_id=24').fetchone()['received_at']
    assert received is not None
    db.execute('update traffic_passages set received_at=null where track_id=24')
    assert db.execute('select received_at from traffic_passages where track_id=24').fetchone()['received_at']==received
    rows=fetch_traffic_passages_for_day(db,'fixture',date(2026,8,24))
    assert [r['track_id'] for r in rows]==[20,21,24]
    assert all(set(r)==set(compact) for r in rows)
    old=fetch_traffic_passages_for_day(db,'fixture',date(2026,8,24),schema_version=1)
    # Legacy v1 verification remains possible during transition, including reviews.
    assert {r['track_id'] for r in old}=={20,21,22,23}
    aggregate=aggregate_daily(rows,'fixture',date(2026,8,24))
    upsert_daily(db,aggregate)
    insert(db,'sensor_health',health(device_name='old-name',storage_errors=7))
    insert(db,'ten_minute_summaries',dict(sensor_id='fixture',time_bucket=passage_row['ended_at'],direction='away',volume=3))
    migrate(db,'finalize_lean_telemetry_schema')
    assert policy_snapshot(db)==before
    tables=db.execute("select relname,relrowsecurity,exists(select 1 from aclexplode(relacl) where grantee=0 and privilege_type='SELECT') as readable from pg_class where relnamespace='public'::regnamespace and relname in ('traffic_passages','sensor_health','traffic_daily','ten_minute_summaries')").fetchall()
    assert all(t['relrowsecurity'] and t['readable'] for t in tables)
    assert {r['track_id'] for r in db.execute('select * from traffic_passages')}=={20,21,24}
    diagnostics=db.execute('select diagnostics from sensor_health').fetchone()['diagnostics']
    assert diagnostics['device_name']=='old-name' and diagnostics['storage_errors']==9
    assert db.execute("select pg_get_constraintdef(oid) as def from pg_constraint where conrelid='ten_minute_summaries'::regclass and contype='p'").fetchone()['def']=='PRIMARY KEY (sensor_id, time_bucket, direction)'
    for table, expected in [('traffic_passages',set(compact)),('sensor_health',set(health())|{'updated_at'}),('ten_minute_summaries',{'sensor_id','time_bucket','direction','volume','avg_speed','v85_speed','max_speed'}),('traffic_daily',{'sensor_id','day','volume','approach_volume','away_volume','motor_vehicle_volume','micromobility_volume','unknown_volume','speed_count','speed_sum_kmh','max_speed_kmh','speed_histogram','updated_at'})]:
        columns={r['column_name'] for r in db.execute("select column_name from information_schema.columns where table_schema='public' and table_name=%s",(table,))}
        assert columns==expected
    compact['track_id']=25
    insert(db,'traffic_passages',compact)
    assert db.execute('select received_at from traffic_passages where track_id=25').fetchone()['received_at'] is not None
    upsert_daily(db,aggregate)
    assert db.execute('select volume from traffic_daily').fetchone()['volume']==3
    with pytest.raises(ValueError,match='no longer has'):
        fetch_traffic_passages_for_day(db,'fixture',date(2026,8,24),schema_version=1)


@pytest.mark.parametrize('reason',['pending','old_firmware','stale','missing'])
def test_finalization_aborts_without_data_loss(db, passage_row, reason):
    insert(db,'traffic_passages',legacy(passage_row))
    migrate(db,'prepare_lean_telemetry_transition')
    h=health()
    if reason=='pending': h['pending_passages']=1
    if reason=='old_firmware': h['firmware_version']='3.0.0-connected'
    if reason=='stale': h['last_seen_at']=datetime(2020,1,1,tzinfo=timezone.utc)
    if reason!='missing': insert(db,'sensor_health',h)
    with pytest.raises(psycopg.errors.RaiseException,match='blocked'):
        migrate(db,'finalize_lean_telemetry_schema')
    db.execute('ROLLBACK')
    assert db.execute('select count(*) as n from traffic_passages').fetchone()['n']==1
    assert db.execute("select count(*) as n from information_schema.columns where table_name='traffic_passages' and column_name='quality_status'").fetchone()['n']==1
