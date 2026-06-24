#!/usr/bin/env bash
# ⚠️ OBSOLETE (2026-06-24): Harbor 已退役。build.sh 现在直接 push 到
# ghcr.io/inferstation（INFERSTATION_REGISTRY），无需 Harbor→GHCR 二次镜像。
# 仅作历史参考。
# Mirror selected tags from the internal Harbor registry to public GHCR
# (ghcr.io/inferstation/<name>:<tag>).
#
# Repos AND tags are auto-discovered from Harbor's REST API every run — there is
# deliberately NO hardcoded image list (the old static list rotted the moment a
# release tag changed and then silently pull-FAILed on every entry).
#
# Run on a host that has BOTH:
#   - network access to the Harbor registry (HARBOR_HOST), AND
#   - `docker login ghcr.io` already done with a classic PAT (write:packages).
# 9700 currently satisfies both.
#
# Default tag policy (override via env, see below):
#   - latest
#   - weekly-YYYYMMDD                               (validated, permanent)
#   - release tags  vX.Y.Z-<arch> / bNNNN-<arch>    (permanent)
#   - the single newest nightly-YYYYMMDD
#   excluded: commit-<sha> provenance tags, empty / malformed tags
#
# Env knobs:
#   REPOS="a b c"           override repo auto-discovery (names without project prefix)
#   MIRROR_ALL_NIGHTLIES=1  mirror every nightly-* instead of only the newest
#   MIRROR_COMMITS=1        also mirror commit-<sha> provenance tags
#   TAG_REGEX='...'         fully override the include filter (an ERE matched per tag)
#   DRY_RUN=1               print the planned source->dest mirrors and exit
#   DOCKER='sudo docker'    docker command to use (default: sudo docker)
#   HARBOR_HOST / HARBOR_PROJECT / GHCR   registry coordinates (sane defaults below)
#
# NOTE on labels: this copies each Harbor image as-is, including whatever
# org.opencontainers.image.source label it was built with. A GHCR package's
# "linked repository" (set once via the web UI) is sticky and is NOT affected by
# re-pushing, so mirroring will not unlink packages.
set -uo pipefail

HARBOR_HOST="${HARBOR_HOST:-10.161.176.38:8443}"
HARBOR_PROJECT="${HARBOR_PROJECT:-inferstation}"
HARBOR_API="http://${HARBOR_HOST}/api/v2.0"
HARBOR="${HARBOR_HOST}/${HARBOR_PROJECT}"
GHCR="${GHCR:-ghcr.io/${HARBOR_PROJECT}}"
DOCKER="${DOCKER:-sudo docker}"
DRY_RUN="${DRY_RUN:-0}"

command -v curl >/dev/null 2>&1 || { echo "sync-ghcr: need curl" >&2; exit 1; }
command -v jq   >/dev/null 2>&1 || { echo "sync-ghcr: need jq"   >&2; exit 1; }

# --- discover repos (project repositories) ------------------------------------
# Internal-only repos never published to GHCR:
#   - vllm wheel pkgs: FROM-scratch build artifacts consumed by the assembler,
#     not runnable images.
#   - vllm-rocm-halo-main: the upstream-main halo vLLM line (carries DiffusionGemma)
#     is kept internal; GHCR publishes only the gfx1151-tuned default vllm-rocm-halo.
# Override with EXCLUDE_REPOS="a b".
EXCLUDE_REPOS="${EXCLUDE_REPOS:-vllm-wheel-halo vllm-wheel-halo-gfx11 vllm-wheel-spark vllm-rocm-halo-main}"
declare -a REPO_LIST
if [[ -n "${REPOS:-}" ]]; then
  read -r -a REPO_LIST <<<"$REPOS"
else
  mapfile -t REPO_LIST < <(
    curl -fsS "${HARBOR_API}/projects/${HARBOR_PROJECT}/repositories?page_size=100" 2>/dev/null \
      | jq -r '.[].name' | sed "s#^${HARBOR_PROJECT}/##" | sort
  )
