from __future__ import annotations

import asyncio
import csv
import io
import json
from collections import defaultdict
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, selectinload

from apps.api.app.core.auth import Actor, require_actor
from apps.api.app.core.settings import Settings, get_settings
from apps.api.app.db import get_db
from apps.api.app.db.models import (
    DatasetVersion,
    Endpoint,
    EndpointCapability,
    EndpointRevision,
    Model,
    Run,
    RunDataset,
    RunMetric,
    SampleExecution,
    SampleScore,
)
from apps.api.app.db.session import SessionLocal
from apps.api.app.schemas.runs import (
    RunCreate,
    RunMetricsRead,
    RunRead,
    RunValidationResponse,
    SampleExecutionRead,
)
from apps.api.app.services.audit import record_audit
from packages.eval_engine.fingerprint import protocol_fingerprint

router = APIRouter(prefix="/runs", tags=["runs"])
TERMINAL_STATUSES = {"SUCCEEDED", "FAILED", "CANCELLED"}
TRANSIENT_ERROR_TYPES = {
    "transport.dns",
    "transport.connect",
    "transport.tls",
    "transport.timeout",
    "http.429",
}


def _is_transient_error(error_type: str | None) -> bool:
    return bool(
        error_type and (error_type in TRANSIENT_ERROR_TYPES or error_type.startswith("http.5"))
    )


def _load_resources(
    db: Session, payload: RunCreate
) -> tuple[Endpoint, EndpointRevision, Model, list[DatasetVersion]]:
    endpoint = db.get(Endpoint, payload.endpoint_id)
    model = db.get(Model, payload.model_id)
    if endpoint is None:
        raise HTTPException(status_code=404, detail={"code": "ENDPOINT_NOT_FOUND"})
    if model is None or model.endpoint_id != endpoint.id:
        raise HTTPException(status_code=404, detail={"code": "MODEL_NOT_FOUND"})
    revision = db.get(EndpointRevision, endpoint.active_revision_id)
    if revision is None:
        raise HTTPException(status_code=409, detail={"code": "ENDPOINT_REVISION_MISSING"})
    versions: list[DatasetVersion] = []
    seen: set[str] = set()
    for item in payload.datasets:
        if item.dataset_version_id in seen:
            raise HTTPException(status_code=422, detail={"code": "DUPLICATE_DATASET_VERSION"})
        seen.add(item.dataset_version_id)
        version = db.get(DatasetVersion, item.dataset_version_id)
        if version is None:
            raise HTTPException(status_code=404, detail={"code": "DATASET_VERSION_NOT_FOUND"})
        manifest_protocol = version.manifest_json["protocol"]["id"]
        if item.protocol_id and item.protocol_id != manifest_protocol:
            raise HTTPException(
                status_code=422,
                detail={"code": "PROTOCOL_MISMATCH", "dataset_version_id": version.id},
            )
        versions.append(version)
    return endpoint, revision, model, versions


def _effective_concurrency(
    payload: RunCreate,
    revision: EndpointRevision,
    settings: Settings,
) -> int:
    return min(
        payload.execution.concurrency,
        int(revision.config_json.get("concurrency_limit", settings.default_concurrency)),
        settings.global_max_concurrency,
    )


def _dataset_selection_warnings(versions: list[DatasetVersion]) -> list[str]:
    warnings: list[str] = []
    selected_names = {version.manifest_json["metadata"]["name"] for version in versions}
    for version in versions:
        subset_of = version.manifest_json["protocol"].get("subset_of")
        if subset_of in selected_names:
            warnings.append(
                f"{version.manifest_json['metadata']['name']} is a subset of {subset_of}; "
                "selecting both repeats samples and model requests"
            )
    return warnings


