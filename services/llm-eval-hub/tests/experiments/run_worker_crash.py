from __future__ import annotations

import argparse
import json
import os
import platform
import time
from collections import Counter
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import celery
import httpx
import redis
from sqlalchemy import create_engine, distinct, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import selectinload, sessionmaker
from sqlalchemy.pool import NullPool

from apps.api.app.db.models import (
    RequestAttempt,
    Run,
    RunDataset,
    RunMetric,
    SampleExecution,
    SampleScore,
)
from packages.eval_engine.datasets import validate_dataset
from tests.experiments.run_capacity import _create_run, _seed_resources
from tests.experiments.run_shared_qps import _mock_control_url, _wait_for_mock
from tests.integration.support import run_alembic
from workers.celery_app import celery_app
from workers.tasks import run_eval

PROJECT_ROOT = Path(__file__).parents[2]
ARTIFACT_ROOT = PROJECT_ROOT / "artifacts" / "experiments"
STATE_PATH = ARTIFACT_ROOT / ".p1-10-worker-crash-state.json"
DATASET_MANIFEST = PROJECT_ROOT / "datasets/experiments/mvp-scale-v1/manifest.yaml"
EXPECTED_SAMPLES = 1_000
CRASH_MIN_COMPLETED = 50
CRASH_MAX_COMPLETED = 100
CONFIGURED_CONCURRENCY = 16


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)


def _read_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        raise RuntimeError("P1-10 state does not exist; run setup first")
    return json.loads(STATE_PATH.read_text())


def _database_url() -> str:
    return os.environ["DATABASE_URL"]


def _server_url() -> str:
    return os.environ["EVALHUB_TEST_DATABASE_SERVER_URL"]


def _redis_url() -> str:
    return os.environ["EVALHUB_TEST_REDIS_URL"]


def _mock_base_url() -> str:
    return os.environ["EVALHUB_TEST_MOCK_BASE_URL"]


def _output_path(state: dict[str, Any]) -> Path:
    return PROJECT_ROOT / state["output_dir"]


def _recreate_database() -> None:
    server_url = make_url(_server_url())
    target_url = make_url(_database_url())
    database_name = target_url.database
    if not database_name or database_name in {"postgres", server_url.database}:
        raise RuntimeError(f"unsafe P1-10 database name: {database_name!r}")
    engine = create_engine(server_url, isolation_level="AUTOCOMMIT", poolclass=NullPool)
    with engine.connect() as connection:
        connection.execute(
            text(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = :database_name AND pid <> pg_backend_pid()"
            ),
            {"database_name": database_name},
        )
        connection.execute(text(f'DROP DATABASE IF EXISTS "{database_name}"'))
        connection.execute(text(f'CREATE DATABASE "{database_name}"'))
    engine.dispose()


def _drop_database() -> None:
    server_url = make_url(_server_url())
    target_url = make_url(_database_url())
    database_name = target_url.database
    if not database_name or database_name in {"postgres", server_url.database}:
        raise RuntimeError(f"unsafe P1-10 database name: {database_name!r}")
    engine = create_engine(server_url, isolation_level="AUTOCOMMIT", poolclass=NullPool)
    with engine.connect() as connection:
        connection.execute(
            text(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = :database_name AND pid <> pg_backend_pid()"
            ),
            {"database_name": database_name},
        )
        connection.execute(text(f'DROP DATABASE IF EXISTS "{database_name}"'))
    engine.dispose()


def _mock_state() -> dict[str, Any]:
    response = httpx.get(_mock_control_url(_mock_base_url(), "state"), timeout=10)
    response.raise_for_status()
    return response.json()


