from __future__ import annotations

import json
import os
import platform
import time
import uuid
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import redis
from celery.contrib.testing.worker import start_worker
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, distinct, func, select, text
from sqlalchemy.orm import sessionmaker

from apps.api.app.core.settings import Settings, get_settings
from apps.api.app.db import get_db
from apps.api.app.db.models import (
    Dataset,
    DatasetVersion,
    Endpoint,
    EndpointRevision,
    Model,
    RequestAttempt,
    Run,
    RunDataset,
    RunMetric,
    SampleExecution,
    SampleScore,
)
from apps.api.app.main import app
from packages.eval_engine.datasets import validate_dataset
from tests.integration.support import isolated_database, run_alembic
from tests.oracles.scoring import percentile
from workers.celery_app import celery_app
from workers.tasks import run_eval

PROJECT_ROOT = Path(__file__).parents[2]
DATASET_ROOT = PROJECT_ROOT / "datasets" / "experiments"
ARTIFACT_ROOT = PROJECT_ROOT / "artifacts" / "experiments"
CONCURRENCY_LEVELS = (1, 8, 16, 32)
FORMAL_REPEATS = 3


def _seed_resources(
    session_factory: sessionmaker,
    mock_base_url: str,
    dataset_names: tuple[str, ...] = ("mvp-golden-v1", "mvp-scale-v1"),
) -> dict[str, str]:
    validated = {
        name: validate_dataset(DATASET_ROOT / name / "manifest.yaml")
        for name in dataset_names
    }
    with session_factory() as db:
        endpoint = Endpoint(
            name=f"capacity-{uuid.uuid4().hex}",
            base_url=mock_base_url,
            auth_type="none",
            status="healthy",
            owner="capacity-experiment",
        )
        db.add(endpoint)
        db.flush()
        revision = EndpointRevision(
            endpoint_id=endpoint.id,
            config_json={
                "base_url": mock_base_url,
                "auth_type": "none",
                "extra_headers": {},
                "qps_limit": 10000,
                "concurrency_limit": 32,
            },
            config_hash="2" * 64,
        )
        db.add(revision)
        db.flush()
        endpoint.active_revision_id = revision.id
        model = Model(
            endpoint_id=endpoint.id,
            model_name="mock-intent-v1",
            display_name="Mock Intent Capacity",
            source="capacity-experiment",
        )
        db.add(model)
        db.flush()
        version_ids: dict[str, str] = {}
        for name, fixture in validated.items():
            dataset = Dataset(
                name=f"{name}-{uuid.uuid4().hex[:8]}",
                display_name=name,
                owner="capacity-experiment",
            )
            db.add(dataset)
            db.flush()
            version = DatasetVersion(
                dataset_id=dataset.id,
                version="1.0.0",
                manifest_json=fixture.manifest.model_dump(mode="json"),
                manifest_uri=str(DATASET_ROOT / name / "manifest.yaml"),
                data_uri=str(DATASET_ROOT / name / "data" / "test.jsonl"),
                checksum=fixture.checksum_sha256,
                row_count=len(fixture.samples),
            )
            db.add(version)
            db.flush()
            version_ids[name] = version.id
        db.commit()
        return {
            "endpoint_revision_id": revision.id,
            "model_id": model.id,
            **version_ids,
        }


def _create_run(
    session_factory: sessionmaker,
    resources: dict[str, str],
    *,
    dataset_name: str,
    concurrency: int,
    repeat: int,
    qps: float = 10000,
    timeout_seconds: float = 5,
    max_retries: int = 2,
) -> str:
    fixture = validate_dataset(DATASET_ROOT / dataset_name / "manifest.yaml")
    with session_factory() as db:
        run = Run(
            name=f"P1-05 c{concurrency} r{repeat} {dataset_name}",
            status="QUEUED",
            created_by="capacity-experiment",
            model_id=resources["model_id"],
            endpoint_revision_id=resources["endpoint_revision_id"],
            protocol_fingerprint="3" * 64,
            run_spec_json={
                "model_name": "mock-intent-v1",
                "inference": {
                    "temperature": 0,
                    "top_p": 1,
                    "max_tokens": 8,
                    "seed": 20260811,
                    "stop": [],
                },
                "execution": {
                    "concurrency": concurrency,
                    "effective_concurrency": concurrency,
                    "qps": qps,
                    "timeout_seconds": timeout_seconds,
                    "max_retries": max_retries,
                    "shard_size": 50,
                },
            },
        )
        db.add(run)
        db.flush()
        db.add(
            RunDataset(
                run_id=run.id,
                dataset_version_id=resources[dataset_name],
                protocol_id=fixture.manifest.protocol.id,
                total_samples=len(fixture.samples),
            )
        )
        db.commit()
        return run.id


