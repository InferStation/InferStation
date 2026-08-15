from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import platform
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import redis
import sqlalchemy
from sqlalchemy import MetaData, Table, create_engine, inspect, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from apps.api.app.core.crypto import SecretCipher
from apps.api.app.core.settings import Settings
from apps.api.app.db.models import Dataset, DatasetVersion, EndpointRevision, Model
from packages.eval_engine.datasets import validate_dataset

PROJECT_ROOT = Path(__file__).parents[2]
ARTIFACT_ROOT = PROJECT_ROOT / "artifacts" / "experiments"
GOLDEN_ROOT = PROJECT_ROOT / "datasets" / "experiments" / "mvp-golden-v1"
STATE_PATH = ARTIFACT_ROOT / ".p1-13-security-state.json"


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _canary() -> str:
    value = os.environ.get("EVALHUB_SECRET_CANARY", "")
    if len(value) < 24:
        raise RuntimeError("EVALHUB_SECRET_CANARY must contain at least 24 characters")
    return value


def _output_from_state() -> Path:
    if not STATE_PATH.exists():
        raise RuntimeError("P1-13 state does not exist; run exercise first")
    state = _read_json(STATE_PATH)
    return PROJECT_ROOT / state["output_dir"]


def _api_client() -> httpx.Client:
    return httpx.Client(
        base_url=os.environ["EVALHUB_SECURITY_API_URL"],
        headers={"X-API-Key": os.environ["ADMIN_API_KEY"]},
        timeout=30,
    )


def _response_code(response: httpx.Response) -> str | None:
    try:
        body = response.json()
    except ValueError:
        return None
    detail = body.get("detail", {}) if isinstance(body, dict) else {}
    return detail.get("code") if isinstance(detail, dict) else None


def _safe_response_scan(name: str, response: httpx.Response, canary: str) -> dict[str, Any]:
    body = response.content
    return {
        "name": name,
        "status_code": response.status_code,
        "response_bytes": len(body),
        "full_secret_hits": body.count(canary.encode("utf-8")),
    }


def _database_scan(canary: str) -> dict[str, Any]:
    engine = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True, poolclass=NullPool)
    inspector = inspect(engine)
    metadata = MetaData()
    hits = 0
    row_counts: dict[str, int] = {}
    with engine.connect() as connection:
        for table_name in sorted(inspector.get_table_names(schema="public")):
            table = Table(table_name, metadata, schema="public", autoload_with=engine)
            rows = list(connection.execute(select(table)))
            row_counts[table_name] = len(rows)
            for row in rows:
                serialized = json.dumps(
                    dict(row._mapping),
                    default=str,
                    ensure_ascii=False,
                    sort_keys=True,
                )
                hits += serialized.count(canary)
    engine.dispose()
    return {
        "captured_at_utc": _utc_now(),
        "full_secret_hits": hits,
        "table_count": len(row_counts),
        "row_counts": row_counts,
    }


def _decode_celery_messages(client: redis.Redis, canary: str) -> dict[str, Any]:
    messages = client.lrange("native", 0, -1)
    summaries: list[dict[str, Any]] = []
    secret_hits = 0
    for raw_message in messages:
        secret_hits += raw_message.count(canary.encode("utf-8"))
        message = json.loads(raw_message)
        encoded_body = message.get("body", "")
        body = base64.b64decode(encoded_body)
        secret_hits += body.count(canary.encode("utf-8"))
        decoded_body = json.loads(body)
        if secret_hits:
            decoded_body = json.loads(json.dumps(decoded_body).replace(canary, "[REDACTED]"))
        summaries.append(
            {
                "task": message.get("headers", {}).get("task"),
                "task_id": message.get("headers", {}).get("id"),
                "decoded_body": decoded_body,
            }
        )
    return {
        "queue": "native",
        "message_count": len(messages),
        "full_secret_hits": secret_hits,
        "messages": summaries,
    }