def _snapshot(session_factory: sessionmaker, run_id: str) -> dict[str, Any]:
    with session_factory() as db:
        run = db.get(Run, run_id)
        run_dataset = db.scalar(select(RunDataset).where(RunDataset.run_id == run_id))
        if run is None or run_dataset is None:
            raise RuntimeError(f"run disappeared: {run_id}")
        statuses = Counter(
            db.scalars(
                select(SampleExecution.status).join(RunDataset).where(RunDataset.run_id == run_id)
            )
        )
        active_claims = int(
            db.scalar(
                select(func.count(SampleExecution.id))
                .join(RunDataset)
                .where(
                    RunDataset.run_id == run_id,
                    SampleExecution.status == "RUNNING",
                    SampleExecution.claim_token.is_not(None),
                    SampleExecution.claim_expires_at > datetime.now(UTC),
                )
            )
            or 0
        )
        claimed = int(
            db.scalar(
                select(func.count(SampleExecution.id))
                .join(RunDataset)
                .where(
                    RunDataset.run_id == run_id,
                    SampleExecution.claim_token.is_not(None),
                )
            )
            or 0
        )
        return {
            "captured_at_utc": _utc_now(),
            "run_status": run.status,
            "completed_samples": run_dataset.completed_samples,
            "statuses": dict(statuses),
            "active_claims": active_claims,
            "claimed_samples": claimed,
        }


def setup() -> None:
    _wait_for_mock(_mock_base_url())
    httpx.post(_mock_control_url(_mock_base_url(), "reset"), timeout=10).raise_for_status()
    httpx.post(_mock_control_url(_mock_base_url(), "delay/250"), timeout=10).raise_for_status()
    redis_client = redis.Redis.from_url(_redis_url(), decode_responses=True)
    redis_client.flushdb()
    celery_app.control.purge()
    _recreate_database()
    run_alembic(_database_url(), "upgrade", "head")

    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    output = ARTIFACT_ROOT / f"P1-10-worker-crash-{timestamp}"
    output.mkdir(parents=True, exist_ok=False)
    (output / "service-logs-redacted").mkdir()
    engine = create_engine(_database_url(), pool_pre_ping=True)
    session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    resources = _seed_resources(session_factory, _mock_base_url(), dataset_names=("mvp-scale-v1",))
    run_id = _create_run(
        session_factory,
        resources,
        dataset_name="mvp-scale-v1",
        concurrency=CONFIGURED_CONCURRENCY,
        repeat=1,
        qps=10_000,
        timeout_seconds=5,
        max_retries=2,
    )
    with session_factory() as db:
        run = db.get(Run, run_id)
        assert run is not None
        run.name = "P1-10 worker SIGKILL recovery"
        db.commit()
    with engine.connect() as connection:
        migration_head = str(connection.scalar(text("SELECT version_num FROM alembic_version")))
        postgresql_version = str(connection.scalar(text("SHOW server_version")))
    compose_hash = os.environ["EVALHUB_COMPOSE_CONFIG_SHA256"]
    fixture = validate_dataset(DATASET_MANIFEST)
    state = {
        "output_dir": str(output.relative_to(PROJECT_ROOT)),
        "run_id": run_id,
        "setup_at_utc": _utc_now(),
        "migration_head": migration_head,
        "dataset_checksum": fixture.checksum_sha256,
        "configured_concurrency": CONFIGURED_CONCURRENCY,
        "expected_samples": EXPECTED_SAMPLES,
        "mock_delay_ms": 250,
        "compose_config_sha256": compose_hash,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "postgresql": postgresql_version,
        "redis": redis_client.info("server")["redis_version"],
        "celery": celery.__version__,
        "git_sha": os.getenv("EVALHUB_GIT_SHA", "working-tree"),
    }
    _write_json(STATE_PATH, state)
    _write_json(output / "run-ids.json", {"run_ids": [run_id]})
    (output / "commands-redacted.txt").write_text(
        "\n".join(
            [
                "docker compose stop worker && docker compose rm -f worker",
                "docker compose run -d --name inferstation-evalhub-worker [REDACTED_ENV] worker",
                "docker compose run --rm crash-experiment dispatch",
                "docker kill -s KILL inferstation-evalhub-worker",
                "docker start inferstation-evalhub-worker",
                "docker compose run --rm crash-experiment verify",
            ]
        )
        + "\n"
    )
    engine.dispose()
    redis_client.close()
    print(state["output_dir"])


