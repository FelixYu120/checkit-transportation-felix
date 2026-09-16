"""Private Cloudflare R2 access through the S3-compatible API."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import quote

import boto3
from botocore.exceptions import ClientError

from checkit_transportation.config import Settings


def create_client(settings: Settings) -> Any:
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        region_name="auto",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
    )


def test_bucket_access(client: Any, bucket: str) -> dict[str, Any]:
    return client.head_bucket(Bucket=bucket)


def upload_file(client: Any, bucket: str, source: str | Path, object_key: str) -> None:
    client.upload_file(str(source), bucket, object_key)


def head_object(client: Any, bucket: str, object_key: str) -> dict[str, Any]:
    return client.head_object(Bucket=bucket, Key=object_key)


def download_object(client: Any, bucket: str, object_key: str, destination: str | Path) -> Path:
    path = Path(destination)
    path.parent.mkdir(parents=True, exist_ok=True)
    client.download_file(bucket, object_key, str(path))
    return path


def object_exists(client: Any, bucket: str, object_key: str) -> bool:
    try:
        head_object(client, bucket, object_key)
        return True
    except ClientError as exc:
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if status == 404 or code in {"404", "NoSuchKey", "NotFound"}:
            return False
        raise


def traffic_passages_object_key(sensor_id: str, day: date, *, part: int = 1) -> str:
    """Construct the mandated Hive-style schema-v1 object key.

    Sensor IDs are URL-escaped to prevent slash-based prefix injection. Existing
    alphanumeric/underscore IDs, including GILMAN2_15D9B4DC, remain unchanged.
    """

    if part < 1:
        raise ValueError("part must be at least 1")
    safe_sensor = quote(sensor_id, safe="-_.~")
    return (
        "derived/traffic_passages/schema=v1/"
        f"sensor={safe_sensor}/year={day:%Y}/month={day:%m}/day={day:%d}/"
        f"part-{part:06d}.parquet"
    )
