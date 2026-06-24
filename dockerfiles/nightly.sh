#!/usr/bin/env bash
# Nightly rebuild of all 6 InferStation images from upstream master/main.
# - build profiles: --ref=master|main (LLAMA_TAG / VLLM_TAG override)
# - mirror profiles: override source_image to upstream "moving" tag
# All push as :nightly-YYYYMMDD AND :latest.
# Then prune.sh deletes nightly-* tags older than 7 days.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/nightly-logs"
mkdir -p "$LOG_DIR"
DATE=$(date -u +%Y%m%d)
TAG="nightly-${DATE}"
LOG="${LOG_DIR}/${DATE}.log"
exec > >(tee -a "$LOG") 2>&1

echo "=========================================="
echo "InferStation nightly build $(date -u +%FT%TZ)"
echo "tag: $TAG"
echo "=========================================="

declare -a SUMMARY

run_one() {
  local label="$1"; shift
  local start=$(date +%s)
  if "$@"; then
    local dur=$(( $(date +%s) - start ))
    SUMMARY+=("OK   ${dur}s  ${label}")
  else
    local rc=$?
    local dur=$(( $(date +%s) - start ))
    SUMMARY+=("FAIL rc=${rc} ${dur}s  ${label}")
  fi
}

# --- build profiles: rebuild from upstream master/main ---
run_one llama-cuda-spark   "${SCRIPT_DIR}/build.sh" llama-cuda-spark   --ref=master --tag="$TAG"
run_one llama-rocm-halo    "${SCRIPT_DIR}/build.sh" llama-rocm-halo    --ref=master --tag="$TAG"
# vllm-cuda-spark is now two-stage (same as halo): build the wheel pkg from main
# (ccache makes this incremental), then assemble the runtime from that wheel.
run_one vllm-cuda-spark-whl "${SCRIPT_DIR}/build.sh" vllm-cuda-spark-wheel --ref=main --tag="$TAG"
run_one vllm-cuda-spark     "${SCRIPT_DIR}/build.sh" vllm-cuda-spark \
            --build-arg "WHEEL_IMAGE=10.161.176.38:8443/inferstation/vllm-wheel-spark:$TAG" \
            --tag="$TAG"
# vllm-rocm-halo is now two-stage: build the wheel pkg from main (ccache makes
# this incremental), then assemble the runtime from that exact nightly wheel.
run_one vllm-rocm-halo-whl "${SCRIPT_DIR}/build.sh" vllm-rocm-halo-wheel --ref=main --tag="$TAG"
run_one vllm-rocm-halo     "${SCRIPT_DIR}/build.sh" vllm-rocm-halo \
            --build-arg "WHEEL_IMAGE=10.161.176.38:8443/inferstation/vllm-wheel-halo:$TAG" \
            --tag="$TAG"

# --- 2 mirror profiles: ggml-org publishes `full-vulkan` as the rolling latest.
# It's a multi-arch manifest (linux/amd64 + linux/arm64) so the same upstream
# tag covers both spark (arm64) and halo (amd64). docker pull on each host
# auto-selects the matching arch.
run_one llama-vulkan-spark "${SCRIPT_DIR}/build.sh" llama-vulkan-spark \
  --repo=ghcr.io/ggml-org/llama.cpp:full-vulkan --tag="$TAG"
run_one llama-vulkan-halo  "${SCRIPT_DIR}/build.sh" llama-vulkan-halo \
  --repo=ghcr.io/ggml-org/llama.cpp:full-vulkan --tag="$TAG"

# --- distribute :latest to runner hosts so dispatcher picks up new build ---
# spark hosts run cuda + vulkan-spark + vllm-cuda; halo hosts run vulkan-halo +
# rocm-halo + vllm-rocm. We `docker pull` :latest on each so subsequent
# `docker run` (from hb-llama wrapper, which does NOT pull) uses the new image.
SSH_LOCAL_CMD="ssh -F /home/lkang/.ssh/config -i /home/lkang/.ssh/id_rsa"
REGISTRY="10.161.176.38:8443"

pull_on_host() {
  local host="$1"; shift
  local images=("$@")
  local cmd=""
  for img in "${images[@]}"; do
    cmd+="sudo docker pull ${REGISTRY}/inferstation/${img}:latest && "
  done
  cmd+="echo done"
  $SSH_LOCAL_CMD amd@10.161.176.110 "ssh ${host} $(printf '%q' "$cmd")"
}

run_one pull-spark1 pull_on_host spark1 llama-cuda-spark llama-vulkan-spark vllm-cuda-spark
run_one pull-spark2 pull_on_host spark2 llama-cuda-spark llama-vulkan-spark vllm-cuda-spark
run_one pull-halo5  pull_on_host halo5  llama-vulkan-halo llama-rocm-halo    vllm-rocm-halo
run_one pull-halo6  pull_on_host halo6  llama-vulkan-halo llama-rocm-halo    vllm-rocm-halo

# --- prune old nightly-* tags (keep last 7 per repo) ---
run_one prune              "${SCRIPT_DIR}/prune.sh"

echo
echo "=========================================="
echo "summary  ($(date -u +%FT%TZ))"
echo "=========================================="
for line in "${SUMMARY[@]}"; do echo "  $line"; done

# overall non-zero if any FAIL
if printf '%s\n' "${SUMMARY[@]}" | grep -q '^FAIL'; then
  exit 1
fi
