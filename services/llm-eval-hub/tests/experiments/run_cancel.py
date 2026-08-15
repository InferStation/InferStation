from __future__ import annotations

import json
import os
import time
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import redis
from celery.contrib.testing.worker import start_worker
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

from apps.api.app.core.settings import Settings, get_settings
from apps.api.app.db import get_db
from apps.api.app.db.models import RunDataset, SampleExecution
from apps.api.app.main import app
from tests.experiments.run_capacity import (
    _create_run,
    _seed_resources,
    _wait_for_run,
)
from tests.experiments.run_shared_qps import _mock_control_url, _wait_for_mock
from tests.integration.support import isolated_database, run_alembic
from workers.celery_app import celery_app
from workers.tasks import run_eval

PROJECT_ROOT = Path(__file__).parents[2]
ARTIFACT_ROOT = PROJECT_ROOT / "artifacts" / "experiments"


def _mock_request_count(mock_base_url: str) -> int:
    response = httpx.get(_mock_control_url(mock_base_url, "state"), timeout=5)
    response.raise_for_status()
    return len(response.json()["requests"])


def _write_evidence(output: Path, result: dict[str, Any], migration_head: str) -> None:
    output.mkdir(parents=True, exist_ok=False)
    (output / "metrics.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    passed = bool(result["passed"])
    assertions = [
        {
            "name": "P1-09-cancel-inflight-bound",
            "expected": f"<= {result['configured_concurrency']}",
            "actual": result["requests_after_cancel"],
            "passed": result["requests_after_cancel"] <= result["configured_concurrency"],
            "evidence": "metrics.json",
        },
        {
            "name": "P1-09-terminal-conservation-and-export",
            "expected": 1000,
            "actual": {
                "terminal_samples": result["terminal_samples"],
                "exported_rows": result["exported_rows"],
                "statuses": result["statuses"],
            },
            "passed": passed,
            "evidence": "metrics.json",
        },
    ]
    (output / "assertions.json").write_text(
        json.dumps(assertions, indent=2, sort_keys=True) + "\n"
    )
    (output / "environment.json").write_text(
        json.dumps(
            {
                "git_sha": os.getenv("EVALHUB_GIT_SHA", "working-tree"),
                "migration_head": migration_head,
                "completed_at_utc": datetime.now(UTC).isoformat(),
            },
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )
    (output / "report.md").write_text(
        "\n".join(
            [
                "# P1-09 Cancel Experiment",
                "",
                f"- Result: {'PASS' if passed else 'FAIL'}",
                f"- Completed when cancelled: {result['completed_at_cancel']}",
                f"- Requests after cancel: {result['requests_after_cancel']}",
                f"- Statuses: `{json.dumps(result['statuses'], sort_keys=True)}`",
                f"- Exported rows: {result['exported_rows']}",
            ]
        )
        + "\n"
    )
    if not passed:
        raise AssertionError(f"P1-09 failed; evidence: {output}")


def main() -> None:
    server_url = os.environ["EVALHUB_TEST_DATABASE_SERVER_URL"]
    redis_url = os.environ["EVALHUB_TEST_REDIS_URL"]
    mock_base_url = os.environ["EVALHUB_TEST_MOCK_BASE_URL"]
    _wait_for_mock(mock_base_url)
    httpx.post(_mock_control_url(mock_base_url, "reset"), timeout=5).raise_for_status()
    httpx.post(_mock_control_url(mock_base_url, "delay/100"), timeout=5).raise_for_status()
    redis_client = redis.Redis.from_url(redis_url, decode_responses=True)
    redis_client.flushdb()
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    output = ARTIFACT_ROOT / f"P1-09-cancel-{timestamp}"

    with isolated_database(server_url, "cancel") as database_url:
        rendered_url = database_url.render_as_string(hide_password=False)
        run_alembic(rendered_url, "upgrade", "head")
        engine = create_engine(database_url, pool_pre_ping=True, pool_size=16, max_overflow=32)
        session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        run_eval.SessionLocal = session_factory
        resources = _seed_resources(
            session_factory, mock_base_url, dataset_names=("mvp-scale-v1",)
        )
        run_id = _create_run(
            session_factory,
            resources,
            dataset_name="mvp-scale-v1",
            concurrency=16,
            repeat=1,
            qps=10000,
        )
        celery_app.conf.update(
            broker_url=redis_url,
            result_backend=redis_url,
            task_always_eager=False,
            broker_connection_retry_on_startup=True,
        )
        celery_app._backend_cache = None
        celery_app.control.purge()
        settings = Settings(
            app_env="test",
            database_url=rendered_url,
            redis_url=redis_url,
            admin_api_key="cancel-key",
        )

        def override_db():
            with session_factory() as db:
                yield db

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_settings] = lambda: settings
        try:
            with TestClient(app) as client, start_worker(
                celery_app,
                concurrency=4,
                pool="threads",
                queues=("native",),
                perform_ping_check=False,
                loglevel="WARNING",
            ):
                dispatch = run_eval.execute_run.apply_async(args=[run_id], queue="native")
                if dispatch.get(timeout=30, disable_sync_subtasks=False) != {"shards": 20}:
                    raise AssertionError("cancel run must dispatch 20 shards")
                deadline = time.monotonic() + 60
                completed = 0
                while time.monotonic() < deadline:
                    with session_factory() as db:
                        completed = int(
                            db.scalar(
                                select(RunDataset.completed_samples).where(
                                    RunDataset.run_id == run_id
                                )
                            )
                            or 0
                        )
                    if 50 <= completed <= 100:
                        break
                    if completed > 100:
                        raise AssertionError(f"cancel threshold was missed: {completed}")
                    time.sleep(0.01)
                else:
                    raise TimeoutError("run did not reach the cancellation threshold")

                response = client.post(
                    f"/api/v1/runs/{run_id}/cancel",
                    headers={"x-api-key": "cancel-key"},
                )
                if response.status_code != 200:
                    raise AssertionError(f"cancel API returned {response.status_code}")
                requests_at_cancel = _mock_request_count(mock_base_url)
                _wait_for_run(session_factory, run_id, engine, timeout_seconds=90)
                final_requests = _mock_request_count(mock_base_url)
                export = client.get(
                    f"/api/v1/runs/{run_id}/export?format=jsonl",
                    headers={"x-api-key": "cancel-key"},
                )
                if export.status_code != 200:
                    raise AssertionError(f"export returned {export.status_code}")
                exported_rows = len(export.text.splitlines())
        finally:
            app.dependency_overrides.clear()

        with session_factory() as db:
            statuses = Counter(
                db.scalars(
                    select(SampleExecution.status)
                    .join(RunDataset)
                    .where(RunDataset.run_id == run_id)
                )
            )
        terminal_samples = sum(statuses.values())
        requests_after_cancel = final_requests - requests_at_cancel
        result = {
            "run_id": run_id,
            "configured_concurrency": 16,
            "completed_at_cancel": completed,
            "requests_at_cancel": requests_at_cancel,
            "final_requests": final_requests,
            "requests_after_cancel": requests_after_cancel,
            "terminal_samples": terminal_samples,
            "statuses": dict(statuses),
            "exported_rows": exported_rows,
            "passed": (
                requests_after_cancel <= 16
                and terminal_samples == 1000
                and set(statuses) <= {"SUCCEEDED", "CANCELLED"}
                and statuses["SUCCEEDED"] == final_requests
                and exported_rows == 1000
            ),
        }
        with engine.connect() as connection:
            migration_head = str(
                connection.scalar(text("SELECT version_num FROM alembic_version"))
            )
        _write_evidence(output, result, migration_head)
        engine.dispose()
    httpx.post(_mock_control_url(mock_base_url, "reset"), timeout=5).raise_for_status()
    redis_client.flushdb()
    redis_client.close()
    print(output)


if __name__ == "__main__":
    main()
