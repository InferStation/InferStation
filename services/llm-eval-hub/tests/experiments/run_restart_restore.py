from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
import platform
import stat
from datetime import UTC, date, datetime, time
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

import httpx
import sqlalchemy
from sqlalchemy import MetaData, Table, create_engine, inspect, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

PROJECT_ROOT = Path(__file__).parents[2]
ARTIFACT_ROOT = PROJECT_ROOT / "artifacts" / "experiments"
STATE_PATH = ARTIFACT_ROOT / ".p1-11-restart-restore-state.json"
EXPECTED_CONTAINERS = {
    "inferstation-evalhub-api",
    "inferstation-evalhub-mock-openai",
    "inferstation-evalhub-postgres",
    "inferstation-evalhub-redis",
    "inferstation-evalhub-web",
    "inferstation-evalhub-worker",
}
CRITICAL_TABLES = {
    "audit_logs",
    "run_metrics",
    "runs",
    "sample_executions",
}
GPU_ENV_KEYS = {
    "CUDA_VISIBLE_DEVICES",
    "GPU_DEVICE_ORDINAL",
    "HIP_VISIBLE_DEVICES",
    "ROCR_VISIBLE_DEVICES",
}


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)


def _read_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        raise RuntimeError("P1-11 state does not exist; run setup first")
    return json.loads(STATE_PATH.read_text())


def _output_path(state: dict[str, Any]) -> Path:
    return PROJECT_ROOT / state["output_dir"]


def _normalize(value: Any) -> Any:
    if value is None or isinstance(value, bool | int | str):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            return str(value)
        return value
    if isinstance(value, bytes):
        return {"__bytes_base64__": base64.b64encode(value).decode("ascii")}
    if isinstance(value, Decimal | UUID):
        return str(value)
    if isinstance(value, datetime | date | time):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _normalize(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_normalize(item) for item in value]
    return str(value)