def dispatch() -> None:
    state = _read_state()
    engine = create_engine(_database_url(), pool_pre_ping=True)
    session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    result = run_eval.execute_run.apply_async(args=[state["run_id"]], queue="native").get(
        timeout=30, disable_sync_subtasks=False
    )
    if result != {"shards": 20}:
        raise AssertionError(f"P1-10 expected 20 shards, got {result!r}")
    deadline = time.monotonic() + 60
    snapshot: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        snapshot = _snapshot(session_factory, state["run_id"])
        completed = snapshot["completed_samples"]
        if (
            CRASH_MIN_COMPLETED <= completed <= CRASH_MAX_COMPLETED
            and snapshot["active_claims"] > 0
        ):
            break
        if completed > CRASH_MAX_COMPLETED:
            raise AssertionError(f"P1-10 crash threshold missed: {completed}")
        time.sleep(0.01)
    else:
        raise TimeoutError("P1-10 run did not reach the crash threshold")
    assert snapshot is not None
    snapshot["mock_requests"] = len(_mock_state()["requests"])
    state["dispatch_result"] = result
    state["pre_crash"] = snapshot
    _write_json(STATE_PATH, state)
    engine.dispose()
    print(json.dumps(snapshot, sort_keys=True))


def record_crash(container_id: str, image_id: str, exit_code: int) -> None:
    state = _read_state()
    engine = create_engine(_database_url(), pool_pre_ping=True)
    session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    snapshot = _snapshot(session_factory, state["run_id"])
    snapshot["mock_requests"] = len(_mock_state()["requests"])
    state["crash"] = {
        "signal": "SIGKILL",
        "exit_code": exit_code,
        "container_name": "inferstation-evalhub-worker",
        "container_id": container_id,
        "image_id": image_id,
        "recorded_at_utc": _utc_now(),
        "database_snapshot": snapshot,
    }
    _write_json(STATE_PATH, state)
    engine.dispose()
    print(json.dumps(state["crash"], sort_keys=True))


