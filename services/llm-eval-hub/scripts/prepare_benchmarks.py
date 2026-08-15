from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tempfile
import urllib.request
from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import duckdb
import yaml

PROJECT_ROOT = Path(__file__).parents[1]
HF_ROOT = PROJECT_ROOT / "hf_cache"
OUTPUT_ROOT = PROJECT_ROOT / "datasets" / "benchmarks"
TRANSFORM_VERSION = "1"
LITE_SEED = "mmlu-lite-v1-20260812"

SOURCES = {
    "gsm8k": {
        "repo": "openai/gsm8k",
        "url": "https://huggingface.co/datasets/openai/gsm8k",
        "license": "MIT",
        "revision": "740312add88f781978c0658806c59bc2815b9866",
        "files": {
            "README.md": "a17e882503578c9e324560630e31017617714ee025c87cf4fea6fd916895f3c1",
            "main/test-00000-of-00001.parquet": (
                "ee7b8da9e381df27b9e3f7758a159ab2bdaa4dbaa910546cbbc47e0cb44e4f59"
            ),
        },
    },
    "mmlu": {
        "repo": "cais/mmlu",
        "url": "https://huggingface.co/datasets/cais/mmlu",
        "license": "MIT",
        "revision": "c30699e8356da336a370243923dbaf21066bb9fe",
        "files": {
            "README.md": "665eef35ecd8a89037c1e4f1e1a0d7fd4c154edc04c81cea5634ace2d3e96953",
            "all/test-00000-of-00001.parquet": (
                "74a41822ce7d3def56e1682f958469c04642a5336a5ce912fa375fdb90fb25d7"
            ),
        },
    },
}

MMLU_DOMAINS = {
    "humanities": {
        "formal_logic", "high_school_european_history", "high_school_us_history",
        "high_school_world_history", "international_law", "jurisprudence",
        "logical_fallacies", "moral_disputes", "moral_scenarios", "philosophy",
        "prehistory", "professional_law", "world_religions",
    },
    "social_sciences": {
        "econometrics", "high_school_geography", "high_school_government_and_politics",
        "high_school_macroeconomics", "high_school_microeconomics",
        "high_school_psychology", "human_sexuality", "professional_psychology",
        "public_relations", "security_studies", "sociology", "us_foreign_policy",
    },
    "stem": {
        "abstract_algebra", "anatomy", "astronomy", "college_biology",
        "college_chemistry", "college_computer_science", "college_mathematics",
        "college_physics", "computer_security", "conceptual_physics",
        "electrical_engineering", "elementary_mathematics", "high_school_biology",
        "high_school_chemistry", "high_school_computer_science",
        "high_school_mathematics", "high_school_physics", "high_school_statistics",
        "machine_learning",
    },
    "other": {
        "business_ethics", "clinical_knowledge", "college_medicine", "global_facts",
        "human_aging", "management", "marketing", "medical_genetics", "miscellaneous",
        "nutrition", "professional_accounting", "professional_medicine", "virology",
    },
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def source_path(source: dict[str, Any], relative: str) -> Path:
    repo_cache = f"datasets--{source['repo'].replace('/', '--')}"
    return HF_ROOT / "hub" / repo_cache / "snapshots" / source["revision"] / relative


def download_sources() -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for source in SOURCES.values():
        for relative, expected_sha in source["files"].items():
            destination = source_path(source, relative)
            destination.parent.mkdir(parents=True, exist_ok=True)
            url = (
                f"https://huggingface.co/datasets/{source['repo']}/resolve/"
                f"{source['revision']}/{relative}"
            )
            if not destination.is_file() or sha256(destination) != expected_sha:
                with tempfile.NamedTemporaryFile(
                    dir=destination.parent, prefix=f".{destination.name}.", delete=False
                ) as temporary:
                    temporary_path = Path(temporary.name)
                try:
                    urllib.request.urlretrieve(url, temporary_path)
                    actual_sha = sha256(temporary_path)
                    if actual_sha != expected_sha:
                        raise RuntimeError(
                            f"Source checksum mismatch for {source['repo']}/{relative}: "
                            f"expected {expected_sha}, got {actual_sha}"
                        )
                    temporary_path.replace(destination)
                finally:
                    temporary_path.unlink(missing_ok=True)
            actual_sha = sha256(destination)
            if actual_sha != expected_sha:
                raise RuntimeError(f"Cached source checksum mismatch: {destination}")
            records.append(
                {
                    "repo": source["repo"],
                    "revision": source["revision"],
                    "file": relative,
                    "sha256": actual_sha,
                    "size_bytes": destination.stat().st_size,
                    "url": url,
                }
            )
    return records


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(f"{canonical_json(row)}\n" for row in rows), encoding="utf-8")
    return sha256(path)