def _redis_scan(canary: str) -> tuple[dict[str, Any], dict[str, Any]]:
    client = redis.Redis.from_url(os.environ["REDIS_URL"], decode_responses=False)
    keys: list[dict[str, Any]] = []
    hits = 0
    for key in sorted(client.scan_iter(), key=lambda item: item.decode("utf-8", errors="replace")):
        dumped = client.dump(key) or b""
        hits += dumped.count(canary.encode("utf-8"))
        keys.append(
            {
                "key": key.decode("utf-8", errors="replace"),
                "type": client.type(key).decode("ascii"),
                "serialized_bytes": len(dumped),
            }
        )
    celery_summary = _decode_celery_messages(client, canary)
    client.close()
    return (
        {
            "captured_at_utc": _utc_now(),
            "full_secret_hits": hits,
            "key_count": len(keys),
            "keys": keys,
        },
        celery_summary,
    )


def _seed_dataset() -> str:
    validated = validate_dataset(GOLDEN_ROOT / "manifest.yaml")
    engine = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)
    with Session(engine) as session:
        dataset = Dataset(
            name="p1-13-security-golden",
            display_name="P1-13 Security Golden",
            owner="security-experiment",
            description="Isolated P1-13 credential-flow experiment",
        )
        session.add(dataset)
        session.flush()
        version = DatasetVersion(
            dataset_id=dataset.id,
            version="1.0.0",
            manifest_json=validated.manifest.model_dump(mode="json"),
            manifest_uri=str(GOLDEN_ROOT / "manifest.yaml"),
            data_uri=str(GOLDEN_ROOT / "data" / "test.jsonl"),
            checksum=validated.checksum_sha256,
            row_count=len(validated.samples),
        )
        session.add(version)
        session.commit()
        version_id = version.id
    engine.dispose()
    return version_id


def _storage_evidence(endpoint_id: str, canary: str) -> dict[str, Any]:
    engine = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)
    with Session(engine) as session:
        revision = session.scalar(
            select(EndpointRevision).where(EndpointRevision.endpoint_id == endpoint_id)
        )
    if revision is None:
        raise RuntimeError("P1-13 endpoint revision was not persisted")
    ciphertext = revision.secret_ciphertext or ""
    decrypted = SecretCipher().decrypt(revision.secret_ciphertext)
    config_serialized = json.dumps(revision.config_json, sort_keys=True)
    result = {
        "ciphertext_present": bool(ciphertext),
        "ciphertext_differs_from_plaintext": ciphertext != canary,
        "ciphertext_contains_full_secret": canary in ciphertext,
        "config_contains_full_secret": canary in config_serialized,
        "decrypt_matches_input": decrypted == canary,
        "secret_hint_length": len(revision.secret_hint or ""),
        "secret_hint_matches_suffix": revision.secret_hint == canary[-4:],
    }
    engine.dispose()
    return result


def _model_id(endpoint_id: str) -> str:
    engine = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)
    with engine.connect() as connection:
        model_id = connection.scalar(
            select(Model.id).where(
                Model.endpoint_id == endpoint_id,
                Model.model_name == "mock-intent-v1",
            )
        )
    engine.dispose()
    if model_id is None:
        raise RuntimeError("P1-13 model was not registered")
    return model_id


