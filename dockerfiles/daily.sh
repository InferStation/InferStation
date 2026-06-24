#!/usr/bin/env bash
# Unified daily build — Beijing 22:00 (= 14:00 UTC).
#
# Replaces the previous split of nightly (master, daily) + release-watch (every
# 6h). ONE daily run now covers both with clear separation of roles:
#
#   For llama.cpp profiles (cuda/rocm):
#     - nightly-only off upstream master as nightly-<date> (+ :latest), with
#       commit-level dedup/retag when unchanged.
#
#   For vLLM profiles (cuda/rocm):
#     - nightly ALWAYS tracks upstream main as nightly-<date> (+ :latest), with
#       commit-level dedup/retag when unchanged.
#     - release tags (<release>-<arch>) are built in MANUAL mode only (or via
#       dedicated release workflows), and never replace nightly.
#
#   Vulkan mirror profiles have no upstream "release"; they always mirror the
#   rolling ggml-org `full-vulkan` tag as nightly-<date> (+ :latest).
#
# <release>-<arch> tags are permanent (prune.sh only touches nightly-* tags), so
# every release stays pullable forever; nightly-* keeps a 7-day rolling window.
#
# Usage:  ./daily.sh spark | halo
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACK="${1:?usage: daily.sh spark|halo|nv4090|r9700}"

# Trigger mode: nightly (scheduled cron) vs manual (workflow_dispatch).
# CI passes TRIGGER=${{ github.event_name }} (schedule | workflow_dispatch).
# A literal `--manual` 2nd arg also forces manual (handy for local runs).
TRIGGER="${TRIGGER:-schedule}"
[[ "${2:-}" == "--manual" ]] && TRIGGER="workflow_dispatch"
MANUAL=0
[[ "$TRIGGER" == "workflow_dispatch" ]] && MANUAL=1

DATE=$(date -u +%Y%m%d)
NIGHTLY="nightly-${DATE}"

HARBOR="${HARBOR:-http://10.161.176.38:8443}"
HARBOR_USER="admin"
# NOTE: the inferstation project allows anonymous PULL/read, but tag writes
# (POST/DELETE artifacts/*/tags) require a real admin credential. Provided via
# the HARBOR_PASS env (no default; Harbor path is unused in ghcr mode).
HARBOR_PASS="${HARBOR_PASS:-}"
PROJECT="inferstation"
LLAMA_REPO="https://github.com/ggml-org/llama.cpp"
VLLM_REPO="https://github.com/vllm-project/vllm"

# --- resolve latest upstream release over git protocol (avoids GitHub REST rate
#     limits on the shared corp egress IP) -------------------------------------
# NOTE: release discovery is used for MANUAL vLLM release builds only; nightly
# vLLM is intentionally main-first to avoid feature lag when releases trail main.
latest_vllm_release() {
  git ls-remote --tags --refs "$VLLM_REPO" 'refs/tags/v[0-9]*' 2>/dev/null \
    | sed 's#.*/##' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1
}

# --- Harbor: does <repo>:<tag> already exist? ---------------------------------
harbor_has_tag() {
  # ghcr has no Harbor API; in ghcr mode skip the dedup probe so every run does a
  # full build/mirror (correct, just without the "unchanged commit" fast-path).
  [[ "${INFERSTATION_GHCR_MODE:-0}" == "1" ]] && return 1
  local repo="$1" tag="$2" code
  code=$(curl -s -o /dev/null -w '%{http_code}' -u "${HARBOR_USER}:${HARBOR_PASS}" \
    "${HARBOR}/api/v2.0/projects/${PROJECT}/repositories/${repo}/artifacts/${tag}/tags")
  [[ "$code" == "200" ]]
}

# --- Harbor: point <newtag> at the SAME artifact as <ref> (a tag or digest),
#     creating it or MOVING it if it already exists elsewhere. This is the cheap
#     "just add a tag" path used when a commit was already built — no recompile,
#     no image transfer, just a manifest tag. -----------------------------------
harbor_set_tag() {
  local repo="$1" ref="$2" newtag="$3" base code
  base="${HARBOR}/api/v2.0/projects/${PROJECT}/repositories/${repo}/artifacts"
  # Remove newtag wherever it currently points (ignore 404), so the re-add can
  # never 409. No-op when newtag does not yet exist.
  curl -s -o /dev/null -u "${HARBOR_USER}:${HARBOR_PASS}" -X DELETE \
    "${base}/${newtag}/tags/${newtag}" >/dev/null 2>&1 || true
  code=$(curl -s -o /dev/null -w '%{http_code}' -u "${HARBOR_USER}:${HARBOR_PASS}" \
    -X POST -H 'Content-Type: application/json' \
    "${base}/${ref}/tags" -d "{\"name\":\"${newtag}\"}")
  if [[ "$code" == "200" || "$code" == "201" ]]; then
    echo "    Harbor: ${repo}:${newtag} -> (${ref}) OK"
    return 0
  fi
  echo "    Harbor: ${repo}:${newtag} -> (${ref}) FAILED (HTTP ${code})" >&2
  return 1
}

