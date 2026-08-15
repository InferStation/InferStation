from __future__ import annotations

import base64
import hashlib
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    app_name: str = "LLM Eval Hub"
    app_env: str = "development"
    log_level: str = "INFO"
    database_url: str = "postgresql+psycopg://evalhub:evalhub@localhost:5432/evalhub"
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"
    artifact_root: Path = Path("artifacts")
    admin_api_key: str = "inferstation-local-dev-key"
    secret_encryption_key: str = ""
    allowed_endpoint_hosts: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["mock-openai", "host.docker.internal"]
    )
    allowed_endpoint_cidrs: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
    )
    allow_insecure_http: bool = True
    allow_public_https_endpoints: bool = False
    default_concurrency: int = 8
    global_max_concurrency: int = 32
    default_qps: float = 10.0
    web_origin: str = "http://localhost:18080"

    @field_validator("allowed_endpoint_hosts", "allowed_endpoint_cidrs", mode="before")
    @classmethod
    def split_csv(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def fernet_key(self) -> bytes:
        if self.secret_encryption_key:
            return self.secret_encryption_key.encode("ascii")
        if self.app_env not in {"development", "test"}:
            raise RuntimeError("SECRET_ENCRYPTION_KEY is required outside development")
        digest = hashlib.sha256(self.admin_api_key.encode("utf-8")).digest()
        return base64.urlsafe_b64encode(digest)


@lru_cache
def get_settings() -> Settings:
    return Settings()
