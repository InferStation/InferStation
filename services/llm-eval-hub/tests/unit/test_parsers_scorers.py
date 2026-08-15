import pytest

from packages.eval_engine.contracts import EvalSample, InferenceResult
from packages.eval_engine.parsers import create_parser
from packages.eval_engine.scorers import create_scorer


def inference(text: str | None) -> InferenceResult:
    return InferenceResult("r1", {}, text, 10.0)


def test_label_parser_normalizes_and_classification_scorer_matches() -> None:
    sample = EvalSample("s1", {}, "billing")
    parser = create_parser(
        {
            "type": "label_set",
            "version": "1",
            "labels": ["billing", "technical", "account"],
            "normalize": ["trim", "unicode_nfkc", "lowercase"],
        }
    )
    scorer = create_scorer({"type": "classification", "primary_metric": "accuracy"})

    answer = parser.parse(sample, inference("  BILLING\n"))
    score = scorer.score(sample, answer)

    assert answer.status == "ok"
    assert answer.value == "billing"
    assert score.primary == 1.0
    assert score.passed is True


@pytest.mark.parametrize(
    ("text", "expected"),
    [("Answer: C", "C"), ("（B）", "B"), ("I choose A.", "A")],
)
def test_choice_parser_extracts_standalone_letter(text: str, expected: str) -> None:
    parser = create_parser({"type": "choice_letter", "allowed": ["A", "B", "C", "D"]})
    answer = parser.parse(EvalSample("s1", {}, expected), inference(text))

    assert answer.value == expected
    assert answer.status == "ok"


def test_numeric_match_respects_absolute_tolerance() -> None:
    sample = EvalSample("s1", {}, "3.14")
    parser = create_parser({"type": "numeric"})
    scorer = create_scorer(
        {"type": "numeric_match", "primary_metric": "numeric_match", "absolute_tolerance": 0.01}
    )

    answer = parser.parse(sample, inference("The result is 3.145."))

    assert scorer.score(sample, answer).passed is True


def test_numeric_parser_can_select_last_number_for_reasoned_answers() -> None:
    sample = EvalSample("s1", {}, "18")
    parser = create_parser({"type": "numeric", "selection": "last"})

    answer = parser.parse(sample, inference("16 - 7 = 9, then 9 * 2 = 18"))

    assert answer.status == "ok"
    assert answer.value == "18"


def test_parser_failure_is_not_silently_scored_as_wrong() -> None:
    sample = EvalSample("s1", {}, "billing")
    parser = create_parser({"type": "label_set", "labels": ["billing"]})
    scorer = create_scorer({"type": "classification", "primary_metric": "accuracy"})

    score = scorer.score(sample, parser.parse(sample, inference("maybe")))

    assert score.primary is None
    assert score.passed is None
    assert score.reason == "parser.no_match"