# --- source-change dedup ------------------------------------------------------
# Avoid recompiling when the upstream source hasn't moved since the last
# successful build. We remember the last-built source id per profile in a small
# state file on this runner host, and skip the build when it's unchanged.
# Set FORCE_BUILD=1 to bypass and rebuild unconditionally.
STATE_DIR="${INFERSTATION_BUILD_STATE:-$HOME/.inferstation-build-state}"
mkdir -p "$STATE_DIR"

# upstream git HEAD sha for a profile's master/main branch (via meta.json upstream)
upstream_head_sha() {
  local profile="$1" branch="$2" upstream
  upstream=$(jq -r '.upstream' "${SCRIPT_DIR}/${profile}/meta.json" 2>/dev/null)
  [[ -z "$upstream" || "$upstream" == "null" ]] && return 1
  git ls-remote "$upstream" "refs/heads/${branch}" 2>/dev/null | awk 'NR==1{print $1}'
}

# digest of an upstream docker image ref (for mirror profiles)
upstream_image_digest() {
  local ref="$1"
  docker manifest inspect "$ref" 2>/dev/null \
    | sha256sum | awk '{print $1}'
}

# returns 0 (skip build) if state file already records this exact source id
source_unchanged() {
  local profile="$1" id="$2"
  [[ "${FORCE_BUILD:-0}" == "1" ]] && return 1
  [[ -z "$id" ]] && return 1   # could not resolve id -> never skip, be safe
  [[ -f "${STATE_DIR}/${profile}" && "$(cat "${STATE_DIR}/${profile}")" == "$id" ]]
}

# record a source id as successfully built
mark_built() {
  local profile="$1" id="$2"
  [[ -n "$id" ]] && printf '%s\n' "$id" > "${STATE_DIR}/${profile}"
}

# Per-job results are collected via files in RESULT_DIR so that jobs can run
# concurrently in background subshells (a parent-scope array would not see the
# writes).  Each job streams its own output to <label>.log (label-prefixed live)
# and records a one-line verdict in <label>.result.
RESULT_DIR=$(mktemp -d)
trap 'rm -rf "$RESULT_DIR"' EXIT

run_one() {
  local label="$1"; shift
  local start; start=$(date +%s)
  if "$@" 2>&1 | sed "s/^/[${label}] /"; then
    echo "OK   $(( $(date +%s) - start ))s  ${label}" > "${RESULT_DIR}/${label}.result"
  else
    local rc=${PIPESTATUS[0]}
    echo "FAIL rc=${rc} $(( $(date +%s) - start ))s  ${label}" > "${RESULT_DIR}/${label}.result"
  fi
}

