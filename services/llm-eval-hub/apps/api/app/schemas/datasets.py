from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class DatasetCreate(BaseModel):
    name: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,62}$")
    display_name: str = Field(min_length=1, max_length=256)
    owner: str = Field(default="ai-platform", min_length=1, max_length=128)
    sensitivity: str = Field(default="internal", max_length=32)
    description: str = Field(default="", max_length=4000)


class DatasetVersionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    dataset_id: str
    version: str
    checksum: str
    row_count: int
    manifest_json: dict[str, Any]
    created_at: datetime


class DatasetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    display_name: str
    owner: str
    sensitivity: str
    description: str
    created_at: datetime
    updated_at: datetime
    versions: list[DatasetVersionRead] = Field(default_factory=list)


class DatasetValidationResponse(BaseModel):
    valid: bool
    dataset_name: str
    version: str
    checksum: str
    row_count: int
    sample_preview: list[dict[str, Any]]
