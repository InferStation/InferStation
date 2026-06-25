#!/usr/bin/env bash
# Universal build dispatcher for InferStation image profiles.
#
# Usage:
#   ./build.sh <profile>                       # build/mirror with meta.json defaults
#   ./build.sh <profile> --ref=<commit-or-tag> # override upstream ref
#   ./build.sh <profile> --repo=<url>          # override upstream repo URL
#   ./build.sh <profile> --tag=<final-tag>     # override registry tag
#   ./build.sh <profile> --build-arg KEY=VAL   # extra docker --build-arg (repeatable)
#   ./build.sh <profile> --no-push             # build only, do not push
#   ./build.sh list
#   ./build.sh all
#
# Examples:
#   # rebuild llama-cuda-spark from the latest master commit, dev tag
#   ./build.sh llama-cuda-spark --ref=master --tag=master-$(date +%Y%m%d)
#
#   # build vllm from a fork
#   ./build.sh vllm-cuda-spark \
#     --repo=https://github.com/myfork/vllm.git \
#     --ref=feature-x --tag=feature-x

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Legacy/unused: the real push target comes from each meta.json `.registry`
# (rewritten to ghcr via INFERSTATION_REGISTRY in CI). Harbor retired 2026-06-24.
REGISTRY="ghcr.io/inferstation"

SSH_LOCAL="ssh -F /home/lkang/.ssh/config -i /home/lkang/.ssh/id_rsa"

list_profiles() {
  find "$SCRIPT_DIR" -mindepth 2 -maxdepth 2 -name meta.json | sort | \
    xargs -I{} jq -r '"\(.kind)\t\(.name)\t-> \(.registry):\(.tag)"' {}
}

die() { echo "ERROR: $*" >&2; exit 1; }

run_on() {
  local host="$1"; shift
  local cmd="$*"
  case "$host" in
    halo[0-9]*|spark[0-9]*)
      # remote spark/halo hosts run docker as root → prefix sudo for any docker
      # call.  nested ssh through amd@10.161.176.110.  We must pass `cmd` through
      # TWO shell expansions, so quote it once with printf %q before the
      # outer ssh so that && / pipes / spaces survive the relay.
      local sudoed
      sudoed=$(echo "$cmd" | sed -E 's/(^|[^[:alnum:]_-])docker /\1sudo docker /g')
      $SSH_LOCAL amd@10.161.176.110 "ssh $host $(printf '%q' "$sudoed")"
      ;;
    9700|9700x8|4090)
      # 9700 / 9700x8 / 4090 run docker as root via passwordless sudo, reached
      # DIRECTLY through lkang's ssh config (NOT the amd@.110 relay). They are
      # single-host families (family_of_host returns "" -> unpooled), so the
      # pinned meta build_host is used as-is.
      local sudoed
      sudoed=$(echo "$cmd" | sed -E 's/(^|[^[:alnum:]_-])docker /\1sudo docker /g')
      $SSH_LOCAL "$host" "$sudoed"
      ;;
    local|"")
      bash -c "$cmd"
      ;;
    *)
      die "unknown host: $host"
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Multi-host scheduling: pick a LIVE + IDLE host within an arch family.
#
# Builds are arch-bound — spark profiles need NVIDIA DGX Spark (arm64+CUDA),
# halo profiles need AMD Strix Halo (amd64+ROCm) — so we never pick across
# families. Within a family any host is interchangeable, so instead of pinning
# one build_host we pick the first reachable+idle host, mutually exclude
# concurrent builds with an atomic lock dir, and QUEUE (poll) when all are busy.
#
# meta.json's build_host/mirror_host is used only as the PREFERRED host (tried
# first); the family is inferred from its name. Set INFERSTATION_AUTO_HOST=0 to
# disable scheduling and force the pinned host (old behaviour).
#
# The candidate pool per family is a MAINTAINED LIST in hosts.conf (not derived
# from current liveness). load_host_pool() parses it; if the file is absent we
# fall back to a built-in default so the script still works standalone.
# ---------------------------------------------------------------------------
declare -A HOST_POOL=()
HOSTS_CONF="${INFERSTATION_HOSTS_CONF:-$SCRIPT_DIR/hosts.conf}"