# vllm_build: the ONLY correct way to build a vLLM profile — (re)compile its
# WHEEL from <ref> first, then assemble the runtime FROM that exact wheel.
#
# The assembler image (`vllm-rocm-halo` / `vllm-cuda-spark`) is a thin packager
# that does `FROM ${WHEEL_IMAGE}`; on its own it just re-wraps whatever wheel it
# is pinned to, so building the assembler alone NEVER changes vllm.__version__.
# That was the freeze bug: nightly/release *tags* advanced (v0.22.0 -> v0.23.0,
# nightly-<date> daily) while every image still carried the v0.22.0 wheel,
# because the wheel — the only place vLLM source is actually compiled — was
# never rebuilt and WHEEL_IMAGE stayed pinned at v0.22.0. vllm_build fixes that
# by compiling the wheel from <ref> and pointing the assembler at it.
#
#   vllm_build <profile> <arch> <ref> <final_tag> [extra build.sh args...]
#
# <ref> is a release tag (vX.Y.Z) or "main". For "main" the wheel is rebuilt
# every run (main moves daily; the wheel Dockerfile's persistent ccache mount
# keeps it to an incremental ~5-10 min). For an immutable release tag the wheel
# is reused if already in Harbor. Extra args (--also-tag / --no-latest) are
# forwarded to the assembler build.sh.
vllm_build() {
  local profile="$1" arch="$2" ref="$3" final_tag="$4"; shift 4
  local wheel_profile="${profile}-wheel"
  local wheel_meta="${SCRIPT_DIR}/${wheel_profile}/meta.json"
  [[ -f "$wheel_meta" ]] || { echo ">>> ${profile}: missing wheel profile ${wheel_profile}"; return 1; }
  local wheel_registry; wheel_registry=$(jq -r '.registry' "$wheel_meta")
  # keep the wheel ref in the same registry namespace as everything else (ghcr)
  if [[ -n "${INFERSTATION_REGISTRY:-}" ]]; then wheel_registry="${INFERSTATION_REGISTRY%/}/$(basename "$wheel_registry")"; fi
  # wheel tag is arch- and ref-scoped: main -> rolling main-<arch> (overwritten
  # nightly as main advances); a release -> immutable <rel>-<arch>.
  local wheel_tag
  case "$ref" in
    main|master) wheel_tag="main-${arch}" ;;
    *)           wheel_tag="${ref}-${arch}" ;;
  esac
  # Cache-bust token for the wheel Dockerfile's `git clone` layer. For a moving
  # branch the clone RUN text is identical every night, so BuildKit caches the
  # FIRST clone forever and the wheel freezes at that commit while commit-<sha>
  # tags keep advancing. Resolve the real upstream HEAD sha and pass it as
  # CACHEBUST so the clone re-runs whenever the branch moves. An immutable
  # release tag needs no bust (its content can't change); use the tag itself.
  local cachebust="$ref"
  case "$ref" in
    main|master|gfx11) cachebust=$(upstream_head_sha "$profile" "$ref" || true); [[ -n "$cachebust" ]] || cachebust=$(date -u +%Y%m%d) ;;
  esac
  # Reuse only an immutable release wheel; a moving branch is always recompiled.
  if [[ "$ref" != "main" && "$ref" != "master" && "$ref" != "gfx11" ]] && harbor_has_tag "$wheel_profile" "$wheel_tag"; then
    echo ">>> ${wheel_profile}: wheel ${wheel_tag} already in Harbor — reuse (no recompile)"
  else
    echo ">>> ${wheel_profile}: compile wheel from ${ref} (${cachebust}) -> ${wheel_tag}"
    if ! "${SCRIPT_DIR}/build.sh" "$wheel_profile" --ref="$ref" --tag="$wheel_tag" --no-latest --build-arg "CACHEBUST=${cachebust}"; then
      echo ">>> ${wheel_profile}: WHEEL BUILD FAILED -> abort assemble (will retry next run)"
      return 1
    fi
  fi
  # Assemble the runtime FROM the wheel we just built/reused. The trailing
  # --build-arg overrides the assembler meta's pinned WHEEL_IMAGE; build.sh emits
  # extra --build-args last, so this wins over the meta default.
  echo ">>> ${profile}: assemble ${final_tag} from ${wheel_profile}:${wheel_tag}"
  "${SCRIPT_DIR}/build.sh" "$profile" --ref="$ref" --tag="$final_tag" \
    --build-arg "WHEEL_IMAGE=${wheel_registry}:${wheel_tag}" "$@"
}

