from copy import deepcopy

import pytest

from packages.eval_engine.fingerprint import canonical_json, protocol_fingerprint

BASE_SPEC = {
    "endpoint_revision_id": "revision-1",
    "endpoint_config_hash": "a" * 64,
    "model_id": "model-1",
    "model_name": "mock-intent-v1",
    "datasets": [
        {
            "dataset_version_id": "dataset-version-1",
            "dataset_checksum": "b" * 64,
            "manifest": {
                "request": {
                    "messages": [
                        {"role": "system", "content": "Return one label."},
                        {"role": "user", "content": "{{ question }}"},
                    ]
                },
                "protocol": {
                    "parser": {"type": "label_set", "version": "1"},
                    "scorer": {"type": "classification", "version": "1"},
                },
            },
        }
    ],
    "inference": {"temperature": 0, "top_p": 1, "max_tokens": 8, "seed": 20260811},
    "execution": {"concurrency": 8, "qps": 100, "timeout_seconds": 30, "max_retries": 2},
    "engine_version": "0.1.0",
}


def test_fingerprint_is_stable_across_mapping_order() -> None:
    left = {"protocol": {"parser": "v1", "labels": ["a", "b"]}, "temperature": 0}
    right = {"temperature": 0, "protocol": {"labels": ["a", "b"], "parser": "v1"}}

    assert canonical_json(left) == canonical_json(right)
    assert protocol_fingerprint(left) == protocol_fingerprint(right)


def test_fingerprint_changes_when_protocol_changes() -> None:
    baseline = {"dataset_checksum": "abc", "parser": {"version": "1"}}
    changed = {"dataset_checksum": "abc", "parser": {"version": "2"}}

    assert protocol_fingerprint(baseline) != protocol_fingerprint(changed)


def test_fingerprint_rejects_non_finite_values() -> None:
    with pytest.raises(ValueError, match="NaN or infinity"):
        canonical_json({"temperature": float("nan")})


def test_full_run_fingerprint_is_stable_and_frozen() -> None:
    reordered = {key: BASE_SPEC[key] for key in reversed(BASE_SPEC)}

    assert protocol_fingerprint(BASE_SPEC) == protocol_fingerprint(deepcopy(BASE_SPEC))
    assert protocol_fingerprint(BASE_SPEC) == protocol_fingerprint(reordered)
    assert protocol_fingerprint(BASE_SPEC) == (
        "cb0da948f656dbdd8f0219fb803afbd817ef1d9ee3f9a2c2570fda4f5534f07b"
    )


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("datasets", 0, "manifest", "request", "messages", 0, "content"), "Changed prompt"),
        (("datasets", 0, "manifest", "protocol", "scorer", "version"), "2"),
        (("datasets", 0, "dataset_checksum"), "c" * 64),
        (("inference", "seed"), 20260812),
    ],
    ids=["prompt", "scorer", "dataset-checksum", "seed"],
)
def test_protocol_inputs_each_change_fingerprint(
    path: tuple[str | int, ...], value: object
) -> None:
    changed = deepcopy(BASE_SPEC)
    target: object = changed
    for key in path[:-1]:
        target = target[key]  # type: ignore[index]
    target[path[-1]] = value  # type: ignore[index]

    assert protocol_fingerprint(changed) != protocol_fingerprint(BASE_SPEC)
