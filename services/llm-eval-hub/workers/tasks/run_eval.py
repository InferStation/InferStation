from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from celery import chord
from celery.utils.log import get_task_logger
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session, selectinload

from apps.api.app.core.crypto import SecretCipher
from apps.api.app.core.network import validate_endpoint_url
from apps.api.app.core.settings import get_settings
from apps.api.app.db.models import (
    DatasetVersion,
    EndpointRevision,
    RequestAttempt,
    Run,
    RunDataset,
    RunMetric,
    SampleExecution,
)
from apps.api.app.db.models import (
    SampleScore as SampleScoreModel,
)
from apps.api.app.db.session import SessionLocal
from apps.api.app.services.endpoints import auth_headers
from packages.eval_engine.adapters import OpenAICompatibleAdapter
from packages.eval_engine.aggregators import aggregate_records
from packages.eval_engine.contracts import (
    EvalSample,
    EvaluationRecord,
    InferenceResult,
    ModelRequest,
    ParsedAnswer,
    SampleScore,
)
from packages.eval_engine.datasets import validate_dataset
from packages.eval_engine.parsers import create_parser
from packages.eval_engine.rendering import JinjaPromptRenderer
from packages.eval_engine.scorers import create_scorer
from workers.celery_app import celery_app
from workers.scheduling import RedisEndpointLimiter

logger = get_task_logger(__name__)
TERMINAL_SAMPLE_STATUSES = {"SUCCEEDED", "API_ERROR", "PARSE_ERROR", "SCORE_ERROR", "CANCELLED"}
TERMINAL_RUN_STATUSES = {"SUCCEEDED", "FAILED", "CANCELLED"}


class RunNotReady(RuntimeError):
    pass