load_host_pool() {
  HOST_POOL=()
  if [[ -f "$HOSTS_CONF" ]]; then
    local fam host enabled rest
    while read -r fam host enabled rest; do
      [[ -z "$fam" || "$fam" == \#* ]] && continue        # skip blanks/comments
      [[ "$enabled" == "1" ]] || continue                 # only enabled hosts
      HOST_POOL[$fam]+="${HOST_POOL[$fam]:+ }$host"
    done < "$HOSTS_CONF"
  fi
  # fallback default if conf missing/empty
  [[ -n "${HOST_POOL[spark]:-}" ]] || HOST_POOL[spark]="spark1 spark2"
  [[ -n "${HOST_POOL[halo]:-}"  ]] || HOST_POOL[halo]="halo6 halo5"
}
load_host_pool
BUILD_LOCK_DIR="/tmp/inferstation-build.lock"
AUTO_HOST="${INFERSTATION_AUTO_HOST:-1}"
PICK_TIMEOUT="${INFERSTATION_PICK_TIMEOUT:-21600}"  # max seconds to queue (6h: a busy pool may serialize a ~2h vllm build behind others)
PICK_INTERVAL="${INFERSTATION_PICK_INTERVAL:-30}"   # poll cadence
_ACTIVE_LOCK_HOST=""                                # for EXIT-trap cleanup
PICKED_HOST=""                                       # pick_idle_host result
RESOLVED_HOST=""                                     # resolve_host result

family_of_host() {
  case "$1" in
    spark[0-9]*) echo spark ;;
    halo[0-9]*)  echo halo ;;
    *)           echo "" ;;
  esac
}

# reachable + ssh ok + NOT running a bench + NO build lock held
host_idle() {
  local host="$1"
  run_on "$host" 'true' >/dev/null 2>&1 || return 1     # unreachable / ssh fail
  local probe
  # A "bench" is either the old offline runner (llama-batched-bench / vllm bench)
  # OR a serve-mode run: a containerized llama-server / `vllm serve`, plus the
  # host-side stream client (inferstation-serve-*). Counting only the offline
  # names would let a build land on a host mid-serve-bench and corrupt its
  # numbers, so match serve processes too.
  probe=$(run_on "$host" \
    "if [ -d $BUILD_LOCK_DIR ]; then echo BUSY; fi; ps -ef | grep -E 'llama-batched-bench|vllm bench|llama-server|vllm serve|inferstation-serve' | grep -v grep | wc -l" \
    2>/dev/null) || return 1
  # idle iff: no BUSY line AND bench-count == 0
  [[ "$probe" != *BUSY* ]] && [[ "$(echo "$probe" | tail -1 | tr -d '[:space:]')" == "0" ]]
}

# build has ABSOLUTE priority over benchmarks: a host is blocked ONLY by another
# build's lock. A running bench (offline or serve-mode) is NOT a blocker — the
# build PREEMPTS it (kills bench / serve container / model download) and takes
# the host. This is policy: builds never yield to a manual or daily bench.
host_build_locked() {
  local host="$1"
  [[ "$(run_on "$host" "[ -d $BUILD_LOCK_DIR ] && echo LOCKED" 2>/dev/null)" == *LOCKED* ]]
}

# kill any benchmark occupying the host so the build can proceed immediately.
# Covers offline runners, serve-mode (llama-server / vllm serve + stream client)
# and the model-download phase. Best-effort; never fails the build.
preempt_bench() {
  local host="$1"
  echo "  [preempt] killing any bench/serve/download on $host (build has priority)" >&2
  run_on "$host" "sudo pkill -9 -f 'llama-batched-bench|vllm bench|stream_bench_client|inferstation-serve' 2>/dev/null; pkill -9 -f 'hf download' 2>/dev/null; sudo docker rm -f \$(sudo docker ps -aq --filter name=inferstation-serve) 2>/dev/null; true" >/dev/null 2>&1 || true
}

# atomically claim a host (mkdir is atomic across the ssh relay)
acquire_host() {
  local host="$1"
  [[ "$(run_on "$host" "mkdir $BUILD_LOCK_DIR 2>/dev/null && echo OK" 2>/dev/null)" == *OK* ]]
}
release_host() {
  local host="$1"
  [[ -n "$host" ]] || return 0
  run_on "$host" "rmdir $BUILD_LOCK_DIR 2>/dev/null" >/dev/null 2>&1 || true
}

