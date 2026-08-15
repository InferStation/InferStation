#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE="$DEPLOY_ROOT/.env.deploy"
REGISTER_BENCHMARKS=false
WAIT_TIMEOUT=300
BUILD_OPTION=--build

usage() {
  echo "Usage: $0 [--env-file PATH] [--with-benchmarks] [--no-build] [--wait-timeout SECONDS]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE=${2:?--env-file requires a path}
      shift 2
      ;;
    --with-benchmarks)
      REGISTER_BENCHMARKS=true
      shift
      ;;
    --no-build)
      BUILD_OPTION=--no-build
      shift
      ;;
    --wait-timeout)
      WAIT_TIMEOUT=${2:?--wait-timeout requires a value}
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Engine with the Compose v2 plugin is required." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Deployment environment file not found: $ENV_FILE" >&2
  echo "Run scripts/generate_deploy_env.sh first." >&2
  exit 1
fi

if grep -Eq '^(POSTGRES_PASSWORD|ADMIN_API_KEY|SECRET_ENCRYPTION_KEY)=($|replace-|change-me)' "$ENV_FILE"; then
  echo "The deployment environment still contains an empty or placeholder secret." >&2
  exit 1
fi

if ! grep -Eq '^WEB_ORIGIN=https?://[^[:space:]]+$' "$ENV_FILE"; then
  echo "WEB_ORIGIN must be an explicit http:// or https:// browser origin." >&2
  exit 1
fi

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$DEPLOY_ROOT/compose.deploy.yml")

"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" up -d "$BUILD_OPTION" --wait --wait-timeout "$WAIT_TIMEOUT"

if [[ "$REGISTER_BENCHMARKS" == true ]]; then
  "${COMPOSE[@]}" run --rm benchmark-register
fi

WEB_ORIGIN_VALUE=$(sed -n 's/^WEB_ORIGIN=//p' "$ENV_FILE" | tail -n 1)
API_PORT=$(sed -n 's/^API_PORT=//p' "$ENV_FILE" | tail -n 1)
echo "Deployment is healthy."
echo "Web UI: ${WEB_ORIGIN_VALUE}"
echo "Local API docs: http://localhost:${API_PORT:-18000}/docs"