def exercise() -> None:
    canary = _canary()
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    output = ARTIFACT_ROOT / f"P1-13-secret-ssrf-{timestamp}"
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    (output / "service-logs-redacted").mkdir()

    ssrf_cases = [
        ("loopback", "http://127.0.0.1:8000/v1"),
        ("cloud-metadata", "http://169.254.169.254/latest/meta-data"),
        ("alternate-metadata", "http://100.100.100.200/latest/meta-data"),
        ("unauthorized-domain", "https://unauthorized.p1-13.invalid/v1"),
        ("allowlisted-dns-rebind", "http://rebind.p1-13.invalid:8000/v1"),
        ("embedded-credentials", "http://user:password@security-mock-openai:8001/v1"),
        ("invalid-scheme", "file:///etc/passwd"),
    ]
    ssrf_results: list[dict[str, Any]] = []
    sensitive_results: list[dict[str, Any]] = []
    response_scans: list[dict[str, Any]] = []

    with _api_client() as client:
        for index, (name, url) in enumerate(ssrf_cases):
            response = client.post(
                "/api/v1/endpoints",
                json={
                    "name": f"P1-13 SSRF {index}",
                    "base_url": url,
                    "model_name": "mock-intent-v1",
                    "auth_type": "none",
                },
            )
            response_scans.append(_safe_response_scan(f"ssrf:{name}", response, canary))
            ssrf_results.append(
                {
                    "case": name,
                    "status_code": response.status_code,
                    "error_code": _response_code(response),
                }
            )

        for index, header_name in enumerate(("Authorization", "X-API-Key", "Cookie")):
            response = client.post(
                "/api/v1/endpoints",
                json={
                    "name": f"P1-13 Header {index}",
                    "base_url": "http://security-mock-openai:8001/v1",
                    "model_name": "mock-intent-v1",
                    "auth_type": "none",
                    "extra_headers": {header_name: canary},
                },
            )
            response_scans.append(
                _safe_response_scan(f"sensitive-header:{header_name}", response, canary)
            )
            sensitive_results.append(
                {
                    "header": header_name,
                    "status_code": response.status_code,
                    "error_code": _response_code(response),
                }
            )

        create_response = client.post(
            "/api/v1/endpoints",
            json={
                "name": "P1-13 Encrypted Endpoint",
                "base_url": "http://security-mock-openai:8001/v1",
                "model_name": "mock-intent-v1",
                "auth_type": "bearer",
                "api_key": canary,
                "extra_headers": {"X-Tenant-ID": "security-experiment"},
                "concurrency_limit": 4,
                "qps_limit": 100,
            },
        )
        response_scans.append(_safe_response_scan("endpoint:create", create_response, canary))
        create_response.raise_for_status()
        endpoint = create_response.json()
        endpoint_id = endpoint["id"]

        probe_response = client.post(f"/api/v1/endpoints/{endpoint_id}/probe", json={})
        response_scans.append(_safe_response_scan("endpoint:probe", probe_response, canary))
        probe_response.raise_for_status()
        if probe_response.json()["status"] != "healthy":
            raise RuntimeError("P1-13 endpoint probe did not become healthy")

        for name, path in (
            ("endpoint:list", "/api/v1/endpoints"),
            ("endpoint:get", f"/api/v1/endpoints/{endpoint_id}"),
            ("endpoint:models", f"/api/v1/endpoints/{endpoint_id}/models"),
        ):
            response = client.get(path)
            response_scans.append(_safe_response_scan(name, response, canary))
            response.raise_for_status()

        dataset_version_id = _seed_dataset()
        run_response = client.post(
            "/api/v1/runs",
            json={
                "name": "P1-13 Secret Flow",
                "endpoint_id": endpoint_id,
                "model_id": _model_id(endpoint_id),
                "datasets": [{"dataset_version_id": dataset_version_id}],
                "inference": {
                    "temperature": 0,
                    "top_p": 1,
                    "max_tokens": 8,
                    "seed": 20260811,
                    "stop": [],
                },
                "execution": {
                    "concurrency": 4,
                    "qps": 100,
                    "timeout_seconds": 5,
                    "max_retries": 0,
                    "shard_size": 50,
                },
            },
        )
        response_scans.append(_safe_response_scan("run:create", run_response, canary))
        run_response.raise_for_status()
        run_id = run_response.json()["id"]

    deadline = time.monotonic() + 10
    redis_before: dict[str, Any] | None = None
    celery_payload: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        redis_before, celery_payload = _redis_scan(canary)
        if celery_payload["message_count"] >= 1:
            break
        time.sleep(0.1)
    if redis_before is None or celery_payload is None or celery_payload["message_count"] < 1:
        raise RuntimeError("P1-13 did not observe the queued Celery message")

    explicit_key_required = False
    try:
        _ = Settings(app_env="production", secret_encryption_key="").fernet_key
    except RuntimeError:
        explicit_key_required = True

    storage = _storage_evidence(endpoint_id, canary)
    database_before = _database_scan(canary)
    _write_json(output / "ssrf-matrix.json", ssrf_results)
    _write_json(output / "sensitive-header-matrix.json", sensitive_results)
    _write_json(output / "api-response-scan-before.json", response_scans)
    _write_json(output / "secret-storage.json", storage)
    _write_json(output / "database-scan-before.json", database_before)
    _write_json(output / "redis-scan-before.json", redis_before)
    _write_json(output / "celery-payload-summary.json", celery_payload)
    _write_json(
        output / "environment.json",
        {
            "captured_at_utc": _utc_now(),
            "git_sha": os.environ.get("EVALHUB_GIT_SHA", "working-tree"),
            "compose_config_sha256": os.environ.get(
                "EVALHUB_COMPOSE_CONFIG_SHA256", "working-tree"
            ),
            "python": platform.python_version(),
            "sqlalchemy": sqlalchemy.__version__,
            "httpx": httpx.__version__,
            "canary_sha256": hashlib.sha256(canary.encode("utf-8")).hexdigest(),
            "production_requires_explicit_encryption_key": explicit_key_required,
        },
    )
    _write_json(
        output / "run-ids.json",
        {
            "endpoint_id": endpoint_id,
            "dataset_version_id": dataset_version_id,
            "run_id": run_id,
        },
    )
    _write_json(
        STATE_PATH,
        {
            "output_dir": str(output.relative_to(PROJECT_ROOT)),
            "run_id": run_id,
            "started_at_utc": _utc_now(),
        },
    )
    print(output.relative_to(PROJECT_ROOT))


