from __future__ import annotations

import json
import os
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import redis
from celery.contrib.testing.worker import start_worker
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import sessionmaker

from apps.api.app.core.settings import Settings, get_settings
from apps.api.app.db import get_db
from apps.api.app.db.models import (
    RequestAttempt,
    RunDataset,
    RunMetric,
    SampleExecution,
    SampleScore,
)
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

EXPECTED_INITIAL = Counter(
    {
        ("http_401", "permanent", "API_ERROR", "http.401", 1): 15,
        ("http_429", "transient", "SUCCEEDED", None, 3): 5,
        ("http_429", "permanent", "API_ERROR", "http.429", 3): 10,
        ("http_500", "transient", "SUCCEEDED", None, 3): 5,
        ("http_500", "permanent", "API_ERROR", "http.5xx", 3): 10,
        ("timeout", "permanent", "API_ERROR", "transport.timeout", 3): 15,
        ("invalid_json", "permanent", "API_ERROR", "response.invalid_json", 1): 15,
        ("schema_mismatch", "permanent", "API_ERROR", "response.schema_mismatch", 1): 15,
        ("empty", "permanent", "API_ERROR", "response.empty", 1): 15,
        ("parse_error", "permanent", "PARSE_ERROR", None, 1): 15,
    }
)


def _snapshot(session_factory: sessionmaker, run_id: str) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    with session_factory() as db:
        executions = list(
            db.scalars(
                select(SampleExecution)
                .join(RunDataset)
                .where(RunDataset.run_id == run_id)
                .order_by(SampleExecution.sample_id)
            )
        )
        for execution in executions:
            attempts = db.scalar(
                select(func.count(RequestAttempt.id)).where(
                    RequestAttempt.sample_execution_id == execution.id
                )
            )
            rows.append(
                {
                    "sample_id": execution.sample_id,
                    "fault_type": execution.metadata_json["fault_type"],
                    "recovery": execution.metadata_json["recovery"],
                    "status": execution.status,
                    "error_type": execution.error_type,
                    "attempts": int(attempts or 0),
                }
            )
        metrics = {
            name: value
            for name, value in db.execute(
                select(RunMetric.metric_name, RunMetric.value)
                .join(RunDataset)
                .where(RunDataset.run_id == run_id, RunMetric.group_key.is_(None))
            )
        }
        score_count = db.scalar(
            select(func.count(SampleScore.id))
            .join(SampleExecution)
            .join(RunDataset)
            .where(RunDataset.run_id == run_id)
        )
    matrix = Counter(
        (
            row["fault_type"],
            row["recovery"],
            row["status"],
            row["error_type"],
            row["attempts"],
        )
        for row in rows
    )
    return {"rows": rows, "matrix": matrix, "metrics": metrics, "score_count": score_count}


def _initial_assertions(snapshot: dict[str, Any]) -> dict[str, Any]:
    metrics = snapshot["metrics"]
    expected_metrics = {
        "total_samples": 120.0,
        "scored_samples": 10.0,
        "api_errors": 95.0,
        "parse_errors": 15.0,
        "accuracy": 0.4,
        "accuracy_numerator": 10.0,
        "accuracy_denominator": 25.0,
    }
    return {
        "matrix_matches": snapshot["matrix"] == EXPECTED_INITIAL,
        "metrics_match": all(metrics.get(key) == value for key, value in expected_metrics.items()),
        "score_count": snapshot["score_count"],
        "attempt_count": sum(row["attempts"] for row in snapshot["rows"]),
        "expected_metrics": expected_metrics,
        "actual_metrics": {key: metrics.get(key) for key in expected_metrics},
    }


def _retry_via_api(
    session_factory: sessionmaker,
    database_url: str,
    redis_url: str,
    run_id: str,
) -> None:
    settings = Settings(
        app_env="test",
        database_url=database_url,
        redis_url=redis_url,
        admin_api_key="fault-key",
    )

    def override_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        with TestClient(app) as client:
            response = client.post(
                f"/api/v1/runs/{run_id}/retry-failures",
                headers={"x-api-key": "fault-key"},
            )
            if response.status_code != 202:
                raise AssertionError(f"retry API returned {response.status_code}: {response.text}")
    finally:
        app.dependency_overrides.clear()


