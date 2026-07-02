#!/usr/bin/env bash
# Pull bench JSON from bench hosts, rebuild the Next.js site, deploy to 4090.
# Designed to be run by cron / systemd timer on the dev box that owns pnpm.
#
# Flow (no GitHub Actions, no GitHub round-trip in the hot path):
#   1. rsync data/runs/ from each bench host into the local checkout
#   2. if any file changed -> pnpm build (static export) -> rsync out/ to 4090
#   3. async: git add data/runs/ && git commit && git push  (best-effort, backup)
#
# Lock so concurrent timers don't trample each other.
set -euo pipefail

REPO="${REPO:-/home/lkang/codes/InferStation}"
SSH="ssh -F /home/lkang/.ssh/config -i /home/lkang/.ssh/id_rsa -o BatchMode=yes -o ConnectTimeout=10"
DEPLOY_TARGET="${DEPLOY_TARGET:-lkang@10.161.176.110:/home/lkang/inferstation/site/}"
LOG="${LOG:-/tmp/inferstation-watch.log}"
LOCK="/tmp/inferstation-watch.lock"

# Bench hosts -> remote path to data/runs/
declare -A HOSTS=(
  [spark1-shanghai]='InferStation/data/runs/'
  [halo3-shanghai]='InferStation/data/runs/'
)

exec 9>"$LOCK"
if ! flock -n 9; then
  exit 0
fi

log() { printf '[%s] %s\n' "$(date -Iseconds)" "$*" >>"$LOG"; }

cd "$REPO"

CHANGED=0
for host in "${!HOSTS[@]}"; do
  src="${HOSTS[$host]}"
  # Only count actual JSON payloads. rsync may also touch dir mtimes etc.
  out=$(rsync -az --out-format='%n' -e "$SSH" "$host:$src" "$REPO/data/runs/" 2>>"$LOG" \
        | grep -E '\.json$' || true)
  if [[ -n "$out" ]]; then
    log "new files from $host: $(echo "$out" | tr '\n' ' ')"
    CHANGED=1
  fi
done

if [[ "$CHANGED" -eq 0 ]]; then
  exit 0
fi

log "build start"
export PATH="/home/lkang/.local/node20/bin:$PATH"
if ! pnpm build >>"$LOG" 2>&1; then
  log "build FAILED"
  exit 1
fi
log "build ok; deploying to $DEPLOY_TARGET"

if rsync -az --delete -e "$SSH" "$REPO/out/" "$DEPLOY_TARGET" >>"$LOG" 2>&1; then
  log "deploy ok"
else
  log "deploy FAILED"
  exit 1
fi

# Best-effort git backup. Failure is non-fatal.
(
  cd "$REPO"
  git add data/runs/ 2>/dev/null || true
  if ! git diff --cached --quiet; then
    git -c user.name=JoursBleu -c user.email=JoursBleu@users.noreply.github.com \
        commit -m "data: auto-sync from bench hosts $(date -Iseconds)" >>"$LOG" 2>&1 || true
    git push origin main >>"$LOG" 2>&1 || log "git push failed (non-fatal)"
  fi
) &
