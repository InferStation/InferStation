#!/usr/bin/env bash
# Run the bench-batch driver directly on the benchmark host.
# No GitHub Actions / runner involved.
#
# Usage:
#   scripts/run-all.sh                 # all registry entries
#   scripts/run-all.sh vllm            # filter (passed through to --filter)
#   scripts/run-all.sh --skip-push     # don't push commits to origin
set -euo pipefail
cd "$(dirname "$0")/.."

# Pull latest registry / driver changes before running.
git pull --ff-only origin main || true

# HF endpoint defaults to the official hub (hf-mirror.com breaks newer
# huggingface_hub HEAD validation). Set HF_TOKEN in the environment to
# raise rate limits and unlock faster CDN endpoints.
export HF_ENDPOINT="${HF_ENDPOINT:-https://huggingface.co}"

ARGS=()
for a in "$@"; do
  case "$a" in
    --*) ARGS+=("$a") ;;
    *)   ARGS+=("--filter=$a") ;;
  esac
done

# bench-batch.py now pushes to the site host after each completed run.
# We still run a final push at the end as a safety net (covers any run
# whose inline push failed transiently).
python3 -u scripts/bench-batch.py "${ARGS[@]}"
status=$?

if [[ -x scripts/push-to-site.sh ]]; then
  scripts/push-to-site.sh || echo "[run-all] final push-to-site failed (non-fatal)"
fi

exit "$status"