def manifest_base(
    *,
    name: str,
    display_name: str,
    version: str,
    description: str,
    checksum: str,
    input_fields: list[str],
    reference_field: str,
    metadata_fields: list[str],
    request: dict[str, Any],
    protocol: dict[str, Any],
    groups: list[dict[str, str]],
    required_fields: list[str],
) -> dict[str, Any]:
    return {
        "api_version": "eval-dataset/v1",
        "kind": "Dataset",
        "metadata": {
            "name": name,
            "display_name": display_name,
            "version": version,
            "description": description,
            "language": ["en"],
            "license": "MIT",
            "owner": "ai-platform",
            "tags": ["benchmark", "native-chat", "generated-text", "frozen"],
        },
        "data": {
            "format": "jsonl",
            "path": "data/test.jsonl",
            "split": "test",
            "checksum_sha256": checksum,
            "id_field": "id",
            "input_fields": input_fields,
            "reference_field": reference_field,
            "metadata_fields": metadata_fields,
        },
        "request": request,
        "protocol": protocol,
        "groups": groups,
        "validation": {
            "required_fields": required_fields,
            "unique_by": ["id"],
            "allowed_values": {},
        },
    }


def write_manifest(root: Path, manifest: dict[str, Any]) -> str:
    path = root / "manifest.yaml"
    path.write_text(
        yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False, width=1000),
        encoding="utf-8",
    )
    return sha256(path)


def read_parquet(path: Path, columns: str) -> list[tuple[Any, ...]]:
    escaped = str(path).replace("'", "''")
    with duckdb.connect() as connection:
        return connection.sql(f"SELECT {columns} FROM read_parquet('{escaped}')").fetchall()


def build_gsm8k() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    source = SOURCES["gsm8k"]
    parquet = source_path(source, "main/test-00000-of-00001.parquet")
    rows: list[dict[str, Any]] = []
    for index, (question, source_answer) in enumerate(read_parquet(parquet, "question, answer")):
        match = re.search(r"####\s*([^\n]+)\s*$", source_answer)
        if not match:
            raise RuntimeError(f"GSM8K row {index} has no final #### answer")
        reference = match.group(1).strip().replace(",", "")
        try:
            Decimal(reference)
        except InvalidOperation as exc:
            raise RuntimeError(f"GSM8K row {index} has non-numeric answer {reference!r}") from exc
        rows.append(
            {
                "id": f"gsm8k-test-{index:04d}",
                "question": question,
                "answer": reference,
                "source_index": index,
            }
        )
    if len(rows) != 1319:
        raise RuntimeError(f"Expected 1319 GSM8K test rows, got {len(rows)}")

    data_sha = write_jsonl(OUTPUT_ROOT / "gsm8k-native" / "data" / "test.jsonl", rows)
    manifest = manifest_base(
        name="gsm8k-native",
        display_name="GSM8K Native Chat (Test)",
        version="740312a-native-chat-v1",
        description=(
            "GSM8K main test split frozen from openai/gsm8k@740312a. "
            "Zero-shot generated numeric answer; not the lm-evaluation-harness 5-shot protocol."
        ),
        checksum=data_sha,
        input_fields=["question"],
        reference_field="answer",
        metadata_fields=["source_index"],
        request={
            "mode": "chat_completions",
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Solve the problem. Reply with only the final numeric answer "
                        "and no explanation."
                    ),
                },
                {"role": "user", "content": "{{ question }}"},
            ],
            "parameters": {"temperature": 0, "max_tokens": 32},
            "stop": [],
        },
        protocol={
            "id": "gsm8k-native-chat-0shot-v1",
            "task_type": "numeric_answer",
            "prediction_source": "generated_text",
            "few_shot": {"count": 0, "selection": "fixed", "sample_ids": []},
            "parser": {"type": "numeric", "version": "2", "selection": "last"},
            "scorer": {
                "type": "numeric_match",
                "version": "1",
                "primary_metric": "numeric_match",
                "absolute_tolerance": 0,
                "relative_tolerance": 0,
            },
            "denominator_policy": "all_scoring_samples",
            "on_api_error": "exclude_and_report",
            "on_parse_error": "count_as_incorrect",
        },
        groups=[],
        required_fields=["id", "question", "answer", "source_index"],
    )
    manifest_sha = write_manifest(OUTPUT_ROOT / "gsm8k-native", manifest)
    return rows, {"rows": len(rows), "data_sha256": data_sha, "manifest_sha256": manifest_sha}


