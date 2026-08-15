from __future__ import annotations

import json
from collections import Counter
from decimal import Decimal
from pathlib import Path

from packages.eval_engine.datasets import validate_dataset
from packages.eval_engine.rendering import JinjaPromptRenderer

ROOT = Path(__file__).parents[2] / "datasets" / "benchmarks"
EXPECTED_COUNTS = {
    "gsm8k-native": 1319,
    "mmlu-lite-native": 570,
    "mmlu-full-native": 14042,
}


def rows(name: str) -> list[dict]:
    path = ROOT / name / "data" / "test.jsonl"
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle]


def test_frozen_benchmark_manifests_and_lock_match() -> None:
    lock = json.loads((ROOT / "source-lock.json").read_text(encoding="utf-8"))

    for name, expected_count in EXPECTED_COUNTS.items():
        validated = validate_dataset(ROOT / name / "manifest.yaml")
        assert len(validated.samples) == expected_count
        assert lock["datasets"][name]["rows"] == expected_count
        assert lock["datasets"][name]["data_sha256"] == validated.checksum_sha256
        assert validated.manifest.protocol.prediction_source == "generated_text"


def test_gsm8k_references_are_numeric() -> None:
    gsm8k_rows = rows("gsm8k-native")

    assert len(gsm8k_rows) == EXPECTED_COUNTS["gsm8k-native"]
    assert all(Decimal(row["answer"]).is_finite() for row in gsm8k_rows)
    assert [row["source_index"] for row in gsm8k_rows] == list(range(1319))


def test_mmlu_lite_is_balanced_subset_of_full() -> None:
    lite = rows("mmlu-lite-native")
    full = rows("mmlu-full-native")
    lite_ids = {row["id"] for row in lite}
    full_ids = {row["id"] for row in full}

    assert lite_ids < full_ids
    assert len({row["subject"] for row in full}) == 57
    assert set(Counter(row["subject"] for row in lite).values()) == {10}
    assert {row["answer"] for row in lite + full} == {"A", "B", "C", "D"}
    assert {row["domain"] for row in full} == {
        "humanities",
        "other",
        "social_sciences",
        "stem",
    }


def test_mmlu_prompt_renders_all_choices() -> None:
    validated = validate_dataset(ROOT / "mmlu-lite-native" / "manifest.yaml")
    renderer = JinjaPromptRenderer(
        validated.manifest.request.model_dump(mode="json"),
        "benchmark-model",
    )

    request = renderer.render(validated.samples[0])

    assert request.mode == "chat_completions"
    assert request.messages is not None
    user_prompt = request.messages[-1]["content"]
    assert all(f"{letter}. " in user_prompt for letter in "ABCD")
    assert "{{" not in user_prompt
    assert request.params["temperature"] == 0
