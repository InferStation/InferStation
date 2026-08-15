from __future__ import annotations

import os
import subprocess
import sys
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.pool import NullPool

PROJECT_ROOT = Path(__file__).parents[2]


def run_alembic(database_url: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=PROJECT_ROOT,
        env={**os.environ, "DATABASE_URL": database_url, "APP_ENV": "test"},
        check=True,
        capture_output=True,
        text=True,
    )


@contextmanager
def isolated_database(server_url_value: str, prefix: str) -> Iterator[URL]:
    server_url = make_url(server_url_value)
    database_name = f"evalhub_{prefix}_{uuid.uuid4().hex}"
    database_url = server_url.set(database=database_name)
    admin_engine = create_engine(server_url, isolation_level="AUTOCOMMIT", poolclass=NullPool)
    with admin_engine.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{database_name}"'))
    try:
        yield database_url
    finally:
        with admin_engine.connect() as connection:
            connection.execute(
                text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :database_name AND pid <> pg_backend_pid()"
                ),
                {"database_name": database_name},
            )
            connection.execute(text(f'DROP DATABASE IF EXISTS "{database_name}"'))
        admin_engine.dispose()
