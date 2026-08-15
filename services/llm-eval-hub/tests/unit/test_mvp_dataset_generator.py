from __future__ import annotations

import json
from pathlib import Path

from packages.eval_engine.datasets.manifest import validate_dataset
from tests.fixtures.generate_mvp_dataset import SEED, generate

PROJECT_ROOT = Path(__file__).parents[2]
FROZEN_FIXTURES = PROJECT_ROOT / "datasets" / "experiments"


def _files(root: Path) -> dict[str, bytes]:
    return {
        str(path.relative_to(root)): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def test_generation_is_byte_for_byte_deterministic(tmp_path: Path) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"

    first_lock = generate(first, SEED)
    second_lock = generate(second, SEED)

    assert first_lock == second_lock
    assert _files(first) == _files(second)


def test_generated_datasets_match_contract_and_expected_counts(tmp_path: Path) -> None:
    output = tmp_path / "fixtures"
    lock = generate(output, SEED)
    expected_counts = {
        "mvp-golden-v1": 100,
        "mvp-scale-v1": 1000,
        "mvp-faults-v1": 120,
        "mvp-numeric-v1": 100,
    }

    assert set(lock["datasets"]) == set(expected_counts)
    for name, count in expected_counts.items():
        validated = validate_dataset(output / name / "manifest.yaml")
        expected = json.loads((output / name / "expected.json").read_text())
        assert len(validated.samples) == count
        assert lock["datasets"][name]["rows"] == count
        assert expected["data_checksum_sha256"] == validated.checksum_sha256
        assert expected["metrics"]["total_samples"] == count


def test_frozen_fixtures_match_generator(tmp_path: Path) -> None:
    generated = tmp_path / "fixtures"
    generate(generated, SEED)

    assert _files(generated) == _files(FROZEN_FIXTURES)
