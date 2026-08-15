from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class EvalSample:
    sample_id: str
    inputs: Mapping[str, Any]
    reference: Any
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ModelRequest:
    request_id: str
    model: str
    mode: str
    messages: list[dict[str, Any]] | None
    prompt: str | None
    params: Mapping[str, Any]


@dataclass(frozen=True)
class AttemptTrace:
    attempt_no: int
    started_at: str
    duration_ms: float
    http_status: int | None
    error_type: str | None
    response_excerpt_redacted: str | None = None


@dataclass(frozen=True)
class InferenceResult:
    request_id: str
    raw_response: Mapping[str, Any] | None
    output_text: str | None
    latency_ms: float
    ttft_ms: float | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    error_type: str | None = None
    error_message_redacted: str | None = None
    http_status: int | None = None
    attempts: int = 1
    attempt_traces: tuple[AttemptTrace, ...] = ()


@dataclass(frozen=True)
class ParsedAnswer:
    value: Any
    status: str
    parser_version: str
    evidence: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SampleScore:
    primary: float | None
    metrics: Mapping[str, float]
    passed: bool | None
    reason: str | None
    scorer_version: str


@dataclass(frozen=True)
class EvaluationRecord:
    sample: EvalSample
    request: ModelRequest
    inference: InferenceResult
    answer: ParsedAnswer
    score: SampleScore


@dataclass(frozen=True)
class FrozenRunSpec:
    endpoint_revision_id: str
    model_id: str
    model_name: str
    endpoint_capabilities: Mapping[str, Any]
    dataset_version_id: str
    dataset_checksum: str
    protocol: Mapping[str, Any]
    request: Mapping[str, Any]
    execution: Mapping[str, Any]
    engine_version: str = "0.1.0"
    created_by: str = "local-admin"

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)