# pick a host in <family>, preferring <preferred>. Builds have ABSOLUTE priority:
# a host running only a bench is PREEMPTED (bench killed), never waited on. We
# queue ONLY when every reachable host is held by ANOTHER BUILD (builds mutually
# exclude via the lock dir).
# On success: sets PICKED_HOST + _ACTIVE_LOCK_HOST and HOLDS its lock. Must NOT
# be called in a $(subshell) or the lock-tracking global won't reach the EXIT
# trap in the parent shell.
pick_idle_host() {
  local family="$1" preferred="${2:-}"
  PICKED_HOST=""
  local pool="${HOST_POOL[$family]:-}"
  [[ -n "$pool" ]] || return 1
  # try the preferred host first
  if [[ -n "$preferred" ]]; then
    pool="$preferred $(printf '%s\n' $pool | grep -vx "$preferred" | tr '\n' ' ')"
  fi
  local waited=0
  while :; do
    local h
    for h in $pool; do
      run_on "$h" 'true' >/dev/null 2>&1 || continue   # unreachable / ssh fail
      host_build_locked "$h" && continue               # another BUILD owns it — never preempt a build
      preempt_bench "$h"                                # kill any bench/serve/download (build wins)
      if acquire_host "$h"; then
        _ACTIVE_LOCK_HOST="$h"
        PICKED_HOST="$h"
        return 0
      fi
    done
    if (( waited >= PICK_TIMEOUT )); then return 1; fi
    echo "  [pick] family '$family' all hosts held by OTHER builds ($pool) — queueing ${PICK_INTERVAL}s (waited ${waited}s)" >&2
    sleep "$PICK_INTERVAL"; waited=$(( waited + PICK_INTERVAL ))
  done
}

# release any held lock on unexpected exit (die/error) as well as normal end
trap 'release_host "$_ACTIVE_LOCK_HOST"' EXIT

# resolve build/mirror host into RESOLVED_HOST: auto-pick idle host in family
# unless disabled. Sets a global (not echo) so the lock survives to the EXIT trap.
resolve_host() {
  local pinned="$1"
  RESOLVED_HOST="$pinned"
  # Build/mirror on the local host (the CI runner) instead of SSHing to a pool
  # host. Used by the GitHub Actions cicd runner that builds everything itself.
  if [[ "${INFERSTATION_FORCE_LOCAL_BUILD:-0}" == "1" ]]; then RESOLVED_HOST="local"; return 0; fi
  if [[ "$AUTO_HOST" != "1" ]]; then return 0; fi
  local fam; fam=$(family_of_host "$pinned")
  if [[ -z "$fam" ]]; then return 0; fi   # 9700/local: not pooled
  echo "→ selecting idle host in family '$fam' (preferred: $pinned)" >&2
  pick_idle_host "$fam" "$pinned" || die "no idle host available in family '$fam' within ${PICK_TIMEOUT}s"
  echo "→ picked host: $PICKED_HOST" >&2
  RESOLVED_HOST="$PICKED_HOST"
}

