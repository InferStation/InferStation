#!/usr/bin/env bash
# Prune nightly-* tags on Harbor: keep latest 7 per repository, delete the rest.
# Other tags (release tags, :latest, dev branches) are NEVER touched.

set -euo pipefail
HARBOR="${HARBOR:-http://10.161.176.38:8443}"   # Harbor here is HTTP-on-8443
PROJECT="inferstation"
USER="admin"
PASS="${HARBOR_PASS:-}"
KEEP=7

REPOS=(
  llama-cuda-spark
  llama-vulkan-spark
  llama-vulkan-halo
  llama-rocm-halo
  vllm-cuda-spark
  vllm-wheel-spark
  vllm-wheel-halo
  vllm-wheel-halo-gfx11
  vllm-rocm-halo
  vllm-rocm-halo-main
)

curl_h() {
  curl -sS -u "$USER:$PASS" -H "accept: application/json" "$@"
}

for repo in "${REPOS[@]}"; do
  echo "--- repo: $repo ---"
  # encode '/' in repo name (none here, but kept for safety)
  url_repo=$(printf '%s' "$repo" | sed 's|/|%2F|g')
  base="${HARBOR}/api/v2.0/projects/${PROJECT}/repositories/${url_repo}/artifacts"

  # list all artifacts page=1 page_size=100 (more than enough)
  artifacts=$(curl_h "${base}?page=1&page_size=100&with_tag=true")
  if [[ -z "$artifacts" || "$artifacts" == "null" ]]; then
    echo "  (no artifacts)"; continue
  fi

  # extract nightly-YYYYMMDD tags with their digest, sort desc by date,
  # keep first $KEEP, queue the rest for deletion.
  mapfile -t to_delete < <(printf '%s' "$artifacts" | jq -r '
    [ .[] |
      { digest: .digest,
        tags: (.tags // []) | map(.name) | map(select(test("^nightly-[0-9]{8}$")))
      } |
      select(.tags | length > 0)
    ] as $arts
    | [ $arts[].tags[] ] | sort | reverse as $sorted
    | ($sorted | .['"$KEEP"':]) as $del
    | $del[]
  ')

  if [[ ${#to_delete[@]} -eq 0 ]]; then
    kept=$(printf '%s' "$artifacts" | jq -r '[.[].tags[]?.name] | map(select(test("^nightly-[0-9]{8}$"))) | length')
    echo "  kept: ${kept} nightly tag(s); nothing to delete"
    continue
  fi

  for tag in "${to_delete[@]}"; do
    [[ -z "$tag" ]] && continue
    # delete just the tag (artifact remains if other tags still reference)
    code=$(curl -sS -u "$USER:$PASS" -o /dev/null -w '%{http_code}' \
      -X DELETE "${base}/${tag}/tags/${tag}")
    echo "  DELETE tag=${tag} -> HTTP ${code}"
  done
done
