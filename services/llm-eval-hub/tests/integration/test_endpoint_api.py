from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from apps.api.app.core.settings import Settings, get_settings
from apps.api.app.db import get_db
from apps.api.app.db.models import Model, Run
from apps.api.app.main import app
from tests.integration.support import isolated_database, run_alembic

AUTH = {"x-api-key": "integration-key"}


@pytest.mark.integration
def test_endpoint_update_and_safe_delete(tmp_path: Path) -> None:
    server_url = os.getenv("EVALHUB_TEST_DATABASE_SERVER_URL")
    if not server_url:
        pytest.skip("EVALHUB_TEST_DATABASE_SERVER_URL is required")

    with isolated_database(server_url, "endpoint_api") as database_url:
        rendered_url = database_url.render_as_string(hide_password=False)
        run_alembic(rendered_url, "upgrade", "head")
        engine = create_engine(database_url, pool_pre_ping=True)
        session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        settings = Settings(
            app_env="test",
            database_url=rendered_url,
            artifact_root=tmp_path / "artifacts",
            admin_api_key=AUTH["x-api-key"],
            allowed_endpoint_hosts=["mock-openai"],
            allowed_endpoint_cidrs=["172.16.0.0/12"],
            allow_insecure_http=True,
        )

        def override_db():
            with session_factory() as db:
                yield db

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_settings] = lambda: settings
        try:
            with TestClient(app) as client:
                created = client.post(
                    "/api/v1/endpoints",
                    headers=AUTH,
                    json={
                        "name": "Disposable Endpoint",
                        "base_url": "http://mock-openai:8001/v1",
                        "model_name": "disposable-model",
                        "auth_type": "bearer",
                        "api_key": "original-secret",
                        "concurrency_limit": 2,
                        "qps_limit": 3,
                    },
                )
                assert created.status_code == 201
                endpoint_id = created.json()["id"]
                original_revision_id = created.json()["active_revision_id"]
                assert created.json()["concurrency_limit"] == 2
                assert created.json()["qps_limit"] == 3

                updated = client.patch(
                    f"/api/v1/endpoints/{endpoint_id}",
                    headers=AUTH,
                    json={
                        "name": "Updated Disposable Endpoint",
                        "concurrency_limit": 4,
                        "qps_limit": 5.5,
                    },
                )
                assert updated.status_code == 200
                assert updated.json()["name"] == "Updated Disposable Endpoint"
                assert updated.json()["concurrency_limit"] == 4
                assert updated.json()["qps_limit"] == 5.5
                assert updated.json()["active_revision_id"] != original_revision_id
                assert updated.json()["secret_hint"] == "cret"

                deleted = client.delete(f"/api/v1/endpoints/{endpoint_id}", headers=AUTH)
                assert deleted.status_code == 204
                missing = client.get(f"/api/v1/endpoints/{endpoint_id}", headers=AUTH)
                assert missing.status_code == 404

                referenced = client.post(
                    "/api/v1/endpoints",
                    headers=AUTH,
                    json={
                        "name": "Referenced Endpoint",
                        "base_url": "http://mock-openai:8001/v1",
                        "model_name": "referenced-model",
                        "auth_type": "none",
                    },
                )
                assert referenced.status_code == 201
                referenced_id = referenced.json()["id"]
                with session_factory() as db:
                    model_id = db.scalar(
                        select(Model.id).where(Model.endpoint_id == referenced_id)
                    )
                    assert model_id is not None
                    db.add(
                        Run(
                            name="Historical Run",
                            status="SUCCEEDED",
                            created_by="integration-test",
                            model_id=model_id,
                            endpoint_revision_id=referenced.json()["active_revision_id"],
                            run_spec_json={},
                            protocol_fingerprint="integration-test",
                        )
                    )
                    db.commit()

                blocked = client.delete(
                    f"/api/v1/endpoints/{referenced_id}", headers=AUTH
                )
                assert blocked.status_code == 409
                assert blocked.json()["detail"]["code"] == "ENDPOINT_IN_USE"
                assert client.get(
                    f"/api/v1/endpoints/{referenced_id}", headers=AUTH
                ).status_code == 200
        finally:
            app.dependency_overrides.clear()
            engine.dispose()
