#!/usr/bin/env bash
# Minimal entrypoint for self-hosted GitHub Actions runner.
set -euo pipefail

: "${REPO_URL:?REPO_URL is required}"
: "${RUNNER_TOKEN:?RUNNER_TOKEN is required}"
: "${RUNNER_NAME:=$(hostname)}"
: "${RUNNER_LABELS:=}"
: "${RUNNER_WORKDIR:=_work}"
: "${EPHEMERAL:=0}"

cd /home/runner

ARCH="$(uname -m)"
case "$ARCH" in
    aarch64) NORM_ARCH=arm64;;
    x86_64)  NORM_ARCH=x64;;
    *)       NORM_ARCH="$ARCH";;
esac
BASE_LABELS="self-hosted,linux,${NORM_ARCH}"
if [[ -n "$RUNNER_LABELS" ]]; then
    ALL_LABELS="${BASE_LABELS},${RUNNER_LABELS}"
else
    ALL_LABELS="$BASE_LABELS"
fi

EPHEMERAL_FLAG=""
[[ "$EPHEMERAL" == "1" ]] && EPHEMERAL_FLAG="--ephemeral"

cleanup() {
    echo "[entrypoint] deregistering runner ${RUNNER_NAME}..."
    ./config.sh remove --token "${RUNNER_TOKEN}" || true
}
trap cleanup SIGTERM SIGINT EXIT

echo "[entrypoint] configuring: name=${RUNNER_NAME} labels=${ALL_LABELS} ephemeral=${EPHEMERAL}"
./config.sh \
    --unattended \
    --url "${REPO_URL}" \
    --token "${RUNNER_TOKEN}" \
    --name "${RUNNER_NAME}" \
    --labels "${ALL_LABELS}" \
    --work "${RUNNER_WORKDIR}" \
    --replace \
    ${EPHEMERAL_FLAG}

echo "[entrypoint] starting runner..."
./run.sh & wait $!
