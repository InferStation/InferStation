from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def new_id() -> str:
    return str(uuid.uuid4())


def utc_now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSON, list[Any]: JSON}


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    username: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="viewer")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Endpoint(Base, TimestampMixin):
    __tablename__ = "endpoints"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    base_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    auth_type: Mapped[str] = mapped_column(String(32), nullable=False, default="bearer")
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="unverified", index=True
    )
    owner: Mapped[str] = mapped_column(String(128), nullable=False, default="local-admin")
    active_revision_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    revisions: Mapped[list[EndpointRevision]] = relationship(
        back_populates="endpoint",
        cascade="all, delete-orphan",
        foreign_keys="EndpointRevision.endpoint_id",
    )
    models: Mapped[list[Model]] = relationship(
        back_populates="endpoint", cascade="all, delete-orphan"
    )


class EndpointRevision(Base):
    __tablename__ = "endpoint_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    endpoint_id: Mapped[str] = mapped_column(
        ForeignKey("endpoints.id", ondelete="CASCADE"), index=True
    )
    config_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    config_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    secret_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    secret_hint: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    endpoint: Mapped[Endpoint] = relationship(
        back_populates="revisions", foreign_keys=[endpoint_id]
    )
    capabilities: Mapped[list[EndpointCapability]] = relationship(
        back_populates="revision", cascade="all, delete-orphan"
    )


class EndpointCapability(Base):
    __tablename__ = "endpoint_capabilities"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    revision_id: Mapped[str] = mapped_column(
        ForeignKey("endpoint_revisions.id", ondelete="CASCADE"), index=True
    )
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    capabilities_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    probe_status: Mapped[str] = mapped_column(String(32), nullable=False)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    error_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message_redacted: Mapped[str | None] = mapped_column(Text, nullable=True)

    revision: Mapped[EndpointRevision] = relationship(back_populates="capabilities")


