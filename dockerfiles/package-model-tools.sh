#!/usr/bin/env bash
# Add the isolated InferStation HF + ModelScope toolchain to existing runtime
# images. Run this script natively for the target architecture.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TAG=""
PUSH=1
TAG_LATEST=0
ALSO_TAGS=()
REPOS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag=*) TAG="${1#*=}"; shift ;;
    --tag) TAG="$2"; shift 2 ;;
    --latest) TAG_LATEST=1; shift ;;
    --also-tag=*) ALSO_TAGS+=("${1#*=}"); shift ;;
    --also-tag) ALSO_TAGS+=("$2"); shift 2 ;;
    --no-push) PUSH=0; shift ;;
    --) shift; REPOS+=("$@"); break ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) REPOS+=("$1"); shift ;;
  esac
done

[[ -n "$TAG" ]] || { echo "--tag is required" >&2; exit 2; }
[[ ${#REPOS[@]} -gt 0 ]] || { echo "at least one image repository is required" >&2; exit 2; }

if [[ -n "${DOCKER:-}" ]]; then
  read -r -a DOCKER_CMD <<< "$DOCKER"
elif docker version >/dev/null 2>&1; then
  DOCKER_CMD=(docker)
elif sudo -n docker version >/dev/null 2>&1; then
  DOCKER_CMD=(sudo -n docker)
else
  echo "docker is not available directly or through passwordless sudo" >&2
  exit 1
fi

for repo in "${REPOS[@]}"; do
  image="${repo}:${TAG}"
  echo "=== package model tools: ${image} ==="
  if [[ "$PUSH" == "1" ]]; then
    # The artifact may have been built on another architecture host. Always
    # refresh the just-pushed tag before wrapping it; a same-name local image
    # may belong to an older weekly build.
    "${DOCKER_CMD[@]}" pull "$image"
  elif ! "${DOCKER_CMD[@]}" image inspect "$image" >/dev/null 2>&1; then
    echo "local image is required with --no-push: $image" >&2
    exit 1
  fi

  base_user=$("${DOCKER_CMD[@]}" image inspect "$image" --format '{{.Config.User}}')
  case "$base_user" in
    ""|root|0|0:0) ;;
    *) echo "refusing to change non-root runtime user '$base_user' in $image" >&2; exit 1 ;;
  esac

  DOCKER_BUILDKIT=1 "${DOCKER_CMD[@]}" build \
    --build-arg "BASE_IMAGE=${image}" \
    --tag "$image" \
    --file "$SCRIPT_DIR/model-tools/Dockerfile" \
    "$SCRIPT_DIR/model-tools"

  [[ "$("${DOCKER_CMD[@]}" image inspect "$image" --format '{{ index .Config.Labels "org.inferstation.model-tools" }}')" == "true" ]]
  "${DOCKER_CMD[@]}" run --rm --entrypoint /bin/sh "$image" -c '
    set -eu
    /opt/inferstation/model-tools/bin/python -c "import huggingface_hub, modelscope"
    hf download --help >/dev/null
    huggingface-cli download --help >/dev/null
    modelscope download --help >/dev/null
  '

  if [[ "$PUSH" == "1" ]]; then
    "${DOCKER_CMD[@]}" push "$image"
  fi
  if [[ "$TAG_LATEST" == "1" ]]; then
    latest="${repo}:latest"
    "${DOCKER_CMD[@]}" tag "$image" "$latest"
    if [[ "$PUSH" == "1" ]]; then
      "${DOCKER_CMD[@]}" push "$latest"
    fi
  fi
  for alias in "${ALSO_TAGS[@]}"; do
    alias_image="${repo}:${alias}"
    "${DOCKER_CMD[@]}" tag "$image" "$alias_image"
    if [[ "$PUSH" == "1" ]]; then
      "${DOCKER_CMD[@]}" push "$alias_image"
    fi
  done
done
