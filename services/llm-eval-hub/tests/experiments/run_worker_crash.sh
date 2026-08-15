#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$PROJECT_ROOT"

WORKER_NAME=inferstation-evalhub-worker
DATABASE_URL="postgresql+psycopg://evalhub:${POSTGRES_PASSWORD:-evalhub}@postgres:5432/evalhub_p1_10_worker_crash"
REDIS_URL=redis://redis:6379/14
OUTPUT_DIR=""

controller() {
  docker compose --profile experiment run --rm crash-experiment \
    python -m tests.experiments.run_worker_crash "$@"
}

capture_logs() {
  if [[ -n "$OUTPUT_DIR" ]] && docker inspect "$WORKER_NAME" >/dev/null 2>&1; then
    mkdir -p "$OUTPUT_DIR/service-logs-redacted"
    docker logs "$WORKER_NAME" 2>&1 \
      | sed -E 's/(Authorization: (Bearer|Basic) )[A-Za-z0-9._~+\/=:-]+/\1[REDACTED]/Ig' \
      >"$OUTPUT_DIR/service-logs-redacted/worker.log"
  fi
}

restore_main_worker() {
  local exit_code=$?
  trap - EXIT INT TERM
  set +e
  capture_logs
  docker rm -f "$WORKER_NAME" >/dev/null 2>&1
  controller cleanup >/dev/null 2>&1
  docker compose up -d worker >/dev/null 2>&1
  exit "$exit_code"
}
trap restore_main_worker EXIT INT TERM

export EVALHUB_GIT_SHA=${EVALHUB_GIT_SHA:-$(git rev-parse HEAD)}
export EVALHUB_COMPOSE_CONFIG_SHA256=${EVALHUB_COMPOSE_CONFIG_SHA256:-$(sha256sum docker-compose.yml | awk '{print $1}')}
docker compose up -d postgres redis
docker compose up -d --build --force-recreate mock-openai
docker compose --profile experiment build worker crash-experiment
docker compose stop worker
docker compose rm -f worker

OUTPUT_DIR=$(controller setup | tail -n 1)
docker compose run -d --name "$WORKER_NAME" --no-deps \
  -e APP_ENV=test \
  -e DATABASE_URL="$DATABASE_URL" \
  -e REDIS_URL="$REDIS_URL" \
  -e CELERY_BROKER_URL="$REDIS_URL" \
  -e CELERY_RESULT_BACKEND="$REDIS_URL" \
  worker celery -A workers.celery_app worker -Q native --concurrency=4 --loglevel=INFO

CONTAINER_ID=$(docker inspect --format '{{.Id}}' "$WORKER_NAME")
IMAGE_ID=$(docker inspect --format '{{.Image}}' "$WORKER_NAME")
controller dispatch
docker kill -s KILL "$WORKER_NAME"
EXIT_CODE=$(docker inspect --format '{{.State.ExitCode}}' "$WORKER_NAME")
controller record-crash "$CONTAINER_ID" "$IMAGE_ID" "$EXIT_CODE"
docker start "$WORKER_NAME"

if ! controller verify; then
  capture_logs
  exit 1
fi
capture_logs
printf '%s\n' "$OUTPUT_DIR"
