#!/usr/bin/env python3
"""Drive a batch of llama.cpp benchmarks from bench/registry.yaml.

For each selected (host, model, quant):
  1. Ensure the GGUF file exists on the host (download from HF mirror if not).
  2. Build (or reuse) the llama.cpp CUDA docker image.
  3. Run `llama-bench -p 512 -n 128 -ngl 999 -o json`.
  4. Convert the output into the InferStation schema and write to
     data/runs/<date>/<host>-<model>-<quant>-llamacpp-cuda.json.
  5. git add + commit + push the result, one commit per run, so the site
     updates incrementally.

Environment expectations:
  - Runs directly on the benchmark host (no GitHub Actions runner needed).
    The host must have docker + sudo and the appropriate GPU driver.
  - Models live on the host under /home/bench/models/<model_slug>/<file>.

Invoke locally:
    python3 scripts/bench-batch.py [--filter=...] [--skip-push]
Typical wrapper: `scripts/run-all.sh`.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path

try:
    import yaml  # type: ignore
except ImportError as e:  # pragma: no cover
    print(
        "error: pyyaml is required. Install with `sudo apt-get install -y python3-yaml` "
        "or `pip install pyyaml`.",
        file=sys.stderr,
    )
    raise SystemExit(2) from e


REPO = Path(__file__).resolve().parent.parent
REGISTRY = REPO / "bench" / "registry.yaml"

# Private container registry serving InferStation's official engine images.
# Configured as insecure-registry on every bench host; `docker login` must
# already be cached (see /memories/api-keys.md for credentials).
INFER_REGISTRY = os.environ.get("INFER_REGISTRY", "10.161.176.9:8443")

# Newer InferStation images are published on GHCR. Keep the old INFER_REGISTRY
# default for legacy entries, but let registry.yaml point runs at GHCR images.
GHCR_REGISTRY = os.environ.get("INFER_GHCR_REGISTRY", "ghcr.io/inferstation")

# Backend metadata. Image is NO LONGER stored here — it is resolved from
# (host, backend) via HOSTS[<slug>]["backends"][<backend>]["image"], and may
# be overridden per-run by a `runs[].image: "<ref>"` field, or globally with
# `--image=<ref>` on the CLI. `docker_extra` describes runtime args common
# to all hosts using that backend.
BACKENDS = {
    "cuda": {
        "engine_slug": "llamacpp-cuda",
        "engine_backend": "CUDA",
        "build_flags": "-DGGML_CUDA=ON",
        "docker_extra": "--gpus all",
        "file_suffix": "llamacpp-cuda",
    },
    "vulkan": {
        "engine_slug": "llamacpp-vulkan",
        "engine_backend": "Vulkan",
        "build_flags": "-DGGML_VULKAN=ON",
        # On DGX Spark / GB10 (arm64), `--gpus all` does NOT bind-mount
        # /proc/driver/nvidia into the container, and the NVIDIA Vulkan ICD's
        # `vk_icdNegotiateLoaderICDInterfaceVersion` fails with -3 because it
        # reads /proc/driver/nvidia/params during init. CDI mode invokes the
        # full nvidia-container-runtime hook which correctly injects procfs.
        # Prereq on host: `sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml`.
        # NB: AMD hosts (Halo) ignore the nvidia.* CDI args and use the host
        # mesa-RADV ICD baked into the Vulkan image instead.
        "docker_extra": (
            "--device nvidia.com/gpu=all "
            "-e NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics"
        ),
        "file_suffix": "llamacpp-vulkan",
    },
    "rocm": {
        "engine_slug": "llamacpp-rocm",
        "engine_backend": "ROCm",
        "build_flags": "-DGGML_HIP=ON",
        # Standard ROCm container access pattern.
        "docker_extra": (
            "--device=/dev/kfd --device=/dev/dri "
            "--group-add video --security-opt seccomp=unconfined"
        ),
        "file_suffix": "llamacpp-rocm",
    },
    # vLLM (one-shot `vllm bench throughput`). Model format: HF safetensors
    # snapshot (not GGUF); quant entry in registry.yaml must set
    # `format: hf-snapshot` + `hf_repo`.
    "vllm": {
        "engine_slug": "vllm",
        "engine_backend": "vLLM",
        "build_flags": "",
        "docker_extra": (
            "--device nvidia.com/gpu=all "
            "--shm-size 16g "
            "--ipc=host"
        ),
        "file_suffix": "vllm",
    },
    "vllm-rocm": {
        "engine_slug": "vllm-rocm",
        "engine_backend": "vLLM-ROCm",
        "build_flags": "",
        "docker_extra": (
            "--device=/dev/kfd --device=/dev/dri "
            "--group-add video --security-opt seccomp=unconfined "
            "--shm-size 16g --ipc=host"
        ),
        "file_suffix": "vllm-rocm",
    },
}

# hf-mirror.com is faster on most CN networks, but newer huggingface_hub
# (>=1.x) rejects its HEAD responses with FileMetadataError because the
# mirror does not return the required X-Repo-Commit / X-Linked-Etag headers.
# Default to the official hub; HF_TOKEN bumps the rate limit / speed.
HF_ENDPOINT = os.environ.get("HF_ENDPOINT", "https://huggingface.co")
HF_TOKEN = os.environ.get("HF_TOKEN", "")
DOCKER = os.environ.get("BENCH_DOCKER") or (
    "sudo -n docker"
    if subprocess.run("docker version >/dev/null 2>&1", shell=True).returncode != 0
    else "docker"
)

# Host metadata. Keyed by the slug used in registry `runs[].host`.
# IMPORTANT: BOTH `name` (display) AND the slug key (used in URLs / filenames)
# are public. Do NOT use internal hostnames, datacenter/site identifiers,
# or runner labels (e.g. "spark1-shanghai", "halo2-shanghai"). Use neutral
# product-style identifiers — e.g. "dgx-spark-01", "strix-halo-01".
#
# `backends` maps backend slug -> default container image (resolved against
# INFER_REGISTRY). Per-run override: set `image: "<full-ref>"` on the run
# entry. Global override: pass `--image=<full-ref>`.
HOSTS = {
    "dgx-spark-01": {
        "name": "DGX Spark",
        "vendor": "NVIDIA",
        "chip": "GB10",
        "vram_gb": 128,
        "form": "apu_minipc",
        "models_root": "/home/bench/models",
        "backends": {
            "cuda":   f"{GHCR_REGISTRY}/llama-cuda-spark:latest",
            "vulkan": f"{GHCR_REGISTRY}/llama-vulkan-spark:latest",
            "vllm":   f"{GHCR_REGISTRY}/vllm-cuda-spark:latest",
        },
    },
    "ryzen-ai-max-395-03": {
        "name": "Strix Halo",
        "vendor": "AMD",
        "chip": "Strix Halo / Radeon 8060S (gfx1151)",
        "vram_gb": 128,
        "form": "apu_minipc",
        "models_root": "/home/bench/models",
        "backends": {
            "rocm":      f"{GHCR_REGISTRY}/llama-rocm-halo:latest",
            "vulkan":    f"{GHCR_REGISTRY}/llama-vulkan-halo:latest",
            "vllm-rocm": f"{GHCR_REGISTRY}/vllm-rocm-halo:latest",
        },
    },
    "rtx-4090-sh": {
        "name": "RTX 4090",
        "vendor": "NVIDIA",
        "chip": "AD102 (sm_89) x2",
        "vram_gb": 96,
        "form": "workstation",
        "models_root": "/opt/inferstation/models",
        "backends": {
            "vllm": f"{GHCR_REGISTRY}/vllm-cuda-4090:latest",
        },
    },
    "radeon-r9700-sh": {
        "name": "Radeon AI PRO R9700",
        "vendor": "AMD",
        "chip": "RDNA4 gfx1200 x2",
        "vram_gb": 64,
        "form": "workstation",
        "models_root": "/opt/inferstation/models",
        "backends": {
            "vllm-rocm": f"{GHCR_REGISTRY}/vllm-rocm-r9700-main:latest",
        },
    },
    "radeon-w7900d": {
        "name": "Radeon PRO W7900 Dual",
        "vendor": "AMD",
        "chip": "RDNA3 gfx1100 x2",
        "vram_gb": 96,
        "form": "workstation",
        "models_root": "/home/lkang/inferstation/models",
        "backends": {
            "vllm-rocm": f"{GHCR_REGISTRY}/vllm-rocm-w7900-main:latest",
        },
    },
}


def sh(cmd: str, *, capture: bool = False, check: bool = True) -> str:
    print(f"$ {cmd}", flush=True)
    if capture:
        out = subprocess.run(cmd, shell=True, check=check, text=True, capture_output=True)
        return out.stdout
    subprocess.run(cmd, shell=True, check=check)
    return ""


def host_test(path: str) -> bool:
    """Test for file existence on the host (not in the runner container)."""
    rc = subprocess.run(
        f"{DOCKER} run --rm -v /:/hostfs:ro alpine:3 test -f /hostfs{shlex.quote(path)}",
        shell=True,
    ).returncode
    return rc == 0


def host_readlink(path: str) -> str:
    out = sh(
        f"{DOCKER} run --rm -v /:/hostfs:ro alpine:3 readlink -f /hostfs{shlex.quote(path)}",
        capture=True,
    ).strip()
    return out.removeprefix("/hostfs")


def resolve_image(entry: dict, host_cfg: dict, backend: str, override: str | None) -> str:
    """Pick the container image for one run.

    Precedence (highest first):
      1. CLI/env --image override
      2. Per-run `image:` field in registry.yaml
      3. Host's `backends[<backend>]` default (private InferStation registry)
    """
    if override:
        return override
    if entry.get("image"):
        return str(entry["image"])
    host_backends = host_cfg.get("backends") or {}
    if backend not in host_backends:
        raise SystemExit(
            f"host {entry['host']!r} has no default image for backend {backend!r}; "
            f"set runs[].image or extend HOSTS[host].backends."
        )
    return host_backends[backend]


def ensure_image(image_ref: str, *, backend: str) -> str:
    """Make sure `image_ref` is present locally; return engine version/commit.

    Always pulls if missing (no fallback to local build). If already cached,
    skips pull. Engine version is extracted with a backend-specific probe:
      - llama.cpp: `cat /opt/llama.cpp/commit.txt` if present, else
        `llama-cli --version` last word.
      - vllm:     `python3 -c 'import vllm; print(vllm.__version__)'`
    """
    have = sh(f"{DOCKER} images -q {image_ref}", capture=True).strip()
    if not have:
        sh(f"{DOCKER} pull {image_ref}")

    if backend in ("vllm", "vllm-rocm"):
        ver = sh(
            f"{DOCKER} run --rm --entrypoint python3 {image_ref} "
            f"-c 'import vllm; print(vllm.__version__)'",
            capture=True,
        ).strip().splitlines()[-1]
        return ver.split("+", 1)[-1] if "+" in ver else ver

    # llama.cpp images: try a few common probe paths.
    probes = [
        "cat /opt/llama.cpp/commit.txt 2>/dev/null",
        "cat /usr/local/share/llama.cpp/commit.txt 2>/dev/null",
        "llama-cli --version 2>&1 | head -n 1",
    ]
    cmd = " || ".join(probes)
    out = sh(
        f"{DOCKER} run --rm --entrypoint sh {image_ref} -c {shlex.quote(cmd)}",
        capture=True,
    ).strip()
    return out or "unknown"


def ensure_model(host_cfg: dict, model_slug: str, model_def: dict, quant: str) -> str:
    """Make sure the model files for (model, quant) are on the host.

    Returns:
      - For GGUF quants: absolute path to the .gguf file.
      - For hf-snapshot quants: absolute path to the snapshot directory.
    """
    qdef = model_def["quants"][quant]
    fmt = qdef.get("format", "gguf")
    host_dir = model_def.get("host_dir", model_slug)

    if fmt == "hf-snapshot":
        # vLLM-style: download a full HF repo snapshot into a per-quant dir.
        local_path = (qdef.get("local_paths") or {}).get(host_cfg.get("slug", "")) or qdef.get("local_path")
        if local_path:
            if host_test(f"{local_path.rstrip('/')}/config.json"):
                print(f"[ok] {local_path} already present")
                return local_path.rstrip("/")
            raise SystemExit(f"missing local HF snapshot at {local_path}; expected config.json")
        repo = qdef.get("hf_repo") or model_def.get("hf_repo")
        if not repo:
            raise SystemExit(f"missing hf_repo for {model_slug}:{quant}")
        snap_dir = f"{host_cfg['models_root']}/{host_dir}-{quant}"
        # Sentinel: config.json must be present in a healthy HF snapshot.
        if host_test(f"{snap_dir}/config.json"):
            print(f"[ok] {snap_dir} already present")
            return snap_dir
        sh(
            f"{DOCKER} run --rm -v /:/hostfs alpine:3 "
            f"sh -c {shlex.quote(f'mkdir -p /hostfs{snap_dir}')}"
        )
        # Use `hf download` from an arm64-friendly python image.
        # Defaults to https://huggingface.co (hf-mirror.com breaks newer
        # huggingface_hub HEAD validation). HF_TOKEN raises the rate limit
        # and unlocks faster CDN endpoints; hf_transfer further parallelizes
        # multi-GB downloads.
        pip_pkgs = "huggingface_hub hf_transfer"
        inner = (
            f"pip install --quiet --no-cache-dir {pip_pkgs} && "
            f"hf download {shlex.quote(repo)} --local-dir /dst "
            "--exclude '.hf/*'"
        )
        token_env = f"-e HF_TOKEN={shlex.quote(HF_TOKEN)} " if HF_TOKEN else ""
        sh(
            f"{DOCKER} run --rm --network host --user 0:0 "
            f"-v {shlex.quote(snap_dir)}:/dst "
            f"-e HF_HOME=/dst/.hf "
            f"-e HF_ENDPOINT={shlex.quote(HF_ENDPOINT)} "
            f"-e HF_HUB_ENABLE_HF_TRANSFER=1 "
            f"-e HF_HUB_ETAG_TIMEOUT=60 "
            f"{token_env}"
            f"python:3.11-slim "
            f"sh -c {shlex.quote(inner)}"
        )
        return snap_dir

    # Default: single-file GGUF.
    fn = qdef["filename"]
    model_dir = f"{host_cfg['models_root']}/{host_dir}"
    path = f"{model_dir}/{fn}"
    if host_test(path):
        print(f"[ok] {path} already present")
        return path
    repo = qdef.get("hf_repo") or model_def.get("hf_repo")
    if not repo:
        raise SystemExit(f"missing {path} and no hf_repo configured for {model_slug}:{quant}")
    url = f"{HF_ENDPOINT}/{repo}/resolve/main/{fn}"
    print(f"[dl] {url} -> {path}")
    sh(
        f"{DOCKER} run --rm -v /:/hostfs alpine:3 "
        f"sh -c {shlex.quote(f'mkdir -p /hostfs{model_dir}')}"
    )
    # curlimages/curl runs as uid 100; the model dir was created by alpine
    # (root) so we need --user 0:0 to be able to write into it.
    sh(
        f"{DOCKER} run --rm --network host --user 0:0 "
        f"-v {shlex.quote(model_dir)}:/dst "
        f"curlimages/curl:8.10.1 "
        f"-fL --retry 3 --retry-delay 5 -o /dst/{shlex.quote(fn)} {shlex.quote(url)}"
    )
    return path



def cleanup_model(host_cfg: dict, model_slug: str, model_def: dict, quant: str) -> None:
    """Remove the (model, quant) artifact from the host to free disk.

    Safe to call after the last benchmark referencing this quant has completed.
    Handles both GGUF single-file quants and hf-snapshot directories. The
    parent model dir is also removed once it becomes empty.
    """
    qdef = model_def["quants"][quant]
    fmt = qdef.get("format", "gguf")
    host_dir = model_def.get("host_dir", model_slug)
    if fmt == "hf-snapshot":
        snap_dir = f"{host_cfg['models_root']}/{host_dir}-{quant}"
        if not host_test(snap_dir):
            return
        print(f"[cleanup] rm -rf {snap_dir}")
        sh(
            f"{DOCKER} run --rm -v /:/hostfs alpine:3 "
            f"sh -c {shlex.quote(f'rm -rf /hostfs{snap_dir}')}"
        )
        return
    fn = qdef["filename"]
    model_dir = f"{host_cfg['models_root']}/{host_dir}"
    path = f"{model_dir}/{fn}"
    if not host_test(path):
        return
    print(f"[cleanup] rm {path}")
    sh(
        f"{DOCKER} run --rm -v /:/hostfs alpine:3 "
        f"sh -c {shlex.quote(f'rm -f /hostfs{path} && rmdir /hostfs{model_dir} 2>/dev/null || true')}"
    )


def run_one_vllm(entry: dict, models: dict, image_override: str | None) -> Path:
    """Run `vllm bench throughput` for one (host, model, quant) tuple.

    `npl` maps to vLLM's `--max-num-seqs` (server-side concurrency cap) and
    also determines how many prompts to issue: 32 * npl, capped at 256, so
    higher concurrency runs still complete in bounded time.
    """
    host_slug = entry["host"]
    host_cfg = HOSTS[host_slug]
    host_cfg = dict(host_cfg)
    host_cfg["slug"] = host_slug
    model_slug = entry["model"]
    quant = entry["quant"]
    backend = entry.get("backend", "vllm")
    bcfg = BACKENDS[backend]
    docker_extra = entry.get("docker_extra") or bcfg["docker_extra"]
    image_ref = resolve_image(entry, host_cfg, backend, image_override)
    engine_commit = ensure_image(image_ref, backend=backend)
    model_def = models[model_slug]
    npl = int(entry.get("npl", 1))
    pp = int(entry.get("pp", 512))
    tg = int(entry.get("tg", 128))
    num_prompts = max(32, min(256, npl * 8))
    b_slug = "" if npl == 1 else f"-bs{npl}"
    scenario = f"vllm-bench-throughput-in{pp}-out{tg}-npl{npl}"

    snap_dir = ensure_model(host_cfg, model_slug, model_def, quant)
    real_dir = host_readlink(snap_dir) or snap_dir

    # vllm bench throughput uses --dataset-name random + fixed lengths.
    out_json = f"/tmp/vllm-bench-{model_slug}-{quant}{b_slug}.json"
    inner_cmd = (
        f"vllm bench throughput "
        f"--model /model "
        f"--dtype bfloat16 "
        # vllm random dataset can produce prompts longer than --input-len
        # (it samples around the target). Give a comfortable buffer.
        f"--max-model-len {(pp + tg) * 2 + 1024} "
        f"--max-num-seqs {npl} "
        f"--gpu-memory-utilization 0.85 "
        f"--dataset-name random "
        f"--input-len {pp} "
        f"--output-len {tg} "
        f"--num-prompts {num_prompts} "
        f"--output-json {out_json}"
    )

    artifacts = REPO / "artifacts"
    artifacts.mkdir(exist_ok=True)
    raw_host = artifacts / f"{host_slug}-{model_slug}-{quant}{b_slug}-vllm.json"
    # Mount snapshot read-only as /model; capture vllm bench output JSON into
    # an artifacts dir mounted at /out. Force --entrypoint sh because some
    # registry images (incl. our private vllm-cuda-spark) bake an OpenAI
    # server entrypoint by default.
    sh(
        f"{DOCKER} run --rm {docker_extra} --network host "
        f"--entrypoint sh "
        f"-v {shlex.quote(real_dir)}:/model:ro "
        f"-v {shlex.quote(str(artifacts))}:/out "
        f"{image_ref} "
        f"-c {shlex.quote(inner_cmd + f' && cp {out_json} /out/' + raw_host.name)}"
    )

    parsed = json.loads(raw_host.read_text())
    # vllm bench throughput JSON keys vary by version:
    #   old (>=0.6.x): request_throughput, output_throughput, total_token_throughput
    #   new (0.17+, NGC 26.03): tokens_per_second (combined), requests_per_second
    # Derive from elapsed + known prompt geometry so we don't depend on which
    # keys the bench happens to emit.
    elapsed = float(parsed.get("elapsed_time") or 0.0)
    if elapsed > 0:
        pp_per_s = num_prompts * pp / elapsed
        out_throughput = num_prompts * tg / elapsed
    else:
        pp_per_s = None
        out_throughput = float(parsed.get("output_throughput") or 0.0)
    total_throughput = (
        float(parsed.get("total_token_throughput") or 0.0)
        or float(parsed.get("tokens_per_second") or 0.0)
        or ((pp_per_s or 0.0) + out_throughput)
    )

    run_date = datetime.datetime.utcnow().strftime("%Y-%m-%d")
    out_rel = f"data/runs/{run_date}/{host_slug}-{model_slug}-{quant}{b_slug}-vllm.json"
    out_abs = REPO / out_rel
    out_abs.parent.mkdir(parents=True, exist_ok=True)

    run_id = os.environ.get("GITHUB_RUN_ID", "manual")
    repo_slug = os.environ.get("GITHUB_REPOSITORY", "JoursBleu/InferStation")
    server = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
    log_url = f"{server}/{repo_slug}/actions/runs/{run_id}" if run_id != "manual" else ""

    record = {
        "schema_version": 0,
        "run_date": run_date,
        "host": {
            "slug": host_slug,
            "name": host_cfg["name"],
            "vendor": host_cfg["vendor"],
            "chip": host_cfg["chip"],
            "vram_gb": host_cfg["vram_gb"],
            "deployment_form": host_cfg["form"],
        },
        "model": {
            "slug": model_slug,
            "name": model_def["name"],
            "params_b": model_def["params_b"],
            "quantization": quant,
            "source_url": model_def.get("source_url", ""),
        },
        "engine": {
            "slug": bcfg["engine_slug"],
            "name": "vLLM",
            "version": engine_commit,
            "commit": engine_commit,
            "backend": bcfg["engine_backend"],
            "build_flags": bcfg["build_flags"],
        },
        "command": inner_cmd,
        "pp_test": f"in{pp}",
        "pp_toks_per_s": pp_per_s,
        "tg_test": f"out{tg}",
        "tg_toks_per_s": out_throughput,
        "combined_toks_per_s": total_throughput,
        "ttft_ms": None,
        "ctx": pp + tg,
        "batch": npl,
        "concurrency": npl,
        "n_gpu_layers": None,
        "vram_used_gb": None,
        "scenario": scenario,
        "usability_tag": "ok",
        "image": image_ref,
        "log_url": log_url,
        "source_url": log_url,
        "notes": "vllm bench throughput; pp_toks_per_s derived as num_prompts*input_len/elapsed",
        "raw_vllm_bench": parsed,
    }
    out_abs.write_text(json.dumps(record, indent=2) + "\n")
    print(f"wrote {out_abs}")
    return out_abs


def run_one(entry: dict, models: dict, image_override: str | None) -> list[Path]:
    backend = entry.get("backend", "cuda")
    if backend in ("vllm", "vllm-rocm"):
        # vllm runner takes a single npl per docker invocation; iterate the
        # npls list at this layer so registry stays uniform.
        if "npls" in entry:
            vllm_npls = [int(x) for x in entry["npls"]]
        else:
            vllm_npls = [int(entry.get("npl", 1))]
        out_paths: list[Path] = []
        for npl in vllm_npls:
            sub = dict(entry); sub.pop("npls", None); sub["npl"] = npl
            out_paths.append(run_one_vllm(sub, models, image_override))
        return out_paths
    host_slug = entry["host"]
    host_cfg = HOSTS[host_slug]
    host_cfg = dict(host_cfg)
    host_cfg["slug"] = host_slug
    model_slug = entry["model"]
    quant = entry["quant"]
    bcfg = BACKENDS[backend]
    image_ref = resolve_image(entry, host_cfg, backend, image_override)
    engine_commit = ensure_image(image_ref, backend=backend)
    model_def = models[model_slug]
    # Batch-size list. The minimum test unit is (model, quant, framework,
    # backend) — one docker invocation produces all bs results in a single
    # GGUF load. `npls` is the canonical field; legacy single `npl` still works.
    if "npls" in entry:
        npls = [int(x) for x in entry["npls"]]
    else:
        npls = [int(entry.get("npl", 1))]
    pp = int(entry.get("pp", 512))
    tg = int(entry.get("tg", 128))
    npl_csv = ",".join(str(n) for n in npls)
    npl_tag = npls[0] if len(npls) == 1 else "x".join(str(n) for n in npls)
    scenario = f"llama-batched-bench-pp{pp}-tg{tg}-npl{npl_tag}"

    model_path = ensure_model(host_cfg, model_slug, model_def, quant)
    real_path = host_readlink(model_path)
    real_dir = os.path.dirname(real_path)
    real_fn = os.path.basename(real_path)

    cmd = (
        f"llama-batched-bench -m /models/{real_fn} -ngl 999 "
        f"-npp {pp} -ntg {tg} -npl {npl_csv} --output-format jsonl"
    )
    artifacts = REPO / "artifacts"
    artifacts.mkdir(exist_ok=True)
    raw_suffix = "" if len(npls) == 1 and npls[0] == 1 else (f"-bs{npls[0]}" if len(npls) == 1 else "-bsall")
    raw = artifacts / f"{host_slug}-{model_slug}-{quant}{raw_suffix}-{bcfg['file_suffix']}.jsonl"
    sh(
        f"{DOCKER} run --rm {bcfg['docker_extra']} --network host --entrypoint bash "
        f"-v {shlex.quote(real_dir)}:/models:ro {image_ref} "
        f"-lc {shlex.quote(cmd)} 2>/dev/null > {shlex.quote(str(raw))}"
    )

    # Parse jsonl: one line per pl value. Shape:
    # {"pp":512,"tg":128,"pl":4,"n_kv":2560,"speed_pp":...,"speed_tg":...,"speed":...}
    raw_text = raw.read_text().strip()
    lines = [json.loads(l) for l in raw_text.splitlines() if l.strip().startswith("{")]
    by_pl: dict[int, dict] = {}
    for d in lines:
        if d.get("pp") == pp and d.get("tg") == tg and d.get("pl") in npls:
            by_pl[int(d["pl"])] = d
    missing = [n for n in npls if n not in by_pl]
    if missing:
        raise RuntimeError(f"no jsonl record for npl={missing} in {raw}")

    run_date = datetime.datetime.utcnow().strftime("%Y-%m-%d")
    run_id = os.environ.get("GITHUB_RUN_ID", "manual")
    repo_slug = os.environ.get("GITHUB_REPOSITORY", "JoursBleu/InferStation")
    server = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
    log_url = f"{server}/{repo_slug}/actions/runs/{run_id}" if run_id != "manual" else ""

    out_paths: list[Path] = []
    for npl in npls:
        pick = by_pl[npl]
        b_slug = "" if npl == 1 else f"-bs{npl}"
        out_rel = f"data/runs/{run_date}/{host_slug}-{model_slug}-{quant}{b_slug}-{bcfg['file_suffix']}.json"
        out_abs = REPO / out_rel
        out_abs.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "schema_version": 0,
            "run_date": run_date,
            "host": {
                "slug": host_slug,
                "name": host_cfg["name"],
                "vendor": host_cfg["vendor"],
                "chip": host_cfg["chip"],
                "vram_gb": host_cfg["vram_gb"],
                "deployment_form": host_cfg["form"],
            },
            "model": {
                "slug": model_slug,
                "name": model_def["name"],
                "params_b": model_def["params_b"],
                "quantization": quant,
                "source_url": model_def.get("source_url", ""),
            },
            "engine": {
                "slug": bcfg["engine_slug"],
                "name": "llama.cpp",
                "version": engine_commit,
                "commit": engine_commit,
                "backend": bcfg["engine_backend"],
                "build_flags": bcfg["build_flags"],
            },
            "command": cmd,
            "pp_test": f"pp{pp}",
            "pp_toks_per_s": pick.get("speed_pp"),
            "tg_test": f"tg{tg}",
            "tg_toks_per_s": pick.get("speed_tg"),
            "combined_toks_per_s": pick.get("speed"),
            "ttft_ms": None,
            "ctx": pick.get("n_kv"),
            "batch": pick.get("n_batch"),
            "concurrency": npl,
            "n_gpu_layers": pick.get("n_gpu_layers"),
            "vram_used_gb": None,
            "scenario": scenario,
            "usability_tag": "ok",
            "log_url": log_url,
            "source_url": log_url,
            "notes": "",
            "raw_llamabench": [pick],
        }
        out_abs.write_text(json.dumps(record, indent=2) + "\n")
        print(f"wrote {out_abs}")
        out_paths.append(out_abs)
    return out_paths


def git_commit_push(out_abs: Path, entry: dict) -> None:
    sh(f"cd {REPO} && git add {shlex.quote(str(out_abs.relative_to(REPO)))}")
    rc = subprocess.run(
        "git diff --cached --quiet", shell=True, cwd=REPO
    ).returncode
    if rc == 0:
        print("[skip] no diff to commit")
        return
    npl = int(entry.get("npl", 1))
    suffix = "" if npl == 1 else f" bs{npl}"
    backend = entry.get("backend", "cuda")
    msg = (
        f"bench({entry['host']}): {entry['model']} {entry['quant']}{suffix} llama.cpp-{backend}"
    )
    sh(
        f"cd {REPO} && git -c user.name='InferStation Bench Bot' "
        f"-c user.email='actions@inferstation' commit -m {shlex.quote(msg)}"
    )
    # Pull (rebase) before push so we don't fail when origin has moved ahead.
    pull_rc = subprocess.run(
        "git pull --rebase --autostash origin main",
        shell=True, cwd=REPO,
    ).returncode
    if pull_rc != 0:
        print(f"[git pull --rebase] rc={pull_rc}, aborting rebase")
        subprocess.run("git rebase --abort", shell=True, cwd=REPO)
    # Push is best-effort: a failure here must not abort the bench run nor
    # block the downstream push-to-site step. The commit stays in the local
    # repo and will be pushed by a later successful run.
    push_rc = subprocess.run(
        "git push origin HEAD:main", shell=True, cwd=REPO,
    ).returncode
    if push_rc != 0:
        print(f"[git push] rc={push_rc} (continuing)")


def select(runs: list[dict], flt: str | None) -> list[dict]:
    """Filter runs by a comma-separated key set.

    The minimum test unit is (host, model, quant, backend, bs). Any of these
    axes — or any combination — can be a filter key. Recognized forms:

      <model>                              e.g. qwen3.6-27b
      <quant>                              e.g. BF16, Q4_K_M     (dtype alone)
      <backend>                            e.g. cuda, vulkan, vllm
      bs<N>                                e.g. bs1, bs16        (batch alone)
      <model>:<quant>
      <model>:<backend>
      <quant>:<backend>
      <model>:<quant>:<backend>
      <model>:<quant>:<backend>:bs<N>
      <host>:...                           any of the above prefixed by host
    """
    if not flt:
        return runs
    keys = {k.strip() for k in flt.split(",") if k.strip()}
    out = []
    for r in runs:
        be = r.get("backend", "cuda")
        host = r["host"]
        model = r["model"]
        quant = r["quant"]
        # bs from `npl` (per-bs entry, canonical) or `npls` (legacy grouped).
        if "npls" in r:
            bss = [int(x) for x in r["npls"]]
        else:
            bss = [int(r.get("npl", 1))]
        bs_tags = {f"bs{n}" for n in bss}

        base = {model, quant, be} | bs_tags
        pairs = {
            f"{model}:{quant}",
            f"{model}:{be}",
            f"{quant}:{be}",
        }
        triples_quads = {f"{model}:{quant}:{be}"}
        for bs_tag in bs_tags:
            triples_quads.add(f"{model}:{quant}:{be}:{bs_tag}")
            triples_quads.add(f"{model}:{be}:{bs_tag}")
            triples_quads.add(f"{quant}:{be}:{bs_tag}")
            triples_quads.add(f"{model}:{quant}:{bs_tag}")
        with_host = {f"{host}:{c}" for c in base | pairs | triples_quads}
        candidates = base | pairs | triples_quads | with_host | {host}
        if candidates & keys:
            out.append(r)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--filter",
        default=os.environ.get("BENCH_FILTER", ""),
        help='Comma-separated "<model>:<quant>" or "<model>" entries. Empty = all.',
    )
    ap.add_argument("--skip-push", action="store_true")
    ap.add_argument("--skip-push-site", action="store_true", help="Do not rsync each completed run to the site host.")
    ap.add_argument("--keep-models", action="store_true", help="Do not delete model files after the last benchmark referencing them.")
    ap.add_argument(
        "--image", default=os.environ.get("BENCH_IMAGE", ""),
        help="Override container image for ALL selected runs (e.g. 10.161.176.9:8443/inferstation/llama-cuda-spark:dev). "
             "Beats both registry.yaml `image:` and the host's default backend image.",
    )
    args = ap.parse_args()
    image_override = args.image or None
    push_site_script = REPO / "scripts" / "push-to-site.sh"

    reg = yaml.safe_load(REGISTRY.read_text())
    runs = select(reg.get("runs", []), args.filter)
    if not runs:
        print("nothing to do")
        return 0
    print(f"[plan] {len(runs)} run(s):")
    for r in runs:
        bs_disp = r.get("npl") if "npl" in r else (",".join(str(x) for x in r.get("npls", [1])))
        eff_image = image_override or r.get("image") or HOSTS.get(r["host"], {}).get("backends", {}).get(r.get("backend", "cuda"), "<unset>")
        print(f"  - {r['host']} :: {r['model']} :: {r['quant']} ({r.get('backend','cuda')}) bs={bs_disp} image={eff_image}")

    # Per-(host, model, quant) reference counter. When a key hits zero (after
    # all runs that use that artifact have completed), free the disk.
    refs: dict[tuple[str, str, str], int] = {}
    for r in runs:
        key = (r["host"], r["model"], r["quant"])
        refs[key] = refs.get(key, 0) + 1

    failures: list[tuple[dict, str]] = []
    for r in runs:
        print(f"\n=== {r['model']} :: {r['quant']} on {r['host']} ({r.get('backend','cuda')}) ===")
        try:
            out_abs_list = run_one(r, reg["models"], image_override)
            for out_abs in out_abs_list:
                if not args.skip_push:
                    git_commit_push(out_abs, r)
            if not args.skip_push_site and push_site_script.exists():
                try:
                    sh(str(push_site_script))
                except subprocess.CalledProcessError as e:
                    print(f"[push-site-fail] {r['model']}:{r['quant']}: {e}", file=sys.stderr)
        except subprocess.CalledProcessError as e:
            print(f"[fail] {r}: {e}", file=sys.stderr)
            failures.append((r, str(e)))
        except Exception as e:  # noqa: BLE001
            print(f"[fail] {r}: {e}", file=sys.stderr)
            failures.append((r, str(e)))
        # Decrement and clean up when this is the last reference, regardless
        # of success — a broken quant is worth less than 20+ GB of disk.
        key = (r["host"], r["model"], r["quant"])
        refs[key] -= 1
        if refs[key] == 0 and not args.keep_models:
            try:
                host_cfg = HOSTS[r["host"]]
                cleanup_model(host_cfg, r["model"], reg["models"][r["model"]], r["quant"])
            except Exception as e:  # noqa: BLE001
                print(f"[cleanup-fail] {r['model']}:{r['quant']}: {e}", file=sys.stderr)

    if failures:
        print(f"\n{len(failures)} failure(s):")
        for r, e in failures:
            print(f"  - {r}: {e}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
