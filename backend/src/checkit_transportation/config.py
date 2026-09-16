"""Environment-backed configuration without secret-value logging."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from dotenv import load_dotenv


class ConfigurationError(ValueError):
    """Raised when required configuration is absent."""


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str = ""
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = "checkit-transportation"

    @property
    def r2_endpoint_url(self) -> str:
        if not self.r2_account_id:
            raise ConfigurationError("R2_ACCOUNT_ID is required to build the R2 endpoint")
        return f"https://{self.r2_account_id}.r2.cloudflarestorage.com"

    @classmethod
    def from_env(
        cls,
        *,
        env_file: str | Path | None = ".env",
        require_database: bool = True,
        require_r2: bool = True,
    ) -> "Settings":
        if env_file is not None:
            load_dotenv(Path(env_file), override=False)
        settings = cls(
            database_url=os.getenv("DATABASE_URL", "").strip(),
            r2_account_id=os.getenv("R2_ACCOUNT_ID", "").strip(),
            r2_access_key_id=os.getenv("R2_ACCESS_KEY_ID", "").strip(),
            r2_secret_access_key=os.getenv("R2_SECRET_ACCESS_KEY", "").strip(),
            r2_bucket=os.getenv("R2_BUCKET", "checkit-transportation").strip(),
        )
        required: list[tuple[str, str]] = []
        if require_database:
            required.append(("DATABASE_URL", settings.database_url))
        if require_r2:
            required.extend(
                [
                    ("R2_ACCOUNT_ID", settings.r2_account_id),
                    ("R2_ACCESS_KEY_ID", settings.r2_access_key_id),
                    ("R2_SECRET_ACCESS_KEY", settings.r2_secret_access_key),
                    ("R2_BUCKET", settings.r2_bucket),
                ]
            )
        missing = [name for name, value in required if not value]
        if missing:
            raise ConfigurationError(f"Missing required environment variables: {', '.join(missing)}")
        return settings


def environment_presence(names: Iterable[str]) -> dict[str, bool]:
    """Return presence flags only; never expose environment values."""

    return {name: bool(os.getenv(name, "").strip()) for name in names}
