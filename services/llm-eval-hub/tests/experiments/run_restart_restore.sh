#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$PROJECT_ROOT"

RESTORE_DATABASE=evalhub_p1_11_restore
RESTORE_DATABASE_URL="postgresql+psycopg://evalhub:${POSTGRES_PASSWORD:-evalhub}@postgres:5432/$RESTORE_DATABASE"
OUTPUT_DIR=""

controller() {
  docker compose --profile experiment run --rm restart-restore-experiment \
    python -m tests.experiments.run_restart_restore "$@"
}

restore_controller() {
  docker compose --profile experiment run --rm \
    -e DATABASE_URL="$RESTORE_DATABASE_URL" \
    restart-restore-experiment \
    python -m tests.experiments.run_restart_restore "$@"
}

capture_container_state() {
  local destination=$1
  local first=1
  local containers=(
    inferstation-evalhub-api
    inferstation-evalhub-mock-openai
    inferstation-evalhub-postgres
    inferstation-evalhub-redis
    inferstation-evalhub-web
    inferstation-evalhub-worker
  )
  {
    printf '{"captured_at_utc":"%s","containers":[' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    for container in "${containers[@]}"; do
      if [[ $first -eq 0 ]]; then
        printf ','
      fi
      first=0
      docker inspect --format \
        '{"name":{{json .Name}},"id":{{json .Id}},"started_at":{{json .State.StartedAt}},"status":{{json .State.Status}},"devices":{{json .HostConfig.Devices}},"device_requests":{{json .HostConfig.DeviceRequests}}}' \
        "$container"
    done
    printf ']}\n'
  } >"$destination"
}

capture_gpu_boundary() {
  local destination=$1
  : >"$destination"
  for service in api worker; do
    docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "inferstation-evalhub-$service" \
      | awk -v service="$service" -F= \
        '$1 ~ /^(ROCR_VISIBLE_DEVICES|HIP_VISIBLE_DEVICES|CUDA_VISIBLE_DEVICES|GPU_DEVICE_ORDINAL)$/ {print service " " $0}' \
        >>"$destination"
  done
  sort -o "$destination" "$destination"
}

wait_for_services() {
  local deadline=$((SECONDS + 120))
  while ((SECONDS < deadline)); do
    if [[ $(docker inspect --format '{{.State.Health.Status}}' inferstation-evalhub-postgres 2>/dev/null) == healthy ]] \
      && [[ $(docker inspect --format '{{.State.Health.Status}}' inferstation-evalhub-redis 2>/dev/null) == healthy ]] \
      && [[ $(docker inspect --format '{{.State.Status}}' inferstation-evalhub-worker 2>/dev/null) == running ]] \
      && curl -fsS http://localhost:18000/healthz >/dev/null \
      && curl -fsS http://localhost:18001/healthz >/dev/null \
      && curl -fsS http://localhost:18080/ >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

recreate_restore_database() {
  docker compose exec -T postgres psql -U evalhub -d postgres -v ON_ERROR_STOP=1 \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$RESTORE_DATABASE' AND pid <> pg_backend_pid()" \
    -c "DROP DATABASE IF EXISTS \"$RESTORE_DATABASE\"" \
    -c "CREATE DATABASE \"$RESTORE_DATABASE\""
}

restore_once() {
  local pass_number=$1
  recreate_restore_database
  docker compose exec -T postgres pg_restore -U evalhub -d "$RESTORE_DATABASE" \
    --exit-on-error --no-owner --no-privileges \
    <"$OUTPUT_DIR/backup/evalhub.dump"
  docker compose exec -T postgres psql -U evalhub -d "$RESTORE_DATABASE" \
    -v ON_ERROR_STOP=1 -c 'ANALYZE'
  restore_controller verify-restore "$pass_number"
}

capture_logs() {
  if [[ -n "$OUTPUT_DIR" ]]; then
    mkdir -p "$OUTPUT_DIR/service-logs-redacted"
    docker compose logs --no-color postgres redis api worker mock-openai web 2>&1 \
      | sed -E \
        -e 's#(postgresql(\+psycopg)?://[^:[:space:]]+:)[^@[:space:]]+@#\1[REDACTED]@#g' \
        -e 's/(Authorization: (Bearer|Basic) )[A-Za-z0-9._~+\/=:-]+/\1[REDACTED]/Ig' \
      >"$OUTPUT_DIR/service-logs-redacted/restart.log"
  fi
}

restore_services() {
  local exit_code=$?
  trap - EXIT INT TERM
  set +e
  capture_logs
  controller cleanup >/dev/null 2>&1
  docker compose up -d postgres redis mock-openai api worker web >/dev/null 2>&1
  exit "$exit_code"
}
trap restore_services EXIT INT TERM

if [[ ${EVALHUB_GPU_DEVICES:-2,3} != 2,3 ]]; then
  echo "P1-11 requires EVALHUB_GPU_DEVICES=2,3" >&2
  exit 2
fi
export EVALHUB_GPU_DEVICES=2,3
mapfile -t GPU_UNIQUE_IDS < <(
  rocm-smi --showuniqueid --csv 2>/dev/null \
    | awk -F, '$1 == "card2" || $1 == "card3" {print $2}'
)
if [[ ${#GPU_UNIQUE_IDS[@]} -ne 2 ]]; then
  echo "Could not identify ROCm cards 2 and 3" >&2
  exit 2
fi
export EVALHUB_GPU_UNIQUE_IDS
EVALHUB_GPU_UNIQUE_IDS=$(IFS=,; echo "${GPU_UNIQUE_IDS[*]}")
export EVALHUB_GIT_SHA=${EVALHUB_GIT_SHA:-$(git rev-parse HEAD)}
export EVALHUB_COMPOSE_CONFIG_SHA256=${EVALHUB_COMPOSE_CONFIG_SHA256:-$(sha256sum docker-compose.yml | awk '{print $1}')}

docker compose --profile experiment build restart-restore-experiment
docker compose up -d postgres redis mock-openai api worker web
wait_for_services
OUTPUT_DIR=$(controller setup | tail -n 1)
capture_container_state "$OUTPUT_DIR/containers-before.json"
capture_gpu_boundary "$OUTPUT_DIR/gpu-boundary.txt"

docker compose restart postgres redis api worker mock-openai web
wait_for_services
capture_container_state "$OUTPUT_DIR/containers-after.json"
controller verify-restart

docker compose stop worker api
controller capture-backup-source
umask 077
docker compose exec -T postgres pg_dump -U evalhub -d evalhub \
  --format=custom --compress=9 --no-owner --no-privileges \
  >"$OUTPUT_DIR/backup/evalhub.dump.tmp"
mv "$OUTPUT_DIR/backup/evalhub.dump.tmp" "$OUTPUT_DIR/backup/evalhub.dump"
chmod 600 "$OUTPUT_DIR/backup/evalhub.dump"
docker compose exec -T postgres pg_restore --list \
  <"$OUTPUT_DIR/backup/evalhub.dump" \
  >"$OUTPUT_DIR/backup/pg-restore-list.txt"
controller record-backup

restore_once 1
restore_once 2
docker compose up -d api worker
wait_for_services
capture_logs
controller finalize
controller cleanup
printf '%s\n' "$OUTPUT_DIR"
