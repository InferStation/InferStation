#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE="$DEPLOY_ROOT/.env.deploy"
BACKUP_ROOT="$DEPLOY_ROOT/backups"

usage() {
  echo "Usage: $0 [--env-file PATH] [--output-dir PATH]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE=${2:?--env-file requires a path}
      shift 2
      ;;
    --output-dir)
      BACKUP_ROOT=${2:?--output-dir requires a path}
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

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Deployment environment file not found: $ENV_FILE" >&2
  exit 1
fi

BACKUP_ID=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="$BACKUP_ROOT/$BACKUP_ID"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$DEPLOY_ROOT/compose.deploy.yml")

"${COMPOSE[@]}" exec -T postgres pg_dump -U evalhub -d evalhub -Fc > "$BACKUP_DIR/database.dump"
"${COMPOSE[@]}" run --rm -T maintenance 'tar -C /data -czf - .' > "$BACKUP_DIR/artifacts.tar.gz"
cp "$ENV_FILE" "$BACKUP_DIR/deployment.env"
chmod 600 "$BACKUP_DIR/database.dump" "$BACKUP_DIR/artifacts.tar.gz" "$BACKUP_DIR/deployment.env"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$BACKUP_DIR" && sha256sum database.dump artifacts.tar.gz deployment.env > SHA256SUMS)
  chmod 600 "$BACKUP_DIR/SHA256SUMS"
fi

echo "Backup created at $BACKUP_DIR"
echo "Store this directory securely; deployment.env contains secrets."
