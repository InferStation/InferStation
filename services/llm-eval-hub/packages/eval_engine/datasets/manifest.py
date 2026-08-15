from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Literal

import yaml
from jsonschema import Draft202012Validator
from pydantic import BaseModel, ConfigDict, Field, model_validator

from packages.eval_engine.contracts import EvalSample


class DatasetValidationError(ValueError):
    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("; ".join(errors))


class MetadataSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    display_name: str
    version: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
    description: str = ""
    language: list[str] = Field(default_factory=list)
    license: str
    owner: str
    tags: list[str] = Field(default_factory=list)


class DataSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format: Literal["jsonl"]
    path: str
    split: str = "test"
    checksum_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    id_field: str
    input_fields: list[str]
    reference_field: str
    metadata_fields: list[str] = Field(default_factory=list)


class RequestSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["chat_completions", "completions"]
    messages: list[dict[str, str]] | None = None
    prompt: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    stop: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_mode_payload(self) -> RequestSpec:
        if self.mode == "chat_completions" and not self.messages:
            raise ValueError("chat_completions requires non-empty messages")
        if self.mode == "completions" and not self.prompt:
            raise ValueError("completions requires a prompt")
        return self


class ProtocolSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    task_type: str
    prediction_source: str
    few_shot: dict[str, Any] = Field(default_factory=dict)
    parser: dict[str, Any]
    scorer: dict[str, Any]
    denominator_policy: Literal["all_scoring_samples", "valid_responses_only"] = (
        "all_scoring_samples"
    )
    on_api_error: Literal["exclude_and_report", "count_as_incorrect"] = "exclude_and_report"
    on_parse_error: Literal["exclude_and_report", "count_as_incorrect"] = "count_as_incorrect"


class ValidationSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    required_fields: list[str]
    unique_by: list[str] = Field(default_factory=list)
    allowed_values: dict[str, list[Any]] = Field(default_factory=dict)


class DatasetManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    api_version: Literal["eval-dataset/v1"]
    kind: Literal["Dataset"]
    metadata: MetadataSpec
    data: DataSpec
    request: RequestSpec
    protocol: ProtocolSpec
    groups: list[dict[str, str]] = Field(default_factory=list)
    validation: ValidationSpec


class ValidatedDataset(BaseModel):
    manifest: DatasetManifest
    samples: list[EvalSample]
    checksum_sha256: str
    data_path: Path

    model_config = ConfigDict(arbitrary_types_allowed=True)


def _schema_path() -> Path:
    return Path(__file__).parents[3] / "datasets" / "schemas" / "eval-dataset-v1.schema.json"


def _load_jsonl(path: Path) -> tuple[list[dict[str, Any]], list[str]]:
    rows: list[dict[str, Any]] = []
    errors: list[str] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                errors.append(f"line {line_no}: invalid JSON ({exc.msg})")
                continue
            if not isinstance(row, dict):
                errors.append(f"line {line_no}: each JSONL row must be an object")
                continue
            rows.append(row)
    return rows, errors


def validate_dataset(
    manifest_path: str | Path,
    data_path_override: str | Path | None = None,
) -> ValidatedDataset:
    manifest_path = Path(manifest_path).resolve()
    raw = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
    schema = json.loads(_schema_path().read_text(encoding="utf-8"))
    schema_errors = sorted(
        Draft202012Validator(schema).iter_errors(raw),
        key=lambda error: list(error.path),
    )
    if schema_errors:
        raise DatasetValidationError(
            [
                f"manifest {'.'.join(map(str, error.path)) or '<root>'}: {error.message}"
                for error in schema_errors
            ]
        )

    manifest = DatasetManifest.model_validate(raw)
    declared_data_path = (manifest_path.parent / manifest.data.path).resolve()
    if manifest_path.parent not in declared_data_path.parents:
        raise DatasetValidationError(["data.path must stay inside the manifest directory"])
    if data_path_override is None:
        data_path = declared_data_path
    else:
        data_path = Path(data_path_override).resolve()
    if not data_path.is_file():
        raise DatasetValidationError([f"data file does not exist: {data_path}"])

    payload = data_path.read_bytes()
    checksum = hashlib.sha256(payload).hexdigest()
    if checksum != manifest.data.checksum_sha256:
        raise DatasetValidationError(
            [f"checksum mismatch: expected {manifest.data.checksum_sha256}, got {checksum}"]
        )

    rows, errors = _load_jsonl(data_path)
    required = set(manifest.validation.required_fields)
    seen_ids: set[str] = set()
    samples: list[EvalSample] = []
    for index, row in enumerate(rows, start=1):
        missing = sorted(required - row.keys())
        if missing:
            errors.append(f"row {index}: missing required fields {missing}")
            continue
        sample_id = str(row[manifest.data.id_field])
        if sample_id in seen_ids:
            errors.append(f"row {index}: duplicate sample id {sample_id!r}")
            continue
        seen_ids.add(sample_id)
        for field, allowed in manifest.validation.allowed_values.items():
            if field in row and row[field] not in allowed:
                errors.append(f"row {index}: {field}={row[field]!r} is not in allowed values")
        samples.append(
            EvalSample(
                sample_id=sample_id,
                inputs={field: row[field] for field in manifest.data.input_fields},
                reference=row[manifest.data.reference_field],
                metadata={field: row.get(field) for field in manifest.data.metadata_fields},
            )
        )
    if errors:
        raise DatasetValidationError(errors)
    if not samples:
        raise DatasetValidationError(["dataset contains no samples"])
    return ValidatedDataset(
        manifest=manifest,
        samples=samples,
        checksum_sha256=checksum,
        data_path=data_path,
    )
