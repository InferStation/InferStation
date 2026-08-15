import pytest

from packages.eval_engine.aggregators import aggregate_records, percentile
from packages.eval_engine.contracts import (
    EvalSample,
    EvaluationRecord,
    InferenceResult,
    ModelRequest,
    ParsedAnswer,
    SampleScore,
)


def record(
    sample_id: str,
    reference: str,
    prediction: str | None,
    *,
    latency: float,
    error_type: str | None = None,
) -> EvaluationRecord:
    answer_status = "ok" if prediction is not None and error_type is None else "no_match"
    primary = float(prediction == reference) if answer_status == "ok" else None
    return EvaluationRecord(
        sample=EvalSample(sample_id, {}, reference),
        request=ModelRequest(sample_id, "mock", "chat_completions", [], None, {}),
        inference=InferenceResult(sample_id, {}, prediction, latency, error_type=error_type),
        answer=ParsedAnswer(prediction, answer_status, "1"),
        score=SampleScore(primary, {}, bool(primary) if primary is not None else None, None, "1"),
    )


def test_percentile_uses_linear_interpolation() -> None:
    assert percentile([10, 20, 30, 40], 0.50) == 25
    assert percentile([10, 20, 30, 40], 0.95) == pytest.approx(38.5)


def test_aggregate_keeps_errors_and_denominator_explicit() -> None:
    records = [
        record("1", "a", "a", latency=10),
        record("2", "a", "b", latency=20),
        record("3", "b", "b", latency=30),
        record("4", "b", "b", latency=40),
        record("5", "c", None, latency=50),
        record("6", "c", None, latency=60, error_type="http.500"),
    ]

    metrics = aggregate_records(
        records,
        denominator_policy="all_scoring_samples",
        on_api_error="count_as_incorrect",
        on_parse_error="count_as_incorrect",
        labels=["a", "b", "c"],
    )

    assert metrics["accuracy"] == 0.5
    assert metrics["accuracy_numerator"] == 3
    assert metrics["accuracy_denominator"] == 6
    assert metrics["api_errors"] == 1
    assert metrics["parse_errors"] == 1
    assert metrics["scored_samples"] == 4
    assert metrics["micro_f1"] == pytest.approx(0.6)
    assert metrics["macro_f1"] == pytest.approx((2 / 3 + 0.8 + 0) / 3)
    assert metrics["latency_success_p50_ms"] == 30
    assert metrics["latency_all_p50_ms"] == 35


def test_aggregate_applies_independent_error_policies() -> None:
    records = [
        record("1", "a", "a", latency=10),
        record("2", "a", None, latency=20),
        record("3", "a", None, latency=30, error_type="transport.timeout"),
    ]

    metrics = aggregate_records(
        records,
        denominator_policy="all_scoring_samples",
        on_api_error="exclude_and_report",
        on_parse_error="count_as_incorrect",
        labels=["a"],
    )

    assert metrics["accuracy"] == 0.5
    assert metrics["accuracy_denominator"] == 2
    assert metrics["api_errors"] == 1
    assert metrics["parse_errors"] == 1
    assert metrics["micro_f1"] == pytest.approx(2 / 3)


def test_aggregate_uses_scorer_primary_metric_name() -> None:
    base = record("1", "1", "1", latency=10)
    numeric_record = EvaluationRecord(
        sample=base.sample,
        request=base.request,
        inference=base.inference,
        answer=base.answer,
        score=SampleScore(1.0, {"numeric_match": 1.0}, True, None, "1"),
    )

    metrics = aggregate_records([numeric_record])

    assert metrics["primary_metric"] == "numeric_match"
    assert metrics["numeric_match"] == 1.0
    assert metrics["numeric_match_denominator"] == 1