def _wait_for_run(
    session_factory: sessionmaker,
    run_id: str,
    engine: Any,
    timeout_seconds: float = 180,
) -> tuple[float, int]:
    started = time.perf_counter()
    deadline = started + timeout_seconds
    peak_connections = 0
    while time.perf_counter() < deadline:
        with engine.connect() as connection:
            connections = connection.scalar(
                text("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()")
            )
            peak_connections = max(peak_connections, int(connections or 0))
        with session_factory() as db:
            run = db.get(Run, run_id)
            if run is None:
                raise RuntimeError(f"run disappeared: {run_id}")
            if run.status == "FAILED":
                raise RuntimeError(run.error_message or "capacity run failed")
            if run.status in {"SUCCEEDED", "CANCELLED"}:
                return time.perf_counter() - started, peak_connections
        time.sleep(0.05)
    raise TimeoutError(f"run did not finish in {timeout_seconds}s: {run_id}")


def _assert_run(
    session_factory: sessionmaker,
    run_id: str,
    expected_samples: int,
) -> dict[str, Any]:
    with session_factory() as db:
        statuses = Counter(
            db.scalars(
                select(SampleExecution.status)
                .join(RunDataset)
                .where(RunDataset.run_id == run_id)
            )
        )
        execution_count = db.scalar(
            select(func.count(SampleExecution.id))
            .join(RunDataset)
            .where(RunDataset.run_id == run_id)
        )
        distinct_count = db.scalar(
            select(func.count(distinct(SampleExecution.sample_id)))
            .join(RunDataset)
            .where(RunDataset.run_id == run_id)
        )
        score_count = db.scalar(
            select(func.count(SampleScore.id))
            .join(SampleExecution)
            .join(RunDataset)
            .where(RunDataset.run_id == run_id)
        )
        attempt_count = db.scalar(
            select(func.count(RequestAttempt.id))
            .join(SampleExecution)
            .join(RunDataset)
            .where(RunDataset.run_id == run_id)
        )
        accuracy = db.scalar(
            select(RunMetric.value)
            .join(RunDataset)
            .where(
                RunDataset.run_id == run_id,
                RunMetric.metric_name == "accuracy",
                RunMetric.group_key.is_(None),
            )
        )
    passed = (
        execution_count == expected_samples
        and distinct_count == expected_samples
        and score_count == expected_samples
        and attempt_count == expected_samples
        and statuses == {"SUCCEEDED": expected_samples}
        and accuracy == 1.0
    )
    return {
        "passed": passed,
        "expected_samples": expected_samples,
        "execution_count": execution_count,
        "distinct_sample_count": distinct_count,
        "score_count": score_count,
        "attempt_count": attempt_count,
        "statuses": dict(statuses),
        "accuracy": accuracy,
    }


def _api_latency(
    session_factory: sessionmaker,
    database_url: str,
    run_id: str,
    artifact_root: Path,
) -> dict[str, dict[str, float]]:
    settings = Settings(
        app_env="test",
        database_url=database_url,
        redis_url=os.environ["EVALHUB_TEST_REDIS_URL"],
        artifact_root=artifact_root,
        admin_api_key="capacity-key",
    )

    def override_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_settings] = lambda: settings
    endpoints = {
        "runs": "/api/v1/runs?limit=50",
        "run_detail": f"/api/v1/runs/{run_id}",
        "metrics": f"/api/v1/runs/{run_id}/metrics",
        "samples": f"/api/v1/runs/{run_id}/samples?limit=50",
    }
    results: dict[str, dict[str, float]] = {}
    try:
        with TestClient(app) as client:
            for name, path in endpoints.items():
                latencies: list[float] = []
                for _ in range(20):
                    started = time.perf_counter()
                    response = client.get(path, headers={"x-api-key": "capacity-key"})
                    latencies.append((time.perf_counter() - started) * 1000)
                    if response.status_code != 200:
                        raise RuntimeError(f"{path} returned {response.status_code}")
                results[name] = {
                    "p50_ms": float(percentile(latencies, 0.5) or 0),
                    "p95_ms": float(percentile(latencies, 0.95) or 0),
                    "p99_ms": float(percentile(latencies, 0.99) or 0),
                }
    finally:
        app.dependency_overrides.clear()
    return results