def verify_run() -> None:
    canary = _canary()
    output = _output_from_state()
    state = _read_json(STATE_PATH)
    run_id = state["run_id"]
    response_scans: list[dict[str, Any]] = []

    with _api_client() as client:
        deadline = time.monotonic() + 120
        final_run: dict[str, Any] | None = None
        while time.monotonic() < deadline:
            response = client.get(f"/api/v1/runs/{run_id}")
            response_scans.append(_safe_response_scan("run:poll", response, canary))
            response.raise_for_status()
            final_run = response.json()
            if final_run["status"] in {"SUCCEEDED", "FAILED", "CANCELLED"}:
                break
            time.sleep(0.25)
        if final_run is None or final_run["status"] != "SUCCEEDED":
            raise RuntimeError(f"P1-13 run did not succeed: {final_run}")

        surface_paths = (
            ("endpoint:list", "/api/v1/endpoints"),
            ("run:list", "/api/v1/runs"),
            ("run:get", f"/api/v1/runs/{run_id}"),
            ("run:metrics", f"/api/v1/runs/{run_id}/metrics"),
            ("run:samples", f"/api/v1/runs/{run_id}/samples?limit=200"),
            ("run:jsonl", f"/api/v1/runs/{run_id}/export?format=jsonl"),
            ("run:csv", f"/api/v1/runs/{run_id}/export?format=csv"),
        )
        responses: dict[str, httpx.Response] = {}
        for name, path in surface_paths:
            response = client.get(path)
            response_scans.append(_safe_response_scan(name, response, canary))
            response.raise_for_status()
            responses[name] = response

    metrics = responses["run:metrics"].json()
    primary = metrics["datasets"][0]["metrics"]
    mock_state = httpx.get(
        f"{os.environ['EVALHUB_SECURITY_MOCK_URL']}/__control/state", timeout=30
    ).json()
    expected_auth_hash = hashlib.sha256(f"Bearer {canary}".encode()).hexdigest()
    auth_hashes = [item.get("authorization_sha256") for item in mock_state["requests"]]
    mock_auth = {
        "request_count": len(auth_hashes),
        "all_requests_authenticated_with_canary_hash": bool(auth_hashes)
        and all(value == expected_auth_hash for value in auth_hashes),
        "distinct_authorization_hashes": len(set(auth_hashes)),
    }

    database_after = _database_scan(canary)
    redis_after, _ = _redis_scan(canary)
    _write_json(output / "api-response-scan-after.json", response_scans)
    _write_json(output / "database-scan-after.json", database_after)
    _write_json(output / "redis-scan-after.json", redis_after)
    _write_json(output / "mock-auth-evidence.json", mock_auth)
    _write_json(
        output / "run-result.json",
        {
            "run_id": run_id,
            "status": final_run["status"],
            "total_samples": final_run["datasets"][0]["total_samples"],
            "completed_samples": final_run["datasets"][0]["completed_samples"],
            "accuracy": primary.get("accuracy"),
            "api_errors": primary.get("api_errors"),
            "parse_errors": primary.get("parse_errors"),
        },
    )


