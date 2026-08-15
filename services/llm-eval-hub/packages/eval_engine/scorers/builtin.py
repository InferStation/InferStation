from __future__ import annotations

import math
import unicodedata
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from packages.eval_engine.contracts import EvalSample, ParsedAnswer, SampleScore


def _normalized_text(value: Any) -> str:
    return " ".join(unicodedata.normalize("NFKC", str(value)).strip().lower().split())


@dataclass(frozen=True)
class BuiltinScorer:
    config: dict[str, Any]

    @property
    def version(self) -> str:
        return str(self.config.get("version", "1"))

    def score(self, sample: EvalSample, answer: ParsedAnswer) -> SampleScore:
        if answer.status != "ok":
            return SampleScore(None, {}, None, f"parser.{answer.status}", self.version)

        scorer_type = self.config["type"]
        if scorer_type in {"classification", "exact_choice", "exact_match"}:
            passed = answer.value == sample.reference
        elif scorer_type == "normalized_exact_match":
            passed = _normalized_text(answer.value) == _normalized_text(sample.reference)
        elif scorer_type == "numeric_match":
            try:
                prediction = Decimal(str(answer.value))
                reference = Decimal(str(sample.reference))
            except InvalidOperation:
                return SampleScore(None, {}, None, "scorer.invalid_numeric_reference", self.version)
            absolute = Decimal(str(self.config.get("absolute_tolerance", 0)))
            relative = Decimal(str(self.config.get("relative_tolerance", 0)))
            tolerance = max(absolute, relative * abs(reference))
            passed = abs(prediction - reference) <= tolerance
        else:
            raise ValueError(f"Unsupported scorer type: {scorer_type}")

        primary = 1.0 if passed else 0.0
        metric_name = str(self.config.get("primary_metric", "accuracy"))
        if not math.isfinite(primary):
            raise ValueError("Score must be finite")
        return SampleScore(
            primary,
            {metric_name: primary},
            passed,
            None if passed else "mismatch",
            self.version,
        )


def create_scorer(config: dict[str, Any]) -> BuiltinScorer:
    supported = {
        "classification",
        "exact_choice",
        "exact_match",
        "normalized_exact_match",
        "numeric_match",
    }
    if config.get("type") not in supported:
        raise ValueError(f"Unsupported scorer type: {config.get('type')}")
    return BuiltinScorer(config=config)
