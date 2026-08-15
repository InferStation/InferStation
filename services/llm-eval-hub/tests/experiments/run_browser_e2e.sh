#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$PROJECT_ROOT"

DATABASE=evalhub_p1_12_e2e
REDIS_DATABASE=13
OUTPUT_DIR=""
E2E_SERVICES=(e2e-artifact-init e2e-api e2e-worker e2e-web e2e-mock-openai)

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

capture_logs() {
  if [[ -z "$OUTPUT_DIR" ]]; then
    return
  fi
  mkdir -p "$OUTPUT_DIR/service-logs-redacted"
  docker compose --profile e2e logs --no-color "${E2E_SERVICES[@]}" 2>&1 \
    | sed -E \
      -e 's/inferstation-e2e-key/[REDACTED]/g' \
      -e 's#(postgresql(\+psycopg)?://[^:[:space:]]+:)[^@[:space:]]+@#\1[REDACTED]@#g' \
      -e 's/(Authorization: (Bearer|Basic) )[A-Za-z0-9._~+\/=:-]+/\1[REDACTED]/Ig' \
    >"$OUTPUT_DIR/service-logs-redacted/services.log"
}

capture_containers() {
  local destination=$1
  docker inspect \
    inferstation-evalhub-e2e-api \
    inferstation-evalhub-e2e-worker \
    inferstation-evalhub-e2e-web \
    inferstation-evalhub-e2e-mock-openai \
    | jq '[.[] | {
        name: .Name,
        id: .Id,
        image: .Image,
        status: .State.Status,
        health: (.State.Health.Status // null),
        devices: (.HostConfig.Devices // []),
        device_requests: (.HostConfig.DeviceRequests // []),
        gpu_boundary: (
          [.Config.Env[] | select(test("^(ROCR_VISIBLE_DEVICES|HIP_VISIBLE_DEVICES|CUDA_VISIBLE_DEVICES|GPU_DEVICE_ORDINAL)="))
            | capture("^(?<key>[^=]+)=(?<value>.*)$")]
          | from_entries
        )
      }]' >"$destination"
}

capture_compose_boundary() {
  local destination=$1
  docker compose --profile e2e config --format json \
    | jq '{services: [.services | to_entries[]
        | select(.key == "browser-e2e" or (.key | startswith("e2e-")))
        | {
            service: .key,
            container_name: .value.container_name,
            devices: (.value.devices // []),
            gpu_boundary: {
              ROCR_VISIBLE_DEVICES: .value.environment.ROCR_VISIBLE_DEVICES,
              HIP_VISIBLE_DEVICES: .value.environment.HIP_VISIBLE_DEVICES,
              CUDA_VISIBLE_DEVICES: .value.environment.CUDA_VISIBLE_DEVICES,
              GPU_DEVICE_ORDINAL: .value.environment.GPU_DEVICE_ORDINAL
            }
          }]}' >"$destination"
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  set +e
  capture_logs
  docker compose --profile e2e rm -sf "${E2E_SERVICES[@]}" >/dev/null 2>&1
  docker volume rm inferstation_evalhub_e2e_artifacts >/dev/null 2>&1
  docker compose exec -T redis redis-cli -n "$REDIS_DATABASE" FLUSHDB >/dev/null 2>&1
  drop_database
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

if [[ ${EVALHUB_GPU_DEVICES:-2,3} != 2,3 ]]; then
  echo "P1-12 requires EVALHUB_GPU_DEVICES=2,3" >&2
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

OUTPUT_DIR="artifacts/experiments/P1-12-browser-e2e-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUTPUT_DIR"
chmod 700 "$OUTPUT_DIR"
export E2E_EVIDENCE_DIR="/workspace/$OUTPUT_DIR"

docker compose up -d postgres redis
create_database
docker compose exec -T redis redis-cli -n "$REDIS_DATABASE" FLUSHDB >/dev/null
docker compose --profile e2e build e2e-api e2e-worker e2e-web e2e-mock-openai browser-e2e
docker compose --profile e2e up -d --force-recreate "${E2E_SERVICES[@]}"
capture_compose_boundary "$OUTPUT_DIR/compose-gpu-boundary.json"

docker compose --profile e2e run --rm browser-e2e
capture_containers "$OUTPUT_DIR/containers.json"
capture_logs
printf '%s\n' "$OUTPUT_DIR"