# build-profile:
# - llama.cpp: nightly-only (release tags are CI-noise bNNNN).
# - vLLM: nightly is always main-first; release tags are manual-only.
build_pkg() {
  local profile="$1" kind="$2" arch="$3"   # kind = llama | vllm
  if [[ "$kind" == "llama" ]]; then
    local sha; sha=$(upstream_head_sha "$profile" master || true)
    local short="${sha:0:12}"
    local commit_tag="commit-${short}"   # permanent per-commit identity tag

    # MANUAL (workflow_dispatch): produce a commit-tagged build ONLY; never touch
    # nightly-*/latest, so hand-triggered test builds stay isolated from the
    # nightly line and are clearly distinguishable from it.
    if [[ "$MANUAL" == "1" ]]; then
      if [[ -n "$sha" ]] && harbor_has_tag "$profile" "$commit_tag"; then
        echo ">>> ${profile}: MANUAL — commit ${short} already built (${commit_tag}); nothing to do"
        return
      fi
      echo ">>> ${profile}: MANUAL — build master (${short}) as ${commit_tag} (no nightly/latest)"
      "${SCRIPT_DIR}/build.sh" "$profile" --ref="master" --tag="$commit_tag" --no-latest
      return
    fi

    # NIGHTLY: if this exact commit was already built (commit-<sha> exists — from
    # a prior manual build or an earlier night), DON'T recompile; just add today's
    # nightly-<date> (+ move :latest) onto that artifact.
    if [[ -n "$sha" ]] && harbor_has_tag "$profile" "$commit_tag"; then
      echo ">>> ${profile}: commit ${short} already built (${commit_tag}) -> retag ${NIGHTLY}+latest (no recompile)"
      harbor_set_tag "$profile" "$commit_tag" "$NIGHTLY" || { echo ">>> ${profile}: retag ${NIGHTLY} FAILED"; return 1; }
      harbor_set_tag "$profile" "$commit_tag" "latest"  || echo ">>> ${profile}: WARN: could not move :latest"
      mark_built "$profile" "$sha"
      return
    fi

    echo ">>> ${profile}: nightly build master (${short}) as ${NIGHTLY} (+${commit_tag},latest)"
    # NOTE: do not rely on `set -e` here — build_pkg is invoked via `if "$@"`
    # in run_one, which disables errexit for the whole call chain. Check the
    # build's exit status explicitly so we only record the sha on success.
    if "${SCRIPT_DIR}/build.sh" "$profile" --ref="master" --tag="$NIGHTLY" --also-tag="$commit_tag"; then
      mark_built "$profile" "$sha"
    else
      local rc=$?
      echo ">>> ${profile}: build FAILED (rc=$rc) -> NOT recording sha (will retry next run)"
      return $rc
    fi
    return
  fi

  # vLLM path: MANUAL may build a missing release tag; NIGHTLY is always main.
  local rel; rel=$(latest_vllm_release || true)

  # MANUAL: prefer a not-yet-built release tag; otherwise a commit-tagged main
  # build. Never touch nightly-*/latest.
  if [[ "$MANUAL" == "1" ]]; then
    if [[ -n "$rel" ]] && ! harbor_has_tag "$profile" "${rel}-${arch}"; then
      echo ">>> ${profile}: MANUAL — wheel+assemble release ${rel} as ${rel}-${arch} (no nightly/latest)"
      vllm_build "$profile" "$arch" "$rel" "${rel}-${arch}" --no-latest
      return
    fi
    local sha; sha=$(upstream_head_sha "$profile" main || true)
    local commit_tag="commit-${sha:0:12}"
    if [[ -n "$sha" ]] && harbor_has_tag "$profile" "$commit_tag"; then
      echo ">>> ${profile}: MANUAL — commit ${sha:0:12} already built (${commit_tag}); nothing to do"
      return
    fi
    echo ">>> ${profile}: MANUAL — wheel+assemble main (${sha:0:12}) as ${commit_tag} (no nightly/latest)"
    vllm_build "$profile" "$arch" main "$commit_tag" --no-latest
    return
  fi

  local sha; sha=$(upstream_head_sha "$profile" main || true)
  local commit_tag="commit-${sha:0:12}"
  if [[ -n "$sha" ]] && harbor_has_tag "$profile" "$commit_tag"; then
    echo ">>> ${profile}: main commit ${sha:0:12} already built (${commit_tag}) -> retag ${NIGHTLY}+latest (no recompile)"
    harbor_set_tag "$profile" "$commit_tag" "$NIGHTLY" || { echo ">>> ${profile}: retag ${NIGHTLY} FAILED"; return 1; }
    harbor_set_tag "$profile" "$commit_tag" "latest"  || echo ">>> ${profile}: WARN: could not move :latest"
  else
    echo ">>> ${profile}: nightly main (${sha:0:12}) -> wheel+assemble as ${NIGHTLY} (+${commit_tag})"
    vllm_build "$profile" "$arch" main "$NIGHTLY" --also-tag="$commit_tag"
  fi
}

