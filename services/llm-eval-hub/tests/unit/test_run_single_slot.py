from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from apps.api.app.api.v1.runs import create_run, list_runs
from apps.api.app.core.auth import Actor
from apps.api.app.core.settings import Settings
from apps.api.app.db.models import (
    Base,
    Dataset,
    DatasetVersion,
    Endpoint,
    EndpointRevision,
    Model,
)
from apps.api.app.schemas.runs import RunCreate


def _seed_resources(db: Session) -> RunCreate:
    endpoint = Endpoint(
        name="single-slot-endpoint",
        base_url="http://model.test/v1",
        auth_type="none",
        status="healthy",
        owner="test",
    )
    db.add(endpoint)
    db.flush()
    revision = EndpointRevision(
        endpoint_id=endpoint.id,
        config_json={"concurrency_limit": 1, "qps_limit": 1},
        config_hash="0" * 64,
    )
    db.add(revision)
    db.flush()
    endpoint.active_revision_id = revision.id
    model = Model(
        endpoint_id=endpoint.id,
        model_name="model-test",
        display_name="Model Test",
        source="test",
    )
    dataset = Dataset(
        name="smoke-test",
        display_name="Smoke Test",
        owner="test",
    )
    db.add_all([model, dataset])
    db.flush()
    version = DatasetVersion(
        dataset_id=dataset.id,
        version="smoke-v1",
        manifest_json={
            "metadata": {"name": dataset.name},
            "protocol": {
                "id": "smoke-choice-v1",
                "task_type": "multiple_choice_generation",
                "scorer": {"primary_metric": "accuracy"},
            },
        },
        manifest_uri="/tmp/manifest.yaml",
        data_uri="/tmp/data.jsonl",
        checksum="1" * 64,
        row_count=10,
    )
    db.add(version)
    db.commit()
    return RunCreate(
        name="single-slot-smoke",
        endpoint_id=endpoint.id,
        model_id=model.id,
        datasets=[{"dataset_version_id": version.id}],
        execution={
            "concurrency": 1,
            "qps": 1,
            "timeout_seconds": 180,
            "max_retries": 1,
            "shard_size": 50,
        },
    )


def test_create_run_enforces_one_active_slot_and_keeps_idempotency() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    settings = Settings(app_env="test", database_url="sqlite+pysqlite:///:memory:")
    actor = Actor(username="test-operator", role="admin")

    with Session(engine, expire_on_commit=False) as db:
        payload = _seed_resources(db)
        first = create_run(payload, actor, db, settings, "request-1")

        replay = create_run(payload, actor, db, settings, "request-1")
        assert replay.id == first.id

        with pytest.raises(HTTPException) as caught:
            create_run(payload, actor, db, settings, "request-2")
        assert caught.value.status_code == 409
        assert caught.value.detail == {
            "code": "ACTIVE_RUN_EXISTS",
            "message": "Another evaluation is already queued or running",
            "run_id": first.id,
            "status": "QUEUED",
        }

        active = list_runs(run_status=None, active_only=True, limit=10, _=actor, db=db)
        assert [run.id for run in active] == [first.id]

        first.status = "SUCCEEDED"
        db.commit()
        second = create_run(payload, actor, db, settings, "request-2")
        assert second.id != first.id

    engine.dispose()