build_profile() {
  local profile="$1"; shift || true
  local dir="$SCRIPT_DIR/$profile"
  local meta="$dir/meta.json"
  [[ -f "$meta" ]] || die "no meta.json at $meta"

  # ---- parse overrides ----
  local override_ref="" override_repo="" override_tag="" push="1" no_latest="0"
  local extra_build_args=()
  local also_tags=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --ref=*)        override_ref="${1#*=}"; shift ;;
      --ref)          override_ref="$2"; shift 2 ;;
      --repo=*)       override_repo="${1#*=}"; shift ;;
      --repo)         override_repo="$2"; shift 2 ;;
      --tag=*)        override_tag="${1#*=}"; shift ;;
      --tag)          override_tag="$2"; shift 2 ;;
      --also-tag=*)   also_tags+=("${1#*=}"); shift ;;
      --also-tag)     also_tags+=("$2"); shift 2 ;;
      --build-arg)    extra_build_args+=("--build-arg" "$2"); shift 2 ;;
      --build-arg=*)  extra_build_args+=("--build-arg" "${1#*=}"); shift ;;
      --no-push)      push="0"; shift ;;
      --push)         push="1"; shift ;;
      --no-latest)    no_latest="1"; shift ;;
      *)              die "unknown flag: $1" ;;
    esac
  done

  local kind name registry tag plat
  kind=$(jq -r .kind "$meta")
  name=$(jq -r .name "$meta")
  registry=$(jq -r .registry "$meta")
  # Redirect the registry host/namespace without editing every meta.json:
  # INFERSTATION_REGISTRY=ghcr.io/inferstation -> ghcr.io/inferstation/<name>
  if [[ -n "${INFERSTATION_REGISTRY:-}" ]]; then
    registry="${INFERSTATION_REGISTRY%/}/$(basename "$registry")"
  fi
  tag=$(jq -r .tag "$meta")
  plat=$(jq -r '.platform // ""' "$meta"); [[ "$plat" == "null" ]] && plat=""
  [[ -n "$override_tag" ]] && tag="$override_tag"
  local full_tag="${registry}:${tag}"
  local platarg=""; [[ -n "$plat" ]] && platarg="--platform $plat"

  echo
  echo "=== [$kind] $name -> $full_tag ==="

  case "$kind" in
    build)
      local build_host dockerfile
      resolve_host "$(jq -r .build_host "$meta")"; build_host="$RESOLVED_HOST"
      dockerfile=$(jq -r '.dockerfile // "Dockerfile"' "$meta")

      local build_args_str=""
      while IFS= read -r kv; do
        build_args_str+=" --build-arg $kv"
      done < <(jq -r '.build_args // {} | to_entries | map("\(.key)=\(.value)") | .[]' "$meta")

      if [[ -n "$override_ref" ]]; then
        local ref_arg
        ref_arg=$(jq -r '.build_args // {} | keys[]?' "$meta" | grep -E '_TAG$' | head -n 1 || true)
        ref_arg="${ref_arg:-LLAMA_TAG}"
        build_args_str+=" --build-arg ${ref_arg}=${override_ref}"
      fi
      if [[ -n "$override_repo" ]]; then
        local repo_arg
        repo_arg=$(jq -r '.build_args // {} | keys[]?' "$meta" | grep -E '_REPO$' | head -n 1 || true)
        if [[ -z "$repo_arg" ]]; then
          case "$name" in
            llama-*) repo_arg="LLAMA_REPO";;
            vllm-*)  repo_arg="VLLM_REPO";;
            *)       repo_arg="UPSTREAM_REPO";;
          esac
        fi
        build_args_str+=" --build-arg ${repo_arg}=${override_repo}"
      fi
      for a in "${extra_build_args[@]}"; do
        build_args_str+=" $a"
      done

      local remote_dir="/tmp/inferstation-build/${name}"
      echo "→ rsync context to ${build_host}:${remote_dir}"
      tar -C "$dir" -czf - . | \
        run_on "$build_host" "rm -rf ${remote_dir} && mkdir -p ${remote_dir} && tar -C ${remote_dir} -xzf -"

      echo "→ docker build on $build_host (args:${build_args_str})${plat:+ platform=$plat}"
      # DOCKER_BUILDKIT=1: the vLLM wheel Dockerfiles use `RUN --mount=type=cache`
      # (ccache) + `--platform`, both of which REQUIRE BuildKit. The cicd
      # self-hosted runner's docker does NOT default to BuildKit, so without this
      # the halo wheel build dies with "the --mount option requires BuildKit".
      run_on "$build_host" "cd ${remote_dir} && DOCKER_BUILDKIT=1 docker build ${platarg}${build_args_str} -t ${full_tag} -f ${dockerfile} ."

      local latest_tag="${registry}:latest"
      if [[ "$push" == "1" ]]; then
        echo "→ docker push from $build_host"
        run_on "$build_host" "docker push ${full_tag}"
        if [[ "$no_latest" != "1" ]]; then
          echo "→ also tag + push :latest -> ${latest_tag}"
          run_on "$build_host" "docker tag ${full_tag} ${latest_tag} && docker push ${latest_tag}"
        else
          echo "(--no-latest) not moving :latest"
        fi
        for at in "${also_tags[@]}"; do
          local at_tag="${registry}:${at}"
          echo "→ also tag + push -> ${at_tag}"
          run_on "$build_host" "docker tag ${full_tag} ${at_tag} && docker push ${at_tag}"
        done
      else
        if [[ "$no_latest" != "1" ]]; then
          run_on "$build_host" "docker tag ${full_tag} ${latest_tag}"
        fi
        for at in "${also_tags[@]}"; do
          run_on "$build_host" "docker tag ${full_tag} ${registry}:${at}"
        done
        echo "(--no-push) skipping push"
      fi
      ;;

    mirror)
      local mirror_host source_image
      resolve_host "$(jq -r .mirror_host "$meta")"; mirror_host="$RESOLVED_HOST"
      source_image=$(jq -r .source_image "$meta")
      # --repo override fully replaces source_image (allows mirroring any
      # arbitrary external image without editing meta.json).
      if [[ -n "$override_repo" ]]; then
        source_image="$override_repo"
      fi
      echo "→ source_image=$source_image"

      echo "→ docker pull on $mirror_host${plat:+ (platform=$plat)}"
      run_on "$mirror_host" "docker pull ${platarg} ${source_image}"

      local latest_tag="${registry}:latest"
      if [[ "$push" == "1" ]]; then
        if [[ "$no_latest" != "1" ]]; then
          echo "→ docker tag + push to $full_tag (and :latest)"
          run_on "$mirror_host" "docker tag ${source_image} ${full_tag} && docker push ${full_tag} && docker tag ${source_image} ${latest_tag} && docker push ${latest_tag}"
        else
          echo "→ docker tag + push to $full_tag (--no-latest: not moving :latest)"
          run_on "$mirror_host" "docker tag ${source_image} ${full_tag} && docker push ${full_tag}"
        fi
        for at in "${also_tags[@]}"; do
          local at_tag="${registry}:${at}"
          echo "→ also tag + push -> ${at_tag}"
          run_on "$mirror_host" "docker tag ${source_image} ${at_tag} && docker push ${at_tag}"
        done
      else
        if [[ "$no_latest" != "1" ]]; then
          run_on "$mirror_host" "docker tag ${source_image} ${full_tag} && docker tag ${source_image} ${latest_tag}"
        else
          run_on "$mirror_host" "docker tag ${source_image} ${full_tag}"
        fi
        for at in "${also_tags[@]}"; do
          run_on "$mirror_host" "docker tag ${source_image} ${registry}:${at}"
        done
        echo "(--no-push) skipping push"
      fi
      ;;

    *)
      die "unknown kind: $kind"
      ;;
  esac

  # release the build-host lock now so queued builds proceed; the EXIT trap is
  # only a safety net (e.g. for `all` mode or an error mid-build).
  if [[ -n "$_ACTIVE_LOCK_HOST" ]]; then
    release_host "$_ACTIVE_LOCK_HOST"; _ACTIVE_LOCK_HOST=""
  fi
  echo "✓ $name done -> $full_tag"
}

