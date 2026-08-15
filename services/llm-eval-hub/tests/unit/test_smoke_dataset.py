from __future__ import annotations

from pathlib import Path

from packages.eval_engine.datasets import validate_dataset
from packages.eval_engine.rendering import JinjaPromptRenderer

ROOT = (
    Path(__file__).parents[2]
    / "datasets"
    / "smoke"
    / "inferstation-accuracy-pipeline-smoke-10"
)


def test_accuracy_pipeline_smoke_dataset_is_small_and_unmistakable() -> None:
    validated = validate_dataset(ROOT / "manifest.yaml")
    metadata = validated.manifest.metadata

    assert len(validated.samples) == 10
    assert metadata.name == "inferstation-accuracy-pipeline-smoke-10"
    assert "SMOKE TEST ONLY" in metadata.display_name
    assert "not-for-accuracy-reporting" in metadata.tags
    assert "Never use" in metadata.description


def test_accuracy_pipeline_smoke_prompt_and_answers_are_valid() -> None:
    validated = validate_dataset(ROOT / "manifest.yaml")
    renderer = JinjaPromptRenderer(
        validated.manifest.request.model_dump(mode="json"),
        "smoke-model",
    )
    request = renderer.render(validated.samples[0])

    assert request.mode == "chat_completions"
    assert request.messages is not None
    assert "connectivity smoke test" in request.messages[0]["content"]
    assert all(sample.reference in {"A", "B", "C", "D"} for sample in validated.samples)