def _retry_assertions(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    before_by_id = {row["sample_id"]: row for row in before["rows"]}
    transient_types = {"http.429", "http.5xx", "transport.timeout"}
    retried = {
        row["sample_id"]
        for row in before["rows"]
        if row["status"] == "API_ERROR" and row["error_type"] in transient_types
    }
    attempt_changes = {
        row["sample_id"]: row["attempts"] - before_by_id[row["sample_id"]]["attempts"]
        for row in after["rows"]
    }
    after_by_id = {row["sample_id"]: row for row in after["rows"]}
    only_transient_retried = all(
        change == (1 if sample_id in retried else 0)
        for sample_id, change in attempt_changes.items()
    )
    retried_succeeded = all(
        after_by_id[sample_id]["status"] == "SUCCEEDED" for sample_id in retried
    )
    metrics = after["metrics"]
    expected_metrics = {
        "total_samples": 120.0,
        "scored_samples": 45.0,
        "api_errors": 60.0,
        "parse_errors": 15.0,
        "accuracy": 0.75,
        "accuracy_numerator": 45.0,
        "accuracy_denominator": 60.0,
    }
    return {
        "retryable_samples": len(retried),
        "only_transient_retried": only_transient_retried,
        "retried_succeeded": retried_succeeded,
        "metrics_match": all(metrics.get(key) == value for key, value in expected_metrics.items()),
        "score_count": after["score_count"],
        "attempt_count": sum(row["attempts"] for row in after["rows"]),
        "expected_metrics": expected_metrics,
        "actual_metrics": {key: metrics.get(key) for key in expected_metrics},
    }


def _write_evidence(
    output: Path,
    initial: dict[str, Any],
    retry: dict[str, Any],
    migration_head: str,
) -> None:
    output.mkdir(parents=True, exist_ok=False)
    serializable_initial = {
        **initial,
        "matrix": [list(item) + [count] for item, count in initial["matrix"].items()],
    }
    (output / "metrics.json").write_text(
        json.dumps({"initial": serializable_initial, "retry": retry}, indent=2, sort_keys=True)
        + "\n"
    )
    p1_07_passed = (
        initial["assertions"]["matrix_matches"]
        and initial["assertions"]["metrics_match"]
        and initial["assertions"]["attempt_count"] == 210
        and initial["assertions"]["score_count"] == 120
    )
    p1_08_passed = (
        retry["assertions"]["retryable_samples"] == 35
        and retry["assertions"]["only_transient_retried"]
        and retry["assertions"]["retried_succeeded"]
        and retry["assertions"]["metrics_match"]
        and retry["assertions"]["attempt_count"] == 245
        and retry["assertions"]["score_count"] == 120
    )
    assertions = [
        {
            "name": "P1-07-fault-matrix",
            "expected": "120 samples, 210 attempts, exact error matrix",
            "actual": initial["assertions"],
            "passed": p1_07_passed,
            "evidence": "metrics.json",
        },
        {
            "name": "P1-08-retry-only-transient",
            "expected": "35 samples retried once; total attempts 245",
            "actual": retry["assertions"],
            "passed": p1_08_passed,
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
    passed = p1_07_passed and p1_08_passed
    (output / "report.md").write_text(
        "\n".join(
            [
                "# P1-07/P1-08 Fault and Retry Experiment",
                "",
                f"- Result: {'PASS' if passed else 'FAIL'}",
                f"- P1-07: {'PASS' if p1_07_passed else 'FAIL'}",
                f"- P1-08: {'PASS' if p1_08_passed else 'FAIL'}",
                f"- Initial attempts: {initial['assertions']['attempt_count']}",
                f"- Retried samples: {retry['assertions']['retryable_samples']}",
                f"- Final attempts: {retry['assertions']['attempt_count']}",
            ]
        )
        + "\n"
    )
    if not passed:
        raise AssertionError(f"P1-07/P1-08 failed; evidence: {output}")


def main() -> None:
    server_url = os.environ["EVALHUB_TEST_DATABASE_SERVER_URL"]
    redis_url = os.environ["EVALHUB_TEST_REDIS_URL"]
    mock_base_url = os.environ["EVALHUB_TEST_MOCK_BASE_URL"]
    _wait_for_mock(mock_base_url)
    httpx.post(_mock_control_url(mock_base_url, "reset"), timeout=5).raise_for_status()
    redis_client = redis.Redis.from_url(redis_url, decode_responses=True)
    redis_client.flushdb()
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    output = ARTIFACT_ROOT / f"P1-07-08-fault-retry-{timestamp}"

    with isolated_database(server_url, "fault_retry") as database_url:
        rendered_url = database_url.render_as_string(hide_password=False)
        run_alembic(rendered_url, "upgrade", "head")
        engine = create_engine(database_url, pool_pre_ping=True, pool_size=16, max_overflow=32)
        session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        run_eval.SessionLocal = session_factory
        resources = _seed_resources(
            session_factory, mock_base_url, dataset_names=("mvp-faults-v1",)
        )
        celery_app.conf.update(
            broker_url=redis_url,
            result_backend=redis_url,
            task_always_eager=False,
            broker_connection_retry_on_startup=True,
        )
        celery_app._backend_cache = None
        celery_app.control.purge()
        run_id = _create_run(
            session_factory,
            resources,
            dataset_name="mvp-faults-v1",
            concurrency=4,
            repeat=1,
            qps=1000,
            timeout_seconds=0.15,
            max_retries=2,
        )
        with start_worker(
            celery_app,
            concurrency=4,
            pool="threads",
            queues=("native",),
            perform_ping_check=False,
            loglevel="WARNING",
        ):
            dispatched = run_eval.execute_run.apply_async(args=[run_id], queue="native")
            if dispatched.get(timeout=30, disable_sync_subtasks=False) != {"shards": 3}:
                raise AssertionError("fault run must dispatch three shards")
            _wait_for_run(session_factory, run_id, engine, timeout_seconds=90)
            initial_snapshot = _snapshot(session_factory, run_id)
            initial = {
                **initial_snapshot,
                "assertions": _initial_assertions(initial_snapshot),
            }

            _retry_via_api(session_factory, rendered_url, redis_url, run_id)
            httpx.post(
                _mock_control_url(mock_base_url, "faults/false"), timeout=5
            ).raise_for_status()
            retry_dispatch = run_eval.execute_run.apply_async(args=[run_id], queue="native")
            if retry_dispatch.get(timeout=30, disable_sync_subtasks=False) != {"shards": 1}:
                raise AssertionError("retry run must dispatch one shard")
            _wait_for_run(session_factory, run_id, engine, timeout_seconds=90)
            after_snapshot = _snapshot(session_factory, run_id)
            retry = {
                "rows": after_snapshot["rows"],
                "metrics": after_snapshot["metrics"],
                "assertions": _retry_assertions(initial_snapshot, after_snapshot),
            }

        with engine.connect() as connection:
            migration_head = str(
                connection.scalar(text("SELECT version_num FROM alembic_version"))
            )
        _write_evidence(output, initial, retry, migration_head)
        engine.dispose()
    redis_client.flushdb()
    redis_client.close()
    print(output)


if __name__ == "__main__":
    main()
