from __future__ import annotations

import math
from collections import Counter
from collections.abc import Sequence
from typing import Any

from packages.eval_engine.contracts import EvaluationRecord


def percentile(values: Sequence[float], quantile: float) -> float | None:
    if not values:
        return None
    if quantile < 0 or quantile > 1:
        raise ValueError("quantile must be between 0 and 1")
    ordered = sorted(float(value) for value in values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * quantile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _classification_f1(
    pairs: Sequence[tuple[Any, Any]], labels: Sequence[Any]
) -> tuple[float, float, float]:
    per_label: list[tuple[float, int]] = []
    total_tp = total_fp = total_fn = 0
    for label in labels:
        tp = sum(1 for reference, prediction in pairs if reference == label and prediction == label)
        fp = sum(1 for reference, prediction in pairs if reference != label and prediction == label)
        fn = sum(1 for reference, prediction in pairs if reference == label and prediction != label)
        denominator = (2 * tp) + fp + fn
        f1 = (2 * tp / denominator) if denominator else 0.0
        support = sum(1 for reference, _ in pairs if reference == label)
        per_label.append((f1, support))
        total_tp += tp
        total_fp += fp
        total_fn += fn
    macro = sum(score for score, _ in per_label) / len(per_label) if per_label else 0.0
    support_total = sum(support for _, support in per_label)
    weighted = (
        sum(score * support for score, support in per_label) / support_total
        if support_total
        else 0.0
    )
    micro_denominator = (2 * total_tp) + total_fp + total_fn
    micro = (2 * total_tp / micro_denominator) if micro_denominator else 0.0
    return macro, micro, weighted


def aggregate_records(
    records: Sequence[EvaluationRecord],
    *,
    denominator_policy: str = "all_scoring_samples",
    on_api_error: str = "exclude_and_report",
    on_parse_error: str = "count_as_incorrect",
    labels: Sequence[Any] | None = None,
    duration_seconds: float | None = None,
) -> dict[str, Any]:
    total = len(records)
    api_error_records = [record for record in records if record.inference.error_type]
    parse_error_records = [
        record
        for record in records
        if not record.inference.error_type and record.answer.status != "ok"
    ]
    api_errors = len(api_error_records)
    parse_errors = len(parse_error_records)
    scored = [record for record in records if record.score.primary is not None]
    score_error_records = [
        record
        for record in records
        if not record.inference.error_type
        and record.answer.status == "ok"
        and record.score.primary is None
    ]
    score_errors = len(score_error_records)
    if denominator_policy == "valid_responses_only":
        denominator = len(scored)
    else:
        denominator = len(scored) + score_errors
        if on_api_error == "count_as_incorrect":
            denominator += api_errors
        if on_parse_error == "count_as_incorrect":
            denominator += parse_errors

    primary_metric = next(
        (name for record in scored for name in record.score.metrics),
        "accuracy",
    )
    numerator = sum(record.score.primary or 0.0 for record in scored)
    primary_value = numerator / denominator if denominator else None
    successful_latencies = [
        record.inference.latency_ms for record in records if not record.inference.error_type
    ]
    all_latencies = [record.inference.latency_ms for record in records]
    metrics: dict[str, Any] = {
        "primary_metric": primary_metric,
        primary_metric: primary_value,
        f"{primary_metric}_numerator": int(numerator),
        f"{primary_metric}_denominator": denominator,
        "total_samples": total,
        "attempted_samples": total,
        "valid_responses": total - api_errors - parse_errors,
        "scored_samples": len(scored),
        "score_errors": score_errors,
        "api_errors": api_errors,
        "api_error_rate": api_errors / total if total else None,
        "parse_errors": parse_errors,
        "parse_error_rate": parse_errors / total if total else None,
        "latency_success_p50_ms": percentile(successful_latencies, 0.50),
        "latency_success_p95_ms": percentile(successful_latencies, 0.95),
        "latency_success_p99_ms": percentile(successful_latencies, 0.99),
        "latency_all_p50_ms": percentile(all_latencies, 0.50),
        "latency_all_p95_ms": percentile(all_latencies, 0.95),
        "latency_all_p99_ms": percentile(all_latencies, 0.99),
        "prompt_tokens": sum(record.inference.prompt_tokens or 0 for record in records),
        "completion_tokens": sum(record.inference.completion_tokens or 0 for record in records),
    }
    if duration_seconds and duration_seconds > 0:
        metrics["throughput_samples_per_second"] = total / duration_seconds

    pairs: list[tuple[Any, Any]] = [
        (record.sample.reference, record.answer.value)
        for record in scored
        if record.answer.status == "ok"
    ]
    if denominator_policy == "all_scoring_samples":
        if on_api_error == "count_as_incorrect":
            pairs.extend((record.sample.reference, "__api_error__") for record in api_error_records)
        if on_parse_error == "count_as_incorrect":
            pairs.extend(
                (record.sample.reference, "__parse_error__") for record in parse_error_records
            )
        pairs.extend((record.sample.reference, "__score_error__") for record in score_error_records)
    if labels is not None:
        macro, micro, weighted = _classification_f1(pairs, labels)
        metrics.update({"macro_f1": macro, "micro_f1": micro, "weighted_f1": weighted})
        metrics["label_support"] = dict(Counter(reference for reference, _ in pairs))
    return metrics
