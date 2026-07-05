#!/usr/bin/env python3
"""Drive a batch of online serve-stream benchmarks from bench/registry.yaml.

For each selected (host, model, quant):
  1. Ensure the model artifact exists on the host.
  2. Pull (or reuse) the configured engine container image.
  3. Start an OpenAI-compatible server (`llama-server` or `vllm serve`).
  4. Drive it with the historical streaming client shape: in512/out128.
  5. Convert the output into the InferStation schema and write to
      data/runs/<date>/<host>-<model>-<quant>[-bsN]-<engine>-o128-serve.json.
  6. git add + commit + push the result, one commit per run, so the site
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
import concurrent.futures
import datetime
import json
import os
import shlex
import socket
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
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
    # vLLM online serving. Model format: HF safetensors snapshot (not GGUF);
    # quant entry in registry.yaml must set `format: hf-snapshot` + `hf_repo`.
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
SERVE_CONCURRENCIES = [1, 4, 16, 32]

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
        "models_root": "/opt/inferstation/models",
        "backends": {
            # The upstream full image is multi-arch and includes llama-server.
            "cuda":   "ghcr.io/ggml-org/llama.cpp:full-cuda",
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
        "models_root": "/opt/inferstation/models",
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
        "models_root": "/dc/inferstation-models",
        "backends": {
            # The upstream full image includes llama-server and works across
            # the dual-4090 workstation.
            "cuda": "ghcr.io/ggml-org/llama.cpp:full-cuda",
            "vulkan": f"{GHCR_REGISTRY}/llama-vulkan-4090:latest",
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
            "rocm": f"{GHCR_REGISTRY}/llama-rocm-r9700:latest",
            "vulkan": f"{GHCR_REGISTRY}/llama-vulkan-r9700:latest",
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

WEEKLY_TEMPLATE_HOST = "dgx-spark-01"
WEEKLY_BACKEND_MAP = {
    "ryzen-ai-max-395-03": {
        "cuda": "rocm",
        "vulkan": "vulkan",
        "vllm": "vllm-rocm",
    },
    "rtx-4090-sh": {
        "cuda": "cuda",
        "vulkan": "vulkan",
        "vllm": "vllm",
    },
    "radeon-r9700-sh": {
        "cuda": "rocm",
        "vulkan": "vulkan",
        "vllm": "vllm-rocm",
    },
}
WEEKLY_DOCKER_EXTRA = {
    ("ryzen-ai-max-395-03", "vulkan"): (
        "--device=/dev/dri --group-add video --security-opt seccomp=unconfined "
        "-e VK_DRIVER_FILES=/usr/share/vulkan/icd.d/radeon_icd.x86_64.json"
    ),
    ("radeon-r9700-sh", "vulkan"): (
        "--device=/dev/dri --group-add video --security-opt seccomp=unconfined "
        "-e VK_DRIVER_FILES=/usr/share/vulkan/icd.d/radeon_icd.x86_64.json"
    ),
    ("rtx-4090-sh", "vulkan"): (
        "--gpus all -e NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics "
        "-e VK_DRIVER_FILES=/usr/share/vulkan/icd.d/nvidia_icd.json"
    ),
    ("rtx-4090-sh", "vllm"): "--gpus all --shm-size 16g --ipc=host",
}
REPRESENTATIVE_MODELS = {
    "minicpm5-2.6b",
    "qwen3.6-35b-a3b",
    "gemma-4-26b-a4b-it",
}
REPRESENTATIVE_GGUF_QUANTS = {"Q8_0", "UD-Q4_K_M"}
REPRESENTATIVE_VLLM_QUANTS = {"BF16"}


def run_key(entry: dict) -> tuple:
    if "npls" in entry:
        npl_key = tuple(int(x) for x in entry["npls"])
    else:
        npl_key = (int(entry.get("npl", 1)),)
    return (
        entry["host"],
        entry["model"],
        entry["quant"],
        entry.get("backend", "cuda"),
        npl_key,
    )


def expand_weekly_runs(runs: list[dict]) -> list[dict]:
    """Expand the canonical Spark recipe to the other weekly host classes.

    `bench/registry.yaml` keeps Spark as the full recipe template. Weekly jobs
    filter by public host slug, so synthesize equivalent host-specific entries
    for Halo, 4090, and R9700 while preserving explicit entries in the registry.
    """
    expanded = [dict(r) for r in runs]
    seen = {run_key(r) for r in expanded}
    templates = [r for r in runs if r.get("host") == WEEKLY_TEMPLATE_HOST]
    for host, backend_map in WEEKLY_BACKEND_MAP.items():
        for template in templates:
            src_backend = template.get("backend", "cuda")
            dst_backend = backend_map.get(src_backend)
            if not dst_backend:
                continue
            entry = dict(template)
            entry["host"] = host
            entry["backend"] = dst_backend
            entry.pop("image", None)
            entry.pop("docker_extra", None)
            docker_extra = WEEKLY_DOCKER_EXTRA.get((host, dst_backend))
            if docker_extra:
                entry["docker_extra"] = docker_extra
            overrides = entry.pop("weekly_overrides", {}) or {}
            entry.update(overrides.get(host, {}) or {})
            key = run_key(entry)
            if key in seen:
                continue
            seen.add(key)
            expanded.append(entry)
    return expanded


def representative_runs(runs: list[dict]) -> list[dict]:
    out = []
    for entry in runs:
        model = entry["model"]
        quant = entry["quant"]
        backend = entry.get("backend", "cuda")
        npl = int(entry.get("npl", 1))
        if model not in REPRESENTATIVE_MODELS:
            continue
        if entry["host"] == "rtx-4090-sh" and backend == "vulkan" and npl > 4:
            continue
        if backend in {"vllm", "vllm-rocm"}:
            if quant in REPRESENTATIVE_VLLM_QUANTS:
                out.append(entry)
            continue
        if quant in REPRESENTATIVE_GGUF_QUANTS:
            out.append(entry)
    return out


def host_slugs() -> set[str]:
    return set(HOSTS)


def scope_base_runs(expanded_runs: list[dict], scope: str, flt: str) -> list[dict]:
    """Choose the source run list before applying filters.

    Scheduled matrix jobs pass a host slug as --filter. That should still mean
    "representative weekly set for this host", not "full sweep for this host".
    Manual model/quant/backend filters intentionally use the full expanded set.
    """
    if scope != "representative":
        return expanded_runs
    keys = {k.strip() for k in flt.split(",") if k.strip()}
    if not keys or keys <= host_slugs():
        return representative_runs(expanded_runs)
    return expanded_runs


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


def sanitize_container_part(value: str) -> str:
    out = "".join(c.lower() if c.isalnum() else "-" for c in value)
    return "-".join(part for part in out.split("-") if part)[:48] or "bench"


def get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def image_tag(image_ref: str) -> str:
    last = image_ref.rsplit("/", 1)[-1]
    if ":" in last:
        return last.rsplit(":", 1)[-1]
    if "@" in last:
        return last.split("@", 1)[-1]
    return "latest"


def quant_scheme(quant: str) -> str | None:
    if quant == "BF16":
        return "W16A16"
    if quant == "Q8_0":
        return "W8A8"
    if "Q4" in quant or "IQ4" in quant or "MXFP4" in quant:
        return "W4A16"
    return None


def accelerator_suffix(host_cfg: dict) -> str:
    chip = host_cfg.get("chip", "")
    for marker in ("gfx1151", "gfx1200", "gfx1201", "gfx1100", "sm_89", "sm_121"):
        if marker in chip:
            return f" ({marker})"
    if "GB10" in chip:
        return " (sm_121)"
    if "AD102" in chip:
        return " (sm_89)"
    return ""


def public_engine(backend: str, bcfg: dict, host_cfg: dict) -> dict:
    accel = accelerator_suffix(host_cfg)
    host_slug = host_cfg.get("slug", "")
    if backend == "rocm":
        return {
            "slug": "llamacpp-hip",
            "name": "llama.cpp",
            "backend": "ROCm/HIP",
            "build_flags": f"-DGGML_HIP=ON{accel}",
            "file_suffix": "llamacpp-hip",
        }
    if backend == "vllm-rocm":
        return {
            "slug": "vllm",
            "name": "vLLM",
            "backend": "ROCm/HIP · TRITON_ATTN",
            "build_flags": f"VLLM_TARGET_DEVICE=rocm{accel}",
            "file_suffix": "vllm",
        }
    if backend == "vllm":
        backend_name = "CUDA · TRITON_ATTN" if host_slug == "dgx-spark-01" else "CUDA"
        return {
            "slug": "vllm",
            "name": "vLLM",
            "backend": backend_name,
            "build_flags": f"VLLM_TARGET_DEVICE=cuda{accel}",
            "file_suffix": "vllm",
        }
    return {
        "slug": bcfg["engine_slug"],
        "name": "llama.cpp",
        "backend": bcfg["engine_backend"],
        "build_flags": f"{bcfg['build_flags']}{accel}" if bcfg.get("build_flags") else "",
        "file_suffix": bcfg["file_suffix"],
    }


def serve_stream_scenario_suffix(entry: dict) -> tuple[str, str]:
    backend = entry.get("backend", "cuda")
    host_slug = entry.get("host", "")
    if backend in {"vllm", "vllm-rocm"} and host_slug in {"dgx-spark-01", "ryzen-ai-max-395-03"}:
        return "serve-stream-in512-out128-c1x4x16x32-attn-triton", "o128-triton-serve"
    return "serve-stream-in512-out128-c1x4x16x32", "o128-serve"


def json_request(url: str, *, timeout: float = 30.0) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "inferstation-bench/1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return int(resp.status), resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return int(e.code), e.read().decode("utf-8", "replace")
    except urllib.error.URLError as e:
        return 0, str(e)


def wait_health(base_url: str, container_name: str, *, timeout_s: int = 1800) -> None:
    deadline = time.monotonic() + timeout_s
    last = ""
    while time.monotonic() < deadline:
        status, body = json_request(f"{base_url}/health", timeout=5)
        if 200 <= status < 300:
            return
        last = f"HTTP {status}: {body[:200]}"
        rc = subprocess.run(
            f"{DOCKER} inspect -f '{{{{.State.Running}}}}' {shlex.quote(container_name)}",
            shell=True,
            text=True,
            capture_output=True,
        )
        if rc.returncode == 0 and rc.stdout.strip() == "false":
            logs = subprocess.run(
                f"{DOCKER} logs --tail 200 {shlex.quote(container_name)}",
                shell=True,
                text=True,
                capture_output=True,
            )
            raise RuntimeError(f"server container exited before health check passed\n{logs.stdout}\n{logs.stderr}")
        time.sleep(2)
    logs = subprocess.run(
        f"{DOCKER} logs --tail 200 {shlex.quote(container_name)}",
        shell=True,
        text=True,
        capture_output=True,
    )
    raise RuntimeError(f"server health timeout after {timeout_s}s; last={last}\n{logs.stdout}\n{logs.stderr}")


def make_prompt(seq: int, approx_tokens: int) -> str:
    sentence = f"InferStation request {seq}: the quick brown fox jumps over the lazy dog. "
    reps = max(1, approx_tokens // 9 + 1)
    return (sentence * reps).strip()


def stream_completion(base_url: str, model: str, prompt: str, output_len: int, *, timeout_s: int) -> dict:
    payload = {
        "model": model,
        "prompt": prompt,
        "max_tokens": output_len,
        "temperature": 0,
        "stream": True,
        "ignore_eos": True,
        "stream_options": {"include_usage": True},
    }

    def run_once(body: dict) -> dict:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"{base_url}/v1/completions",
            data=data,
            headers={"Content-Type": "application/json", "User-Agent": "inferstation-bench/1"},
            method="POST",
        )
        submit_t = time.perf_counter()
        first_t: float | None = None
        chunk_times: list[float] = []
        usage: dict = {}
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            for raw in resp:
                now = time.perf_counter()
                line = raw.decode("utf-8", "replace").strip()
                if not line or line.startswith(":") or not line.startswith("data:"):
                    continue
                text = line[5:].strip()
                if text == "[DONE]":
                    break
                try:
                    event = json.loads(text)
                except json.JSONDecodeError:
                    continue
                if event.get("usage"):
                    usage = event["usage"] or usage
                for choice in event.get("choices", []) or []:
                    delta = choice.get("text")
                    if delta is None:
                        delta = (choice.get("delta") or {}).get("content")
                    if delta:
                        if first_t is None:
                            first_t = now
                        chunk_times.append(now)
        end_t = time.perf_counter()
        completion_tokens = int(usage.get("completion_tokens") or output_len)
        prompt_tokens = int(usage.get("prompt_tokens") or 0) or None
        ttft_s = (first_t or end_t) - submit_t
        latency_s = end_t - submit_t
        tpot_s = (latency_s - ttft_s) / max(completion_tokens - 1, 1)
        itl_ms = [
            (chunk_times[i] - chunk_times[i - 1]) * 1000.0
            for i in range(1, len(chunk_times))
        ]
        return {
            "latency_s": latency_s,
            "ttft_s": ttft_s,
            "tpot_s": tpot_s,
            "itl_ms": itl_ms,
            "completion_tokens": completion_tokens,
            "prompt_tokens": prompt_tokens,
        }

    try:
        return run_once(payload)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        if e.code in (400, 422) and "stream_options" in body:
            payload.pop("stream_options", None)
            return run_once(payload)
        raise RuntimeError(f"completion HTTP {e.code}: {body[:500]}") from e


def pct(values: list[float], percentile: int) -> float | None:
    if not values:
        return None
    if len(values) == 1:
        return values[0]
    return statistics.quantiles(values, n=100, method="inclusive")[percentile - 1]


def mean(values: list[float]) -> float | None:
    return statistics.fmean(values) if values else None


def stddev(values: list[float]) -> float | None:
    return statistics.stdev(values) if len(values) > 1 else (0.0 if values else None)


def run_serve_client(base_url: str, model_name: str, *, concurrency: int, input_len: int, output_len: int) -> dict:
    # Historical serve-stream runs used 8 prompts for c1/c4, 16 for c16, 32 for c32.
    num_prompts = max(8, concurrency)
    timeout_s = int(os.environ.get("BENCH_REQUEST_TIMEOUT", "1800"))

    for warmup_id in range(2):
        stream_completion(
            base_url,
            model_name,
            make_prompt(100000 + warmup_id, 32),
            8,
            timeout_s=min(timeout_s, 300),
        )

    results: list[dict] = []
    errors: list[str] = []
    lock = threading.Lock()

    def worker(seq: int) -> None:
        try:
            result = stream_completion(
                base_url,
                model_name,
                make_prompt(seq, input_len),
                output_len,
                timeout_s=timeout_s,
            )
            with lock:
                results.append(result)
        except Exception as e:  # noqa: BLE001
            with lock:
                errors.append(str(e))

    start_t = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(worker, i) for i in range(num_prompts)]
        concurrent.futures.wait(futures)
    duration_s = time.perf_counter() - start_t

    completed = len(results)
    failed = len(errors)
    if failed or completed != num_prompts:
        raise RuntimeError(f"serve-stream failed: completed={completed}/{num_prompts}, errors={errors[:3]}")

    ttft_ms = [r["ttft_s"] * 1000.0 for r in results]
    tpot_ms = [r["tpot_s"] * 1000.0 for r in results]
    e2e_ms = [r["latency_s"] * 1000.0 for r in results]
    itl_ms = [x for r in results for x in r["itl_ms"]]
    prefill_tps = [
        input_len / max(r["ttft_s"] - r["tpot_s"], 1e-9)
        for r in results
    ]
    total_output_tokens = sum(int(r["completion_tokens"]) for r in results)
    total_input_tokens = completed * input_len
    output_throughput = total_output_tokens / duration_s if duration_s > 0 else None
    total_throughput = (total_input_tokens + total_output_tokens) / duration_s if duration_s > 0 else None

    return {
        "completed": completed,
        "failed": failed,
        "num_prompts": num_prompts,
        "max_concurrency": concurrency,
        "input_len": input_len,
        "output_len": output_len,
        "duration_s": duration_s,
        "request_throughput": completed / duration_s if duration_s > 0 else None,
        "output_throughput": output_throughput,
        "total_output_tokens": total_output_tokens,
        "total_input_tokens": total_input_tokens,
        "total_throughput": total_throughput,
        "decode_throughput": output_throughput,
        "prefill_throughput": mean(prefill_tps),
        "median_prefill_throughput": statistics.median(prefill_tps) if prefill_tps else None,
        "mean_ttft_ms": mean(ttft_ms),
        "median_ttft_ms": statistics.median(ttft_ms) if ttft_ms else None,
        "std_ttft_ms": stddev(ttft_ms),
        "p99_ttft_ms": pct(ttft_ms, 99),
        "mean_tpot_ms": mean(tpot_ms),
        "median_tpot_ms": statistics.median(tpot_ms) if tpot_ms else None,
        "std_tpot_ms": stddev(tpot_ms),
        "p99_tpot_ms": pct(tpot_ms, 99),
        "mean_itl_ms": mean(itl_ms),
        "median_itl_ms": statistics.median(itl_ms) if itl_ms else None,
        "std_itl_ms": stddev(itl_ms),
        "p99_itl_ms": pct(itl_ms, 99),
        "mean_e2el_ms": mean(e2e_ms),
        "median_e2el_ms": statistics.median(e2e_ms) if e2e_ms else None,
    }


def write_serve_record(
    entry: dict,
    host_cfg: dict,
    model_def: dict,
    bcfg: dict,
    image_ref: str,
    engine_commit: str,
    server_cmd: str,
    bench: dict,
) -> Path:
    host_slug = entry["host"]
    model_slug = entry["model"]
    quant = entry["quant"]
    backend = entry.get("backend", "cuda")
    public = public_engine(backend, bcfg, host_cfg)
    npl = int(bench["max_concurrency"])
    b_slug = "" if npl == 1 else f"-bs{npl}"
    run_date = datetime.datetime.utcnow().strftime("%Y-%m-%d")
    scenario, serve_suffix = serve_stream_scenario_suffix(entry)
    out_rel = f"data/runs/{run_date}/{host_slug}-{model_slug}-{quant}{b_slug}-{public['file_suffix']}-{serve_suffix}.json"
    out_abs = REPO / out_rel
    out_abs.parent.mkdir(parents=True, exist_ok=True)

    run_id = os.environ.get("GITHUB_RUN_ID", "manual")
    repo_slug = os.environ.get("GITHUB_REPOSITORY", "JoursBleu/InferStation")
    server = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
    log_url = f"{server}/{repo_slug}/actions/runs/{run_id}" if run_id != "manual" else ""
    scheme = quant_scheme(quant)
    model_record = {
        "slug": model_slug,
        "name": model_def["name"],
        "params_b": model_def["params_b"],
        "quantization": quant,
        "source_url": model_def.get("source_url", ""),
    }
    if scheme:
        model_record["scheme"] = scheme

    notes = (
        f"serve stream: completed={bench['completed']}/{bench['num_prompts']}, "
        f"ttft={bench['mean_ttft_ms']:.0f}ms tpot={bench['mean_tpot_ms']:.1f}ms; "
        f"prefill={bench['prefill_throughput']:.3g} decode={bench['decode_throughput']:.4g} "
        f"total={bench['total_throughput']:.4g} tok/s; "
        f"req_tput={bench['request_throughput']:.3f}/s"
    )
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
        "model": model_record,
        "engine": {
            "slug": public["slug"],
            "name": public["name"],
            "version": engine_commit,
            "commit": engine_commit if public["name"] == "llama.cpp" else "",
            "backend": public["backend"],
            "build_flags": public["build_flags"],
        },
        "command": server_cmd,
        "pp_test": f"in{bench['input_len']}",
        "pp_toks_per_s": bench["prefill_throughput"],
        "tg_test": f"out{bench['output_len']}",
        "tg_toks_per_s": bench["decode_throughput"],
        "combined_toks_per_s": bench["total_throughput"],
        "ttft_ms": bench["mean_ttft_ms"],
        "tpot_ms": bench["mean_tpot_ms"],
        "prefill_toks_per_s": bench["prefill_throughput"],
        "decode_toks_per_s": bench["decode_throughput"],
        "total_toks_per_s": bench["total_throughput"],
        "ctx": None,
        "batch": npl,
        "concurrency": npl,
        "n_gpu_layers": None,
        "vram_used_gb": None,
        "scenario": scenario,
        "image": image_ref,
        "image_tag": image_tag(image_ref),
        "usability_tag": "ok",
        "log_url": log_url,
        "source_url": log_url,
        "notes": notes,
        "raw_llamabench": [bench],
    }
    out_abs.write_text(json.dumps(record, indent=2) + "\n")
    print(f"wrote {out_abs}")
    return out_abs


def run_one_vllm(entry: dict, models: dict, image_override: str | None) -> Path:
    """Run the historical online serve-stream benchmark through vLLM."""
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
    tp = int(entry.get("tp", 1))
    pp = int(entry.get("pp", 512))
    tg = int(entry.get("tg", 128))
    npl = int(entry.get("npl", 1))

    snap_dir = ensure_model(host_cfg, model_slug, model_def, quant)
    real_dir = host_readlink(snap_dir) or snap_dir

    port = get_free_port()
    container_name = (
        f"inferstation-bench-{sanitize_container_part(host_slug)}-"
        f"{sanitize_container_part(model_slug)}-{sanitize_container_part(quant)}-"
        f"{os.getpid()}-{port}"
    )
    model_name = "inferstation-bench"
    max_model_len = int(entry.get("max_model_len", max(2048, (pp + tg) * 2 + 1024)))
    gpu_mem_util = float(entry.get("gpu_memory_utilization", 0.85))
    inner_cmd = (
        f"exec vllm serve /model "
        f"--served-model-name {shlex.quote(model_name)} "
        f"--host 0.0.0.0 --port {port} "
        f"--dtype bfloat16 "
        f"--max-model-len {max_model_len} "
        f"--max-num-seqs {npl} "
        f"--tensor-parallel-size {tp} "
        f"--gpu-memory-utilization {gpu_mem_util} "
        f"--trust-remote-code "
        f"--disable-log-requests"
    )
    base_url = f"http://127.0.0.1:{port}"
    sh(f"{DOCKER} rm -f {shlex.quote(container_name)} >/dev/null 2>&1 || true", check=False)
    try:
        sh(
            f"{DOCKER} run -d --name {shlex.quote(container_name)} {docker_extra} --network host "
            f"--entrypoint bash "
            f"-v {shlex.quote(real_dir)}:/model:ro "
            f"{image_ref} "
            f"-lc {shlex.quote(inner_cmd)}"
        )
        wait_health(base_url, container_name)
        bench = run_serve_client(base_url, model_name, concurrency=npl, input_len=pp, output_len=tg)
        return write_serve_record(entry, host_cfg, model_def, bcfg, image_ref, engine_commit, inner_cmd, bench)
    except Exception:
        logs = subprocess.run(
            f"{DOCKER} logs --tail 200 {shlex.quote(container_name)}",
            shell=True,
            text=True,
            capture_output=True,
        )
        if logs.stdout or logs.stderr:
            print(logs.stdout, file=sys.stderr)
            print(logs.stderr, file=sys.stderr)
        raise
    finally:
        sh(f"{DOCKER} rm -f {shlex.quote(container_name)} >/dev/null 2>&1 || true", check=False)


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
    # Serve-stream runs one server per (model, quant, backend) entry and drives
    # the recipe-declared concurrency level through an OpenAI-compatible client.
    if "npls" in entry:
        npls = [int(x) for x in entry["npls"]]
    else:
        npls = [int(entry.get("npl", 1))]
    pp = int(entry.get("pp", 512))
    tg = int(entry.get("tg", 128))
    max_npl = max(npls)

    model_path = ensure_model(host_cfg, model_slug, model_def, quant)
    real_path = host_readlink(model_path)
    real_dir = os.path.dirname(real_path)
    real_fn = os.path.basename(real_path)

    port = get_free_port()
    container_name = (
        f"inferstation-bench-{sanitize_container_part(host_slug)}-"
        f"{sanitize_container_part(model_slug)}-{sanitize_container_part(quant)}-"
        f"{os.getpid()}-{port}"
    )
    model_name = "inferstation-bench"
    ctx_size = int(entry.get("ctx", max(4096, (pp + tg) * max_npl + 1024)))
    cmd = (
        "server_bin=$(command -v llama-server || true); "
        "if [ -z \"$server_bin\" ]; then "
        "for p in /app/llama-server /usr/local/bin/llama-server /usr/bin/llama-server /opt/llama.cpp/llama-server; do "
        "[ -x \"$p\" ] && server_bin=\"$p\" && break; done; fi; "
        "[ -n \"$server_bin\" ] || { echo 'llama-server not found' >&2; exit 127; }; "
        f"exec \"$server_bin\" -m /models/{shlex.quote(real_fn)} -ngl 999 "
        f"--host 0.0.0.0 --port {port} --alias {shlex.quote(model_name)} "
        f"-c {ctx_size} -np {max_npl} -cb --no-webui"
    )
    docker_extra = entry.get("docker_extra") or bcfg["docker_extra"]
    base_url = f"http://127.0.0.1:{port}"
    sh(f"{DOCKER} rm -f {shlex.quote(container_name)} >/dev/null 2>&1 || true", check=False)
    try:
        sh(
            f"{DOCKER} run -d --name {shlex.quote(container_name)} {docker_extra} --network host --entrypoint bash "
            f"-v {shlex.quote(real_dir)}:/models:ro {image_ref} "
            f"-lc {shlex.quote(cmd)}"
        )
        wait_health(base_url, container_name)
        out_paths: list[Path] = []
        for npl in npls:
            bench = run_serve_client(base_url, model_name, concurrency=npl, input_len=pp, output_len=tg)
            out_paths.append(write_serve_record(entry, host_cfg, model_def, bcfg, image_ref, engine_commit, cmd, bench))
        return out_paths
    except Exception:
        logs = subprocess.run(
            f"{DOCKER} logs --tail 200 {shlex.quote(container_name)}",
            shell=True,
            text=True,
            capture_output=True,
        )
        if logs.stdout or logs.stderr:
            print(logs.stdout, file=sys.stderr)
            print(logs.stderr, file=sys.stderr)
        raise
    finally:
        sh(f"{DOCKER} rm -f {shlex.quote(container_name)} >/dev/null 2>&1 || true", check=False)


def git_commit_push(out_paths: Path | list[Path], entry: dict) -> None:
    if isinstance(out_paths, Path):
        paths = [out_paths]
    else:
        paths = out_paths
    rel_paths = " ".join(shlex.quote(str(p.relative_to(REPO))) for p in paths)
    sh(f"cd {REPO} && git add {rel_paths}")
    rc = subprocess.run(
        "git diff --cached --quiet", shell=True, cwd=REPO
    ).returncode
    if rc == 0:
        print("[skip] no diff to commit")
        return
    if "npls" in entry:
        suffix = " bs" + ",".join(str(x) for x in entry["npls"])
    else:
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
    attempts = int(os.environ.get("BENCH_GIT_PUSH_ATTEMPTS", "6"))
    last_error = ""
    for attempt in range(1, attempts + 1):
        pull_rc = subprocess.run(
            "git -c user.name='InferStation Bench Bot' "
            "-c user.email='actions@inferstation' "
            "pull --rebase --autostash origin main",
            shell=True, cwd=REPO,
        ).returncode
        if pull_rc != 0:
            last_error = f"git pull --rebase rc={pull_rc}"
            print(f"[{last_error}] attempt {attempt}/{attempts}, aborting rebase")
            subprocess.run("git rebase --abort", shell=True, cwd=REPO)
        else:
            push_rc = subprocess.run(
                "git push origin HEAD:main", shell=True, cwd=REPO,
            ).returncode
            if push_rc == 0:
                return
            last_error = f"git push rc={push_rc}"
            print(f"[{last_error}] attempt {attempt}/{attempts}")
        if attempt < attempts:
            time.sleep(min(2 * attempt, 15))
    raise RuntimeError(f"failed to push benchmark result after {attempts} attempts: {last_error}")


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
    ap.add_argument(
        "--scope",
        choices=("representative", "all"),
        default=os.environ.get("BENCH_SCOPE", "representative"),
        help="Default run set when --filter is empty. representative is the weekly schedule; all is the full expanded registry.",
    )
    ap.add_argument("--skip-push", action="store_true")
    ap.add_argument("--skip-push-site", action="store_true", help="Do not rsync each completed run to the site host.")
    ap.add_argument("--dry-run", action="store_true", help="Print the selected plan and exit without running benchmarks.")
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
    expanded_runs = expand_weekly_runs(reg.get("runs", []))
    base_runs = scope_base_runs(expanded_runs, args.scope, args.filter)
    runs = select(base_runs, args.filter)
    if not runs:
        print("nothing to do")
        return 0
    print(f"[plan] {len(runs)} run(s):")
    for r in runs:
        bs_disp = r.get("npl") if "npl" in r else (",".join(str(x) for x in r.get("npls", [1])))
        eff_image = image_override or r.get("image") or HOSTS.get(r["host"], {}).get("backends", {}).get(r.get("backend", "cuda"), "<unset>")
        print(f"  - {r['host']} :: {r['model']} :: {r['quant']} ({r.get('backend','cuda')}) bs={bs_disp} image={eff_image}")
    if args.dry_run:
        return 0

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
            if not args.skip_push:
                git_commit_push(out_abs_list, r)
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
