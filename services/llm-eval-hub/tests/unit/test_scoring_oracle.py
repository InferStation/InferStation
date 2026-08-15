from __future__ import annotations

import json
import random
import re
from pathlib import Path

import pytest

from packages.eval_engine.aggregators import aggregate_records
from packages.eval_engine.contracts import (
    EvalSample,
    EvaluationRecord,
    InferenceResult,
    ModelRequest,
    ParsedAnswer,
    SampleScore,
)
from packages.eval_engine.parsers import create_parser
from packages.eval_engine.scorers import create_scorer
from tests.oracles.scoring import classification_f1, numeric_matches, percentile

NUMERIC_ROOT = Path("datasets/experiments/mvp-numeric-v1")
LABELS = ["billing", "technical", "account", "unused-label"]


def _record(
    index: int,
    reference: str,
    prediction: str | None,
    status: str,
) -> EvaluationRecord:
    error_type = "http.5xx" if status == "api_error" else None
    answer_status = "no_match" if status == "parse_error" else "ok"
    if status == "api_error":
        answer_status = "upstream_error"
    primary = None if status in {"api_error", "parse_error", "score_error"} else float(
        prediction == reference
    )
    metric_values = {"accuracy": primary} if primary is not None else {}
    return EvaluationRecord(
        sample=EvalSample(str(index), {}, reference),
        request=ModelRequest(str(index), "mock", "chat_completions", [], None, {}),
        inference=InferenceResult(
            str(index),
            {},
            prediction,
            latency_ms=float(index % 97) + 0.25,
            prompt_tokens=index % 11,
            completion_tokens=index % 3,
            error_type=error_type,
        ),
        answer=ParsedAnswer(prediction, answer_status, "1"),
        score=SampleScore(
            primary,
            metric_values,
            bool(primary) if primary is not None else None,
            "forced-score-error" if status == "score_error" else None,
            "1",
        ),
    )


@pytest.mark.parametrize(
    ("denominator_policy", "on_api_error", "on_parse_error"),
    [
        ("all_scoring_samples", "exclude_and_report", "count_as_incorrect"),
        ("all_scoring_samples", "count_as_incorrect", "count_as_incorrect"),
        ("all_scoring_samples", "exclude_and_report", "exclude_and_report"),
        ("valid_responses_only", "count_as_incorrect", "count_as_incorrect"),
    ],
)
def test_aggregate_matches_independent_oracle(
    denominator_policy: str,
    on_api_error: str,
    on_parse_error: str,
) -> None:
    rng = random.Random(20260811)
    statuses = ["scored"] * 400 + ["api_error"] * 40 + ["parse_error"] * 30 + [
        "score_error"
    ] * 30
    rng.shuffle(statuses)
    records: list[EvaluationRecord] = []
    for index, status in enumerate(statuses, start=1):
        reference = LABELS[index % 3]
        prediction = LABELS[rng.randrange(3)] if status in {"scored", "score_error"} else None
        records.append(_record(index, reference, prediction, status))

    actual = aggregate_records(
        records,
        denominator_policy=denominator_policy,
        on_api_error=on_api_error,
        on_parse_error=on_parse_error,
        labels=LABELS,
    )
    scored = [record for record in records if record.score.primary is not None]
    api_errors = [record for record in records if record.inference.error_type]
    parse_errors = [
        record
        for record in records
        if not record.inference.error_type and record.answer.status != "ok"
    ]
    score_errors = [
        record
        for record in records
        if not record.inference.error_type
        and record.answer.status == "ok"
        and record.score.primary is None
    ]
    if denominator_policy == "valid_responses_only":
        denominator = len(scored)
    else:
        denominator = len(scored) + len(score_errors)
        denominator += len(api_errors) if on_api_error == "count_as_incorrect" else 0
        denominator += len(parse_errors) if on_parse_error == "count_as_incorrect" else 0

    references = [record.sample.reference for record in scored]
    predictions = [record.answer.value for record in scored]
    if denominator_policy == "all_scoring_samples":
        if on_api_error == "count_as_incorrect":
            references.extend(record.sample.reference for record in api_errors)
            predictions.extend("__api_error__" for _ in api_errors)
        if on_parse_error == "count_as_incorrect":
            references.extend(record.sample.reference for record in parse_errors)
            predictions.extend("__parse_error__" for _ in parse_errors)
        references.extend(record.sample.reference for record in score_errors)
        predictions.extend("__score_error__" for _ in score_errors)
    expected_f1 = classification_f1(references, predictions, LABELS)

    assert actual["accuracy_denominator"] == denominator
    assert actual["accuracy_numerator"] == sum(record.score.primary or 0 for record in scored)
    for metric_name, expected in expected_f1.items():
        assert actual[metric_name] == pytest.approx(expected, abs=1e-12)
    all_latencies = [record.inference.latency_ms for record in records]
    successful_latencies = [
        record.inference.latency_ms for record in records if not record.inference.error_type
    ]
    for suffix, quantile in (("p50", 0.5), ("p95", 0.95), ("p99", 0.99)):
        assert actual[f"latency_all_{suffix}_ms"] == pytest.approx(
            percentile(all_latencies, quantile), abs=1e-12
        )
        assert actual[f"latency_success_{suffix}_ms"] == pytest.approx(
            percentile(successful_latencies, quantile), abs=1e-12
        )


def test_numeric_fixture_matches_independent_decimal_oracle() -> None:
    data_lines = (NUMERIC_ROOT / "data" / "test.jsonl").read_text().splitlines()
    rows = [json.loads(line) for line in data_lines]
    expected = json.loads((NUMERIC_ROOT / "expected.json").read_text())
    parser = create_parser({"type": "numeric", "version": "1"})
    scorer = create_scorer(
        {
            "type": "numeric_match",
            "version": "1",
            "primary_metric": "numeric_match",
            "absolute_tolerance": 0.01,
            "relative_tolerance": 0.001,
        }
    )
    records: list[EvaluationRecord] = []
    oracle_results: list[bool | None] = []
    for index, row in enumerate(rows, start=1):
        output = re.search(r"\[numeric-output:([^\]]+)\]", row["question"])
        assert output is not None
        output_text = output.group(1)
        sample = EvalSample(row["id"], {"question": row["question"]}, row["expected"])
        inference = InferenceResult(row["id"], {}, output_text, float(index))
        answer = parser.parse(sample, inference)
        score = scorer.score(sample, answer)
        records.append(
            EvaluationRecord(
                sample,
                ModelRequest(row["id"], "mock", "chat_completions", [], None, {}),
                inference,
                answer,
                score,
            )
        )
        oracle_results.append(
            numeric_matches(
                output_text,
                row["expected"],
                absolute_tolerance="0.01",
                relative_tolerance="0.001",
            )
        )

    actual = aggregate_records(records, on_parse_error="count_as_incorrect")
    oracle_numerator = sum(result is True for result in oracle_results)
    oracle_parse_errors = sum(result is None for result in oracle_results)

    assert actual["numeric_match"] == pytest.approx(
        expected["metrics"]["numeric_match"], abs=1e-12
    )
    assert actual["numeric_match_numerator"] == oracle_numerator == 90
    assert actual["numeric_match_denominator"] == len(rows) == 100
    assert actual["parse_errors"] == oracle_parse_errors == 5