def _chunks(values: list[str], size: int) -> list[list[str]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def _claim_seconds(execution_config: dict[str, Any]) -> float:
    attempts = int(execution_config["max_retries"]) + 1
    request_time = float(execution_config["timeout_seconds"]) * attempts
    backoff_time = sum(min(8.0, 0.25 * (2**index)) for index in range(attempts - 1))
    return request_time + backoff_time + 10


def _mark_run_failed(run_id: str, exc: Exception) -> None:
    logger.exception("Run failed run_id=%s", run_id)
    with SessionLocal() as db:
        run = db.get(Run, run_id)
        if run is None or run.status in TERMINAL_RUN_STATUSES:
            return
        run.status = "FAILED"
        run.error_message = f"{type(exc).__name__}: {str(exc)[:500]}"
        run.completed_at = datetime.now(UTC)
        for run_dataset in db.scalars(
            select(RunDataset).where(
                RunDataset.run_id == run_id,
                RunDataset.status.not_in({"SUCCEEDED", "CANCELLED"}),
            )
        ):
            run_dataset.status = "FAILED"
        db.commit()


def _materialize(run_dataset: RunDataset, version: DatasetVersion) -> None:
    validated = validate_dataset(Path(version.manifest_uri), Path(version.data_uri))
    with SessionLocal() as db:
        existing = set(
            db.scalars(
                select(SampleExecution.sample_id).where(
                    SampleExecution.run_dataset_id == run_dataset.id
                )
            )
        )
        for sample in validated.samples:
            if sample.sample_id in existing:
                continue
            db.add(
                SampleExecution(
                    run_dataset_id=run_dataset.id,
                    sample_id=sample.sample_id,
                    inputs_json=dict(sample.inputs),
                    reference_json=sample.reference,
                    metadata_json=dict(sample.metadata),
                )
            )
        db.commit()


def _claim_execution(
    execution_id: str,
    request: ModelRequest,
    claim_seconds: float,
) -> tuple[str, str | None, int]:
    now = datetime.now(UTC)
    with SessionLocal() as db:
        execution = db.scalar(
            select(SampleExecution)
            .where(SampleExecution.id == execution_id)
            .with_for_update()
        )
        if execution is None or execution.status in TERMINAL_SAMPLE_STATUSES:
            return "terminal", None, 0
        run_dataset = db.get(RunDataset, execution.run_dataset_id)
        run = db.get(Run, run_dataset.run_id) if run_dataset else None
        if run is None or run.cancel_requested or run.status == "CANCELLED":
            execution.status = "CANCELLED"
            execution.claim_token = None
            execution.claim_expires_at = None
            execution.completed_at = now
            db.commit()
            return "terminal", None, 0
        if (
            execution.status == "RUNNING"
            and execution.claim_expires_at is not None
            and execution.claim_expires_at > now
        ):
            return "busy", None, 0

        claim_token = str(uuid.uuid4())
        execution.status = "RUNNING"
        execution.claim_token = claim_token
        execution.claim_expires_at = now + timedelta(seconds=claim_seconds)
        execution.started_at = now
        execution.rendered_request_json = asdict(request)
        prior_attempts = (
            db.scalar(
                select(func.count(RequestAttempt.id)).where(
                    RequestAttempt.sample_execution_id == execution_id
                )
            )
            or 0
        )
        db.commit()
        return "claimed", claim_token, prior_attempts


def _stop_if_cancelled_or_reclaimed(execution_id: str, claim_token: str) -> bool:
    with SessionLocal() as db:
        execution = db.get(SampleExecution, execution_id)
        if execution is None or execution.status in TERMINAL_SAMPLE_STATUSES:
            return True
        run_dataset = db.get(RunDataset, execution.run_dataset_id)
        run = db.get(Run, run_dataset.run_id) if run_dataset else None
        if run is not None and not run.cancel_requested and execution.claim_token == claim_token:
            return False
        if run is None or run.cancel_requested:
            execution.status = "CANCELLED"
            execution.claim_token = None
            execution.claim_expires_at = None
            execution.completed_at = datetime.now(UTC)
            db.commit()
        return True


def _update_progress(run_dataset_id: str) -> None:
    with SessionLocal() as db:
        db.execute(
            update(RunDataset)
            .where(RunDataset.id == run_dataset_id)
            .values(completed_samples=RunDataset.completed_samples + 1)
        )
        db.commit()


async def _execute_sample(
    *,
    execution_id: str,
    sample: EvalSample,
    renderer: JinjaPromptRenderer,
    adapter: OpenAICompatibleAdapter,
    parser_config: dict[str, Any],
    scorer_config: dict[str, Any],
    endpoint_limiter: RedisEndpointLimiter,
    semaphore: asyncio.Semaphore,
    claim_seconds: float,
) -> str:
    request = renderer.render(sample)
    claim_state, claim_token, prior_attempts = _claim_execution(
        execution_id, request, claim_seconds
    )
    if claim_state != "claimed" or claim_token is None:
        return claim_state

    async with semaphore:
        if _stop_if_cancelled_or_reclaimed(execution_id, claim_token):
            return "terminal"
        async with endpoint_limiter.request_slot():
            if _stop_if_cancelled_or_reclaimed(execution_id, claim_token):
                return "terminal"
            inference = await adapter.infer(request)
    parser = create_parser(parser_config)
    scorer = create_scorer(scorer_config)
    answer = parser.parse(sample, inference)
    score = scorer.score(sample, answer)

    run_dataset_id: str | None = None
    with SessionLocal() as db:
        execution = db.scalar(
            select(SampleExecution)
            .where(SampleExecution.id == execution_id)
            .with_for_update()
        )
        if execution is None:
            return "terminal"
        if execution.claim_token != claim_token:
            return "busy"
        run_dataset_id = execution.run_dataset_id
        execution.raw_response_json = (
            dict(inference.raw_response) if inference.raw_response else None
        )
        execution.output_text = inference.output_text
        execution.parsed_value_json = answer.value
        execution.parse_status = answer.status
        execution.latency_ms = inference.latency_ms
        execution.ttft_ms = inference.ttft_ms
        execution.prompt_tokens = inference.prompt_tokens
        execution.completion_tokens = inference.completion_tokens
        execution.error_type = inference.error_type
        execution.error_message_redacted = inference.error_message_redacted
        execution.completed_at = datetime.now(UTC)
        execution.claim_token = None
        execution.claim_expires_at = None
        if inference.error_type:
            execution.status = "API_ERROR"
        elif answer.status != "ok":
            execution.status = "PARSE_ERROR"
        elif score.primary is None:
            execution.status = "SCORE_ERROR"
        else:
            execution.status = "SUCCEEDED"
        for trace in inference.attempt_traces:
            db.add(
                RequestAttempt(
                    sample_execution_id=execution.id,
                    attempt_no=prior_attempts + trace.attempt_no,
                    started_at=datetime.fromisoformat(trace.started_at),
                    duration_ms=trace.duration_ms,
                    http_status=trace.http_status,
                    error_type=trace.error_type,
                    response_excerpt_redacted=trace.response_excerpt_redacted,
                )
            )
        db.add(
            SampleScoreModel(
                sample_execution_id=execution.id,
                score_revision=1,
                scorer_id=scorer_config["type"],
                scorer_version=score.scorer_version,
                primary_score=score.primary,
                metrics_json=dict(score.metrics),
                passed=score.passed,
                reason=score.reason,
            )
        )
        db.commit()
    if run_dataset_id is not None:
        _update_progress(run_dataset_id)
    return "completed"


def _records_for_aggregation(db: Session, run_dataset_id: str) -> list[EvaluationRecord]:
    executions = (
        db.scalars(
            select(SampleExecution)
            .where(SampleExecution.run_dataset_id == run_dataset_id)
            .options(selectinload(SampleExecution.scores))
        )
        .unique()
        .all()
    )
    records: list[EvaluationRecord] = []
    for execution in executions:
        score_row = execution.scores[-1] if execution.scores else None
        request_data = execution.rendered_request_json or {
            "request_id": execution.sample_id,
            "model": "",
            "mode": "chat_completions",
            "messages": None,
            "prompt": None,
            "params": {},
        }
        records.append(
            EvaluationRecord(
                sample=EvalSample(
                    execution.sample_id,
                    execution.inputs_json,
                    execution.reference_json,
                    execution.metadata_json,
                ),
                request=ModelRequest(**request_data),
                inference=InferenceResult(
                    request_id=execution.sample_id,
                    raw_response=execution.raw_response_json,
                    output_text=execution.output_text,
                    latency_ms=execution.latency_ms or 0,
                    ttft_ms=execution.ttft_ms,
                    prompt_tokens=execution.prompt_tokens,
                    completion_tokens=execution.completion_tokens,
                    error_type=execution.error_type,
                    error_message_redacted=execution.error_message_redacted,
                ),
                answer=ParsedAnswer(
                    execution.parsed_value_json,
                    execution.parse_status or "upstream_error",
                    "1",
                ),
                score=SampleScore(
                    score_row.primary_score if score_row else None,
                    score_row.metrics_json if score_row else {},
                    score_row.passed if score_row else None,
                    score_row.reason if score_row else None,
                    score_row.scorer_version if score_row else "1",
                ),
            )
        )
    return records


def _group_value(record: EvaluationRecord, field: str) -> str:
    value = record.sample.metadata.get(field, record.sample.inputs.get(field, "<missing>"))
    if isinstance(value, dict | list) or value is None:
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def _add_metric_rows(
    db: Session,
    run_dataset_id: str,
    metrics: dict[str, Any],
    *,
    group_key: str | None = None,
    group_value: str | None = None,
) -> None:
    primary_metric = metrics["primary_metric"]
    primary_denominator = metrics.get(f"{primary_metric}_denominator")
    for name, value in metrics.items():
        if not isinstance(value, int | float) and value is not None:
            continue
        db.add(
            RunMetric(
                run_dataset_id=run_dataset_id,
                metric_name=name,
                value=float(value) if value is not None else None,
                denominator=primary_denominator if name == primary_metric else None,
                group_key=group_key,
                group_value=group_value,
            )
        )


def _aggregate_dataset(db: Session, run: Run, run_dataset: RunDataset) -> None:
    version = db.get(DatasetVersion, run_dataset.dataset_version_id)
    if version is None:
        raise RuntimeError("Frozen dataset version does not exist")
    manifest = version.manifest_json
    records = _records_for_aggregation(db, run_dataset.id)
    protocol = manifest["protocol"]
    aggregate_options = {
        "denominator_policy": protocol.get("denominator_policy", "all_scoring_samples"),
        "on_api_error": protocol.get("on_api_error", "exclude_and_report"),
        "on_parse_error": protocol.get("on_parse_error", "count_as_incorrect"),
        "labels": protocol["parser"].get("labels"),
    }
    metrics = aggregate_records(records, **aggregate_options)
    db.execute(delete(RunMetric).where(RunMetric.run_dataset_id == run_dataset.id))
    _add_metric_rows(db, run_dataset.id, metrics)
    for group in manifest.get("groups", []):
        field = group.get("field")
        if not field:
            continue
        values = sorted({_group_value(record, field) for record in records})
        for value in values:
            group_records = [
                record for record in records if _group_value(record, field) == value
            ]
            group_metrics = aggregate_records(group_records, **aggregate_options)
            _add_metric_rows(
                db,
                run_dataset.id,
                group_metrics,
                group_key=field,
                group_value=value,
            )
    run_dataset.completed_samples = len(records)
    run_dataset.status = "CANCELLED" if run.cancel_requested else "SUCCEEDED"
    run_dataset.counters_json = {
        key: metrics[key]
        for key in (
            "total_samples",
            "scored_samples",
            "api_errors",
            "parse_errors",
            "score_errors",
        )
    }


def _prepare_run(run_id: str) -> list[tuple[str, list[str]]]:
    with SessionLocal() as db:
        run = db.scalar(select(Run).where(Run.id == run_id).options(selectinload(Run.datasets)))
        if run is None or run.status in TERMINAL_RUN_STATUSES:
            return []
        run.status = "PREPARING"
        run.started_at = run.started_at or datetime.now(UTC)
        run.completed_at = None
        run.error_message = None
        work = []
        for run_dataset in run.datasets:
            run_dataset.status = "PREPARING"
            version = db.get(DatasetVersion, run_dataset.dataset_version_id)
            if version is None:
                raise RuntimeError("Frozen dataset version does not exist")
            work.append((run_dataset.id, run_dataset, version))
        db.commit()

    for _, run_dataset, version in work:
        _materialize(run_dataset, version)

    with SessionLocal() as db:
        run = db.get(Run, run_id)
        if run is None or run.status in TERMINAL_RUN_STATUSES:
            return []
        run.status = "RUNNING"
        shard_size = int(run.run_spec_json["execution"].get("shard_size", 50))
        shards: list[tuple[str, list[str]]] = []
        for run_dataset_id, _, _ in work:
            run_dataset = db.get(RunDataset, run_dataset_id)
            assert run_dataset is not None
            run_dataset.status = "RUNNING"
            execution_ids = list(
                db.scalars(
                    select(SampleExecution.id)
                    .where(
                        SampleExecution.run_dataset_id == run_dataset_id,
                        SampleExecution.status.not_in(TERMINAL_SAMPLE_STATUSES),
                    )
                    .order_by(SampleExecution.sample_id)
                )
            )
            shards.extend((run_dataset_id, chunk) for chunk in _chunks(execution_ids, shard_size))
        db.commit()
        return shards


async def _execute_shard_async(
    run_id: str,
    run_dataset_id: str,
    execution_ids: list[str],
) -> dict[str, int]:
    with SessionLocal() as db:
        run = db.get(Run, run_id)
        run_dataset = db.get(RunDataset, run_dataset_id)
        if run is None or run_dataset is None or run.status in TERMINAL_RUN_STATUSES:
            return {"completed": 0, "terminal": len(execution_ids), "busy": 0}
        revision = db.get(EndpointRevision, run.endpoint_revision_id)
        version = db.get(DatasetVersion, run_dataset.dataset_version_id)
        if revision is None or version is None:
            raise RuntimeError("Frozen run resources do not exist")
        spec = run.run_spec_json
        executions = list(
            db.scalars(select(SampleExecution).where(SampleExecution.id.in_(execution_ids)))
        )
        samples = {
            execution.id: EvalSample(
                execution.sample_id,
                execution.inputs_json,
                execution.reference_json,
                execution.metadata_json,
            )
            for execution in executions
        }
        manifest = version.manifest_json
        settings = get_settings()
        base_url = await validate_endpoint_url(revision.config_json["base_url"], settings)
        secret = SecretCipher().decrypt(revision.secret_ciphertext)
        headers = {
            **auth_headers(revision.config_json["auth_type"], secret),
            **revision.config_json.get("extra_headers", {}),
        }

    execution_config = spec["execution"]
    request_spec = dict(manifest["request"])
    request_spec["parameters"] = {
        **request_spec.get("parameters", {}),
        **{key: value for key, value in spec["inference"].items() if value is not None},
    }
    renderer = JinjaPromptRenderer(request_spec, spec["model_name"])
    adapter = OpenAICompatibleAdapter(
        base_url=base_url,
        headers=headers,
        timeout_seconds=execution_config["timeout_seconds"],
        max_retries=execution_config["max_retries"],
    )
    semaphore = asyncio.Semaphore(execution_config["effective_concurrency"])
    limiter = RedisEndpointLimiter(
        redis_url=settings.redis_url,
        endpoint_revision_id=revision.id,
        qps=min(execution_config["qps"], revision.config_json["qps_limit"]),
        concurrency_limit=int(
            revision.config_json.get("concurrency_limit", settings.default_concurrency)
        ),
        lease_seconds=_claim_seconds(execution_config),
        run_id=run_id,
        run_concurrency_limit=int(execution_config["effective_concurrency"]),
    )
    async with adapter, limiter:
        states = await asyncio.gather(
            *[
                _execute_sample(
                    execution_id=execution_id,
                    sample=samples[execution_id],
                    renderer=renderer,
                    adapter=adapter,
                    parser_config=manifest["protocol"]["parser"],
                    scorer_config=manifest["protocol"]["scorer"],
                    endpoint_limiter=limiter,
                    semaphore=semaphore,
                    claim_seconds=_claim_seconds(execution_config),
                )
                for execution_id in execution_ids
                if execution_id in samples
            ]
        )
    return {state: states.count(state) for state in ("completed", "terminal", "busy")}


def _finalize_run(run_id: str) -> None:
    with SessionLocal() as db, db.begin():
        run = db.scalar(
            select(Run)
            .where(Run.id == run_id)
            .options(selectinload(Run.datasets))
            .with_for_update()
        )
        if run is None or run.status in TERMINAL_RUN_STATUSES:
            return
        nonterminal = db.scalar(
            select(func.count(SampleExecution.id))
            .join(RunDataset)
            .where(
                RunDataset.run_id == run_id,
                SampleExecution.status.not_in(TERMINAL_SAMPLE_STATUSES),
            )
        )
        if nonterminal:
            raise RunNotReady(f"{nonterminal} samples are not terminal")
        for run_dataset in run.datasets:
            _aggregate_dataset(db, run, run_dataset)
        run.status = "CANCELLED" if run.cancel_requested else "SUCCEEDED"
        run.completed_at = datetime.now(UTC)


@celery_app.task(bind=True, name="workers.tasks.run_eval.execute_shard", acks_late=True)
def execute_shard(
    self,
    run_id: str,
    run_dataset_id: str,
    execution_ids: list[str],
) -> dict[str, int]:
    try:
        result = asyncio.run(_execute_shard_async(run_id, run_dataset_id, execution_ids))
    except Exception as exc:
        if self.request.retries < 3:
            raise self.retry(exc=exc, countdown=2**self.request.retries, max_retries=3) from exc
        _mark_run_failed(run_id, exc)
        raise
    if result["busy"]:
        raise self.retry(countdown=1, max_retries=600)
    return result


@celery_app.task(bind=True, name="workers.tasks.run_eval.finalize_run", acks_late=True)
def finalize_run(self, _: list[dict[str, int]], run_id: str) -> None:
    try:
        _finalize_run(run_id)
    except RunNotReady as exc:
        raise self.retry(exc=exc, countdown=1, max_retries=600) from exc
    except Exception as exc:
        _mark_run_failed(run_id, exc)
        raise


@celery_app.task(bind=True, name="workers.tasks.run_eval.execute_run", acks_late=True)
def execute_run(self, run_id: str) -> dict[str, int]:
    del self
    try:
        shards = _prepare_run(run_id)
        if not shards:
            with SessionLocal() as db:
                run = db.get(Run, run_id)
                if run is not None and run.status not in TERMINAL_RUN_STATUSES:
                    finalize_run.apply_async(args=[[], run_id], queue="native")
            return {"shards": 0}
        header = [
            execute_shard.s(run_id, run_dataset_id, execution_ids).set(queue="native")
            for run_dataset_id, execution_ids in shards
        ]
        chord(header)(finalize_run.s(run_id).set(queue="native"))
        return {"shards": len(shards)}
    except Exception as exc:
        _mark_run_failed(run_id, exc)
        raise
