from pathlib import Path

import pytest
import yaml

from packages.eval_engine.datasets import DatasetValidationError, validate_dataset

EXAMPLE = Path("datasets/examples/intent-classification/manifest.yaml")


def test_golden_dataset_is_valid_and_materializes_samples() -> None:
    validated = validate_dataset(EXAMPLE)

    assert validated.manifest.metadata.version == "2026.08.1"
    assert len(validated.samples) == 12
    assert validated.samples[0].sample_id == "s-0001"
    assert validated.samples[0].inputs == {"question": "为什么信用卡被扣了两次？"}
    assert validated.samples[0].reference == "billing"


def test_checksum_mismatch_is_rejected(tmp_path: Path) -> None:
    data_path = tmp_path / "changed.jsonl"
    data_path.write_text('{"id":"x","question":"x","label":"billing"}\n', encoding="utf-8")

    with pytest.raises(DatasetValidationError, match="checksum mismatch"):
        validate_dataset(EXAMPLE, data_path)


def test_declared_data_path_cannot_escape_when_override_is_used(tmp_path: Path) -> None:
    manifest = yaml.safe_load(EXAMPLE.read_text())
    manifest["data"]["path"] = "../outside.jsonl"
    manifest_path = tmp_path / "manifest.yaml"
    manifest_path.write_text(yaml.safe_dump(manifest), encoding="utf-8")

    with pytest.raises(DatasetValidationError, match="data.path must stay inside"):
        validate_dataset(manifest_path, EXAMPLE.parent / "data" / "test.jsonl")


def test_dataset_version_rejects_path_characters(tmp_path: Path) -> None:
    manifest = yaml.safe_load(EXAMPLE.read_text())
    manifest["metadata"]["version"] = "../../escape"
    manifest_path = tmp_path / "manifest.yaml"
    manifest_path.write_text(yaml.safe_dump(manifest), encoding="utf-8")

    with pytest.raises(DatasetValidationError, match="manifest metadata.version"):
        validate_dataset(manifest_path, EXAMPLE.parent / "data" / "test.jsonl")
