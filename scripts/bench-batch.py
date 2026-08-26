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
import re
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
PULL_ATTEMPTS = max(1, int(os.environ.get("BENCH_PULL_ATTEMPTS", "4")))
DOWNLOAD_ATTEMPTS = max(1, int(os.environ.get("BENCH_DOWNLOAD_ATTEMPTS", "4")))
UNIT_ATTEMPTS = max(1, int(os.environ.get("BENCH_UNIT_ATTEMPTS", "2")))
RETRY_DELAY_SECONDS = max(0, int(os.environ.get("BENCH_RETRY_DELAY_SECONDS", "10")))
SERVE_CONCURRENCIES = [1, 4, 16, 32]
SERVE_MAX_CONCURRENCY = max(SERVE_CONCURRENCIES)

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
        "--device nvidia.com/gpu=all "
        "-e VK_DRIVER_FILES=/etc/vulkan/icd.d/nvidia_icd.json"
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


def sh(
    cmd: str,
    *,
    capture: bool = False,
    check: bool = True,
    display_cmd: str | None = None,
) -> str:
    print(f"$ {display_cmd or cmd}", flush=True)
    if capture:
        out = subprocess.run(cmd, shell=True, check=check, text=True, capture_output=True)
        return out.stdout
    subprocess.run(cmd, shell=True, check=check)
    return ""


def retry_command(
    cmd: str,
    *,
    attempts: int,
    label: str,
    capture: bool = False,
    display_cmd: str | None = None,
    sleeper=time.sleep,
) -> str:
    """Run an infrastructure command with bounded exponential backoff."""
    for attempt in range(1, attempts + 1):
        try:
            return sh(cmd, capture=capture, display_cmd=display_cmd)
        except subprocess.CalledProcessError:
            if attempt >= attempts:
                raise
            delay = min(RETRY_DELAY_SECONDS * (2 ** (attempt - 1)), 60)
            print(
                f"[retry] {label} failed attempt {attempt}/{attempts}; "
                f"retrying in {delay}s",
                file=sys.stderr,
                flush=True,
            )
            sleeper(delay)
    raise AssertionError("retry loop exhausted")


def host_test(path: str) -> bool:
    """Test for file existence on the host (not in the runner container)."""
    rc = subprocess.run(
        f"{DOCKER} run --rm -v /:/hostfs:ro alpine:3 test -f /hostfs{shlex.quote(path)}",
        shell=True,
    ).returncode
    return rc == 0