@router.post("/validate", response_model=RunValidationResponse)
def validate_run(
    payload: RunCreate,
    _: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> RunValidationResponse:
    endpoint, revision, _, versions = _load_resources(db, payload)
    warnings: list[str] = []
    if endpoint.status != "healthy":
        warnings.append("Endpoint has not passed its latest connectivity probe")
    warnings.extend(_dataset_selection_warnings(versions))
    return RunValidationResponse(
        valid=True,
        sample_count=sum(version.row_count for version in versions),
        effective_concurrency=_effective_concurrency(payload, revision, settings),
        warnings=warnings,
        dataset_protocols=[
            {
                "dataset_version_id": version.id,
                "protocol_id": version.manifest_json["protocol"]["id"],
                "task_type": version.manifest_json["protocol"]["task_type"],
            }
            for version in versions
        ],
    )


@router.post("", response_model=RunRead, status_code=status.HTTP_202_ACCEPTED)
def create_run(
    payload: RunCreate,
    actor: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> Run:
    if idempotency_key:
        existing = db.scalar(select(Run).where(Run.idempotency_key == idempotency_key))
        if existing:
            return existing
    endpoint, revision, model, versions = _load_resources(db, payload)
    capability = db.scalar(
        select(EndpointCapability)
        .where(EndpointCapability.revision_id == revision.id)
        .order_by(EndpointCapability.checked_at.desc())
        .limit(1)
    )
    effective_concurrency = _effective_concurrency(payload, revision, settings)
    spec = {
        "endpoint_revision_id": revision.id,
        "endpoint_config_hash": revision.config_hash,
        "endpoint_capabilities": capability.capabilities_json if capability else {},
        "model_id": model.id,
        "model_name": model.model_name,
        "datasets": [
            {
                "dataset_version_id": version.id,
                "dataset_checksum": version.checksum,
                "manifest": version.manifest_json,
            }
            for version in versions
        ],
        "inference": payload.inference.model_dump(mode="json"),
        "execution": {
            **payload.execution.model_dump(mode="json"),
            "effective_concurrency": effective_concurrency,
        },
        "engine_version": "0.1.0",
        "created_by": actor.username,
    }
    run = Run(
        name=payload.name,
        status="QUEUED",
        created_by=actor.username,
        model_id=model.id,
        endpoint_revision_id=revision.id,
        run_spec_json=spec,
        protocol_fingerprint=protocol_fingerprint(spec),
        baseline_run_id=payload.baseline_run_id,
        idempotency_key=idempotency_key,
    )
    db.add(run)
    db.flush()
    for item, version in zip(payload.datasets, versions, strict=True):
        db.add(
            RunDataset(
                run_id=run.id,
                dataset_version_id=version.id,
                protocol_id=item.protocol_id or version.manifest_json["protocol"]["id"],
                total_samples=version.row_count,
            )
        )
    record_audit(
        db,
        actor=actor.username,
        action="run.create",
        resource_type="run",
        resource_id=run.id,
        metadata={"fingerprint": run.protocol_fingerprint},
    )
    db.commit()
    run = db.scalar(select(Run).where(Run.id == run.id).options(selectinload(Run.datasets)))
    assert run is not None
    if settings.app_env != "test":
        from workers.tasks.run_eval import execute_run

        execute_run.delay(run.id)
    return run


@router.get("", response_model=list[RunRead])
def list_runs(
    run_status: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    _: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
) -> list[Run]:
    statement = select(Run).options(selectinload(Run.datasets)).order_by(Run.created_at.desc())
    if run_status:
        statement = statement.where(Run.status == run_status)
    return list(db.scalars(statement.limit(limit)).unique())


@router.get("/{run_id}", response_model=RunRead)
def get_run(
    run_id: str,
    _: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
) -> Run:
    run = db.scalar(select(Run).where(Run.id == run_id).options(selectinload(Run.datasets)))
    if run is None:
        raise HTTPException(status_code=404, detail={"code": "RUN_NOT_FOUND"})
    return run


@router.post("/{run_id}/cancel", response_model=RunRead)
def cancel_run(
    run_id: str,
    actor: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
) -> Run:
    run = db.scalar(select(Run).where(Run.id == run_id).options(selectinload(Run.datasets)))
    if run is None:
        raise HTTPException(status_code=404, detail={"code": "RUN_NOT_FOUND"})
    if run.status in TERMINAL_STATUSES:
        raise HTTPException(status_code=409, detail={"code": "RUN_ALREADY_TERMINAL"})
    run.cancel_requested = True
    run.status = "CANCELLING" if run.status == "RUNNING" else "CANCELLED"
    if run.status == "CANCELLED":
        run.completed_at = datetime.now(UTC)
    record_audit(
        db,
        actor=actor.username,
        action="run.cancel",
        resource_type="run",
        resource_id=run.id,
    )
    db.commit()
    return run


@router.post(
    "/{run_id}/retry-failures",
    response_model=RunRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def retry_run_failures(
    run_id: str,
    actor: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Run:
    run = db.scalar(select(Run).where(Run.id == run_id).options(selectinload(Run.datasets)))
    if run is None:
        raise HTTPException(status_code=404, detail={"code": "RUN_NOT_FOUND"})
    if run.status not in TERMINAL_STATUSES:
        raise HTTPException(status_code=409, detail={"code": "RUN_NOT_TERMINAL"})

    executions = db.scalars(
        select(SampleExecution)
        .join(RunDataset)
        .where(RunDataset.run_id == run_id, SampleExecution.status == "API_ERROR")
    ).all()
    retryable = [item for item in executions if _is_transient_error(item.error_type)]
    if not retryable:
        raise HTTPException(status_code=409, detail={"code": "NO_RETRYABLE_FAILURES"})

    execution_ids = [item.id for item in retryable]
    affected_dataset_ids = {item.run_dataset_id for item in retryable}
    retries_per_dataset: dict[str, int] = defaultdict(int)
    for execution in retryable:
        retries_per_dataset[execution.run_dataset_id] += 1
    db.execute(delete(SampleScore).where(SampleScore.sample_execution_id.in_(execution_ids)))
    db.execute(delete(RunMetric).where(RunMetric.run_dataset_id.in_(affected_dataset_ids)))
    for execution in retryable:
        execution.status = "PENDING"
        execution.rendered_request_json = None
        execution.raw_response_json = None
        execution.output_text = None
        execution.parsed_value_json = None
        execution.parse_status = None
        execution.latency_ms = None
        execution.ttft_ms = None
        execution.prompt_tokens = None
        execution.completion_tokens = None
        execution.error_type = None
        execution.error_message_redacted = None
        execution.claim_token = None
        execution.claim_expires_at = None
        execution.started_at = None
        execution.completed_at = None
    for run_dataset in run.datasets:
        if run_dataset.id not in affected_dataset_ids:
            continue
        run_dataset.status = "QUEUED"
        run_dataset.completed_samples = max(
            0,
            run_dataset.completed_samples - retries_per_dataset[run_dataset.id],
        )
        run_dataset.counters_json = {}
    run.status = "QUEUED"
    run.cancel_requested = False
    run.completed_at = None
    run.error_message = None
    record_audit(
        db,
        actor=actor.username,
        action="run.retry_failures",
        resource_type="run",
        resource_id=run.id,
        metadata={"sample_count": len(retryable)},
    )
    db.commit()
    run = db.scalar(select(Run).where(Run.id == run.id).options(selectinload(Run.datasets)))
    assert run is not None
    if settings.app_env != "test":
        from workers.tasks.run_eval import execute_run

        execute_run.delay(run.id)
    return run


@router.get("/{run_id}/metrics", response_model=RunMetricsRead)
def get_run_metrics(
    run_id: str,
    _: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
) -> RunMetricsRead:
    run_datasets = db.scalars(select(RunDataset).where(RunDataset.run_id == run_id)).all()
    if not run_datasets:
        raise HTTPException(status_code=404, detail={"code": "RUN_NOT_FOUND"})
    result = []
    for run_dataset in run_datasets:
        metrics = db.scalars(
            select(RunMetric).where(RunMetric.run_dataset_id == run_dataset.id)
        ).all()
        overall = [metric for metric in metrics if metric.group_key is None]
        grouped: dict[tuple[str, str], list[RunMetric]] = defaultdict(list)
        for metric in metrics:
            if metric.group_key is not None and metric.group_value is not None:
                grouped[(metric.group_key, metric.group_value)].append(metric)
        result.append(
            {
                "run_dataset_id": run_dataset.id,
                "dataset_version_id": run_dataset.dataset_version_id,
                "protocol_id": run_dataset.protocol_id,
                "metrics": {metric.metric_name: metric.value for metric in overall},
                "denominators": {
                    metric.metric_name: metric.denominator
                    for metric in overall
                    if metric.denominator is not None
                },
                "metadata": {metric.metric_name: metric.metadata_json for metric in overall},
                "groups": [
                    {
                        "group_key": group_key,
                        "group_value": group_value,
                        "metrics": {metric.metric_name: metric.value for metric in rows},
                        "denominators": {
                            metric.metric_name: metric.denominator
                            for metric in rows
                            if metric.denominator is not None
                        },
                    }
                    for (group_key, group_value), rows in sorted(grouped.items())
                ],
            }
        )
    return RunMetricsRead(run_id=run_id, datasets=result)


def _sample_read(execution: SampleExecution) -> SampleExecutionRead:
    score = execution.scores[-1] if execution.scores else None
    return SampleExecutionRead(
        **{
            column.name: getattr(execution, column.name)
            for column in SampleExecution.__table__.columns
        },
        primary_score=score.primary_score if score else None,
        passed=score.passed if score else None,
        score_reason=score.reason if score else None,
    )


@router.get("/{run_id}/samples", response_model=list[SampleExecutionRead])
def list_run_samples(
    run_id: str,
    sample_status: str | None = Query(default=None, alias="status"),
    error_type: str | None = None,
    passed: bool | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    _: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
) -> list[SampleExecutionRead]:
    statement = (
        select(SampleExecution)
        .join(RunDataset)
        .where(RunDataset.run_id == run_id)
        .options(selectinload(SampleExecution.scores))
        .order_by(SampleExecution.sample_id)
    )
    if sample_status:
        statement = statement.where(SampleExecution.status == sample_status)
    if error_type:
        statement = statement.where(SampleExecution.error_type == error_type)
    if passed is not None:
        statement = statement.join(SampleScore).where(SampleScore.passed == passed)
    executions = db.scalars(statement.offset(offset).limit(limit)).unique().all()
    return [_sample_read(execution) for execution in executions]


@router.get("/{run_id}/samples/{sample_execution_id}", response_model=SampleExecutionRead)
def get_run_sample(
    run_id: str,
    sample_execution_id: str,
    _: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
) -> SampleExecutionRead:
    execution = db.scalar(
        select(SampleExecution)
        .join(RunDataset)
        .where(RunDataset.run_id == run_id, SampleExecution.id == sample_execution_id)
        .options(selectinload(SampleExecution.scores))
    )
    if execution is None:
        raise HTTPException(status_code=404, detail={"code": "SAMPLE_NOT_FOUND"})
    return _sample_read(execution)


@router.get("/{run_id}/events")
async def run_events(
    run_id: str,
    _: Actor = Depends(require_actor),
) -> StreamingResponse:
    async def event_stream() -> AsyncIterator[str]:
        previous: tuple | None = None
        while True:
            with SessionLocal() as db:
                run = db.get(Run, run_id)
                if run is None:
                    yield f"event: run.failed\ndata: {json.dumps({'code': 'RUN_NOT_FOUND'})}\n\n"
                    return
                totals = db.execute(
                    select(
                        func.sum(RunDataset.total_samples),
                        func.sum(RunDataset.completed_samples),
                    ).where(RunDataset.run_id == run_id)
                ).one()
                snapshot = (run.status, int(totals[0] or 0), int(totals[1] or 0))
            if snapshot != previous:
                event = "run.completed" if snapshot[0] in TERMINAL_STATUSES else "run.progress"
                payload = {
                    "run_id": run_id,
                    "status": snapshot[0],
                    "total": snapshot[1],
                    "completed": snapshot[2],
                }
                yield f"event: {event}\ndata: {json.dumps(payload)}\n\n"
                previous = snapshot
            else:
                yield "event: heartbeat\ndata: {}\n\n"
            if snapshot[0] in TERMINAL_STATUSES:
                return
            await asyncio.sleep(1)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/{run_id}/export")
def export_run(
    run_id: str,
    export_format: Literal["jsonl", "csv"] = Query(default="jsonl", alias="format"),
    _: Actor = Depends(require_actor),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    executions = (
        db.scalars(
            select(SampleExecution)
            .join(RunDataset)
            .where(RunDataset.run_id == run_id)
            .options(selectinload(SampleExecution.scores))
            .order_by(SampleExecution.sample_id)
        )
        .unique()
        .all()
    )
    if not executions:
        raise HTTPException(status_code=404, detail={"code": "RUN_RESULTS_NOT_FOUND"})
    rows = [_sample_read(execution).model_dump(mode="json") for execution in executions]
    if export_format == "jsonl":
        content = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
        media_type = "application/x-ndjson"
    else:
        output = io.StringIO()
        fields = [
            "sample_id",
            "status",
            "reference_json",
            "parsed_value_json",
            "output_text",
            "primary_score",
            "passed",
            "latency_ms",
            "error_type",
        ]
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        writer.writerows({field: row.get(field) for field in fields} for row in rows)
        content = output.getvalue()
        media_type = "text/csv"
    headers = {"Content-Disposition": f'attachment; filename="run-{run_id}.{export_format}"'}
    return StreamingResponse(iter([content]), media_type=media_type, headers=headers)