def _canonical_json(value: Any) -> str:
    return json.dumps(_normalize(value), ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _schema_description(inspector: Any, table_name: str) -> dict[str, Any]:
    return {
        "columns": [
            {
                "name": column["name"],
                "type": str(column["type"]),
                "nullable": column["nullable"],
                "default": column.get("default"),
            }
            for column in inspector.get_columns(table_name, schema="public")
        ],
        "primary_key": inspector.get_pk_constraint(table_name, schema="public"),
        "unique_constraints": sorted(
            inspector.get_unique_constraints(table_name, schema="public"),
            key=_canonical_json,
        ),
        "foreign_keys": sorted(
            inspector.get_foreign_keys(table_name, schema="public"),
            key=_canonical_json,
        ),
        "check_constraints": sorted(
            inspector.get_check_constraints(table_name, schema="public"),
            key=_canonical_json,
        ),
        "indexes": sorted(
            inspector.get_indexes(table_name, schema="public"),
            key=_canonical_json,
        ),
    }


def _database_snapshot(database_url: str) -> dict[str, Any]:
    engine = create_engine(database_url, pool_pre_ping=True, poolclass=NullPool)
    inspector = inspect(engine)
    metadata = MetaData()
    table_results: dict[str, dict[str, Any]] = {}
    with engine.connect() as connection:
        table_names = sorted(inspector.get_table_names(schema="public"))
        for table_name in table_names:
            table = Table(table_name, metadata, schema="public", autoload_with=engine)
            rows = [
                _canonical_json(dict(row._mapping)) for row in connection.execute(select(table))
            ]
            rows.sort()
            data_hash = hashlib.sha256()
            for row in rows:
                data_hash.update(row.encode("utf-8"))
                data_hash.update(b"\n")
            schema_description = _schema_description(inspector, table_name)
            table_results[table_name] = {
                "row_count": len(rows),
                "data_sha256": data_hash.hexdigest(),
                "schema_sha256": hashlib.sha256(
                    _canonical_json(schema_description).encode("utf-8")
                ).hexdigest(),
            }
        migration_head = connection.scalar(text("SELECT version_num FROM alembic_version"))
        postgresql_version = connection.scalar(text("SHOW server_version"))
    database_checksum = hashlib.sha256(_canonical_json(table_results).encode("utf-8")).hexdigest()
    engine.dispose()
    return {
        "captured_at_utc": _utc_now(),
        "database_sha256": database_checksum,
        "migration_head": str(migration_head),
        "postgresql_version": str(postgresql_version),
        "table_count": len(table_results),
        "tables": table_results,
    }


def _load_container_states(output: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    before = json.loads((output / "containers-before.json").read_text())["containers"]
    after = json.loads((output / "containers-after.json").read_text())["containers"]
    return before, after


def _restart_evidence(output: Path) -> dict[str, Any]:
    before, after = _load_container_states(output)
    before_by_name = {item["name"].lstrip("/"): item for item in before}
    after_by_name = {item["name"].lstrip("/"): item for item in after}
    restarted = {
        name: {
            "same_container_id": before_by_name.get(name, {}).get("id")
            == after_by_name.get(name, {}).get("id"),
            "started_at_changed": before_by_name.get(name, {}).get("started_at")
            != after_by_name.get(name, {}).get("started_at"),
            "final_status": after_by_name.get(name, {}).get("status"),
            "gpu_devices": after_by_name.get(name, {}).get("devices"),
            "gpu_device_requests": after_by_name.get(name, {}).get("device_requests"),
        }
        for name in sorted(EXPECTED_CONTAINERS)
    }
    all_restarted = (
        set(before_by_name) == EXPECTED_CONTAINERS
        and set(after_by_name) == EXPECTED_CONTAINERS
        and all(
            item["same_container_id"]
            and item["started_at_changed"]
            and item["final_status"] == "running"
            for item in restarted.values()
        )
    )
    no_gpu_devices = all(
        item["gpu_devices"] in (None, []) and item["gpu_device_requests"] in (None, [])
        for item in restarted.values()
    )
    return {
        "all_restarted": all_restarted,
        "no_gpu_devices_mounted": no_gpu_devices,
        "containers": restarted,
    }


def _gpu_environment_evidence(output: Path) -> dict[str, Any]:
    expected = os.environ["EVALHUB_GPU_DEVICES"]
    values: dict[str, dict[str, str]] = {}
    for line in (output / "gpu-boundary.txt").read_text().splitlines():
        service, assignment = line.split(" ", 1)
        key, value = assignment.split("=", 1)
        values.setdefault(service, {})[key] = value
    passed = set(values) == {"api", "worker"} and all(
        set(environment) == GPU_ENV_KEYS
        and all(value == expected for value in environment.values())
        for environment in values.values()
    )
    return {"expected": expected, "actual": values, "passed": passed}


def setup() -> None:
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    output = ARTIFACT_ROOT / f"P1-11-restart-restore-{timestamp}"
    output.mkdir(parents=True, exist_ok=False)
    (output / "backup").mkdir()
    (output / "service-logs-redacted").mkdir()
    state = {
        "output_dir": str(output.relative_to(PROJECT_ROOT)),
        "started_at_utc": _utc_now(),
        "git_sha": os.getenv("EVALHUB_GIT_SHA", "working-tree"),
        "compose_config_sha256": os.environ["EVALHUB_COMPOSE_CONFIG_SHA256"],
        "gpu_devices": os.environ["EVALHUB_GPU_DEVICES"],
        "gpu_unique_ids": os.environ["EVALHUB_GPU_UNIQUE_IDS"].split(","),
        "python": platform.python_version(),
        "sqlalchemy": sqlalchemy.__version__,
        "pre_restart": _database_snapshot(os.environ["DATABASE_URL"]),
    }
    _write_json(STATE_PATH, state)
    run_ids: list[str] = []
    engine = create_engine(os.environ["DATABASE_URL"], poolclass=NullPool)
    with engine.connect() as connection:
        run_ids = [
            str(value) for value in connection.scalars(text("SELECT id FROM runs ORDER BY id"))
        ]
    engine.dispose()
    _write_json(output / "run-ids.json", {"run_ids": run_ids})
    (output / "commands-redacted.txt").write_text(
        "\n".join(
            [
                "docker compose restart postgres redis api worker mock-openai web",
                "docker compose stop worker api",
                "docker compose exec -T postgres pg_dump -U evalhub -d evalhub "
                "--format=custom --compress=9 --no-owner --no-privileges "
                "> backup/evalhub.dump",
                "docker compose exec -T postgres pg_restore -U evalhub "
                "-d evalhub_p1_11_restore --exit-on-error --no-owner "
                "--no-privileges < backup/evalhub.dump",
                "# The restore database is dropped/recreated and restored twice; "
                "credentials are redacted.",
            ]
        )
        + "\n"
    )
    print(state["output_dir"])


def verify_restart() -> None:
    state = _read_state()
    output = _output_path(state)
    post_restart = _database_snapshot(os.environ["DATABASE_URL"])
    health_urls = {
        "api": "http://api:8000/healthz",
        "mock_openai": "http://mock-openai:8001/healthz",
        "web": "http://web:80/",
    }
    health: dict[str, dict[str, Any]] = {}
    for name, url in health_urls.items():
        try:
            response = httpx.get(url, timeout=10)
            health[name] = {"status_code": response.status_code, "passed": response.is_success}
        except httpx.HTTPError as exc:
            health[name] = {"error": type(exc).__name__, "passed": False}
    state["post_restart"] = post_restart
    state["restart"] = {
        "database_unchanged": post_restart["database_sha256"]
        == state["pre_restart"]["database_sha256"],
        "container_lifecycle": _restart_evidence(output),
        "gpu_environment": _gpu_environment_evidence(output),
        "health": health,
    }
    _write_json(STATE_PATH, state)
    print(json.dumps(state["restart"], sort_keys=True))


def capture_backup_source() -> None:
    state = _read_state()
    state["backup_source"] = _database_snapshot(os.environ["DATABASE_URL"])
    _write_json(STATE_PATH, state)
    print(state["backup_source"]["database_sha256"])


def record_backup() -> None:
    state = _read_state()
    output = _output_path(state)
    backup = output / "backup" / "evalhub.dump"
    restore_list = output / "backup" / "pg-restore-list.txt"
    file_mode = stat.S_IMODE(backup.stat().st_mode)
    state["backup"] = {
        "path": str(backup.relative_to(PROJECT_ROOT)),
        "size_bytes": backup.stat().st_size,
        "sha256": hashlib.sha256(backup.read_bytes()).hexdigest(),
        "mode": oct(file_mode),
        "restore_list_entries": sum(
            bool(line.strip()) and not line.startswith(";")
            for line in restore_list.read_text().splitlines()
        ),
    }
    _write_json(STATE_PATH, state)
    print(json.dumps(state["backup"], sort_keys=True))


def verify_restore(pass_number: int) -> None:
    if pass_number not in {1, 2}:
        raise ValueError("restore pass must be 1 or 2")
    state = _read_state()
    restored = _database_snapshot(os.environ["DATABASE_URL"])
    restored["matches_source"] = (
        restored["database_sha256"] == state["backup_source"]["database_sha256"]
    )
    state.setdefault("restore_passes", {})[str(pass_number)] = restored
    _write_json(STATE_PATH, state)
    print(json.dumps(restored, sort_keys=True))


def finalize() -> None:
    state = _read_state()
    output = _output_path(state)
    restart = state["restart"]
    source = state["backup_source"]
    restore_one = state["restore_passes"]["1"]
    restore_two = state["restore_passes"]["2"]
    critical_counts = {
        table_name: source["tables"][table_name]["row_count"]
        for table_name in sorted(CRITICAL_TABLES)
    }
    assertions = [
        {
            "name": "P1-11-all-services-restarted",
            "expected": sorted(EXPECTED_CONTAINERS),
            "actual": restart["container_lifecycle"],
            "passed": restart["container_lifecycle"]["all_restarted"],
            "evidence": "containers-before.json, containers-after.json",
        },
        {
            "name": "P1-11-authoritative-state-survives-restart",
            "expected": state["pre_restart"]["database_sha256"],
            "actual": state["post_restart"]["database_sha256"],
            "passed": restart["database_unchanged"],
            "evidence": "metrics.json",
        },
        {
            "name": "P1-11-services-healthy-after-restart",
            "expected": {"api": 200, "mock_openai": 200, "web": 200},
            "actual": restart["health"],
            "passed": all(item["passed"] for item in restart["health"].values()),
            "evidence": "metrics.json",
        },
        {
            "name": "P1-11-gpu-boundary",
            "expected": {"visible_devices": "2,3", "mounted_gpu_devices": 0},
            "actual": {
                "gpu_environment": restart["gpu_environment"],
                "no_gpu_devices_mounted": restart["container_lifecycle"]["no_gpu_devices_mounted"],
            },
            "passed": (
                restart["gpu_environment"]["passed"]
                and restart["container_lifecycle"]["no_gpu_devices_mounted"]
            ),
            "evidence": "gpu-boundary.txt, containers-after.json",
        },
        {
            "name": "P1-11-backup-artifact",
            "expected": {"size_bytes": ">0", "mode": "0o600"},
            "actual": state["backup"],
            "passed": (
                state["backup"]["size_bytes"] > 0
                and state["backup"]["mode"] == "0o600"
                and state["backup"]["restore_list_entries"] > 0
            ),
            "evidence": "backup/evalhub.dump, backup/pg-restore-list.txt",
        },
        {
            "name": "P1-11-first-clean-restore",
            "expected": source["database_sha256"],
            "actual": restore_one["database_sha256"],
            "passed": restore_one["matches_source"],
            "evidence": "table-checksums.json",
        },
        {
            "name": "P1-11-second-clean-restore",
            "expected": source["database_sha256"],
            "actual": restore_two["database_sha256"],
            "passed": restore_two["matches_source"],
            "evidence": "table-checksums.json",
        },
        {
            "name": "P1-11-critical-state-nonempty",
            "expected": "all critical table counts > 0",
            "actual": critical_counts,
            "passed": all(count > 0 for count in critical_counts.values()),
            "evidence": "table-checksums.json",
        },
        {
            "name": "P1-11-migration-head-restored",
            "expected": source["migration_head"],
            "actual": [restore_one["migration_head"], restore_two["migration_head"]],
            "passed": (
                restore_one["migration_head"]
                == restore_two["migration_head"]
                == source["migration_head"]
            ),
            "evidence": "table-checksums.json",
        },
    ]
    passed = all(item["passed"] for item in assertions)
    state["completed_at_utc"] = _utc_now()
    environment = {
        key: state[key]
        for key in (
            "git_sha",
            "compose_config_sha256",
            "gpu_devices",
            "gpu_unique_ids",
            "python",
            "sqlalchemy",
            "started_at_utc",
            "completed_at_utc",
        )
    }
    environment.update(
        {
            "migration_head": source["migration_head"],
            "postgresql": source["postgresql_version"],
            "backup_sha256": state["backup"]["sha256"],
        }
    )
    metrics = {
        "restart": restart,
        "backup": state["backup"],
        "critical_table_counts": critical_counts,
        "source_database_sha256": source["database_sha256"],
        "restore_pass_1_sha256": restore_one["database_sha256"],
        "restore_pass_2_sha256": restore_two["database_sha256"],
        "table_count": source["table_count"],
    }
    _write_json(output / "environment.json", environment)
    _write_json(output / "metrics.json", metrics)
    _write_json(output / "assertions.json", assertions)
    _write_json(
        output / "table-checksums.json",
        {
            "source": source,
            "restore_pass_1": restore_one,
            "restore_pass_2": restore_two,
        },
    )
    with (output / "samples.jsonl").open("w") as handle:
        for table_name, table in sorted(source["tables"].items()):
            handle.write(json.dumps({"table": table_name, **table}, sort_keys=True) + "\n")
    (output / "report.md").write_text(
        "\n".join(
            [
                "# P1-11 Restart and Restore Experiment",
                "",
                f"- Result: {'PASS' if passed else 'FAIL'}",
                f"- Services restarted: {len(EXPECTED_CONTAINERS)}",
                f"- Public tables checked: {source['table_count']}",
                f"- Source database SHA-256: `{source['database_sha256']}`",
                f"- Restore pass 1 SHA-256: `{restore_one['database_sha256']}`",
                f"- Restore pass 2 SHA-256: `{restore_two['database_sha256']}`",
                f"- Backup SHA-256: `{state['backup']['sha256']}`",
                f"- Backup size: {state['backup']['size_bytes']} bytes",
                f"- Critical row counts: `{json.dumps(critical_counts, sort_keys=True)}`",
                "- GPU access: physical cards 2,3 allowed; no GPU device mounted for P1-11",
            ]
        )
        + "\n"
    )
    _write_json(STATE_PATH, state)
    print(state["output_dir"])
    if not passed:
        raise AssertionError(f"P1-11 failed; evidence: {output}")


def cleanup() -> None:
    server_url = make_url(os.environ["EVALHUB_TEST_DATABASE_SERVER_URL"])
    database_name = os.environ["EVALHUB_RESTORE_DATABASE_NAME"]
    if not database_name.startswith("evalhub_p1_11_"):
        raise RuntimeError(f"unsafe restore database name: {database_name}")
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
    STATE_PATH.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="P1-11 restart and restore controller")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("setup")
    subparsers.add_parser("verify-restart")
    subparsers.add_parser("capture-backup-source")
    subparsers.add_parser("record-backup")
    restore_parser = subparsers.add_parser("verify-restore")
    restore_parser.add_argument("pass_number", type=int)
    subparsers.add_parser("finalize")
    subparsers.add_parser("cleanup")
    args = parser.parse_args()
    if args.command == "setup":
        setup()
    elif args.command == "verify-restart":
        verify_restart()
    elif args.command == "capture-backup-source":
        capture_backup_source()
    elif args.command == "record-backup":
        record_backup()
    elif args.command == "verify-restore":
        verify_restore(args.pass_number)
    elif args.command == "finalize":
        finalize()
    else:
        cleanup()


if __name__ == "__main__":
    main()
