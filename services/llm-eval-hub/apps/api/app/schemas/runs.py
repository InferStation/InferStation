from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class RunDatasetInput(BaseModel):
    dataset_version_id: str
    protocol_id: str | None = None


class InferenceConfig(BaseModel):
    temperature: float = Field(default=0, ge=0, le=2)
    top_p: float = Field(default=1, gt=0, le=1)
    max_tokens: int = Field(default=32, ge=1, le=32768)
    seed: int | None = 42
    stop: list[str] = Field(default_factory=list, max_length=16)


class ExecutionConfig(BaseModel):
    concurrency: int = Field(default=8, ge=1, le=256)
    qps: float = Field(default=10, gt=0, le=1000)
    timeout_seconds: float = Field(default=60, gt=0, le=3600)
    max_retries: int = Field(default=2, ge=0, le=10)
    shard_size: int = Field(default=50, ge=20, le=100)


class RunCreate(BaseModel):
    name: str = Field(min_length=1, max_length=256)
    endpoint_id: str
    model_id: str
    datasets: list[RunDatasetInput] = Field(min_length=1, max_length=32)
    inference: InferenceConfig = Field(default_factory=InferenceConfig)
    execution: ExecutionConfig = Field(default_factory=ExecutionConfig)
    baseline_run_id: str | None = None


class RunValidationResponse(BaseModel):
    valid: bool
    sample_count: int
    effective_concurrency: int
    warnings: list[str]
    dataset_protocols: list[dict[str, Any]]


class RunDatasetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    dataset_version_id: str
    protocol_id: str
    status: str
    total_samples: int
    completed_samples: int
    counters_json: dict[str, Any]


class RunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    status: str
    created_by: str
    model_id: str
    endpoint_revision_id: str
    protocol_fingerprint: str
    baseline_run_id: str | None
    cancel_requested: bool
    run_spec_json: dict[str, Any]
    started_at: datetime | None
    completed_at: datetime | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    datasets: list[RunDatasetRead]


class SampleExecutionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    run_dataset_id: str
    sample_id: str
    inputs_json: dict[str, Any]
    reference_json: Any
    metadata_json: dict[str, Any]
    rendered_request_json: dict[str, Any] | None
    raw_response_json: dict[str, Any] | None
    output_text: str | None
    parsed_value_json: Any | None
    parse_status: str | None
    status: str
    latency_ms: float | None
    prompt_tokens: int | None
    completion_tokens: int | None
    error_type: str | None
    error_message_redacted: str | None
    primary_score: float | None = None
    passed: bool | None = None
    score_reason: str | None = None


class RunMetricsRead(BaseModel):
    run_id: str
    datasets: list[dict[str, Any]]


class ExportFormat(BaseModel):
    format: Literal["jsonl", "csv"] = "jsonl"