main() {
  case "${1:-}" in
    ""|"-h"|"--help")
      cat <<EOF
Usage: $0 <profile>|all|list [flags]

Flags (build profiles):
  --ref=<commit-or-tag>     override upstream commit/tag
  --repo=<url>              override upstream repo URL (or, for mirror: source image)
  --tag=<final-tag>         override registry tag
  --build-arg KEY=VAL       extra docker --build-arg (repeatable)
  --no-push / --push        skip / force push (default: push)
  --also-tag=<tag>          push an extra tag pointing at this build (repeatable)
  --no-latest               do NOT move :latest to this build (manual/dev builds)

Other subcommands:
  list     list build/mirror profiles
  hosts    show the maintained candidate host pool (from hosts.conf)

Profiles:
$(list_profiles)
EOF
      ;;
    list)
      list_profiles
      ;;
    hosts)
      echo "maintained host pool (hosts.conf: $HOSTS_CONF):"
      local fam
      for fam in "${!HOST_POOL[@]}"; do
        printf "  %-6s -> %s\n" "$fam" "${HOST_POOL[$fam]}"
      done
      ;;
    all)
      shift
      for p in llama-rocm-halo llama-vulkan-halo vllm-rocm-halo vllm-rocm-halo-main \
               llama-vulkan-spark llama-cuda-spark vllm-cuda-spark; do
        build_profile "$p" "$@"
      done
      ;;
    *)
      build_profile "$@"
      ;;
  esac
}

main "$@"