def _result_metrics(
    session_factory: sessionmaker,
    state: dict[str, Any],
    progress_history: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    run_id = state["run_id"]
    with session_factory() as db:
        run = db.get(Run, run_id)
        run_dataset = db.scalar(select(RunDataset).where(RunDataset.run_id == run_id))
        if run is None or run_dataset is None:
            raise RuntimeError(f"run disappeared: {run_id}")
        executions = (
            db.scalars(
                select(SampleExecution)
                .join(RunDataset)
                .where(RunDataset.run_id == run_id)
                .options(
                    selectinload(SampleExecution.scores),
                    selectinload(SampleExecution.attempts),
                )
                .order_by(SampleExecution.sample_id)
            )
            .unique()
            .all()
        )
        statuses = Counter(item.status for item in executions)
        execution_count = len(executions)
        distinct_samples = int(
            db.scalar(
                select(func.count(distinct(SampleExecution.sample_id)))
                .join(RunDataset)
                .where(RunDataset.run_id == run_id)
            )
            or 0
        )
        score_count = int(
            db.scalar(
                select(func.count(SampleScore.id))
                .join(SampleExecution)
                .join(RunDataset)
                .where(RunDataset.run_id == run_id)
            )
            or 0
        )
        attempt_count = int(
            db.scalar(
                select(func.count(RequestAttempt.id))
                .join(SampleExecution)
                .join(RunDataset)
                .where(RunDataset.run_id == run_id)
            )
            or 0
        )
        active_claims = sum(item.claim_token is not None for item in executions)
        score_revisions = sorted(
            {score.score_revision for item in executions for score in item.scores}
        )
        invalid_score_rows = sum(
            len(item.scores) != 1 or item.scores[0].score_revision != 1 for item in executions
        )
        accuracy = db.scalar(
            select(RunMetric.value).where(
                RunMetric.run_dataset_id == run_dataset.id,
                RunMetric.metric_name == "accuracy",
                RunMetric.group_key.is_(None),
            )
        )
        samples = [
            {
                "sample_id": item.sample_id,
                "status": item.status,
                "score_revisions": sorted(score.score_revision for score in item.scores),
                "attempt_numbers": sorted(attempt.attempt_no for attempt in item.attempts),
                "claim_token_present": item.claim_token is not None,
            }
            for item in executions
        ]
    progress_values = [item["completed_samples"] for item in progress_history]
    monotonic_progress = all(
        current >= previous
        for previous, current in zip(progress_values, progress_values[1:], strict=False)
    )
    mock_requests = len(_mock_state()["requests"])
    metrics = {
        "run_id": run_id,
        "run_status": run.status,
        "run_dataset_status": run_dataset.status,
        "completed_samples": run_dataset.completed_samples,
        "execution_count": execution_count,
        "distinct_sample_count": distinct_samples,
        "statuses": dict(statuses),
        "score_count": score_count,
        "score_revisions": score_revisions,
        "invalid_score_rows": invalid_score_rows,
        "attempt_count": attempt_count,
        "active_claims": active_claims,
        "accuracy": accuracy,
        "mock_request_count": mock_requests,
        "duplicate_http_requests_after_crash": max(0, mock_requests - attempt_count),
        "progress_monotonic": monotonic_progress,
        "progress_history": progress_history,
    }
    return metrics, samples


def verify() -> None:
    state = _read_state()
    if "pre_crash" not in state or "crash" not in state:
        raise RuntimeError("P1-10 crash metadata is incomplete")
    engine = create_engine(_database_url(), pool_pre_ping=True)
    session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    progress_history = [state["pre_crash"], state["crash"]["database_snapshot"]]
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        snapshot = _snapshot(session_factory, state["run_id"])
        progress_history.append(snapshot)
        if snapshot["run_status"] in {"SUCCEEDED", "FAILED", "CANCELLED"}:
            break
        time.sleep(0.25)
    else:
        raise TimeoutError("P1-10 run did not become terminal after worker restart")

    metrics, samples = _result_metrics(session_factory, state, progress_history)
    output = _output_path(state)
    crash = state["crash"]
    assertions = [
        {
            "name": "P1-10-worker-killed-mid-run",
            "expected": {"signal": "SIGKILL", "exit_code": 137, "active_claims": ">0"},
            "actual": {
                "signal": crash["signal"],
                "exit_code": crash["exit_code"],
                "active_claims": state["pre_crash"]["active_claims"],
                "completed_samples": state["pre_crash"]["completed_samples"],
            },
            "passed": (
                crash["signal"] == "SIGKILL"
                and crash["exit_code"] == 137
                and state["pre_crash"]["active_claims"] > 0
                and CRASH_MIN_COMPLETED
                <= state["pre_crash"]["completed_samples"]
                <= CRASH_MAX_COMPLETED
            ),
            "evidence": "metrics.json",
        },
        {
            "name": "P1-10-terminal-sample-conservation",
            "expected": {
                "run_status": "SUCCEEDED",
                "executions": EXPECTED_SAMPLES,
                "statuses": {"SUCCEEDED": EXPECTED_SAMPLES},
            },
            "actual": {
                "run_status": metrics["run_status"],
                "executions": metrics["execution_count"],
                "distinct_samples": metrics["distinct_sample_count"],
                "statuses": metrics["statuses"],
            },
            "passed": (
                metrics["run_status"] == "SUCCEEDED"
                and metrics["run_dataset_status"] == "SUCCEEDED"
                and metrics["completed_samples"] == EXPECTED_SAMPLES
                and metrics["execution_count"] == EXPECTED_SAMPLES
                and metrics["distinct_sample_count"] == EXPECTED_SAMPLES
                and metrics["statuses"] == {"SUCCEEDED": EXPECTED_SAMPLES}
            ),
            "evidence": "metrics.json",
        },
        {
            "name": "P1-10-unique-score-revision",
            "expected": {"score_count": EXPECTED_SAMPLES, "revisions": [1], "invalid": 0},
            "actual": {
                "score_count": metrics["score_count"],
                "revisions": metrics["score_revisions"],
                "invalid": metrics["invalid_score_rows"],
            },
            "passed": (
                metrics["score_count"] == EXPECTED_SAMPLES
                and metrics["score_revisions"] == [1]
                and metrics["invalid_score_rows"] == 0
            ),
            "evidence": "samples.jsonl",
        },
        {
            "name": "P1-10-claim-recovery",
            "expected": {"claims_before_crash": ">0", "claims_final": 0},
            "actual": {
                "claims_before_crash": state["pre_crash"]["active_claims"],
                "claims_after_kill": crash["database_snapshot"]["claimed_samples"],
                "claims_final": metrics["active_claims"],
            },
            "passed": (
                state["pre_crash"]["active_claims"] > 0
                and crash["database_snapshot"]["claimed_samples"] > 0
                and metrics["active_claims"] == 0
            ),
            "evidence": "metrics.json",
        },
        {
            "name": "P1-10-progress-monotonic",
            "expected": True,
            "actual": metrics["progress_monotonic"],
            "passed": metrics["progress_monotonic"],
            "evidence": "metrics.json",
        },
        {
            "name": "P1-10-final-metric",
            "expected": {"accuracy": 1.0, "attempts": EXPECTED_SAMPLES},
            "actual": {
                "accuracy": metrics["accuracy"],
                "attempts": metrics["attempt_count"],
            },
            "passed": (metrics["accuracy"] == 1.0 and metrics["attempt_count"] == EXPECTED_SAMPLES),
            "evidence": "metrics.json",
        },
    ]
    passed = all(item["passed"] for item in assertions)
    state["completed_at_utc"] = _utc_now()
    environment = {
        key: state[key]
        for key in (
            "git_sha",
            "migration_head",
            "dataset_checksum",
            "compose_config_sha256",
            "python",
            "platform",
            "postgresql",
            "redis",
            "celery",
            "setup_at_utc",
            "completed_at_utc",
        )
    }
    environment["worker"] = {
        "container_name": crash["container_name"],
        "container_id": crash["container_id"],
        "image_id": crash["image_id"],
        "signal": crash["signal"],
        "exit_code": crash["exit_code"],
    }
    _write_json(output / "environment.json", environment)
    _write_json(output / "metrics.json", {"crash": crash, "result": metrics})
    _write_json(output / "assertions.json", assertions)
    with (output / "samples.jsonl").open("w") as handle:
        for sample in samples:
            handle.write(json.dumps(sample, sort_keys=True) + "\n")
    (output / "report.md").write_text(
        "\n".join(
            [
                "# P1-10 Worker Crash Recovery Experiment",
                "",
                f"- Result: {'PASS' if passed else 'FAIL'}",
                f"- Worker exit: `{crash['exit_code']}` from `{crash['signal']}`",
                f"- Completed before crash: {state['pre_crash']['completed_samples']}",
                f"- Active claims before crash: {state['pre_crash']['active_claims']}",
                f"- Final status: `{metrics['run_status']}`",
                "- Final samples/scores/attempts: "
                f"{metrics['execution_count']}/{metrics['score_count']}/"
                f"{metrics['attempt_count']}",
                "- Duplicate HTTP requests caused by at-least-once recovery: "
                f"{metrics['duplicate_http_requests_after_crash']}",
                f"- Progress monotonic: {metrics['progress_monotonic']}",
                f"- Accuracy: {metrics['accuracy']}",
            ]
        )
        + "\n"
    )
    _write_json(STATE_PATH, state)
    engine.dispose()
    print(state["output_dir"])
    if not passed:
        raise AssertionError(f"P1-10 failed; evidence: {output}")


def cleanup() -> None:
    try:
        _drop_database()
    finally:
        redis_client = redis.Redis.from_url(_redis_url(), decode_responses=True)
        redis_client.flushdb()
        redis_client.close()
        with suppress(httpx.HTTPError):
            httpx.post(_mock_control_url(_mock_base_url(), "reset"), timeout=10)
        STATE_PATH.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="P1-10 worker crash recovery controller")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("setup")
    subparsers.add_parser("dispatch")
    crash_parser = subparsers.add_parser("record-crash")
    crash_parser.add_argument("container_id")
    crash_parser.add_argument("image_id")
    crash_parser.add_argument("exit_code", type=int)
    subparsers.add_parser("verify")
    subparsers.add_parser("cleanup")
    args = parser.parse_args()
    if args.command == "setup":
        setup()
    elif args.command == "dispatch":
        dispatch()
    elif args.command == "record-crash":
        record_crash(args.container_id, args.image_id, args.exit_code)
    elif args.command == "verify":
        verify()
    else:
        cleanup()


if __name__ == "__main__":
    main()
