#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE="$DEPLOY_ROOT/.env.deploy"
BACKUP_DIR=""
CONFIRMED=false
BUILD_OPTION=""

usage() {
  echo "Usage: $0 --backup-dir PATH [--env-file PATH] [--no-build] --confirm-destructive-restore"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-dir)
      BACKUP_DIR=${2:?--backup-dir requires a path}
      shift 2
      ;;
    --env-file)
      ENV_FILE=${2:?--env-file requires a path}
      shift 2
      ;;
    --confirm-destructive-restore)
      CONFIRMED=true
      shift
      ;;
    --no-build)
      BUILD_OPTION=--no-build
      shift
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

if [[ -z "$BACKUP_DIR" || "$CONFIRMED" != true ]]; then
  usage >&2
  echo "Restore requires an explicit backup directory and destructive confirmation." >&2
  exit 2
fi

for required_file in "$ENV_FILE" "$BACKUP_DIR/database.dump" "$BACKUP_DIR/artifacts.tar.gz" "$BACKUP_DIR/deployment.env"; do
  if [[ ! -f "$required_file" ]]; then
    echo "Required restore file not found: $required_file" >&2
    exit 1
  fi
done

if [[ -f "$BACKUP_DIR/SHA256SUMS" ]] && command -v sha256sum >/dev/null 2>&1; then
  (cd "$BACKUP_DIR" && sha256sum -c SHA256SUMS)
fi

CURRENT_ENCRYPTION_KEY=$(sed -n 's/^SECRET_ENCRYPTION_KEY=//p' "$ENV_FILE" | tail -n 1)
BACKUP_ENCRYPTION_KEY=$(sed -n 's/^SECRET_ENCRYPTION_KEY=//p' "$BACKUP_DIR/deployment.env" | tail -n 1)
if [[ -z "$CURRENT_ENCRYPTION_KEY" || "$CURRENT_ENCRYPTION_KEY" != "$BACKUP_ENCRYPTION_KEY" ]]; then
  echo "SECRET_ENCRYPTION_KEY does not match the backup environment." >&2
  echo "Restore the original key before restoring encrypted endpoint credentials." >&2
  exit 1
fi

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$DEPLOY_ROOT/compose.deploy.yml")

echo "Stopping application traffic..."
"${COMPOSE[@]}" stop api worker web
"${COMPOSE[@]}" up -d postgres redis

echo "Clearing non-authoritative Redis task state..."
"${COMPOSE[@]}" exec -T redis redis-cli FLUSHALL >/dev/null

echo "Replacing PostgreSQL state..."
"${COMPOSE[@]}" exec -T postgres dropdb -U evalhub --if-exists --force evalhub
"${COMPOSE[@]}" exec -T postgres createdb -U evalhub evalhub
"${COMPOSE[@]}" exec -T postgres pg_restore -U evalhub -d evalhub --no-owner --no-privileges \
  < "$BACKUP_DIR/database.dump"

echo "Replacing artifact state..."
"${COMPOSE[@]}" run --rm -T artifact-restore \
  'find /restore -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -C /restore -xzf -' \
  < "$BACKUP_DIR/artifacts.tar.gz"

echo "Starting the restored deployment..."
DEPLOY_ARGS=(--env-file "$ENV_FILE")
if [[ -n "$BUILD_OPTION" ]]; then
  DEPLOY_ARGS+=("$BUILD_OPTION")
fi
"$DEPLOY_ROOT/scripts/deploy.sh" "${DEPLOY_ARGS[@]}"
echo "Restore completed. Probe an endpoint and run a small validation dataset."