def mmlu_domain(subject: str) -> str:
    matches = [domain for domain, subjects in MMLU_DOMAINS.items() if subject in subjects]
    if len(matches) != 1:
        raise RuntimeError(f"MMLU subject {subject!r} maps to {len(matches)} domains")
    return matches[0]


def mmlu_row(
    source_index: int,
    subject_index: int,
    question: str,
    subject: str,
    choices: list[str],
    answer: int,
) -> dict[str, Any]:
    if len(choices) != 4 or answer not in range(4):
        raise RuntimeError(f"Invalid MMLU row at source index {source_index}")
    return {
        "id": f"mmlu-test-{source_index:05d}",
        "question": question,
        "subject": subject,
        "subject_display": subject.replace("_", " "),
        "choice_a": choices[0],
        "choice_b": choices[1],
        "choice_c": choices[2],
        "choice_d": choices[3],
        "answer": "ABCD"[answer],
        "domain": mmlu_domain(subject),
        "source_index": source_index,
        "subject_index": subject_index,
    }


def mmlu_manifest(
    name: str,
    display_name: str,
    protocol_id: str,
    checksum: str,
    note: str,
) -> dict[str, Any]:
    source = SOURCES["mmlu"]
    return manifest_base(
        name=name,
        display_name=display_name,
        version="c30699e-native-chat-v1",
        description=(
            f"MMLU all/test frozen from cais/mmlu@{source['revision'][:8]}. {note} "
            "Zero-shot generated choice letters; not official loglikelihood MMLU."
        ),
        checksum=checksum,
        input_fields=[
            "question", "subject_display", "choice_a", "choice_b", "choice_c", "choice_d"
        ],
        reference_field="answer",
        metadata_fields=["subject", "domain", "source_index", "subject_index"],
        request={
            "mode": "chat_completions",
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Answer the multiple-choice question. Reply with exactly one letter: "
                        "A, B, C, or D."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "Subject: {{ subject_display }}\n\n{{ question }}\n\n"
                        "A. {{ choice_a }}\nB. {{ choice_b }}\nC. {{ choice_c }}\n"
                        "D. {{ choice_d }}\n\nAnswer:"
                    ),
                },
            ],
            "parameters": {"temperature": 0, "max_tokens": 4},
            "stop": [],
        },
        protocol={
            "id": protocol_id,
            "task_type": "multiple_choice_generation",
            "prediction_source": "generated_text",
            "few_shot": {"count": 0, "selection": "fixed", "sample_ids": []},
            "parser": {"type": "choice_letter", "version": "1", "allowed": ["A", "B", "C", "D"]},
            "scorer": {"type": "exact_choice", "version": "1", "primary_metric": "accuracy"},
            "denominator_policy": "all_scoring_samples",
            "on_api_error": "exclude_and_report",
            "on_parse_error": "count_as_incorrect",
        },
        groups=[{"field": "subject"}, {"field": "domain"}],
        required_fields=[
            "id", "question", "subject", "subject_display", "choice_a", "choice_b",
            "choice_c", "choice_d", "answer", "domain", "source_index", "subject_index",
        ],
    )


def build_mmlu() -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    source = SOURCES["mmlu"]
    parquet = source_path(source, "all/test-00000-of-00001.parquet")
    source_rows = read_parquet(parquet, "question, subject, choices, answer")
    subject_counts: dict[str, int] = defaultdict(int)
    full: list[dict[str, Any]] = []
    for source_index, (question, subject, choices, answer) in enumerate(source_rows):
        subject_index = subject_counts[subject]
        subject_counts[subject] += 1
        full.append(mmlu_row(source_index, subject_index, question, subject, choices, answer))
    if len(full) != 14042 or len(subject_counts) != 57:
        raise RuntimeError(
            f"Expected 14042 rows across 57 MMLU subjects, got {len(full)} "
            f"across {len(subject_counts)}"
        )
    configured_subjects = set().union(*MMLU_DOMAINS.values())
    if configured_subjects != set(subject_counts):
        raise RuntimeError(
            f"MMLU domain mapping mismatch: missing={set(subject_counts) - configured_subjects}, "
            f"extra={configured_subjects - set(subject_counts)}"
        )

    candidates: dict[str, list[tuple[str, dict[str, Any]]]] = defaultdict(list)
    for row in full:
        selection_key = hashlib.sha256(
            f"{LITE_SEED}:{row['id']}:{row['question']}".encode()
        ).hexdigest()
        candidates[row["subject"]].append((selection_key, row))
    lite = sorted(
        [row for subject in sorted(candidates) for _, row in sorted(candidates[subject])[:10]],
        key=lambda row: row["source_index"],
    )
    if len(lite) != 570:
        raise RuntimeError(f"Expected 570 MMLU Lite rows, got {len(lite)}")

    results: dict[str, Any] = {
        "source_rows": len(full),
        "subjects": len(subject_counts),
        "lite_seed": LITE_SEED,
        "lite_rows_per_subject": 10,
    }
    for name, display_name, protocol_id, rows, note in (
        (
            "mmlu-lite-native", "MMLU Lite Native Chat (570)",
            "mmlu-native-chat-0shot-lite-v1", lite,
            f"Deterministic {LITE_SEED} sample of 10 rows per each of 57 subjects.",
        ),
        (
            "mmlu-full-native", "MMLU Full Native Chat (14,042)",
            "mmlu-native-chat-0shot-full-v1", full,
            "Complete 14,042-row test split across 57 subjects.",
        ),
    ):
        root = OUTPUT_ROOT / name
        data_sha = write_jsonl(root / "data" / "test.jsonl", rows)
        manifest = mmlu_manifest(name, display_name, protocol_id, data_sha, note)
        if name == "mmlu-lite-native":
            manifest["protocol"]["subset_of"] = "mmlu-full-native"
        manifest_sha = write_manifest(
            root,
            manifest,
        )
        results[name] = {
            "rows": len(rows),
            "data_sha256": data_sha,
            "manifest_sha256": manifest_sha,
        }
    return lite, full, results


def generate() -> dict[str, Any]:
    download_records = download_sources()
    gsm8k, gsm8k_result = build_gsm8k()
    lite, full, mmlu_result = build_mmlu()
    if not {row["id"] for row in lite}.issubset({row["id"] for row in full}):
        raise RuntimeError("MMLU Lite is not a subset of MMLU Full")

    lock = {
        "transform_version": TRANSFORM_VERSION,
        "sources": SOURCES,
        "datasets": {
            "gsm8k-native": gsm8k_result,
            "mmlu-lite-native": mmlu_result["mmlu-lite-native"],
            "mmlu-full-native": mmlu_result["mmlu-full-native"],
        },
        "assertions": {
            "gsm8k_rows": len(gsm8k),
            "mmlu_full_rows": len(full),
            "mmlu_lite_rows": len(lite),
            "mmlu_subjects": mmlu_result["subjects"],
            "mmlu_lite_rows_per_subject": mmlu_result["lite_rows_per_subject"],
            "mmlu_lite_seed": mmlu_result["lite_seed"],
        },
    }
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    (OUTPUT_ROOT / "source-lock.json").write_text(
        json.dumps(lock, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    download_manifest = {
        "generated_at": datetime.now(UTC).isoformat(),
        "hf_home": str(HF_ROOT),
        "files": download_records,
    }
    (HF_ROOT / "download-manifest.json").write_text(
        json.dumps(download_manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return lock


def main() -> None:
    parser = argparse.ArgumentParser(description="Download and freeze Native benchmark datasets")
    parser.add_argument("--print-lock", action="store_true")
    args = parser.parse_args()
    for variable, expected in {
        "HF_HOME": HF_ROOT,
        "HF_HUB_CACHE": HF_ROOT / "hub",
        "HF_DATASETS_CACHE": HF_ROOT / "datasets",
        "HUGGINGFACE_HUB_CACHE": HF_ROOT / "hub",
    }.items():
        configured = Path(os.environ.get(variable, expected)).resolve()
        if PROJECT_ROOT.resolve() not in configured.parents:
            raise RuntimeError(f"{variable} must stay inside {PROJECT_ROOT}")
    lock = generate()
    if args.print_lock:
        print(json.dumps(lock, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print(
            "Prepared GSM8K 1,319, MMLU Lite 570, and MMLU Full 14,042 "
            f"under {OUTPUT_ROOT}"
        )


if __name__ == "__main__":
    main()