# mirror-profile (llama.cpp vulkan): llama.cpp is nightly-only (see build_pkg),
# so just mirror ggml-org's rolling full-vulkan image as nightly-<date> (+ :latest).
# No full-vulkan-bNNNN release tags — that would be the same bNNNN CI noise.
mirror_pkg() {
  local profile="$1"
  # Optional 2nd arg overrides the mirror source (e.g. vllm/vllm-openai for the
  # 4090 vllm line); defaults to the ggml-org rolling Vulkan image.
  local src="${2:-ghcr.io/ggml-org/llama.cpp:full-vulkan}"
  local dig; dig=$(upstream_image_digest "$src" || true)
  local short="${dig:0:12}"
  local commit_tag="commit-${short}"   # upstream-image identity (digest-pinned)

  # MANUAL: mirror to a commit-tagged image only; never touch nightly-*/latest.
  if [[ "$MANUAL" == "1" ]]; then
    if [[ -n "$dig" ]] && harbor_has_tag "$profile" "$commit_tag"; then
      echo ">>> ${profile}: MANUAL — full-vulkan ${short} already mirrored (${commit_tag}); nothing to do"
      return
    fi
    echo ">>> ${profile}: MANUAL — mirror full-vulkan (${short}) as ${commit_tag} (no nightly/latest)"
    "${SCRIPT_DIR}/build.sh" "$profile" --repo="$src" --tag="$commit_tag" --no-latest
    return
  fi

  # NIGHTLY: if this upstream digest was already mirrored, just retag — no re-pull.
  if [[ -n "$dig" ]] && harbor_has_tag "$profile" "$commit_tag"; then
    echo ">>> ${profile}: full-vulkan ${short} already mirrored (${commit_tag}) -> retag ${NIGHTLY}+latest (no re-pull)"
    harbor_set_tag "$profile" "$commit_tag" "$NIGHTLY" || { echo ">>> ${profile}: retag ${NIGHTLY} FAILED"; return 1; }
    harbor_set_tag "$profile" "$commit_tag" "latest"  || echo ">>> ${profile}: WARN: could not move :latest"
    mark_built "$profile" "$dig"
    return
  fi
  echo ">>> ${profile}: mirror rolling full-vulkan (${short}) as ${NIGHTLY} (+${commit_tag},latest)"
  # Explicit success check (see build_pkg note about `set -e` + `if "$@"`).
  if "${SCRIPT_DIR}/build.sh" "$profile" --repo="$src" --tag="$NIGHTLY" --also-tag="$commit_tag"; then
    mark_built "$profile" "$dig"
  else
    local rc=$?
    echo ">>> ${profile}: mirror FAILED (rc=$rc) -> NOT recording digest (will retry next run)"
    return $rc
  fi
}

# build_pkg_gfx11: SECOND halo vLLM line that tracks AMD's ROCm/vllm `gfx11`
# branch (gfx1151-tuned kernels) instead of upstream main. Same wheel-first
# vllm_build flow, but ref="gfx11" (a branch on ROCm/vllm, set via the profile's
# meta build_args VLLM_REPO/VLLM_TAG) and cache-bust resolved from that branch's
# HEAD. Independent profile/registry (vllm-rocm-halo, the default halo line), so
# it never touches the upstream-main vllm-rocm-halo-main line. nightly-<date> + commit-<sha> + latest.
build_pkg_gfx11() {
  local profile="vllm-rocm-halo" arch="gfx1151"
  local sha; sha=$(upstream_head_sha "$profile" gfx11 || true)
  local commit_tag="commit-${sha:0:12}"

  if [[ "$MANUAL" == "1" ]]; then
    if [[ -n "$sha" ]] && harbor_has_tag "$profile" "$commit_tag"; then
      echo ">>> ${profile}: MANUAL — gfx11 commit ${sha:0:12} already built (${commit_tag}); nothing to do"
      return
    fi
    echo ">>> ${profile}: MANUAL — wheel+assemble gfx11 (${sha:0:12}) as ${commit_tag} (no nightly/latest)"
    vllm_build "$profile" "$arch" gfx11 "$commit_tag" --no-latest
    return
  fi

  if [[ -n "$sha" ]] && harbor_has_tag "$profile" "$commit_tag"; then
    echo ">>> ${profile}: gfx11 commit ${sha:0:12} already built (${commit_tag}) -> retag ${NIGHTLY}+latest (no recompile)"
    harbor_set_tag "$profile" "$commit_tag" "$NIGHTLY" || { echo ">>> ${profile}: retag ${NIGHTLY} FAILED"; return 1; }
    harbor_set_tag "$profile" "$commit_tag" "latest"  || echo ">>> ${profile}: WARN: could not move :latest"
  else
    echo ">>> ${profile}: nightly gfx11 (${sha:0:12}) -> wheel+assemble as ${NIGHTLY} (+${commit_tag})"
    vllm_build "$profile" "$arch" gfx11 "$NIGHTLY" --also-tag="$commit_tag"
  fi
}

