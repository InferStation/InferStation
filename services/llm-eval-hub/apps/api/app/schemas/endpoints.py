from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class EndpointCreate(BaseModel):
    name: str = Field(min_length=2, max_length=128)
    base_url: str = Field(min_length=8, max_length=2048)
    model_name: str | None = Field(default=None, min_length=1, max_length=512)
    auth_type: Literal["bearer", "api-key-header", "none"] = "bearer"
    api_key: str | None = Field(default=None, max_length=8192)
    extra_headers: dict[str, str] = Field(default_factory=dict)
    concurrency_limit: int = Field(default=8, ge=1, le=256)
    qps_limit: float = Field(default=10, gt=0, le=1000)


class EndpointUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=128)
    base_url: str | None = Field(default=None, min_length=8, max_length=2048)
    auth_type: Literal["bearer", "api-key-header", "none"] | None = None
    api_key: str | None = Field(default=None, max_length=8192)
    extra_headers: dict[str, str] | None = None
    concurrency_limit: int | None = Field(default=None, ge=1, le=256)
    qps_limit: float | None = Field(default=None, gt=0, le=1000)


class EndpointRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    base_url: str
    auth_type: str
    status: str
    owner: str
    active_revision_id: str | None
    api_key_configured: bool = False
    secret_hint: str | None = None
    concurrency_limit: int
    qps_limit: float
    capability: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime


class EndpointModelCreate(BaseModel):
    model_name: str = Field(min_length=1, max_length=512)
    display_name: str | None = Field(default=None, max_length=512)


class EndpointModelRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    endpoint_id: str
    model_name: str
    display_name: str
    enabled: bool
    source: str


class ProbeRequest(BaseModel):
    model_id: str | None = None
    timeout_seconds: float = Field(default=60, ge=1, le=300)


class ProbeResponse(BaseModel):
    status: str
    models: list[str]
    capabilities: dict[str, Any]
    latency_ms: float | None = None
    error_type: str | None = None
    error_message: str | None = None