def host_dir_test(path: str) -> bool:
    """Test for directory existence on the host (not in the runner container)."""
    rc = subprocess.run(
        f"{DOCKER} run --rm -v /:/hostfs:ro alpine:3 test -d /hostfs{shlex.quote(path)}",
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


def apply_gpu_device(docker_extra: str) -> str:
    """Pin NVIDIA Docker launches when BENCH_GPU_DEVICE is set."""
    gpu_device = os.environ.get("BENCH_GPU_DEVICE", "").strip()
    if not gpu_device:
        return docker_extra
    if not gpu_device.isdigit():
        raise ValueError(f"invalid BENCH_GPU_DEVICE: {gpu_device!r}")
    if "--gpus all" in docker_extra:
        return docker_extra.replace("--gpus all", f"--gpus device={gpu_device}", 1)
    if "--device nvidia.com/gpu=all" in docker_extra:
        return docker_extra.replace(
            "--device nvidia.com/gpu=all",
            f"--device nvidia.com/gpu={gpu_device}",
            1,
        )
    raise ValueError("BENCH_GPU_DEVICE requires NVIDIA GPU or CDI Docker args")


def ensure_image(image_ref: str, *, backend: str) -> str:
    """Make sure `image_ref` is present locally; return engine version/commit.

    Always pulls if missing (no fallback to local build). Mutable `latest` tags
    are refreshed even when cached. Engine version is extracted with a backend-specific probe:
      - llama.cpp: `cat /opt/llama.cpp/commit.txt` if present, else
        `llama-cli --version` last word.
      - vllm:     `python3 -c 'import vllm; print(vllm.__version__)'`
    """
    have = sh(f"{DOCKER} images -q {image_ref}", capture=True).strip()
    image_tag = image_ref.rsplit(":", 1)[-1] if ":" in image_ref.rsplit("/", 1)[-1] else "latest"
    if not have or image_tag == "latest":
        retry_command(
            f"{DOCKER} pull {shlex.quote(image_ref)}",
            attempts=PULL_ATTEMPTS,
            label=f"docker pull {image_ref}",
        )

    if backend in ("vllm", "vllm-rocm"):
        ver = sh(
            f"{DOCKER} run --rm --entrypoint python3 {image_ref} "
            f"-c 'import vllm; print(vllm.__version__)'",
            capture=True,
        ).strip().splitlines()[-1]
        return ver.split("+", 1)[-1] if "+" in ver else ver

    cmd = (
        "for f in /opt/llama.cpp/commit.txt /usr/local/share/llama.cpp/commit.txt; do "
        "[ -s \"$f\" ] && { cat \"$f\"; exit 0; }; done; "
        "for p in /app/llama-server /usr/local/bin/llama-server /usr/bin/llama-server "
        "/opt/llama.cpp/llama-server; do "
        "[ -x \"$p\" ] && { \"$p\" --version 2>&1 | head -n 1; exit 0; }; done; "
        "command -v llama-cli >/dev/null && llama-cli --version 2>&1 | head -n 1"
    )
    out = sh(
        f"{DOCKER} run --rm --entrypoint sh {image_ref} -c {shlex.quote(cmd)}",
        capture=True,
    ).strip()
    version_commit = re.search(r"\(([0-9a-f]{7,40})\)", out)
    if version_commit:
        return version_commit.group(1)
    return out or "unknown"


def image_digest(image_ref: str) -> str:
    """Return the pulled manifest digest for an image, or an empty string."""
    if "@sha256:" in image_ref:
        return image_ref.rsplit("@", 1)[-1]
    out = sh(
        f"{DOCKER} image inspect --format '{{{{json .RepoDigests}}}}' {shlex.quote(image_ref)}",
        capture=True,
    ).strip()
    repo_digests = (json.loads(out) if out else []) or []
    repository = image_ref.rsplit(":", 1)[0] if ":" in image_ref.rsplit("/", 1)[-1] else image_ref
    matching = [item for item in repo_digests if item.partition("@")[0] == repository]
    selected = matching[0] if matching else (repo_digests[0] if repo_digests else "")
    return selected.partition("@")[2]


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
        # vLLM-style: materialize a full snapshot at the host-specific target.
        local_path = (qdef.get("local_paths") or {}).get(host_cfg.get("slug", "")) or qdef.get("local_path")
        snap_dir = local_path.rstrip("/") if local_path else f"{host_cfg['models_root']}/{host_dir}-{quant}"
        if host_test(f"{snap_dir}/config.json"):
            print(f"[ok] {snap_dir} already present")
            return snap_dir

        archive_url = qdef.get("archive_url") or model_def.get("archive_url")
        archive_sha256 = qdef.get("archive_sha256") or model_def.get("archive_sha256")
        if archive_url:
            if not archive_sha256:
                raise RuntimeError(f"missing archive_sha256 for {model_slug}:{quant}")
            archive_path = f"{snap_dir}.download.tar"
            partial_dir = f"{snap_dir}.partial"
            parent_dir = os.path.dirname(snap_dir)
            script = (
                "set -eu; "
                f"rm -rf {shlex.quote(partial_dir)}; "
                f"mkdir -p {shlex.quote(parent_dir)} {shlex.quote(partial_dir)}; "
                f"trap 'rm -rf {shlex.quote(partial_dir)}' EXIT; "
                f"attempt=1; until curl -fL --retry 2 --retry-all-errors --retry-delay 5 "
                f"--connect-timeout 30 --continue-at - -o {shlex.quote(archive_path)} "
                f"{shlex.quote(archive_url)}; do "
                f"if [ \"$attempt\" -ge {DOWNLOAD_ATTEMPTS} ]; then exit 1; fi; "
                "delay=$((attempt * 10)); echo \"download retry $attempt "
                f"/{DOWNLOAD_ATTEMPTS} in ${{delay}}s\" >&2; sleep \"$delay\"; "
                "attempt=$((attempt + 1)); done; "
                f"if ! printf '%s  %s\n' {shlex.quote(archive_sha256)} "
                f"{shlex.quote(archive_path)} | sha256sum -c -; then "
                f"rm -f {shlex.quote(archive_path)}; exit 1; fi; "
                f"tar -xf {shlex.quote(archive_path)} -C {shlex.quote(partial_dir)}; "
                f"test -f {shlex.quote(f'{partial_dir}/config.json')}; "
                f"rm -rf {shlex.quote(snap_dir)}; "
                f"mv {shlex.quote(partial_dir)} {shlex.quote(snap_dir)}; "
                f"rm -f {shlex.quote(archive_path)}"
            )
            print(f"[dl] {archive_url} -> {snap_dir}")
            sh(script)
            return snap_dir

        repo = qdef.get("hf_repo") or model_def.get("hf_repo")
        if not repo:
            raise RuntimeError(f"no snapshot source configured for {model_slug}:{quant}")
        partial_dir = f"{snap_dir}.partial"
        parent_dir = os.path.dirname(snap_dir)
        sh(
            f"{DOCKER} run --rm -v /:/hostfs alpine:3 "
            f"sh -c {shlex.quote(f'rm -rf /hostfs{partial_dir} && mkdir -p /hostfs{parent_dir} /hostfs{partial_dir}')}"
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
        # Let Docker copy HF_TOKEN from this process. Never put the secret in
        # argv: CalledProcessError includes argv and is printed in job summaries.
        token_run_env = "-e HF_TOKEN " if HF_TOKEN else ""
        token_display_env = "-e HF_TOKEN=<redacted> " if HF_TOKEN else ""
        snapshot_cmd = (
            f"{DOCKER} run --rm --network host --user 0:0 "
            f"-v {shlex.quote(partial_dir)}:/dst "
            f"-e HF_HOME=/dst/.hf "
            f"-e HF_ENDPOINT={shlex.quote(HF_ENDPOINT)} "
            f"-e HF_HUB_ENABLE_HF_TRANSFER=1 "
            f"-e HF_HUB_ETAG_TIMEOUT=60 "
            f"{token_run_env}"
            f"python:3.11-slim "
            f"sh -c {shlex.quote(inner)}"
        )
        display_snapshot_cmd = snapshot_cmd.replace(token_run_env, token_display_env)
        try:
            retry_command(
                snapshot_cmd,
                attempts=DOWNLOAD_ATTEMPTS,
                label=f"hf download {repo}",
                display_cmd=display_snapshot_cmd,
            )
            if not host_test(f"{partial_dir}/config.json"):
                raise RuntimeError(f"downloaded snapshot has no config.json: {repo}")
            sh(
                f"{DOCKER} run --rm -v /:/hostfs alpine:3 "
                f"sh -c {shlex.quote(f'rm -rf /hostfs{snap_dir} && mv /hostfs{partial_dir} /hostfs{snap_dir}')}"
            )
        except Exception:
            sh(
                f"{DOCKER} run --rm -v /:/hostfs alpine:3 "
                f"sh -c {shlex.quote(f'rm -rf /hostfs{partial_dir}')}"
            )
            raise
        return snap_dir

    # Default: single-file GGUF.
    fn = qdef["filename"]
    model_dir = f"{host_cfg['models_root']}/{host_dir}"
    path = f"{model_dir}/{fn}"
    if host_test(path):
        print(f"[ok] {path} already present")
        return path
    repo = qdef.get("hf_repo") or model_def.get("hf_repo")
    download_url = qdef.get("download_url")
    if not download_url and not repo:
        raise RuntimeError(f"missing {path} and no hf_repo configured for {model_slug}:{quant}")
    url = download_url or f"{HF_ENDPOINT}/{repo}/resolve/main/{fn}"
    print(f"[dl] {url} -> {path}")
    sh(
        f"{DOCKER} run --rm -v /:/hostfs alpine:3 "
        f"sh -c {shlex.quote(f'mkdir -p /hostfs{model_dir}')}"
    )
    # curlimages/curl runs as uid 100; the model dir was created by alpine
    # (root) so we need --user 0:0 to be able to write into it.
    dst = f"/dst/{fn}"
    partial = f"{dst}.partial"
    curl_cmd = (
        "set -eu; "
        "if [ -n \"${HF_TOKEN:-}\" ]; then "
        "set -- -H \"Authorization: Bearer ${HF_TOKEN}\"; else set --; fi; "
        f"expected=$(curl -fsSIL --retry 8 --retry-all-errors --retry-delay 5 "
        f"--connect-timeout 30 \"$@\" {shlex.quote(url)} | "
        "awk 'tolower($1) == \"content-length:\" { gsub(\"\\r\", \"\", $2); n=$2 } END { print n }'); "
        "if [ -z \"$expected\" ] || [ \"$expected\" -le 0 ]; then "
        "echo \"missing content length\" >&2; exit 1; fi; "
        f"current=$([ -f {shlex.quote(partial)} ] && wc -c < {shlex.quote(partial)} || echo 0); "
        f"if [ \"$current\" -gt \"$expected\" ]; then rm -f {shlex.quote(partial)}; current=0; fi; "
        "attempt=1; while :; do "
        f"curl -fL --retry 2 --retry-all-errors --retry-delay 5 --connect-timeout 30 "
        f"--continue-at - \"$@\" -o {shlex.quote(partial)} {shlex.quote(url)} || true; "
        f"current=$([ -f {shlex.quote(partial)} ] && wc -c < {shlex.quote(partial)} || echo 0); "
        "if [ \"$current\" -eq \"$expected\" ]; then break; fi; "
        f"if [ \"$attempt\" -ge {DOWNLOAD_ATTEMPTS} ]; then exit 1; fi; "
        "delay=$((attempt * 10)); echo \"download retry $attempt "
        f"/{DOWNLOAD_ATTEMPTS} in ${{delay}}s\" >&2; sleep \"$delay\"; "
        "attempt=$((attempt + 1)); done; "
        f"actual=$(wc -c < {shlex.quote(partial)}); "
        "if [ -z \"$expected\" ] || [ \"$expected\" -le 0 ] || [ \"$actual\" -ne \"$expected\" ]; then "
        "echo \"download size mismatch: expected=$expected actual=$actual\" >&2; exit 1; fi; "
        f"mv -f {shlex.quote(partial)} {shlex.quote(dst)}"
    )
    use_hf_auth = bool(HF_TOKEN and not download_url)
    token_env = "-e HF_TOKEN=<redacted> " if use_hf_auth else ""
    # `docker run -e NAME` inherits NAME without embedding its value in argv.
    token_run_env = "-e HF_TOKEN " if use_hf_auth else ""
    cmd = (
        f"{DOCKER} run --rm --network host --user 0:0 "
        f"-v {shlex.quote(model_dir)}:/dst "
        f"{token_run_env}"
        f"curlimages/curl:8.10.1 "
        f"sh -c {shlex.quote(curl_cmd)}"
    )
    display_cmd = cmd.replace(token_run_env, token_env) if token_run_env else cmd
    print(f"$ {display_cmd}", flush=True)
    subprocess.run(cmd, shell=True, check=True)
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
        local_path = (qdef.get("local_paths") or {}).get(host_cfg.get("slug", "")) or qdef.get("local_path")
        snap_dir = local_path.rstrip("/") if local_path else f"{host_cfg['models_root']}/{host_dir}-{quant}"
        if not host_dir_test(snap_dir):
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
        f"sh -c {shlex.quote(f'rm -f /hostfs{path} /hostfs{path}.partial && rmdir /hostfs{model_dir} 2>/dev/null || true')}"
    )


def cleanup_weekly_models(host_cfg: dict, models: dict) -> None:
    """Remove all weekly benchmark model artifacts for this host.

    This is intentionally host-local and registry-driven: it only removes the
    directories/files that bench/registry.yaml can create under models_root.
    """
    seen: set[tuple[str, str]] = set()
    for model_slug, model_def in models.items():
        for quant in (model_def.get("quants") or {}):
            key = (model_slug, quant)
            if key in seen:
                continue
            seen.add(key)
            cleanup_model(host_cfg, model_slug, model_def, quant)


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


def current_run_date() -> str:
    return os.environ.get("BENCH_RUN_DATE") or datetime.datetime.utcnow().strftime("%Y-%m-%d")


def expected_serve_record_paths(entry: dict, host_cfg: dict, bcfg: dict, *, run_date: str | None = None) -> list[Path]:
    backend = entry.get("backend", "cuda")
    public = public_engine(backend, bcfg, host_cfg)
    result_host = entry.get("result_host") or entry["host"]
    if "npls" in entry:
        npls = [int(x) for x in entry["npls"]]
    else:
        npls = [int(entry.get("npl", 1))]
    scenario, serve_suffix = serve_stream_scenario_suffix(entry)
    del scenario
    date = run_date or current_run_date()
    out = []
    for npl in npls:
        b_slug = "" if npl == 1 else f"-bs{npl}"
        out.append(REPO / f"data/runs/{date}/{result_host}-{entry['model']}-{entry['quant']}{b_slug}-{public['file_suffix']}-{serve_suffix}.json")
    return out


def successful_serve_record(path: Path) -> bool:
    try:
        record = json.loads(path.read_text())
    except Exception:
        return False
    if record.get("usability_tag") not in (None, "ok"):
        return False
    if not (record.get("decode_toks_per_s") or record.get("tg_toks_per_s")):
        return False
    raw = record.get("raw_llamabench") or []
    return all(int(r.get("failed") or 0) == 0 and int(r.get("completed") or 0) > 0 for r in raw)


def has_successful_record_any_date(expected_path: Path) -> bool:
    return any(successful_serve_record(path) for path in REPO.glob(f"data/runs/*/{expected_path.name}"))


def has_successful_record(expected_path: Path, mode: str) -> bool:
    if mode == "none":
        return False
    if mode == "date":
        return successful_serve_record(expected_path)
    if mode == "any":
        return has_successful_record_any_date(expected_path)
    raise SystemExit(f"invalid resume mode: {mode}")


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
    image_manifest_digest: str,
    engine_commit: str,
    server_cmd: str,
    bench: dict,
) -> Path:
    host_slug = entry["host"]
    result_host_slug = entry.get("result_host") or host_slug
    model_slug = entry["model"]
    quant = entry["quant"]
    backend = entry.get("backend", "cuda")
    public = public_engine(backend, bcfg, host_cfg)
    npl = int(bench["max_concurrency"])
    b_slug = "" if npl == 1 else f"-bs{npl}"
    run_date = current_run_date()
    scenario, serve_suffix = serve_stream_scenario_suffix(entry)
    out_rel = f"data/runs/{run_date}/{result_host_slug}-{model_slug}-{quant}{b_slug}-{public['file_suffix']}-{serve_suffix}.json"
    out_abs = REPO / out_rel
    out_abs.parent.mkdir(parents=True, exist_ok=True)

    run_id = os.environ.get("GITHUB_RUN_ID", "manual")
    repo_slug = os.environ.get("GITHUB_REPOSITORY", "InferStation/InferStation")
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
            "slug": result_host_slug,
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
        "image_digest": image_manifest_digest,
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
    docker_extra = apply_gpu_device(entry.get("docker_extra") or bcfg["docker_extra"])
    model_def = models[model_slug]
    snap_dir = ensure_model(host_cfg, model_slug, model_def, quant)
    real_dir = host_readlink(snap_dir) or snap_dir
    image_ref = resolve_image(entry, host_cfg, backend, image_override)
    engine_commit = ensure_image(image_ref, backend=backend)
    image_manifest_digest = image_digest(image_ref)
    tp = int(entry.get("tp", 1))
    pp = int(entry.get("pp", 512))
    tg = int(entry.get("tg", 128))
    npl = int(entry.get("npl", 1))
    server_max_seqs = int(entry.get("server_max_seqs", SERVE_MAX_CONCURRENCY))

    port = get_free_port()
    container_name = (
        f"inferstation-bench-{sanitize_container_part(host_slug)}-"
        f"{sanitize_container_part(model_slug)}-{sanitize_container_part(quant)}-"
        f"{os.getpid()}-{port}"
    )
    model_name = "inferstation-bench"
    max_model_len = int(entry.get("max_model_len", max(2048, (pp + tg) * 2 + 1024)))
    gpu_mem_util = float(entry.get("gpu_memory_utilization", 0.85))
    vllm_args = shlex.join(shlex.split(str(entry.get("vllm_args", ""))))
    inner_cmd = (
        f"exec vllm serve /model "
        f"--served-model-name {shlex.quote(model_name)} "
        f"--host 0.0.0.0 --port {port} "
        f"--dtype bfloat16 "
        f"--max-model-len {max_model_len} "
        f"--max-num-seqs {server_max_seqs} "
        f"--tensor-parallel-size {tp} "
        f"--gpu-memory-utilization {gpu_mem_util} "
        f"--trust-remote-code"
        f"{f' {vllm_args}' if vllm_args else ''}"
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
        return write_serve_record(
            entry,
            host_cfg,
            model_def,
            bcfg,
            image_ref,
            image_manifest_digest,
            engine_commit,
            inner_cmd,
            bench,
        )
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
    model_def = models[model_slug]
    model_path = ensure_model(host_cfg, model_slug, model_def, quant)
    real_path = host_readlink(model_path)
    real_dir = os.path.dirname(real_path)
    real_fn = os.path.basename(real_path)
    image_ref = resolve_image(entry, host_cfg, backend, image_override)
    engine_commit = ensure_image(image_ref, backend=backend)
    image_manifest_digest = image_digest(image_ref)
    # Serve-stream runs one server per (model, quant, backend) entry and drives
    # the recipe-declared concurrency level through an OpenAI-compatible client.
    if "npls" in entry:
        npls = [int(x) for x in entry["npls"]]
    else:
        npls = [int(entry.get("npl", 1))]
    pp = int(entry.get("pp", 512))
    tg = int(entry.get("tg", 128))
    max_npl = max(npls)

    port = get_free_port()
    container_name = (
        f"inferstation-bench-{sanitize_container_part(host_slug)}-"
        f"{sanitize_container_part(model_slug)}-{sanitize_container_part(quant)}-"
        f"{os.getpid()}-{port}"
    )
    model_name = "inferstation-bench"
    ctx_size = int(entry.get("ctx", max(32768, max_npl * 2048)))
    cmd = (
        "server_bin=$(command -v llama-server || true); "
        "if [ -z \"$server_bin\" ]; then "
        "for p in /app/llama-server /usr/local/bin/llama-server /usr/bin/llama-server /opt/llama.cpp/llama-server; do "
        "[ -x \"$p\" ] && server_bin=\"$p\" && break; done; fi; "
        "[ -n \"$server_bin\" ] || { echo 'llama-server not found' >&2; exit 127; }; "
        f"exec \"$server_bin\" -m /models/{shlex.quote(real_fn)} -ngl 999 "
        f"--host 0.0.0.0 --port {port} --alias {shlex.quote(model_name)} "
        f"-c {ctx_size} -np {max_npl} -fa on -cb --no-webui"
    )
    docker_extra = apply_gpu_device(entry.get("docker_extra") or bcfg["docker_extra"])
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
            out_paths.append(
                write_serve_record(
                    entry,
                    host_cfg,
                    model_def,
                    bcfg,
                    image_ref,
                    image_manifest_digest,
                    engine_commit,
                    cmd,
                    bench,
                )
            )
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


def retryable_run_failure(exc: Exception) -> bool:
    """Whether rerunning a whole benchmark unit can recover this failure."""
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return True
    if isinstance(exc, urllib.error.URLError):
        reason = exc.reason
        if isinstance(reason, (TimeoutError, socket.timeout)):
            return True
        if "timed out" in str(reason).lower():
            return True
    text = str(exc).lower()
    command = str(exc.cmd).lower() if isinstance(exc, subprocess.CalledProcessError) else ""
    if any(marker in command for marker in ("docker pull", "curlimages/curl", "hf download")):
        return True
    transient_markers = (
        "could not resolve host",
        "temporary failure in name resolution",
        "connection reset",
        "connection timed out",
        "network is unreachable",
        "no route to host",
        "remote end closed connection",
        "unexpected eof",
        "broken pipe",
        "timed out",
        "server health timeout",
    )
    if any(marker in text for marker in transient_markers):
        return True
    return "serve-stream failed" in text and "timed out" in text


def run_one_with_retries(
    entry: dict,
    models: dict,
    image_override: str | None,
    *,
    runner=None,
    attempts: int | None = None,
    sleeper=time.sleep,
) -> list[Path]:
    """Retry a transiently failed unit from a fresh model server container."""
    operation = runner or run_one
    max_attempts = attempts if attempts is not None else UNIT_ATTEMPTS
    for attempt in range(1, max_attempts + 1):
        try:
            return operation(entry, models, image_override)
        except Exception as exc:
            if attempt >= max_attempts or not retryable_run_failure(exc):
                raise
            delay = min(RETRY_DELAY_SECONDS * attempt, 60)
            print(
                f"[retry-unit] transient failure attempt {attempt}/{max_attempts}: "
                f"{exc}; restarting in {delay}s",
                file=sys.stderr,
                flush=True,
            )
            sleeper(delay)
    raise AssertionError("unit retry loop exhausted")


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

def shard_runs(runs: list[dict], shard_index: int, shard_count: int) -> list[dict]:
    if shard_count <= 1:
        return runs
    if shard_index < 0 or shard_index >= shard_count:
        raise SystemExit(f"invalid shard index {shard_index}; expected 0..{shard_count - 1}")
    return [r for i, r in enumerate(runs) if i % shard_count == shard_index]


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
        default=os.environ.get("BENCH_SCOPE", "all"),
        help="Default run set when --filter is empty. representative is the weekly schedule; all is the full expanded registry.",
    )
    ap.add_argument("--skip-push", action="store_true")
    ap.add_argument("--skip-push-site", action="store_true", help="Do not rsync each completed run to the site host.")
    ap.add_argument("--push-batch-size", type=int, default=int(os.environ.get("BENCH_PUSH_BATCH_SIZE", "1")), help="Commit/push after this many generated result files. Default 1 preserves historical per-run pushes.")
    ap.add_argument("--dry-run", action="store_true", help="Print the selected plan and exit without running benchmarks.")
    ap.add_argument("--keep-models", action="store_true", help="Do not delete model files after the last benchmark referencing them.")
    ap.add_argument("--cleanup-all-models", action="store_true", default=os.environ.get("BENCH_CLEANUP_ALL_MODELS", "false").lower() == "true", help="After the run, remove all registry-managed weekly model artifacts for selected hosts.")
    ap.add_argument("--shard-index", type=int, default=int(os.environ.get("BENCH_SHARD_INDEX", "0")), help="Zero-based shard index for splitting the selected run list across runners.")
    ap.add_argument("--shard-count", type=int, default=int(os.environ.get("BENCH_SHARD_COUNT", "1")), help="Total number of shards for splitting the selected run list across runners.")
    ap.add_argument("--result-host", default=os.environ.get("BENCH_RESULT_HOST", ""), help="Override the public host slug written to result JSONs and filenames without changing execution host config.")
    ap.add_argument("--resume-existing", choices=("none", "date", "any"), default=os.environ.get("BENCH_RESUME_EXISTING", "none"), help="Skip selected runs that already have successful result JSONs. date checks BENCH_RUN_DATE; any checks all dates.")
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
    runs = shard_runs(runs, args.shard_index, args.shard_count)
    if args.result_host:
        runs = [{**r, "result_host": args.result_host} for r in runs]
    if args.resume_existing != "none":
        before = len(runs)
        remaining = []
        skipped = 0
        for r in runs:
            backend = r.get("backend", "cuda")
            host_cfg = dict(HOSTS[r["host"]])
            host_cfg["slug"] = r["host"]
            bcfg = BACKENDS[backend]
            expected_paths = expected_serve_record_paths(r, host_cfg, bcfg)
            if all(has_successful_record(path, args.resume_existing) for path in expected_paths):
                skipped += 1
                continue
            remaining.append(r)
        runs = remaining
        print(f"[resume] skipped {skipped}/{before} run(s) mode={args.resume_existing} date={current_run_date()}")
    if not runs:
        print("nothing to do")
        return 0
    print(f"[plan] {len(runs)} run(s) shard={args.shard_index}/{args.shard_count}:")
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
    pending_paths: list[Path] = []

    def flush_pending(entry: dict) -> None:
        nonlocal pending_paths
        if not pending_paths or args.skip_push:
            return
        git_commit_push(pending_paths, entry)
        pending_paths = []
        if not args.skip_push_site and push_site_script.exists():
            try:
                sh(str(push_site_script))
            except subprocess.CalledProcessError as e:
                print(f"[push-site-fail] batch after {entry['model']}:{entry['quant']}: {e}", file=sys.stderr)

    for r in runs:
        print(f"\n=== {r['model']} :: {r['quant']} on {r['host']} ({r.get('backend','cuda')}) ===")
        try:
            out_abs_list = run_one_with_retries(r, reg["models"], image_override)
            if not args.skip_push:
                if isinstance(out_abs_list, Path):
                    pending_paths.append(out_abs_list)
                else:
                    pending_paths.extend(out_abs_list)
                if len(pending_paths) >= max(args.push_batch_size, 1):
                    flush_pending(r)
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
                host_cfg = dict(HOSTS[r["host"]])
                host_cfg["slug"] = r["host"]
                cleanup_model(host_cfg, r["model"], reg["models"][r["model"]], r["quant"])
            except Exception as e:  # noqa: BLE001
                print(f"[cleanup-fail] {r['model']}:{r['quant']}: {e}", file=sys.stderr)

    if pending_paths:
        flush_pending(runs[-1])

    if args.cleanup_all_models and not args.keep_models:
        cleaned_hosts = set()
        for r in runs:
            host = r["host"]
            if host in cleaned_hosts:
                continue
            cleaned_hosts.add(host)
            try:
                host_cfg = dict(HOSTS[host])
                host_cfg["slug"] = host
                cleanup_weekly_models(host_cfg, reg["models"])
            except Exception as e:  # noqa: BLE001
                print(f"[cleanup-all-fail] {host}: {e}", file=sys.stderr)

    if failures:
        print(f"\n{len(failures)} failure(s):")
        for r, e in failures:
            print(f"  - {r}: {e}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