# build_r9700_vllm: r9700 vLLM is compiled FROM SOURCE (no wheel profile) on the
# TheRock gfx1201 base, pinned to the meta's tag (currently v0.22.0-gfx1201).
# Heavy (~45GB image, compiles vLLM). Produces nightly-<date> + <reltag> + latest.
build_r9700_vllm() {
  local profile="vllm-rocm-r9700-main"
  local reltag; reltag=$(jq -r '.tag' "${SCRIPT_DIR}/${profile}/meta.json")
  if [[ "$MANUAL" == "1" ]]; then
    if harbor_has_tag "$profile" "$reltag"; then
      echo ">>> ${profile}: MANUAL — ${reltag} already built; nothing to do"; return
    fi
    echo ">>> ${profile}: MANUAL — build ${reltag} (no nightly/latest)"
    "${SCRIPT_DIR}/build.sh" "$profile" --tag="$reltag" --no-latest
    return
  fi
  if harbor_has_tag "$profile" "$reltag"; then
    echo ">>> ${profile}: ${reltag} already built -> retag ${NIGHTLY}+latest (no recompile)"
    harbor_set_tag "$profile" "$reltag" "$NIGHTLY" || { echo ">>> ${profile}: retag FAILED"; return 1; }
    harbor_set_tag "$profile" "$reltag" "latest"  || echo ">>> ${profile}: WARN: could not move :latest"
    return
  fi
  echo ">>> ${profile}: nightly build (from source, pinned ${reltag}) as ${NIGHTLY} (+${reltag},latest)"
  if ! "${SCRIPT_DIR}/build.sh" "$profile" --tag="$NIGHTLY" --also-tag="$reltag"; then
    local rc=$?; echo ">>> ${profile}: build FAILED (rc=$rc)"; return $rc
  fi
}

echo "=========================================="
echo "InferStation daily build  track=${TRACK}  $(date -u +%FT%TZ)"
echo "trigger: ${TRIGGER}  (manual=${MANUAL})"
if [[ "$MANUAL" == "1" ]]; then
  echo "mode: MANUAL — build commit-<sha> tags only, no nightly-*/latest"
else
  echo "nightly tag: ${NIGHTLY}  (reuse commit-<sha> if already built)"
fi
echo "=========================================="

# The three profiles of a track build on DIFFERENT hosts (heavy vllm compile on
# the primary box; llama compile + the light vulkan mirror on the secondary
# box), so they are launched concurrently and joined with `wait`.
case "$TRACK" in
  spark)
    # NVIDIA images now MIRROR upstream official (verified to run on GB10/sm121),
    # so cicd (x86) produces the arm64 image via `docker pull --platform`.
    run_one llama-cuda-spark   mirror_pkg llama-cuda-spark ghcr.io/ggml-org/llama.cpp:server-cuda &
    run_one vllm-cuda-spark    mirror_pkg vllm-cuda-spark  vllm/vllm-openai:latest &
    run_one llama-vulkan-spark mirror_pkg llama-vulkan-spark &
    wait
    ;;
  halo)
    run_one llama-rocm-halo       build_pkg       llama-rocm-halo    llama gfx1151 &
    run_one vllm-rocm-halo-main   build_pkg       vllm-rocm-halo-main vllm gfx1151 &
    run_one vllm-rocm-halo        build_pkg_gfx11 &
    run_one llama-vulkan-halo     mirror_pkg      llama-vulkan-halo &
    wait
    ;;
  nv4090)
    # NVIDIA images MIRROR upstream official (sm89 is well-supported).
    run_one llama-cuda-4090       mirror_pkg      llama-cuda-4090 ghcr.io/ggml-org/llama.cpp:server-cuda &
    run_one llama-vulkan-4090     mirror_pkg      llama-vulkan-4090 &
    run_one vllm-cuda-4090        mirror_pkg      vllm-cuda-4090 vllm/vllm-openai:nightly &
    wait
    ;;
  r9700)
    run_one llama-rocm-r9700      build_pkg          llama-rocm-r9700   llama gfx1201 &
    run_one vllm-rocm-r9700-main  build_r9700_vllm &
    run_one llama-vulkan-r9700    mirror_pkg         llama-vulkan-r9700 &
    wait
    ;;
  *)
    echo "unknown track: $TRACK (expected spark|halo|nv4090|r9700)" >&2; exit 1 ;;
esac

echo
echo "=========================================="
echo "summary  track=${TRACK}  ($(date -u +%FT%TZ))"
echo "=========================================="
cat "${RESULT_DIR}"/*.result | sort

if grep -qh '^FAIL' "${RESULT_DIR}"/*.result; then
  exit 1
fi
