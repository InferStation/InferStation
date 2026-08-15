"""Add expiring sample execution claims.

Revision ID: 20260811_0002
Revises: 20260811_0001
Create Date: 2026-08-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260811_0002"
down_revision: str | Sequence[str] | None = "20260811_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "sample_executions",
        sa.Column("claim_token", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "sample_executions",
        sa.Column("claim_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_execution_claim_expiry",
        "sample_executions",
        ["status", "claim_expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_execution_claim_expiry", table_name="sample_executions")
    op.drop_column("sample_executions", "claim_expires_at")
    op.drop_column("sample_executions", "claim_token")
