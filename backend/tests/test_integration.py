from __future__ import annotations

import os

import pytest

from checkit_transportation.config import Settings
from checkit_transportation.storage.postgres import connect, test_connection as check_database_connection
from checkit_transportation.storage.r2 import create_client, test_bucket_access as check_bucket_access


REQUIRED = (
    "DATABASE_URL", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"
)

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not all(os.getenv(name) for name in REQUIRED),
        reason="live Supabase/R2 environment variables are not all set",
    ),
]


def test_live_read_only_connections() -> None:
    settings = Settings.from_env(env_file=None)
    with connect(settings.database_url) as connection:
        assert check_database_connection(connection)
    check_bucket_access(create_client(settings), settings.r2_bucket)
