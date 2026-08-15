from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import NullPool

from tests.integration.support import isolated_database, run_alembic

EXPECTED_TABLES = {
    "alembic_version",
    "artifacts",
    "audit_logs",
    "dataset_versions",
    "datasets",
    "endpoint_capabilities",
    "endpoint_revisions",
    "endpoints",
    "models",
    "live_run_history",
    "protocols",
    "request_attempts",
    "run_datasets",
    "run_metrics",
    "runs",
    "sample_executions",
    "sample_scores",
    "users",
}
@pytest.mark.integration
def test_initial_migration_is_repeatable_and_matches_metadata() -> None:
    server_url_value = os.getenv("EVALHUB_TEST_DATABASE_SERVER_URL")
    if not server_url_value:
        pytest.skip("EVALHUB_TEST_DATABASE_SERVER_URL is required")

    with isolated_database(server_url_value, "migration") as database_url:
        rendered_url = database_url.render_as_string(hide_password=False)
        run_alembic(rendered_url, "upgrade", "head")
        run_alembic(rendered_url, "upgrade", "head")
        run_alembic(rendered_url, "check")

        database_engine = create_engine(database_url, poolclass=NullPool)
        with database_engine.connect() as connection:
            assert set(inspect(connection).get_table_names()) == EXPECTED_TABLES
            revision = connection.scalar(text("SELECT version_num FROM alembic_version"))
            assert revision == "20260815_0003"
        database_engine.dispose()

        run_alembic(rendered_url, "downgrade", "base")
        downgrade_engine = create_engine(database_url, poolclass=NullPool)
        with downgrade_engine.connect() as connection:
            remaining = set(inspect(connection).get_table_names())
            assert remaining <= {"alembic_version"}
        downgrade_engine.dispose()
