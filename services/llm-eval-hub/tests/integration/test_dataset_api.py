from __future__ import annotations

import hashlib
import json
import os
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from apps.api.app.core.settings import Settings, get_settings
from apps.api.app.db import get_db
from apps.api.app.db.models import DatasetVersion
from apps.api.app.main import app
from tests.integration.support import isolated_database, run_alembic

PROJECT_ROOT = Path(__file__).parents[2]
GOLDEN_ROOT = PROJECT_ROOT / "datasets" / "experiments" / "mvp-golden-v1"
AUTH = {"x-api-key": "integration-key"}


def _source() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    manifest = yaml.safe_load((GOLDEN_ROOT / "manifest.yaml").read_text())
    data_lines = (GOLDEN_ROOT / "data" / "test.jsonl").read_text().splitlines()
    rows = [json.loads(line) for line in data_lines]
    return manifest, rows


def _upload_files(
    manifest: dict[str, Any], rows: list[dict[str, Any]] | None = None, data: bytes | None = None
) -> dict[str, tuple[str, bytes, str]]:
    if data is None:
        assert rows is not None
        data = "".join(
            f"{json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(',', ':'))}\n"
            for row in rows
        ).encode()
    payload = deepcopy(manifest)
    payload["data"]["checksum_sha256"] = hashlib.sha256(data).hexdigest()
    return {
        "manifest_file": (
            "manifest.yaml",
            yaml.safe_dump(payload, allow_unicode=True, sort_keys=False).encode(),
            "application/yaml",
        ),
        "data_file": ("test.jsonl", data, "application/x-ndjson"),
    }


def _assert_error(response: Any, status_code: int, code: str) -> None:
    assert response.status_code == status_code
    assert response.json()["detail"]["code"] == code


@pytest.mark.integration
def test_dataset_upload_validation_and_version_immutability(
    tmp_path: Path,
) -> None:
    server_url = os.getenv("EVALHUB_TEST_DATABASE_SERVER_URL")
    if not server_url:
        pytest.skip("EVALHUB_TEST_DATABASE_SERVER_URL is required")

    with isolated_database(server_url, "dataset_api") as database_url:
        rendered_url = database_url.render_as_string(hide_password=False)
        run_alembic(rendered_url, "upgrade", "head")
        engine = create_engine(database_url, pool_pre_ping=True)
        session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        settings = Settings(
            app_env="test",
            database_url=rendered_url,
            artifact_root=tmp_path / "artifacts",
            admin_api_key=AUTH["x-api-key"],
        )

        def override_db():
            with session_factory() as db:
                yield db

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_settings] = lambda: settings
        try:
            with TestClient(app) as client:
                create_payload = {
                    "name": "mvp-golden-v1",
                    "display_name": "MVP Golden API",
                    "owner": "integration-test",
                }
                created = client.post("/api/v1/datasets", json=create_payload, headers=AUTH)
                assert created.status_code == 201
                dataset_id = created.json()["id"]

                duplicate = client.post("/api/v1/datasets", json=create_payload, headers=AUTH)
                _assert_error(duplicate, 409, "DATASET_NAME_EXISTS")

                manifest, rows = _source()
                validated = client.post(
                    "/api/v1/datasets/validate",
                    files=_upload_files(manifest, rows),
                    headers=AUTH,
                )
                assert validated.status_code == 200
                assert validated.json()["row_count"] == 100

                version_one = client.post(
                    f"/api/v1/datasets/{dataset_id}/versions",
                    files=_upload_files(manifest, rows),
                    headers=AUTH,
                )
                assert version_one.status_code == 201
                frozen_checksum = version_one.json()["checksum"]

                changed_rows = deepcopy(rows)
                changed_rows[0]["question"] += " changed"
                immutable = client.post(
                    f"/api/v1/datasets/{dataset_id}/versions",
                    files=_upload_files(manifest, changed_rows),
                    headers=AUTH,
                )
                _assert_error(immutable, 409, "DATASET_VERSION_IMMUTABLE")

                version_two_manifest = deepcopy(manifest)
                version_two_manifest["metadata"]["version"] = "1.0.1"
                version_two = client.post(
                    f"/api/v1/datasets/{dataset_id}/versions",
                    files=_upload_files(version_two_manifest, changed_rows),
                    headers=AUTH,
                )
                assert version_two.status_code == 201
                assert version_two.json()["version"] == "1.0.1"

                fetched = client.get(
                    f"/api/v1/datasets/{dataset_id}/versions/1.0.0", headers=AUTH
                )
                assert fetched.status_code == 200
                assert fetched.json()["checksum"] == frozen_checksum

                mismatch_manifest = deepcopy(version_two_manifest)
                mismatch_manifest["metadata"]["name"] = "different-dataset"
                mismatch_manifest["metadata"]["version"] = "2.0.0"
                mismatch = client.post(
                    f"/api/v1/datasets/{dataset_id}/versions",
                    files=_upload_files(mismatch_manifest, rows),
                    headers=AUTH,
                )
                _assert_error(mismatch, 422, "DATASET_NAME_MISMATCH")

                invalid_cases: list[tuple[dict[str, Any], bytes]] = []
                duplicate_rows = deepcopy(rows)
                duplicate_rows[1]["id"] = duplicate_rows[0]["id"]
                invalid_cases.append(
                    (
                        manifest,
                        _upload_files(manifest, duplicate_rows)["data_file"][1],
                    )
                )
                missing_rows = deepcopy(rows)
                del missing_rows[0]["question"]
                invalid_cases.append(
                    (manifest, _upload_files(manifest, missing_rows)["data_file"][1])
                )
                invalid_cases.append((manifest, b"not-json\n"))
                unsafe_path = deepcopy(manifest)
                unsafe_path["data"]["path"] = "../../outside.jsonl"
                invalid_cases.append((unsafe_path, _upload_files(manifest, rows)["data_file"][1]))
                unsafe_version = deepcopy(manifest)
                unsafe_version["metadata"]["version"] = "../../escape"
                invalid_cases.append(
                    (unsafe_version, _upload_files(manifest, rows)["data_file"][1])
                )

                for invalid_manifest, invalid_data in invalid_cases:
                    response = client.post(
                        "/api/v1/datasets/validate",
                        files=_upload_files(invalid_manifest, data=invalid_data),
                        headers=AUTH,
                    )
                    _assert_error(response, 422, "DATASET_INVALID")

                checksum_files = _upload_files(manifest, rows)
                checksum_manifest = yaml.safe_load(checksum_files["manifest_file"][1])
                checksum_manifest["data"]["checksum_sha256"] = "0" * 64
                checksum_files["manifest_file"] = (
                    "manifest.yaml",
                    yaml.safe_dump(checksum_manifest).encode(),
                    "application/yaml",
                )
                checksum_error = client.post(
                    "/api/v1/datasets/validate", files=checksum_files, headers=AUTH
                )
                _assert_error(checksum_error, 422, "DATASET_INVALID")

            with session_factory() as db:
                assert db.scalar(select(func.count(DatasetVersion.id))) == 2
            version_root = tmp_path / "artifacts" / "datasets" / dataset_id
            assert sorted(path.name for path in version_root.iterdir()) == ["1.0.0", "1.0.1"]
        finally:
            app.dependency_overrides.clear()
            engine.dispose()