class Model(Base, TimestampMixin):
    __tablename__ = "models"
    __table_args__ = (UniqueConstraint("endpoint_id", "model_name", name="uq_model_endpoint_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    endpoint_id: Mapped[str] = mapped_column(
        ForeignKey("endpoints.id", ondelete="CASCADE"), index=True
    )
    model_name: Mapped[str] = mapped_column(String(512), nullable=False)
    display_name: Mapped[str] = mapped_column(String(512), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    source: Mapped[str] = mapped_column(String(32), default="manual")

    endpoint: Mapped[Endpoint] = relationship(back_populates="models")


class Dataset(Base, TimestampMixin):
    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(256), nullable=False)
    owner: Mapped[str] = mapped_column(String(128), nullable=False)
    sensitivity: Mapped[str] = mapped_column(String(32), default="internal")
    description: Mapped[str] = mapped_column(Text, default="")

    versions: Mapped[list[DatasetVersion]] = relationship(
        back_populates="dataset", cascade="all, delete-orphan"
    )


class DatasetVersion(Base):
    __tablename__ = "dataset_versions"
    __table_args__ = (UniqueConstraint("dataset_id", "version", name="uq_dataset_version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    dataset_id: Mapped[str] = mapped_column(
        ForeignKey("datasets.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[str] = mapped_column(String(128), nullable=False)
    manifest_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    manifest_uri: Mapped[str] = mapped_column(Text, nullable=False)
    data_uri: Mapped[str] = mapped_column(Text, nullable=False)
    checksum: Mapped[str] = mapped_column(String(64), nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    dataset: Mapped[Dataset] = relationship(back_populates="versions")


class Protocol(Base):
    __tablename__ = "protocols"
    __table_args__ = (UniqueConstraint("name", "version", name="uq_protocol_name_version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    version: Mapped[str] = mapped_column(String(64), nullable=False)
    spec_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    spec_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Run(Base, TimestampMixin):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="QUEUED", index=True)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False)
    model_id: Mapped[str] = mapped_column(ForeignKey("models.id"), index=True)
    endpoint_revision_id: Mapped[str] = mapped_column(ForeignKey("endpoint_revisions.id"))
    run_spec_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    protocol_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    baseline_run_id: Mapped[str | None] = mapped_column(ForeignKey("runs.id"), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    datasets: Mapped[list[RunDataset]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )


class LiveRunHistoryEntry(Base):
    __tablename__ = "live_run_history"

    run_id: Mapped[str] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )


class RunDataset(Base):
    __tablename__ = "run_datasets"
    __table_args__ = (
        UniqueConstraint("run_id", "dataset_version_id", name="uq_run_dataset_version"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    dataset_version_id: Mapped[str] = mapped_column(ForeignKey("dataset_versions.id"), index=True)
    protocol_id: Mapped[str] = mapped_column(String(256), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="QUEUED")
    total_samples: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_samples: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    counters_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    run: Mapped[Run] = relationship(back_populates="datasets")
    executions: Mapped[list[SampleExecution]] = relationship(
        back_populates="run_dataset", cascade="all, delete-orphan"
    )


class SampleExecution(Base):
    __tablename__ = "sample_executions"
    __table_args__ = (
        UniqueConstraint("run_dataset_id", "sample_id", name="uq_execution_sample"),
        Index("ix_execution_run_status", "run_dataset_id", "status"),
        Index("ix_execution_error_type", "error_type"),
        Index("ix_execution_claim_expiry", "status", "claim_expires_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_dataset_id: Mapped[str] = mapped_column(
        ForeignKey("run_datasets.id", ondelete="CASCADE"), index=True
    )
    sample_id: Mapped[str] = mapped_column(String(512), nullable=False)
    inputs_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    reference_json: Mapped[Any] = mapped_column(JSON, nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    rendered_request_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    raw_response_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    output_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    parsed_value_json: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    parse_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    ttft_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message_redacted: Mapped[str | None] = mapped_column(Text, nullable=True)
    claim_token: Mapped[str | None] = mapped_column(String(36), nullable=True)
    claim_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    run_dataset: Mapped[RunDataset] = relationship(back_populates="executions")
    attempts: Mapped[list[RequestAttempt]] = relationship(
        back_populates="sample_execution", cascade="all, delete-orphan"
    )
    scores: Mapped[list[SampleScore]] = relationship(
        back_populates="sample_execution", cascade="all, delete-orphan"
    )


class RequestAttempt(Base):
    __tablename__ = "request_attempts"
    __table_args__ = (
        UniqueConstraint("sample_execution_id", "attempt_no", name="uq_attempt_number"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    sample_execution_id: Mapped[str] = mapped_column(
        ForeignKey("sample_executions.id", ondelete="CASCADE"), index=True
    )
    attempt_no: Mapped[int] = mapped_column(Integer, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_ms: Mapped[float] = mapped_column(Float, nullable=False)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    response_excerpt_redacted: Mapped[str | None] = mapped_column(Text, nullable=True)

    sample_execution: Mapped[SampleExecution] = relationship(back_populates="attempts")


class SampleScore(Base):
    __tablename__ = "sample_scores"
    __table_args__ = (
        UniqueConstraint("sample_execution_id", "score_revision", name="uq_score_revision"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    sample_execution_id: Mapped[str] = mapped_column(
        ForeignKey("sample_executions.id", ondelete="CASCADE"), index=True
    )
    score_revision: Mapped[int] = mapped_column(Integer, default=1)
    scorer_id: Mapped[str] = mapped_column(String(128), nullable=False)
    scorer_version: Mapped[str] = mapped_column(String(64), nullable=False)
    primary_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    metrics_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    passed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    sample_execution: Mapped[SampleExecution] = relationship(back_populates="scores")


class RunMetric(Base):
    __tablename__ = "run_metrics"
    __table_args__ = (
        Index("ix_run_metric_lookup", "run_dataset_id", "metric_name", "score_revision"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_dataset_id: Mapped[str] = mapped_column(
        ForeignKey("run_datasets.id", ondelete="CASCADE"), index=True
    )
    metric_name: Mapped[str] = mapped_column(String(128), nullable=False)
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    denominator: Mapped[int | None] = mapped_column(Integer, nullable=True)
    group_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    group_value: Mapped[str | None] = mapped_column(String(256), nullable=True)
    score_revision: Mapped[int] = mapped_column(Integer, default=1)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    run_id: Mapped[str | None] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    uri: Mapped[str] = mapped_column(Text, nullable=False)
    checksum: Mapped[str] = mapped_column(String(64), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    retention_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    actor: Mapped[str] = mapped_column(String(128), nullable=False)
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