fi
# drop internal-only repos
if [[ -n "${EXCLUDE_REPOS// }" ]]; then
  declare -a _filtered=()
  for _r in "${REPO_LIST[@]}"; do
    _skip=0
    for _x in $EXCLUDE_REPOS; do [[ "$_r" == "$_x" ]] && _skip=1 && break; done
    [[ $_skip -eq 0 ]] && _filtered+=("$_r")
  done
  REPO_LIST=("${_filtered[@]}")
fi
if [[ ${#REPO_LIST[@]} -eq 0 ]]; then
  echo "sync-ghcr: no repos discovered in Harbor project '${HARBOR_PROJECT}'" >&2
  exit 1
fi

# --- list non-empty tags for a repo -------------------------------------------
list_tags() {  # $1=repo
  curl -fsS "${HARBOR_API}/projects/${HARBOR_PROJECT}/repositories/$1/artifacts?page_size=100&with_tag=true" 2>/dev/null \
    | jq -r '.[].tags[]?.name' | grep -vE '^$'
}

# --- pick which tags to mirror (reads tags on stdin, prints selection) --------
select_tags() {
  local tags; tags=$(cat)
  if [[ -n "${TAG_REGEX:-}" ]]; then
    grep -E "$TAG_REGEX" <<<"$tags" || true
    return
  fi
  {
    grep -xE 'latest'                              <<<"$tags" || true
    grep -xE 'weekly-[0-9]{8}'                     <<<"$tags" || true
    grep -xE 'v[0-9][^[:space:]]*-[^[:space:]]+'   <<<"$tags" || true   # vX.Y.Z-arch
    grep -xE 'b[0-9][^[:space:]]*-[^[:space:]]+'   <<<"$tags" || true   # bNNNN-arch
    [[ "${MIRROR_COMMITS:-0}" == "1" ]] && { grep -xE 'commit-[0-9a-f]+' <<<"$tags" || true; }
    if [[ "${MIRROR_ALL_NIGHTLIES:-0}" == "1" ]]; then
      grep -xE 'nightly-[0-9]{8}' <<<"$tags" || true
    else
      grep -xE 'nightly-[0-9]{8}' <<<"$tags" | sort | tail -1 || true   # newest nightly only
    fi
  } | sort -u
}

# --- mirror -------------------------------------------------------------------
declare -a SUMMARY
ok=0; fail=0
for repo in "${REPO_LIST[@]}"; do
  echo "================ ${repo} ================"
  tags=$(list_tags "$repo") || { echo "  (failed to list tags)"; continue; }
  sel=$(select_tags <<<"$tags")
  if [[ -z "$sel" ]]; then echo "  (no tags selected)"; continue; fi
  while IFS= read -r tag; do
    [[ -z "$tag" ]] && continue
    src="${HARBOR}/${repo}:${tag}"
    dst="${GHCR}/${repo}:${tag}"
    if [[ "$DRY_RUN" == "1" ]]; then
      echo "  DRY  ${src}  ->  ${dst}"
      continue
    fi
    echo "  --- ${repo}:${tag} ---"
    if ! $DOCKER pull "$src" >/dev/null 2>&1; then
      echo "    pull FAIL"; SUMMARY+=("FAIL pull  ${repo}:${tag}"); fail=$((fail+1)); continue
    fi
    $DOCKER tag "$src" "$dst"
    if $DOCKER push "$dst" >/dev/null 2>&1; then
      echo "    pushed"; SUMMARY+=("OK   ${repo}:${tag}"); ok=$((ok+1))
    else
      echo "    push FAIL"; SUMMARY+=("FAIL push  ${repo}:${tag}"); fail=$((fail+1))
    fi
  done <<<"$sel"
done

echo
if [[ "$DRY_RUN" == "1" ]]; then
  echo "=== dry-run complete (no images pushed) ==="
else
  echo "=== summary (ok=${ok} fail=${fail}) ==="
  for line in "${SUMMARY[@]:-}"; do [[ -n "$line" ]] && echo "  $line"; done
fi
