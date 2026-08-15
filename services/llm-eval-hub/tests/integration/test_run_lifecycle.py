from __future__ import annotations

import os
import time
import uuid
from pathlib import Path

import pytest
import redis
from celery.contrib.testing.worker import start_worker
from sqlalchemy import create_engine, distinct, func, select
from sqlalchemy.orm import sessionmaker

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
from packages.eval_engine.datasets import validate_dataset
from tests.integration.support import isolated_database, run_alembic
from workers.celery_app import celery_app
from workers.tasks import run_eval

PROJECT_ROOT = Path(__file__).parents[2]
GOLDEN_ROOT = PROJECT_ROOT / "datasets" / "experiments" / "mvp-golden-v1"


def _seed_run(session_factory: sessionmaker, mock_base_url: str) -> tuple[str, str]:
    validated = validate_dataset(GOLDEN_ROOT / "manifest.yaml")
    manifest = validated.manifest.model_dump(mode="json")
    with session_factory() as db:
        endpoint = Endpoint(
            name=f"lifecycle-{uuid.uuid4().hex}",
            base_url=mock_base_url,
            auth_type="none",
            status="healthy",
            owner="integration-test",
        )
        db.add(endpoint)
        db.flush()
        revision = EndpointRevision(
            endpoint_id=endpoint.id,
            config_json={
                "base_url": mock_base_url,
                "auth_type": "none",
                "extra_headers": {},
                "qps_limit": 1000,
            },
            config_hash="0" * 64,
        )
        db.add(revision)
        db.flush()
        endpoint.active_revision_id = revision.id
        model = Model(
            endpoint_id=endpoint.id,
            model_name="mock-intent-v1",
            display_name="Mock Intent",
            source="integration-test",
        )
        dataset = Dataset(
            name=f"golden-{uuid.uuid4().hex}",
            display_name="MVP Golden Integration",
            owner="integration-test",
        )
        db.add_all([model, dataset])
        db.flush()
        dataset_version = DatasetVersion(
            dataset_id=dataset.id,
            version="1.0.0",
            manifest_json=manifest,
            manifest_uri=str(GOLDEN_ROOT / "manifest.yaml"),
            data_uri=str(GOLDEN_ROOT / "data" / "test.jsonl"),
            checksum=validated.checksum_sha256,
            row_count=len(validated.samples),
        )
        db.add(dataset_version)
        db.flush()
        run = Run(
            name="MVP lifecycle integration",
            status="QUEUED",
            created_by="integration-test",
            model_id=model.id,
            endpoint_revision_id=revision.id,
            protocol_fingerprint="1" * 64,
            run_spec_json={
                "model_name": model.model_name,
                "inference": {
                    "temperature": 0,
                    "top_p": 1,
                    "max_tokens": 8,
                    "seed": 20260811,
                    "stop": [],
                },
                "execution": {
                    "concurrency": 8,
                    "effective_concurrency": 8,
                    "qps": 1000,
                    "timeout_seconds": 5,
                    "max_retries": 2,
                    "shard_size": 50,
                },
            },
        )
        db.add(run)
        db.flush()
        run_dataset = RunDataset(
            run_id=run.id,
            dataset_version_id=dataset_version.id,
            protocol_id=manifest["protocol"]["id"],
            total_samples=len(validated.samples),
        )
        db.add(run_dataset)
        db.commit()
        return run.id, run_dataset.id


@pytest.mark.integration
def test_celery_run_lifecycle_is_complete_and_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    server_url = os.getenv("EVALHUB_TEST_DATABASE_SERVER_URL")
    redis_url = os.getenv("EVALHUB_TEST_REDIS_URL")
    mock_base_url = os.getenv("EVALHUB_TEST_MOCK_BASE_URL")
    if not server_url or not redis_url or not mock_base_url:
        pytest.skip("PostgreSQL, Redis, and mock service integration URLs are required")

    redis_client = redis.Redis.from_url(redis_url, decode_responses=True)
    assert redis_client.ping() is True
    redis_client.flushdb()

    with isolated_database(server_url, "lifecycle") as database_url:
        run_alembic(database_url.render_as_string(hide_password=False), "upgrade", "head")
        engine = create_engine(database_url, pool_pre_ping=True)
        session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        monkeypatch.setattr(run_eval, "SessionLocal", session_factory)
        run_id, run_dataset_id = _seed_run(session_factory, mock_base_url)

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
            concurrency=1,
            pool="solo",
            queues=("native",),
            perform_ping_check=False,
            loglevel="WARNING",
        ):
            first = run_eval.execute_run.apply_async(args=[run_id], queue="native")
            assert first.get(timeout=15, disable_sync_subtasks=False) == {"shards": 2}
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                with session_factory() as db:
                    if db.get(Run, run_id).status == "SUCCEEDED":
                        break
                time.sleep(0.1)
            else:
                pytest.fail("sharded run did not reach SUCCEEDED")
            second = run_eval.execute_run.apply_async(args=[run_id], queue="native")
            assert second.get(timeout=15, disable_sync_subtasks=False) == {"shards": 0}

        with session_factory() as db:
            run = db.get(Run, run_id)
            run_dataset = db.get(RunDataset, run_dataset_id)
            assert run is not None and run.status == "SUCCEEDED"
            assert run_dataset is not None and run_dataset.status == "SUCCEEDED"
            assert run_dataset.total_samples == 100
            assert run_dataset.completed_samples == 100
            assert run_dataset.counters_json == {
                "total_samples": 100,
                "scored_samples": 100,
                "api_errors": 0,
                "parse_errors": 0,
                "score_errors": 0,
            }
            assert db.scalar(select(func.count(SampleExecution.id))) == 100
            assert db.scalar(select(func.count(distinct(SampleExecution.sample_id)))) == 100
            assert db.scalar(select(func.count(RequestAttempt.id))) == 100
            assert db.scalar(select(func.count(SampleScore.id))) == 100
            accuracy = db.scalar(
                select(RunMetric.value).where(
                    RunMetric.run_dataset_id == run_dataset_id,
                    RunMetric.metric_name == "accuracy",
                    RunMetric.group_key.is_(None),
                )
            )
            assert accuracy == 1.0
        engine.dispose()

    redis_client.flushdb()
    redis_client.close()
