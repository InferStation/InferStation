"""Add the bounded InferStation Live Run history index.

Revision ID: 20260815_0003
Revises: 20260811_0002
Create Date: 2026-08-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260815_0003"
down_revision: str | Sequence[str] | None = "20260811_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "live_run_history",
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("run_id"),
    )
    op.create_index(
        "ix_live_run_history_created_at",
        "live_run_history",
        ["created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_live_run_history_created_at", table_name="live_run_history")
    op.drop_table("live_run_history")
