#!/usr/bin/env python3
"""Parse `llama-bench --output json` output into InferStation run schema.

Usage:
    parse-llamabench.py <llama-bench json> <out json>
        --host <slug> --host-name <name> --host-vendor <vendor> --host-chip <chip>
        --host-vram-gb <int> --host-form <apu_minipc|desktop_consumer|workstation|server>
        --model-slug <slug> --model-name <name> --model-params-b <float>
        --quant <Q4_K_M|Q8_0|...> --model-source-url <url>
        --engine-version <vX.Y.Z> --engine-commit <git-sha>
        --run-date YYYY-MM-DD --scenario <slug>
        --workflow-run-url <url>
        --command "<the exact command>"

llama-bench JSON shape (one element per test, e.g. pp512 and tg128):
    [{"model_filename":..., "model_type":..., "n_batch":..., "n_threads":...,
      "n_gpu_layers":..., "test":"pp512"|"tg128"|..., "avg_ts": <toks/s>, ...}, ...]
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("bench_json", type=Path)
    p.add_argument("out_json", type=Path)
    p.add_argument("--host", required=True)
    p.add_argument("--host-name", required=True)
    p.add_argument("--host-vendor", required=True)
    p.add_argument("--host-chip", required=True)
    p.add_argument("--host-vram-gb", type=int, required=True)
    p.add_argument("--host-form", required=True)
    p.add_argument("--model-slug", required=True)
    p.add_argument("--model-name", required=True)
    p.add_argument("--model-params-b", type=float, required=True)
    p.add_argument("--quant", required=True)
    p.add_argument("--model-source-url", default="")
    p.add_argument("--engine-version", required=True)
    p.add_argument("--engine-commit", required=True)
    p.add_argument("--run-date", required=True)
    p.add_argument("--scenario", default="llama-bench")
    p.add_argument("--workflow-run-url", default="")
    p.add_argument("--command", required=True)
    args = p.parse_args()

    data = json.loads(args.bench_json.read_text())
    if not isinstance(data, list) or not data:
        print("error: bench json is empty or not a list", file=sys.stderr)
        return 2

    # Newer llama-bench JSON does not include a "test" string; classify
    # entries by n_prompt / n_gen instead. Fall back to legacy "test" field.
    def _kind(d: dict) -> str:
        t = d.get("test", "")
        if t.startswith("pp"):
            return "pp"
        if t.startswith("tg"):
            return "tg"
        if (d.get("n_prompt") or 0) > 0 and not (d.get("n_gen") or 0):
            return "pp"
        if (d.get("n_gen") or 0) > 0 and not (d.get("n_prompt") or 0):
            return "tg"
        return ""

    def _label(d: dict) -> str:
        t = d.get("test")
        if t:
            return t
        np_ = d.get("n_prompt") or 0
        ng = d.get("n_gen") or 0
        if np_ and not ng:
            return f"pp{np_}"
        if ng and not np_:
            return f"tg{ng}"
        return ""

    pp = next((d for d in data if _kind(d) == "pp"), None)
    tg = next((d for d in data if _kind(d) == "tg"), None)
    first = data[0]

    record = {
        "schema_version": 0,
        "run_date": args.run_date,
        "host": {
            "slug": args.host,
            "name": args.host_name,
            "vendor": args.host_vendor,
            "chip": args.host_chip,
            "vram_gb": args.host_vram_gb,
            "deployment_form": args.host_form,
        },
        "model": {
            "slug": args.model_slug,
            "name": args.model_name,
            "params_b": args.model_params_b,
            "quantization": args.quant,
            "source_url": args.model_source_url,
        },
        "engine": {
            "slug": "llamacpp-cuda",
            "name": "llama.cpp",
            "version": args.engine_version,
            "commit": args.engine_commit,
            "backend": "CUDA",
            "build_flags": "-DGGML_CUDA=ON",
        },
        "command": args.command,
        "pp_test": _label(pp) if pp else None,
        "pp_toks_per_s": (pp or {}).get("avg_ts"),
        "tg_test": _label(tg) if tg else None,
        "tg_toks_per_s": (tg or {}).get("avg_ts"),
        "ttft_ms": None,
        "ctx": first.get("n_ctx"),
        "batch": first.get("n_batch"),
        "concurrency": 1,
        "n_gpu_layers": first.get("n_gpu_layers"),
        "vram_used_gb": None,
        "scenario": args.scenario,
        "usability_tag": "ok",
        "log_url": args.workflow_run_url,
        "source_url": args.workflow_run_url,
        "notes": "",
        "raw_llamabench": data,
    }

    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.write_text(json.dumps(record, indent=2) + "\n")
    print(f"wrote {args.out_json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
