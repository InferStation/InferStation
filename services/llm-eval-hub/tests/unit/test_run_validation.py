from types import SimpleNamespace

from apps.api.app.api.v1.runs import _dataset_selection_warnings


def version(name: str, subset_of: str | None = None) -> SimpleNamespace:
    protocol = {"id": f"{name}-protocol"}
    if subset_of:
        protocol["subset_of"] = subset_of
    return SimpleNamespace(
        manifest_json={"metadata": {"name": name}, "protocol": protocol}
    )


def test_selected_dataset_subset_warns_about_duplicate_requests() -> None:
    warnings = _dataset_selection_warnings(
        [
            version("mmlu-lite-native", "mmlu-full-native"),
            version("mmlu-full-native"),
        ]
    )

    assert warnings == [
        "mmlu-lite-native is a subset of mmlu-full-native; "
        "selecting both repeats samples and model requests"
    ]


def test_dataset_subset_alone_has_no_warning() -> None:
    assert _dataset_selection_warnings(
        [version("mmlu-lite-native", "mmlu-full-native")]
    ) == []