def _write_evidence(
    output: Path,
    environment: dict[str, Any],
    results: list[dict[str, Any]],
    api_latency: dict[str, dict[str, float]],
) -> None:
    output.mkdir(parents=True, exist_ok=False)
    (output / "environment.json").write_text(
        json.dumps(environment, indent=2, sort_keys=True) + "\n"
    )
    (output / "metrics.json").write_text(
        json.dumps({"runs": results, "api_latency": api_latency}, indent=2, sort_keys=True)
        + "\n"
    )
    assertions = [
        {
            "name": f"c{item['concurrency']}-r{item['repeat']}-sample-conservation",
            "expected": item["sample_count"],
            "actual": item["invariants"],
            "passed": item["invariants"]["passed"],
            "evidence": "metrics.json",
        }
        for item in results
        if not item["warmup"]
    ]
    assertions.extend(
        {
            "name": f"api-{name}-p95-under-500ms",
            "expected": "<500ms",
            "actual": values["p95_ms"],
            "passed": values["p95_ms"] < 500,
            "evidence": "metrics.json",
        }
        for name, values in api_latency.items()
    )
    (output / "assertions.json").write_text(
        json.dumps(assertions, indent=2, sort_keys=True) + "\n"
    )
    passed = all(item["passed"] for item in assertions)
    lines = [
        "# P1-05 Capacity Experiment",
        "",
        f"- Result: {'PASS' if passed else 'FAIL'}",
        f"- Formal runs: {sum(not item['warmup'] for item in results)}",
        f"- Git SHA: `{environment['git_sha']}`",
        f"- Migration head: `{environment['migration_head']}`",
        "",
        "| Concurrency | Repeat | Duration (s) | Samples/s | Peak DB connections | Pass |",
        "|---:|---:|---:|---:|---:|---|",
    ]
    lines.extend(
        "| {concurrency} | {repeat} | {duration_seconds:.3f} | {samples_per_second:.2f} | "
        "{peak_db_connections} | {passed} |".format(
            **item, passed="PASS" if item["invariants"]["passed"] else "FAIL"
        )
        for item in results
        if not item["warmup"]
    )
    (output / "report.md").write_text("\n".join(lines) + "\n")
    if not passed:
        raise AssertionError(f"P1-05 failed; evidence: {output}")


def main() -> None:
    server_url = os.environ["EVALHUB_TEST_DATABASE_SERVER_URL"]
    redis_url = os.environ["EVALHUB_TEST_REDIS_URL"]
    mock_base_url = os.environ["EVALHUB_TEST_MOCK_BASE_URL"]
    redis_client = redis.Redis.from_url(redis_url, decode_responses=True)
    redis_client.flushdb()
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    output = ARTIFACT_ROOT / f"P1-05-capacity-{timestamp}"

    with isolated_database(server_url, "capacity") as database_url:
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
        results: list[dict[str, Any]] = []
        latest_run_id = ""
        with start_worker(
            celery_app,
            concurrency=4,
            pool="threads",
            queues=("native",),
            perform_ping_check=False,
            loglevel="WARNING",
        ):
            for concurrency in CONCURRENCY_LEVELS:
                for repeat, dataset_name in [
                    (0, "mvp-golden-v1"),
                    *((index, "mvp-scale-v1") for index in range(1, FORMAL_REPEATS + 1)),
                ]:
                    run_id = _create_run(
                        session_factory,
                        resources,
                        dataset_name=dataset_name,
                        concurrency=concurrency,
                        repeat=repeat,
                    )
                    latest_run_id = run_id
                    dispatch = run_eval.execute_run.apply_async(args=[run_id], queue="native")
                    dispatch_result = dispatch.get(timeout=30, disable_sync_subtasks=False)
                    expected_shards = 2 if repeat == 0 else 20
                    if dispatch_result != {"shards": expected_shards}:
                        raise AssertionError(f"unexpected dispatch result: {dispatch_result}")
                    duration, peak_connections = _wait_for_run(
                        session_factory, run_id, engine
                    )
                    sample_count = 100 if repeat == 0 else 1000
                    invariants = _assert_run(session_factory, run_id, sample_count)
                    results.append(
                        {
                            "run_id": run_id,
                            "concurrency": concurrency,
                            "repeat": repeat,
                            "warmup": repeat == 0,
                            "sample_count": sample_count,
                            "duration_seconds": duration,
                            "samples_per_second": sample_count / duration,
                            "peak_db_connections": peak_connections,
                            "invariants": invariants,
                        }
                    )

        api_latency = _api_latency(
            session_factory,
            rendered_url,
            latest_run_id,
            output,
        )
        with engine.connect() as connection:
            environment = {
                "git_sha": os.getenv("EVALHUB_GIT_SHA", "working-tree"),
                "migration_head": connection.scalar(
                    text("SELECT version_num FROM alembic_version")
                ),
                "python": platform.python_version(),
                "platform": platform.platform(),
                "postgresql": connection.scalar(text("SHOW server_version")),
                "redis": redis_client.info("server")["redis_version"],
                "celery": celery_app.broker_connection().as_uri(include_password=False),
                "dataset_checksum": validate_dataset(
                    DATASET_ROOT / "mvp-scale-v1" / "manifest.yaml"
                ).checksum_sha256,
                "started_at_utc": timestamp,
                "completed_at_utc": datetime.now(UTC).isoformat(),
            }
        _write_evidence(output, environment, results, api_latency)
        engine.dispose()
    redis_client.flushdb()
    redis_client.close()
    print(output)


if __name__ == "__main__":
    main()
