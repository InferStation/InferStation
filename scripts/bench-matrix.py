#!/usr/bin/env python3
"""Build the GitHub Actions matrix for scheduled or targeted benchmark runs."""

from __future__ import annotations

import argparse
import json
import os


RUNNERS = [
    {"target": "halo", "label": "inferstation-halo3", "host": "ryzen-ai-max-395-03", "shard_index": 0, "shard_count": 2},
    {"target": "halo", "label": "inferstation-halo4", "host": "ryzen-ai-max-395-03", "result_host": "ryzen-ai-max-395-04", "shard_index": 1, "shard_count": 2},
    {"target": "spark", "label": "inferstation-spark2", "host": "dgx-spark-01", "result_host": "dgx-spark-02", "shard_index": 0, "shard_count": 2},
    {"target": "spark", "label": "inferstation-spark1", "host": "dgx-spark-01", "shard_index": 1, "shard_count": 2},
    {"target": "nv4090", "label": "inferstation-nv4090-weekly", "host": "rtx-4090-sh", "shard_index": 0, "shard_count": 1},
    {"target": "r9700", "label": "inferstation-r9700-weekly", "host": "radeon-r9700-sh", "shard_index": 0, "shard_count": 1},
]


def build_matrix(target: str = "all", runner_label: str = "") -> dict:
    selected = [
        row
        for row in RUNNERS
        if target in ("all", row["target"])
        and (not runner_label or runner_label == row["label"])
    ]
    if not selected:
        raise ValueError(
            f"no runner matches target={target!r} label={runner_label!r}"
        )
    return {"include": selected}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--target", default=os.environ.get("BENCH_TARGET", "all") or "all"
    )
    parser.add_argument(
        "--runner-label", default=os.environ.get("BENCH_RUNNER_LABEL", "")
    )
    args = parser.parse_args()
    try:
        matrix = build_matrix(args.target, args.runner_label)
    except ValueError as exc:
        parser.error(str(exc))
    print(json.dumps(matrix, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())