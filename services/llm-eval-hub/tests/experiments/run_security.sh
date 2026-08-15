#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$PROJECT_ROOT"

DATABASE=evalhub_p1_13_security
REDIS_DATABASE=12
OUTPUT_DIR=""
TEMP_DIR=$(mktemp -d)
CANARY="p1-13-secret-canary-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}${RANDOM}"
SECURITY_SERVICES=(security-api security-worker security-mock-openai)

drop_database() {
  docker compose exec -T postgres psql -U evalhub -d postgres -v ON_ERROR_STOP=1 \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DATABASE' AND pid <> pg_backend_pid()" \
    -c "DROP DATABASE IF EXISTS \"$DATABASE\"" >/dev/null
}

create_database() {
  drop_database
  docker compose exec -T postgres psql -U evalhub -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE \"$DATABASE\"" >/dev/null
}

controller() {
  docker compose --profile security run --rm \
    -e EVALHUB_SECRET_CANARY="$CANARY" \
    security-experiment \
    python -m tests.experiments.run_security "$@"
}

wait_for_security_api() {
  local deadline=$((SECONDS + 120))
  while ((SECONDS < deadline)); do
    if [[ $(docker inspect --format '{{.State.Health.Status}}' inferstation-evalhub-security-api 2>/dev/null) == healthy ]] \
      && [[ $(docker inspect --format '{{.State.Health.Status}}' inferstation-evalhub-security-mock-openai 2>/dev/null) == healthy ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

capture_logs() {
  if [[ -z "$OUTPUT_DIR" ]]; then
    return
  fi
  local raw_log="$TEMP_DIR/security-services.log"
  mkdir -p "$OUTPUT_DIR/service-logs-redacted"
  docker compose --profile security logs --no-color "${SECURITY_SERVICES[@]}" >"$raw_log" 2>&1 || true
  local hit_count=0
  if grep -Fq "$CANARY" "$raw_log"; then
    hit_count=$(grep -Fo "$CANARY" "$raw_log" | wc -l | tr -d ' ')
  fi
  sed -E \
    -e "s/${CANARY}/[REDACTED]/g" \
    -e 's/p1-13-admin-test-key/[REDACTED]/g' \
    -e 's/MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=/[REDACTED]/g' \
    -e 's#(postgresql(\+psycopg)?://[^:[:space:]]+:)[^@[:space:]]+@#\1[REDACTED]@#g' \
    -e 's/(Authorization: (Bearer|Basic) )[A-Za-z0-9._~+\/=:-]+/\1[REDACTED]/Ig' \
    "$raw_log" >"$OUTPUT_DIR/service-logs-redacted/services.log"
  jq -n \
    --arg captured_at_utc "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --argjson full_secret_hits "$hit_count" \
    '{captured_at_utc: $captured_at_utc, full_secret_hits: $full_secret_hits}' \
    >"$OUTPUT_DIR/service-log-scan.json"
}

capture_containers() {
  docker inspect \
    inferstation-evalhub-security-api \
    inferstation-evalhub-security-worker \
    inferstation-evalhub-security-mock-openai \
    | jq '[.[] | {
        name: .Name,
        user: .Config.User,
        status: .State.Status,
        health: (.State.Health.Status // null),
        devices: (.HostConfig.Devices // []),
        device_requests: (.HostConfig.DeviceRequests // []),
        gpu_boundary: (
          [.Config.Env[]
            | select(test("^(ROCR_VISIBLE_DEVICES|HIP_VISIBLE_DEVICES|CUDA_VISIBLE_DEVICES|GPU_DEVICE_ORDINAL)="))
            | capture("^(?<key>[^=]+)=(?<value>.*)$")]
          | from_entries
        )
      }]' >"$OUTPUT_DIR/containers.json"
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  set +e
  capture_logs
  docker compose --profile security rm -sf "${SECURITY_SERVICES[@]}" >/dev/null 2>&1
  docker compose exec -T redis redis-cli -n "$REDIS_DATABASE" FLUSHDB >/dev/null 2>&1
  drop_database
  rm -rf -- "$TEMP_DIR"
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

if [[ ${EVALHUB_GPU_DEVICES:-2,3} != 2,3 ]]; then
  echo "P1-13 requires EVALHUB_GPU_DEVICES=2,3" >&2
  exit 2
fi
export EVALHUB_GPU_DEVICES=2,3
export EVALHUB_GIT_SHA=${EVALHUB_GIT_SHA:-$(git rev-parse HEAD)}
export EVALHUB_COMPOSE_CONFIG_SHA256=${EVALHUB_COMPOSE_CONFIG_SHA256:-$(sha256sum docker-compose.yml | awk '{print $1}')}

docker compose up -d postgres redis
create_database
docker compose exec -T redis redis-cli -n "$REDIS_DATABASE" FLUSHDB >/dev/null
docker compose --profile security build security-api security-worker security-mock-openai security-experiment
docker compose --profile security up -d --force-recreate security-mock-openai security-api
wait_for_security_api

OUTPUT_DIR=$(controller exercise | tail -n 1)
docker compose --profile security up -d security-worker
controller verify-run
capture_containers
capture_logs
controller finalize
printf '%s\n' "$OUTPUT_DIR"
