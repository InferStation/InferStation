from __future__ import annotations

import math
from collections import Counter
from collections.abc import Sequence
from decimal import Decimal, InvalidOperation
from typing import Any


def classification_f1(
    references: Sequence[Any], predictions: Sequence[Any], labels: Sequence[Any]
) -> dict[str, float]:
    if len(references) != len(predictions):
        raise ValueError("references and predictions must have the same length")
    confusion = Counter(zip(references, predictions, strict=True))
    per_label: list[tuple[float, int]] = []
    true_positives = false_positives = false_negatives = 0
    for label in labels:
        tp = confusion[label, label]
        fp = sum(
            count
            for (reference, prediction), count in confusion.items()
            if prediction == label and reference != label
        )
        fn = sum(
            count
            for (reference, prediction), count in confusion.items()
            if reference == label and prediction != label
        )
        support = sum(count for (reference, _), count in confusion.items() if reference == label)
        denominator = 2 * tp + fp + fn
        per_label.append(((2 * tp / denominator) if denominator else 0.0, support))
        true_positives += tp
        false_positives += fp
        false_negatives += fn

    macro = sum(score for score, _ in per_label) / len(labels) if labels else 0.0
    total_support = sum(support for _, support in per_label)
    weighted = (
        sum(score * support for score, support in per_label) / total_support
        if total_support
        else 0.0
    )
    micro_denominator = 2 * true_positives + false_positives + false_negatives
    micro = 2 * true_positives / micro_denominator if micro_denominator else 0.0
    return {"macro_f1": macro, "micro_f1": micro, "weighted_f1": weighted}


def numeric_matches(
    prediction: str,
    reference: str,
    *,
    absolute_tolerance: str,
    relative_tolerance: str,
) -> bool | None:
    try:
        predicted_value = Decimal(prediction)
        reference_value = Decimal(reference)
    except InvalidOperation:
        return None
    tolerance = max(
        Decimal(absolute_tolerance), Decimal(relative_tolerance) * abs(reference_value)
    )
    return abs(predicted_value - reference_value) <= tolerance


def percentile(values: Sequence[float], quantile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * quantile
    lower = int(math.floor(position))
    upper = int(math.ceil(position))
    fraction = position - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction
