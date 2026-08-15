from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
from typing import Any

import yaml

SEED = 20260811
GENERATOR_VERSION = "1"
LABELS = ("billing", "technical", "account")

_CLASSIFICATION_QUESTIONS = {
    "billing": (
        "如何申请退款？",
        "信用卡被重复扣款了。",
        "在哪里下载本月发票？",
        "续费价格和页面显示的不一致。",
        "怎样变更当前套餐？",
    ),
    "technical": (
        "接口一直返回 502 错误。",
        "上传文件时页面显示空白。",
        "请求频繁超时怎么办？",
        "控制台页面无法加载。",
        "批量接口返回未知错误。",
    ),
    "account": (
        "登录账号时收不到验证码。",
        "如何修改账号邮箱？",
        "怎样邀请新的团队成员？",
        "在哪里开启两步验证？",
        "账号登录后立即退出。",
    ),
}


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _stable_order(rows: list[dict[str, Any]], seed: int) -> list[dict[str, Any]]:
    return sorted(
        rows,
        key=lambda row: hashlib.sha256(f"{seed}:{row['id']}".encode()).digest(),
    )


def _classification_rows(name: str, count: int, seed: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index in range(count):
        label = LABELS[index % len(LABELS)]
        template_index = (index // len(LABELS)) % len(_CLASSIFICATION_QUESTIONS[label])
        question = f"{_CLASSIFICATION_QUESTIONS[label][template_index]}（样本 {index + 1}）"
        edge_case = "standard"
        if index % 20 == 0:
            question = f"  {question}\t"
            edge_case = "surrounding_whitespace"
        elif index % 20 == 1:
            question = question.replace("？", "？\u3000")
            edge_case = "ideographic_space"
        elif index % 20 == 2:
            question = question.replace("账号", "帳號")
            edge_case = "traditional_unicode"
        rows.append(
            {
                "id": f"{name}-{index + 1:04d}",
                "question": question,
                "label": label,
                "category": label,
                "difficulty": "edge" if edge_case != "standard" else "standard",
                "edge_case": edge_case,
            }
        )
    return _stable_order(rows, seed)


def _fault_rows(seed: int) -> list[dict[str, Any]]:
    fault_markers = {
        "http_401": "[http:401]",
        "http_429": "[http:429]",
        "http_500": "[http:500]",
        "timeout": "[delay:0.20]",
        "invalid_json": "[invalid-json]",
        "schema_mismatch": "[schema-mismatch]",
        "empty": "[empty]",
        "parse_error": "[parse-error]",
    }
    rows: list[dict[str, Any]] = []
    for fault_index, (fault_type, default_marker) in enumerate(fault_markers.items()):
        for offset in range(15):
            sample_id = f"mvp-faults-v1-{fault_index * 15 + offset + 1:04d}"
            marker = default_marker
            recovery = "permanent"
            if fault_type == "http_429" and offset < 5:
                marker = "[fail-first:2:429]"
                recovery = "transient"
            elif fault_type == "http_500" and offset < 5:
                marker = "[fail-first:2:500]"
                recovery = "transient"
            rows.append(
                {
                    "id": sample_id,
                    "question": f"[sample-id:{sample_id}] {marker} 信用卡退款测试",
                    "label": "billing",
                    "fault_type": fault_type,
                    "recovery": recovery,
                }
            )
    return _stable_order(rows, seed)


def _decimal_text(value: Decimal) -> str:
    return format(value.normalize(), "f")


def _numeric_rows(seed: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index in range(100):
        reference = Decimal(index - 50) / Decimal("4")
        category = "exact"
        output = _decimal_text(reference)
        if 80 <= index < 90:
            category = "within_tolerance"
            output = _decimal_text(reference + Decimal("0.005"))
        elif 90 <= index < 95:
            category = "outside_tolerance"
            tolerance = max(Decimal("0.01"), Decimal("0.001") * abs(reference))
            output = _decimal_text(reference + tolerance + Decimal("0.1"))
        elif index >= 95:
            category = "invalid_numeric"
            output = "not-a-number"
        sample_id = f"mvp-numeric-v1-{index + 1:04d}"
        rows.append(
            {
                "id": sample_id,
                "question": (
                    f"[sample-id:{sample_id}] [numeric-output:{output}] "
                    f"请返回数值 {_decimal_text(reference)}"
                ),
                "expected": _decimal_text(reference),
                "category": category,
                "difficulty": "edge" if category != "exact" else "standard",
            }
        )
    return _stable_order(rows, seed)


def _base_manifest(
    *,
    name: str,
    display_name: str,
    description: str,
    checksum: str,
    metadata_fields: list[str],
) -> dict[str, Any]:
    return {
        "api_version": "eval-dataset/v1",
        "kind": "Dataset",
        "metadata": {
            "name": name,
            "display_name": display_name,
            "version": "1.0.0",
            "description": description,
            "language": ["zh-CN"],
            "license": "proprietary",
            "owner": "ai-platform",
            "tags": ["mvp", "experiment", "deterministic"],
        },
        "data": {
            "format": "jsonl",
            "path": "data/test.jsonl",
            "split": "test",
            "checksum_sha256": checksum,
            "id_field": "id",
            "input_fields": ["question"],
            "reference_field": "label",
            "metadata_fields": metadata_fields,
        },
        "request": {
            "mode": "chat_completions",
            "messages": [
                {
                    "role": "system",
                    "content": "你是分类器。只能输出 billing、technical、account 之一。",
                },
                {"role": "user", "content": "{{ question }}"},
            ],
            "parameters": {"temperature": 0, "max_tokens": 8, "seed": SEED},
            "stop": [],
        },
        "protocol": {
            "id": "mvp-intent-chat-greedy-v1",
            "task_type": "single_label_classification",
            "prediction_source": "generated_text",
            "few_shot": {"count": 0, "selection": "fixed", "sample_ids": []},
            "parser": {
                "type": "label_set",
                "version": "1",
                "labels": list(LABELS),
                "normalize": ["trim", "unicode_nfkc", "lowercase"],
            },
            "scorer": {
                "type": "classification",
                "version": "1",
                "primary_metric": "accuracy",
                "metrics": ["accuracy", "macro_f1", "micro_f1", "weighted_f1"],
            },
            "denominator_policy": "all_scoring_samples",
            "on_api_error": "exclude_and_report",
            "on_parse_error": "count_as_incorrect",
        },
        "groups": [{"field": field} for field in metadata_fields],
        "validation": {
            "required_fields": ["id", "question", "label"],
            "unique_by": ["id"],
            "allowed_values": {"label": list(LABELS)},
        },
    }


def _expected_classification(rows: list[dict[str, Any]]) -> dict[str, Any]:
    distribution = dict(sorted(Counter(row["label"] for row in rows).items()))
    return {
        "assumptions": {"mock_state_reset": True, "max_retries": 2},
        "label_distribution": distribution,
        "metrics": {
            "total_samples": len(rows),
            "valid_responses": len(rows),
            "scored_samples": len(rows),
            "api_errors": 0,
            "parse_errors": 0,
            "accuracy_numerator": len(rows),
            "accuracy_denominator": len(rows),
            "accuracy": 1.0,
            "macro_f1": 1.0,
            "micro_f1": 1.0,
            "weighted_f1": 1.0,
        },
    }


def _expected_faults() -> dict[str, Any]:
    return {
        "assumptions": {
            "mock_state_reset": True,
            "max_retries": 2,
            "timeout_seconds": 0.05,
            "on_api_error": "exclude_and_report",
            "on_parse_error": "count_as_incorrect",
        },
        "fault_distribution": {
            name: 15
            for name in (
                "empty",
                "http_401",
                "http_429",
                "http_500",
                "invalid_json",
                "parse_error",
                "schema_mismatch",
                "timeout",
            )
        },
        "expected_by_fault_type": {
            "http_401": {"api_errors": 15, "successful": 0, "attempts_total": 15},
            "http_429": {"api_errors": 10, "successful": 5, "attempts_total": 45},
            "http_500": {"api_errors": 10, "successful": 5, "attempts_total": 45},
            "timeout": {"api_errors": 15, "successful": 0, "attempts_total": 45},
            "invalid_json": {"api_errors": 15, "successful": 0, "attempts_total": 15},
            "schema_mismatch": {"api_errors": 15, "successful": 0, "attempts_total": 15},
            "empty": {"api_errors": 15, "successful": 0, "attempts_total": 15},
            "parse_error": {"api_errors": 0, "successful": 0, "parse_errors": 15},
        },
        "metrics": {
            "total_samples": 120,
            "valid_responses": 10,
            "scored_samples": 10,
            "api_errors": 95,
            "parse_errors": 15,
            "accuracy_numerator": 10,
            "accuracy_denominator": 25,
            "accuracy": 0.4,
        },
    }


def _expected_numeric() -> dict[str, Any]:
    return {
        "assumptions": {
            "mock_state_reset": True,
            "absolute_tolerance": 0.01,
            "relative_tolerance": 0.001,
            "on_parse_error": "count_as_incorrect",
        },
        "category_distribution": {
            "exact": 80,
            "invalid_numeric": 5,
            "outside_tolerance": 5,
            "within_tolerance": 10,
        },
        "metrics": {
            "total_samples": 100,
            "valid_responses": 95,
            "scored_samples": 95,
            "api_errors": 0,
            "parse_errors": 5,
            "numeric_match_numerator": 90,
            "numeric_match_denominator": 100,
            "numeric_match": 0.9,
        },
    }


def build_fixture_specs(seed: int = SEED) -> dict[str, tuple[list[dict[str, Any]], dict[str, Any]]]:
    golden = _classification_rows("mvp-golden-v1", 100, seed)
    scale = _classification_rows("mvp-scale-v1", 1000, seed)
    faults = _fault_rows(seed)
    numeric = _numeric_rows(seed)
    return {
        "mvp-golden-v1": (golden, _expected_classification(golden)),
        "mvp-scale-v1": (scale, _expected_classification(scale)),
        "mvp-faults-v1": (faults, _expected_faults()),
        "mvp-numeric-v1": (numeric, _expected_numeric()),
    }


def _write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n")


def generate(output: Path, seed: int = SEED) -> dict[str, Any]:
    output.mkdir(parents=True, exist_ok=True)
    lock: dict[str, Any] = {
        "generator_version": GENERATOR_VERSION,
        "seed": seed,
        "datasets": {},
    }
    for name, (rows, expected) in build_fixture_specs(seed).items():
        root = output / name
        data_path = root / "data" / "test.jsonl"
        root.mkdir(parents=True, exist_ok=True)
        data_path.parent.mkdir(parents=True, exist_ok=True)
        data_path.write_text("".join(f"{_canonical_json(row)}\n" for row in rows))
        checksum = _sha256(data_path)
        manifest = _base_manifest(
            name=name,
            display_name=name.replace("-", " ").title(),
            description=f"Deterministic MVP experiment fixture generated with seed {seed}.",
            checksum=checksum,
            metadata_fields=[
                key
                for key in rows[0]
                if key not in {"id", "question", "label", "expected"}
            ],
        )
        if name == "mvp-faults-v1":
            manifest["validation"]["allowed_values"]["fault_type"] = [
                "http_401",
                "http_429",
                "http_500",
                "timeout",
                "invalid_json",
                "schema_mismatch",
                "empty",
                "parse_error",
            ]
        if name == "mvp-numeric-v1":
            manifest["data"]["reference_field"] = "expected"
            manifest["protocol"] = {
                "id": "mvp-numeric-greedy-v1",
                "task_type": "numeric_answer",
                "prediction_source": "generated_text",
                "few_shot": {"count": 0, "selection": "fixed", "sample_ids": []},
                "parser": {"type": "numeric", "version": "1"},
                "scorer": {
                    "type": "numeric_match",
                    "version": "1",
                    "primary_metric": "numeric_match",
                    "absolute_tolerance": 0.01,
                    "relative_tolerance": 0.001,
                },
                "denominator_policy": "all_scoring_samples",
                "on_api_error": "exclude_and_report",
                "on_parse_error": "count_as_incorrect",
            }
            manifest["request"]["messages"][0]["content"] = "只输出最终数值，不要解释。"
            manifest["validation"]["required_fields"] = ["id", "question", "expected"]
            manifest["validation"]["allowed_values"] = {}
        manifest_path = root / "manifest.yaml"
        manifest_path.write_text(
            yaml.safe_dump(
                deepcopy(manifest),
                allow_unicode=True,
                sort_keys=False,
                width=1000,
            )
        )
        expected_payload = {
            "dataset": name,
            "generator_version": GENERATOR_VERSION,
            "seed": seed,
            "data_checksum_sha256": checksum,
            **expected,
        }
        expected_path = root / "expected.json"
        _write_json(expected_path, expected_payload)
        lock["datasets"][name] = {
            "rows": len(rows),
            "data_sha256": checksum,
            "manifest_sha256": _sha256(manifest_path),
            "expected_sha256": _sha256(expected_path),
        }
    _write_json(output / "fixture-lock.json", lock)
    return lock


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate deterministic MVP experiment datasets")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("datasets/experiments"),
        help="Output directory (default: datasets/experiments)",
    )
    parser.add_argument("--seed", type=int, default=SEED)
    args = parser.parse_args()
    lock = generate(args.output, args.seed)
    print(json.dumps(lock, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
