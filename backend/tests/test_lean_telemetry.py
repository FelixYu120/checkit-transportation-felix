from datetime import date
import shutil
import pytest
from checkit_transportation.storage.parquet import (
    LEAN_PASSAGE_COLUMNS, archive_schema_version, write_traffic_passages,
    read_archive, assert_required_columns,
)
from checkit_transportation.archive.verifier import verify_archive, ArchiveVerificationError
from checkit_transportation.archive import exporter
from checkit_transportation.storage.r2 import traffic_passages_object_key
from checkit_transportation.aggregation.daily import aggregate_daily


@pytest.fixture
def lean_row(passage_row):
    row = {key: passage_row[key] for key in LEAN_PASSAGE_COLUMNS if key in passage_row}
    return {**row, 'observed_at': passage_row['ended_at'], 'speed_kmh': passage_row['median_speed_kmh']}


@pytest.mark.parametrize('version', [1, 2])
def test_versions_roundtrip_verify_all_fields(tmp_path, passage_row, lean_row, version):
    row = passage_row if version == 1 else lean_row
    rows = [dict(row, track_id=i) for i in range(12)]
    local = write_traffic_passages(rows, tmp_path / 'schema=v2' / 'source.parquet')
    downloaded = tmp_path / 'downloaded.parquet'
    shutil.copyfile(local, downloaded)
    assert archive_schema_version(local) == version
    assert_required_columns(local)
    assert len(read_archive(local).to_pylist()) == 12
    assert verify_archive(rows, local, downloaded).verification_result
    # Change a field outside the old default sample of ten; must still fail.
    rows[-1]['max_speed_kmh'] += 1
    with pytest.raises(ArchiveVerificationError, match='max_speed_kmh'):
        verify_archive(rows, local, downloaded, sample_size=1)
    downloaded.write_bytes(b'corrupted download')
    with pytest.raises(ArchiveVerificationError):
        verify_archive(rows, local, downloaded)


def test_lean_schema_exact_and_time_range(tmp_path, lean_row):
    path = write_traffic_passages([lean_row], tmp_path / 'lean.parquet')
    assert set(read_archive(path).column_names) == set(LEAN_PASSAGE_COLUMNS)
    changed = dict(lean_row, observed_at=lean_row['observed_at'].replace(hour=13))
    with pytest.raises(ArchiveVerificationError, match='timestamp ranges'):
        verify_archive([changed], path, path)
    with pytest.raises(ValueError, match='extra='):
        write_traffic_passages([dict(lean_row, quality_status='rejected')], tmp_path / 'bad.parquet')


def test_mixed_daily_rows_exclude_review_and_rejected(passage_row, lean_row):
    rows = [passage_row, dict(lean_row, track_id=21),
            dict(passage_row, track_id=22, quality_status='review', speed_kmh=100),
            dict(passage_row, track_id=23, quality_status='rejected', speed_kmh=120),
            dict(passage_row, track_id=24, quality_status=None)]
    result = aggregate_daily(rows, passage_row['sensor_id'], date(2026, 8, 24))
    assert result.volume == result.speed_count == 2
    assert result.speed_sum_kmh == 46
    assert sum(result.speed_histogram) == 2
    assert result.max_speed_kmh == 23


@pytest.mark.parametrize('version', [1, 2])
def test_export_upload_download_and_immutable_v1(tmp_path, monkeypatch, passage_row, lean_row, version):
    row = passage_row if version == 1 else lean_row
    monkeypatch.setattr(exporter, 'fetch_traffic_passages_for_day', lambda *args: [row])
    objects = {}
    monkeypatch.setattr(exporter, 'object_exists', lambda c,b,k: k in objects)
    monkeypatch.setattr(exporter, 'upload_file', lambda c,b,p,k,**kwargs: objects.__setitem__(k, p.read_bytes()))
    monkeypatch.setattr(exporter, 'head_object', lambda c,b,k: {'ContentLength': len(objects[k])})
    monkeypatch.setattr(exporter, 'download_object', lambda c,b,k,p: p.write_bytes(objects[k]))
    result = exporter.archive_day(None, None, 'test', row['sensor_id'], date(2026,8,24), output_root=tmp_path)
    assert f'schema=v{version}/' in result.object_key
    assert result.uploaded and result.verification_result
    assert result.object_key == traffic_passages_object_key(row['sensor_id'], date(2026,8,24), schema_version=version)
    original = objects.copy()
    again = exporter.archive_day(None, None, 'test', row['sensor_id'], date(2026,8,24), output_root=tmp_path)
    assert not again.uploaded
    if version == 1:
        with pytest.raises(ValueError, match='immutable'):
            exporter.archive_day(None, None, 'test', row['sensor_id'], date(2026,8,24), output_root=tmp_path, overwrite=True)
        assert objects == original


def test_r2_conditional_write_prevents_overwrite(tmp_path):
    from checkit_transportation.storage.r2 import upload_file
    class Client:
        def __init__(self): self.calls=[]
        def put_object(self, **kwargs):
            self.calls.append({**kwargs,'Body':kwargs['Body'].read()})
    client=Client(); path=tmp_path/'data';path.write_bytes(b'archive')
    upload_file(client,'test',path,'derived/traffic_passages/schema=v1/test.parquet')
    assert client.calls[0]['IfNoneMatch']=='*'
    with pytest.raises(ValueError,match='immutable'):
        upload_file(client,'test',path,'derived/traffic_passages/schema=v1/test.parquet',overwrite=True)
    assert len(client.calls)==1


def test_ten_minute_helper_accepts_lean_rows_without_counting_legacy_review(passage_row, lean_row):
    from checkit_transportation.aggregation.ten_minute import aggregate_ten_minute
    results=aggregate_ten_minute([passage_row,lean_row,dict(passage_row,quality_status='review')])
    assert len(results)==1 and results[0]['volume']==2 and results[0]['avg_speed']==23
