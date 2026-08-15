"""Create the initial Phase 1 schema.

Revision ID: 20260811_0001
Revises:
Create Date: 2026-08-11
"""

import sqlalchemy as sa
from alembic import op

revision = "20260811_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("actor", sa.String(length=128), nullable=False),
        sa.Column("action", sa.String(length=128), nullable=False),
        sa.Column("resource_type", sa.String(length=64), nullable=False),
        sa.Column("resource_id", sa.String(length=36), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_logs_resource_id", "audit_logs", ["resource_id"])

    op.create_table(
        "datasets",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("display_name", sa.String(length=256), nullable=False),
        sa.Column("owner", sa.String(length=128), nullable=False),
        sa.Column("sensitivity", sa.String(length=32), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )

    op.create_table(
        "endpoints",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("base_url", sa.String(length=2048), nullable=False),
        sa.Column("auth_type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("owner", sa.String(length=128), nullable=False),
        sa.Column("active_revision_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index("ix_endpoints_status", "endpoints", ["status"])

    op.create_table(
        "protocols",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("version", sa.String(length=64), nullable=False),
        sa.Column("spec_json", sa.JSON(), nullable=False),
        sa.Column("spec_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", "version", name="uq_protocol_name_version"),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("username", sa.String(length=128), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("username"),
    )

    op.create_table(
        "dataset_versions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("dataset_id", sa.String(length=36), nullable=False),
        sa.Column("version", sa.String(length=128), nullable=False),
        sa.Column("manifest_json", sa.JSON(), nullable=False),
        sa.Column("manifest_uri", sa.Text(), nullable=False),
        sa.Column("data_uri", sa.Text(), nullable=False),
        sa.Column("checksum", sa.String(length=64), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dataset_id", "version", name="uq_dataset_version"),
    )
    op.create_index("ix_dataset_versions_dataset_id", "dataset_versions", ["dataset_id"])

    op.create_table(
        "endpoint_revisions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("endpoint_id", sa.String(length=36), nullable=False),
        sa.Column("config_json", sa.JSON(), nullable=False),
        sa.Column("config_hash", sa.String(length=64), nullable=False),
        sa.Column("secret_ciphertext", sa.Text(), nullable=True),
        sa.Column("secret_hint", sa.String(length=16), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["endpoint_id"], ["endpoints.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_endpoint_revisions_endpoint_id", "endpoint_revisions", ["endpoint_id"])

    op.create_table(
        "models",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("endpoint_id", sa.String(length=36), nullable=False),
        sa.Column("model_name", sa.String(length=512), nullable=False),
        sa.Column("display_name", sa.String(length=512), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["endpoint_id"], ["endpoints.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint_id", "model_name", name="uq_model_endpoint_name"),
    )
    op.create_index("ix_models_endpoint_id", "models", ["endpoint_id"])

    op.create_table(
        "endpoint_capabilities",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("revision_id", sa.String(length=36), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("capabilities_json", sa.JSON(), nullable=False),
        sa.Column("probe_status", sa.String(length=32), nullable=False),
        sa.Column("latency_ms", sa.Float(), nullable=True),
        sa.Column("error_type", sa.String(length=64), nullable=True),
        sa.Column("error_message_redacted", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["revision_id"], ["endpoint_revisions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_endpoint_capabilities_revision_id", "endpoint_capabilities", ["revision_id"]
    )

    op.create_table(
        "runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_by", sa.String(length=128), nullable=False),
        sa.Column("model_id", sa.String(length=36), nullable=False),
        sa.Column("endpoint_revision_id", sa.String(length=36), nullable=False),
        sa.Column("run_spec_json", sa.JSON(), nullable=False),
        sa.Column("protocol_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("baseline_run_id", sa.String(length=36), nullable=True),
        sa.Column("idempotency_key", sa.String(length=128), nullable=True),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["baseline_run_id"], ["runs.id"]),
        sa.ForeignKeyConstraint(["endpoint_revision_id"], ["endpoint_revisions.id"]),
        sa.ForeignKeyConstraint(["model_id"], ["models.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("idempotency_key"),
    )
    op.create_index("ix_runs_model_id", "runs", ["model_id"])
    op.create_index("ix_runs_protocol_fingerprint", "runs", ["protocol_fingerprint"])
    op.create_index("ix_runs_status", "runs", ["status"])

    op.create_table(
        "artifacts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=True),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("uri", sa.Text(), nullable=False),
        sa.Column("checksum", sa.String(length=64), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("retention_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_artifacts_run_id", "artifacts", ["run_id"])

    op.create_table(
        "run_datasets",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("dataset_version_id", sa.String(length=36), nullable=False),
        sa.Column("protocol_id", sa.String(length=256), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("total_samples", sa.Integer(), nullable=False),
        sa.Column("completed_samples", sa.Integer(), nullable=False),
        sa.Column("counters_json", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["dataset_version_id"], ["dataset_versions.id"]),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "dataset_version_id", name="uq_run_dataset_version"),
    )
    op.create_index("ix_run_datasets_dataset_version_id", "run_datasets", ["dataset_version_id"])
    op.create_index("ix_run_datasets_run_id", "run_datasets", ["run_id"])

    op.create_table(
        "run_metrics",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_dataset_id", sa.String(length=36), nullable=False),
        sa.Column("metric_name", sa.String(length=128), nullable=False),
        sa.Column("value", sa.Float(), nullable=True),
        sa.Column("denominator", sa.Integer(), nullable=True),
        sa.Column("group_key", sa.String(length=128), nullable=True),
        sa.Column("group_value", sa.String(length=256), nullable=True),
        sa.Column("score_revision", sa.Integer(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["run_dataset_id"], ["run_datasets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_run_metric_lookup",
        "run_metrics",
        ["run_dataset_id", "metric_name", "score_revision"],
    )
    op.create_index("ix_run_metrics_run_dataset_id", "run_metrics", ["run_dataset_id"])

    op.create_table(
        "sample_executions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_dataset_id", sa.String(length=36), nullable=False),
        sa.Column("sample_id", sa.String(length=512), nullable=False),
        sa.Column("inputs_json", sa.JSON(), nullable=False),
        sa.Column("reference_json", sa.JSON(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("rendered_request_json", sa.JSON(), nullable=True),
        sa.Column("raw_response_json", sa.JSON(), nullable=True),
        sa.Column("output_text", sa.Text(), nullable=True),
        sa.Column("parsed_value_json", sa.JSON(), nullable=True),
        sa.Column("parse_status", sa.String(length=32), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("latency_ms", sa.Float(), nullable=True),
        sa.Column("ttft_ms", sa.Float(), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("error_type", sa.String(length=64), nullable=True),
        sa.Column("error_message_redacted", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["run_dataset_id"], ["run_datasets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_dataset_id", "sample_id", name="uq_execution_sample"),
    )
    op.create_index("ix_execution_error_type", "sample_executions", ["error_type"])
    op.create_index("ix_execution_run_status", "sample_executions", ["run_dataset_id", "status"])
    op.create_index("ix_sample_executions_run_dataset_id", "sample_executions", ["run_dataset_id"])

    op.create_table(
        "request_attempts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("sample_execution_id", sa.String(length=36), nullable=False),
        sa.Column("attempt_no", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_ms", sa.Float(), nullable=False),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("error_type", sa.String(length=64), nullable=True),
        sa.Column("response_excerpt_redacted", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["sample_execution_id"], ["sample_executions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sample_execution_id", "attempt_no", name="uq_attempt_number"),
    )
    op.create_index(
        "ix_request_attempts_sample_execution_id", "request_attempts", ["sample_execution_id"]
    )

    op.create_table(
        "sample_scores",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("sample_execution_id", sa.String(length=36), nullable=False),
        sa.Column("score_revision", sa.Integer(), nullable=False),
        sa.Column("scorer_id", sa.String(length=128), nullable=False),
        sa.Column("scorer_version", sa.String(length=64), nullable=False),
        sa.Column("primary_score", sa.Float(), nullable=True),
        sa.Column("metrics_json", sa.JSON(), nullable=False),
        sa.Column("passed", sa.Boolean(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["sample_execution_id"], ["sample_executions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sample_execution_id", "score_revision", name="uq_score_revision"),
    )
    op.create_index(
        "ix_sample_scores_sample_execution_id", "sample_scores", ["sample_execution_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_sample_scores_sample_execution_id", table_name="sample_scores")
    op.drop_table("sample_scores")
    op.drop_index("ix_request_attempts_sample_execution_id", table_name="request_attempts")
    op.drop_table("request_attempts")
    op.drop_index("ix_sample_executions_run_dataset_id", table_name="sample_executions")
    op.drop_index("ix_execution_run_status", table_name="sample_executions")
    op.drop_index("ix_execution_error_type", table_name="sample_executions")
    op.drop_table("sample_executions")
    op.drop_index("ix_run_metrics_run_dataset_id", table_name="run_metrics")
    op.drop_index("ix_run_metric_lookup", table_name="run_metrics")
    op.drop_table("run_metrics")
    op.drop_index("ix_run_datasets_run_id", table_name="run_datasets")
    op.drop_index("ix_run_datasets_dataset_version_id", table_name="run_datasets")
    op.drop_table("run_datasets")
    op.drop_index("ix_artifacts_run_id", table_name="artifacts")
    op.drop_table("artifacts")
    op.drop_index("ix_runs_status", table_name="runs")
    op.drop_index("ix_runs_protocol_fingerprint", table_name="runs")
    op.drop_index("ix_runs_model_id", table_name="runs")
    op.drop_table("runs")
    op.drop_index("ix_endpoint_capabilities_revision_id", table_name="endpoint_capabilities")
    op.drop_table("endpoint_capabilities")
    op.drop_index("ix_models_endpoint_id", table_name="models")
    op.drop_table("models")
    op.drop_index("ix_endpoint_revisions_endpoint_id", table_name="endpoint_revisions")
    op.drop_table("endpoint_revisions")
    op.drop_index("ix_dataset_versions_dataset_id", table_name="dataset_versions")
    op.drop_table("dataset_versions")
    op.drop_table("users")
    op.drop_table("protocols")
    op.drop_index("ix_endpoints_status", table_name="endpoints")
    op.drop_table("endpoints")
    op.drop_table("datasets")
    op.drop_index("ix_audit_logs_resource_id", table_name="audit_logs")
    op.drop_table("audit_logs")