def _assertion(
    name: str,
    expected: Any,
    actual: Any,
    passed: bool,
    evidence: str,
) -> dict[str, Any]:
    return {
        "name": name,
        "expected": expected,
        "actual": actual,
        "passed": passed,
        "evidence": evidence,
    }


def finalize() -> None:
    canary = _canary()
    output = _output_from_state()
    ssrf = _read_json(output / "ssrf-matrix.json")
    headers = _read_json(output / "sensitive-header-matrix.json")
    storage = _read_json(output / "secret-storage.json")
    api_before = _read_json(output / "api-response-scan-before.json")
    api_after = _read_json(output / "api-response-scan-after.json")
    database_before = _read_json(output / "database-scan-before.json")
    database_after = _read_json(output / "database-scan-after.json")
    redis_before = _read_json(output / "redis-scan-before.json")
    redis_after = _read_json(output / "redis-scan-after.json")
    celery_payload = _read_json(output / "celery-payload-summary.json")
    log_scan = _read_json(output / "service-log-scan.json")
    containers = _read_json(output / "containers.json")
    run_result = _read_json(output / "run-result.json")
    mock_auth = _read_json(output / "mock-auth-evidence.json")
    environment = _read_json(output / "environment.json")

    ssrf_actual = {item["case"]: [item["status_code"], item["error_code"]] for item in ssrf}
    header_actual = {
        item["header"]: [item["status_code"], item["error_code"]] for item in headers
    }
    api_hits = sum(item["full_secret_hits"] for item in [*api_before, *api_after])
    storage_passed = (
        storage["ciphertext_present"]
        and storage["ciphertext_differs_from_plaintext"]
        and not storage["ciphertext_contains_full_secret"]
        and not storage["config_contains_full_secret"]
        and storage["decrypt_matches_input"]
        and storage["secret_hint_length"] == 4
        and storage["secret_hint_matches_suffix"]
    )
    expected_user = "evalhub"
    containers_passed = all(
        item["user"] == expected_user
        and item["devices"] in (None, [])
        and item["device_requests"] in (None, [])
        and all(value == "2,3" for value in item["gpu_boundary"].values())
        for item in containers
    )

    artifact_hits = 0
    for path in output.rglob("*"):
        if path.is_file():
            artifact_hits += path.read_bytes().count(canary.encode("utf-8"))

    assertions = [
        _assertion(
            "SSRF refusal matrix",
            "all cases return 422 ENDPOINT_POLICY",
            ssrf_actual,
            bool(ssrf) and all(value == [422, "ENDPOINT_POLICY"] for value in ssrf_actual.values()),
            "ssrf-matrix.json",
        ),
        _assertion(
            "Sensitive extra headers rejected",
            "Authorization/X-API-Key/Cookie return 422 ENDPOINT_POLICY",
            header_actual,
            bool(headers)
            and all(value == [422, "ENDPOINT_POLICY"] for value in header_actual.values()),
            "sensitive-header-matrix.json",
        ),
        _assertion(
            "Endpoint secret encrypted at rest",
            "ciphertext only; decryptable; four-character hint",
            storage,
            storage_passed,
            "secret-storage.json",
        ),
        _assertion(
            "API responses contain no full secret",
            0,
            api_hits,
            api_hits == 0,
            "api-response-scan-before.json, api-response-scan-after.json",
        ),
        _assertion(
            "Database contains no full plaintext secret",
            [0, 0],
            [database_before["full_secret_hits"], database_after["full_secret_hits"]],
            database_before["full_secret_hits"] == database_after["full_secret_hits"] == 0,
            "database-scan-before.json, database-scan-after.json",
        ),
        _assertion(
            "Celery payload is identifier-only and secret-free",
            "at least one task; 0 full-secret hits",
            {
                "message_count": celery_payload["message_count"],
                "full_secret_hits": celery_payload["full_secret_hits"],
                "tasks": [item["task"] for item in celery_payload["messages"]],
            },
            celery_payload["message_count"] >= 1
            and celery_payload["full_secret_hits"] == 0
            and all(
                item["task"] == "workers.tasks.run_eval.execute_run"
                for item in celery_payload["messages"]
            ),
            "celery-payload-summary.json",
        ),
        _assertion(
            "Redis broker/backend contain no full secret",
            [0, 0],
            [redis_before["full_secret_hits"], redis_after["full_secret_hits"]],
            redis_before["full_secret_hits"] == redis_after["full_secret_hits"] == 0,
            "redis-scan-before.json, redis-scan-after.json",
        ),
        _assertion(
            "Service logs contain no full secret",
            0,
            log_scan["full_secret_hits"],
            log_scan["full_secret_hits"] == 0,
            "service-log-scan.json, service-logs-redacted/services.log",
        ),
        _assertion(
            "Worker used the encrypted credential",
            "all mock request auth hashes match the canary-derived hash",
            mock_auth,
            mock_auth["all_requests_authenticated_with_canary_hash"],
            "mock-auth-evidence.json",
        ),
        _assertion(
            "Secret-bearing run completed correctly",
            {"status": "SUCCEEDED", "samples": 100, "accuracy": 1.0},
            run_result,
            run_result["status"] == "SUCCEEDED"
            and run_result["total_samples"] == 100
            and run_result["completed_samples"] == 100
            and run_result["accuracy"] == 1.0
            and run_result["api_errors"] == 0,
            "run-result.json",
        ),
        _assertion(
            "Security services are non-root and have no GPU mapping",
            "user=evalhub, devices=[], GPU boundary=2,3",
            containers,
            containers_passed,
            "containers.json",
        ),
        _assertion(
            "Production requires an explicit encryption key",
            True,
            environment["production_requires_explicit_encryption_key"],
            environment["production_requires_explicit_encryption_key"] is True,
            "environment.json",
        ),
        _assertion(
            "Evidence directory contains no full secret",
            0,
            artifact_hits,
            artifact_hits == 0,
            "artifact recursive scan before report generation",
        ),
    ]
    _write_json(output / "assertions.json", assertions)
    passed = all(item["passed"] for item in assertions)
    report_lines = [
        "# P1-13 Secret / SSRF Security Report",
        "",
        f"- Status: **{'PASS' if passed else 'FAIL'}**",
        f"- Completed at (UTC): `{_utc_now()}`",
        f"- Git SHA: `{environment['git_sha']}`",
        f"- Canary SHA-256: `{environment['canary_sha256']}` (plaintext not retained)",
        "- Scope: endpoint credential storage/use, API/DB/Redis/Celery/log surfaces, "
        "SSRF refusal matrix, non-root and GPU boundary",
        "",
        "| Assertion | Result |",
        "|---|---|",
        *[
            f"| {item['name']} | {'PASS' if item['passed'] else 'FAIL'} |"
            for item in assertions
        ],
        "",
        "The experiment used an isolated PostgreSQL database and Redis DB 12. "
        "It did not call any user-configured or external model endpoint.",
        "",
        "Known boundary: application checks resolve and validate every endpoint again before "
        "worker traffic, and redirects are disabled. A network-layer egress firewall remains a "
        "production deployment control rather than an application feature.",
        "",
    ]
    (output / "report.md").write_text("\n".join(report_lines), encoding="utf-8")
    STATE_PATH.unlink(missing_ok=True)
    if not passed:
        failed = [item["name"] for item in assertions if not item["passed"]]
        raise SystemExit(f"P1-13 failed assertions: {failed}")
    print(output.relative_to(PROJECT_ROOT))


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the isolated P1-13 security experiment")
    parser.add_argument("command", choices=("exercise", "verify-run", "finalize"))
    args = parser.parse_args()
    if args.command == "exercise":
        exercise()
    elif args.command == "verify-run":
        verify_run()
    else:
        finalize()


if __name__ == "__main__":
    main()
