from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any

import httpx
import yaml

PROJECT_ROOT = Path(__file__).parents[1]
BENCHMARK_ROOT = PROJECT_ROOT / "datasets" / "benchmarks"
SMOKE_ROOT = PROJECT_ROOT / "datasets" / "smoke"
DATASET_PACKS = (
    BENCHMARK_ROOT / "gsm8k-native",
    BENCHMARK_ROOT / "mmlu-lite-native",
    BENCHMARK_ROOT / "mmlu-full-native",
    SMOKE_ROOT / "inferstation-accuracy-pipeline-smoke-10",
)


def register(api_base: str, api_key: str) -> list[dict[str, Any]]:
    headers = {"X-API-Key": api_key}
    results: list[dict[str, Any]] = []
    with httpx.Client(base_url=f"{api_base.rstrip('/')}/", headers=headers, timeout=120) as client:
        response = client.get("datasets")
        response.raise_for_status()
        existing = {dataset["name"]: dataset for dataset in response.json()}

        for root in DATASET_PACKS:
            manifest_path = root / "manifest.yaml"
            data_path = root / "data" / "test.jsonl"
            manifest = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
            metadata = manifest["metadata"]
            name = metadata["name"]
            dataset = existing.get(name)
            if dataset is None:
                response = client.post(
                    "datasets",
                    json={
                        "name": name,
                        "display_name": metadata["display_name"],
                        "owner": metadata["owner"],
                        "sensitivity": "internal",
                        "description": metadata["description"],
                    },
                )
                response.raise_for_status()
                dataset = response.json()
                existing[name] = dataset

            matching = [
                version
                for version in dataset.get("versions", [])
                if version["version"] == metadata["version"]
            ]
            if matching:
                version = matching[0]
                if version["checksum"] != manifest["data"]["checksum_sha256"]:
                    raise RuntimeError(
                        "Existing immutable version checksum mismatch for "
                        f"{name}@{metadata['version']}"
                    )
                if version["manifest_json"] != manifest:
                    raise RuntimeError(
                        f"Existing immutable manifest mismatch for {name}@{metadata['version']}"
                    )
                action = "unchanged"
            else:
                with manifest_path.open("rb") as manifest_file, data_path.open("rb") as data_file:
                    response = client.post(
                        f"datasets/{dataset['id']}/versions",
                        files={
                            "manifest_file": ("manifest.yaml", manifest_file, "application/yaml"),
                            "data_file": ("test.jsonl", data_file, "application/x-ndjson"),
                        },
                    )
                response.raise_for_status()
                version = response.json()
                action = "created"
            results.append(
                {
                    "name": name,
                    "dataset_id": dataset["id"],
                    "version_id": version["id"],
                    "version": version["version"],
                    "rows": version["row_count"],
                    "action": action,
                }
            )
    return results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Idempotently register benchmark and pipeline-smoke datasets"
    )
    parser.add_argument("--api-base", default="http://127.0.0.1:18000/api/v1")
    args = parser.parse_args()
    api_key = os.environ.get("ADMIN_API_KEY", "inferstation-local-dev-key")
    for result in register(args.api_base, api_key):
        print(
            f"{result['action']}: {result['name']}@{result['version']} "
            f"({result['rows']} rows, version_id={result['version_id']})"
        )


if __name__ == "__main__":
    main()
