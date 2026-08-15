from __future__ import annotations

import json
import os
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import redis
from celery.contrib.testing.worker import start_worker
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from tests.experiments.run_capacity import (
    _assert_run,
    _create_run,
    _seed_resources,
    _wait_for_run,
)
from tests.integration.support import isolated_database, run_alembic
from workers.celery_app import celery_app
from workers.tasks import run_eval

PROJECT_ROOT = Path(__file__).parents[2]
ARTIFACT_ROOT = PROJECT_ROOT / "artifacts" / "experiments"


def _wait_for_mock(mock_base_url: str) -> None:
    health_url = mock_base_url.removesuffix("/v1") + "/healthz"
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            if httpx.get(health_url, timeout=1).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.2)
    raise TimeoutError("mock server did not become healthy")


def _mock_control_url(mock_base_url: str, path: str) -> str:
    return f"{mock_base_url.removesuffix('/v1')}/__control/{path}"


def _max_sliding_window(timestamps_ns: list[int], window_ns: int = 1_000_000_000) -> int:
    ordered = sorted(timestamps_ns)
    left = 0
    maximum = 0
    for right, timestamp in enumerate(ordered):
        while timestamp - ordered[left] >= window_ns:
            left += 1
        maximum = max(maximum, right - left + 1)
    return maximum


def _run_pair(
    session_factory: sessionmaker,
    resources: dict[str, str],
    engine: Any,
    mock_base_url: str,
    qps: int,
) -> dict[str, Any]:
    reset = httpx.post(_mock_control_url(mock_base_url, "reset"), timeout=5)
    reset.raise_for_status()
    run_ids = [
        _create_run(
            session_factory,
            resources,
            dataset_name="mvp-golden-v1",
            concurrency=8,
            repeat=index,
            qps=qps,
        )
        for index in (1, 2)
    ]
    started = time.perf_counter()
    dispatches = [
        run_eval.execute_run.apply_async(args=[run_id], queue="native") for run_id in run_ids
    ]
    for dispatch in dispatches:
        if dispatch.get(timeout=30, disable_sync_subtasks=False) != {"shards": 2}:
            raise AssertionError("each QPS run must dispatch exactly two shards")
    peaks = []
    for run_id in run_ids:
        _, peak = _wait_for_run(session_factory, run_id, engine, timeout_seconds=90)
        peaks.append(peak)
    duration = time.perf_counter() - started
    state = httpx.get(_mock_control_url(mock_base_url, "state"), timeout=5)
    state.raise_for_status()
    requests = state.json()["requests"]
    timestamps = [int(item["monotonic_ns"]) for item in requests]
    invariants = [_assert_run(session_factory, run_id, 100) for run_id in run_ids]
    max_window = _max_sliding_window(timestamps)
    return {
        "qps": qps,
        "run_ids": run_ids,
        "duration_seconds": duration,
        "request_count": len(requests),
        "max_requests_in_one_second": max_window,
        "allowed_max": qps + 1,
        "peak_db_connections": max(peaks),
        "run_invariants": invariants,
        "passed": (
            len(requests) == 200
            and max_window <= qps + 1
            and all(item["passed"] for item in invariants)
        ),
    }


def _write_evidence(output: Path, results: list[dict[str, Any]], migration_head: str) -> None:
    output.mkdir(parents=True, exist_ok=False)
    metrics = {"pairs": results}
    (output / "metrics.json").write_text(json.dumps(metrics, indent=2, sort_keys=True) + "\n")
    assertions = [
        {
            "name": f"qps-{item['qps']}-shared-sliding-window",
            "expected": f"<= {item['allowed_max']}",
            "actual": item["max_requests_in_one_second"],
            "passed": item["passed"],
            "evidence": "metrics.json",
        }
        for item in results
    ]
    (output / "assertions.json").write_text(
        json.dumps(assertions, indent=2, sort_keys=True) + "\n"
    )
    environment = {
        "git_sha": os.getenv("EVALHUB_GIT_SHA", "working-tree"),
        "migration_head": migration_head,
        "completed_at_utc": datetime.now(UTC).isoformat(),
    }
    (output / "environment.json").write_text(
        json.dumps(environment, indent=2, sort_keys=True) + "\n"
    )
    passed = all(item["passed"] for item in assertions)
    lines = [
        "# P1-06 Shared QPS Experiment",
        "",
        f"- Result: {'PASS' if passed else 'FAIL'}",
        f"- Git SHA: `{environment['git_sha']}`",
        "",
        "| QPS | Requests | Max 1s window | Allowed | Duration (s) | Both runs pass |",
        "|---:|---:|---:|---:|---:|---|",
    ]
    lines.extend(
        f"| {item['qps']} | {item['request_count']} | "
        f"{item['max_requests_in_one_second']} | {item['allowed_max']} | "
        f"{item['duration_seconds']:.3f} | {'PASS' if item['passed'] else 'FAIL'} |"
        for item in results
    )
    (output / "report.md").write_text("\n".join(lines) + "\n")
    if not passed:
        raise AssertionError(f"P1-06 failed; evidence: {output}")


def main() -> None:
    server_url = os.environ["EVALHUB_TEST_DATABASE_SERVER_URL"]
    redis_url = os.environ["EVALHUB_TEST_REDIS_URL"]
    mock_base_url = os.environ["EVALHUB_TEST_MOCK_BASE_URL"]
    _wait_for_mock(mock_base_url)
    redis_client = redis.Redis.from_url(redis_url, decode_responses=True)
    redis_client.flushdb()
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    output = ARTIFACT_ROOT / f"P1-06-shared-qps-{timestamp}"

    with isolated_database(server_url, "shared_qps") as database_url:
        rendered_url = database_url.render_as_string(hide_password=False)
        run_alembic(rendered_url, "upgrade", "head")
        engine = create_engine(database_url, pool_pre_ping=True, pool_size=16, max_overflow=32)
        session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        run_eval.SessionLocal = session_factory
        resources = _seed_resources(session_factory, mock_base_url)
        celery_app.conf.update(
            broker_url=redis_url,
            result_backend=redis_url,
            task_always_eager=False,
            broker_connection_retry_on_startup=True,
        )
        celery_app._backend_cache = None
        celery_app.control.purge()
        with start_worker(
            celery_app,
            concurrency=4,
            pool="threads",
            queues=("native",),
            perform_ping_check=False,
            loglevel="WARNING",
        ):
            results = [
                _run_pair(session_factory, resources, engine, mock_base_url, qps)
                for qps in (10, 50)
            ]
        with engine.connect() as connection:
            migration_head = str(
                connection.scalar(text("SELECT version_num FROM alembic_version"))
            )
        _write_evidence(output, results, migration_head)
        engine.dispose()
    redis_client.flushdb()
    redis_client.close()
    print(output)


if __name__ == "__main__":
    main()
