#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TARGET_FILE=${1:-"$DEPLOY_ROOT/.env.deploy"}
PUBLIC_ORIGIN=${2:-http://localhost:18080}
TEMPLATE_FILE=${3:-"$DEPLOY_ROOT/.env.deploy.example"}

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate deployment secrets." >&2
  exit 1
fi

if [[ -e "$TARGET_FILE" ]]; then
  echo "Refusing to overwrite existing file: $TARGET_FILE" >&2
  exit 1
fi

if [[ ! -f "$TEMPLATE_FILE" ]]; then
  echo "Environment template not found: $TEMPLATE_FILE" >&2
  exit 1
fi

POSTGRES_SECRET=$(openssl rand -hex 24)
ADMIN_SECRET=$(openssl rand -hex 32)
FERNET_SECRET=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '\n')

cp "$TEMPLATE_FILE" "$TARGET_FILE"
sed -i.bak \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$POSTGRES_SECRET|" \
  -e "s|^ADMIN_API_KEY=.*|ADMIN_API_KEY=$ADMIN_SECRET|" \
  -e "s|^SECRET_ENCRYPTION_KEY=.*|SECRET_ENCRYPTION_KEY=$FERNET_SECRET|" \
  -e "s|^WEB_ORIGIN=.*|WEB_ORIGIN=$PUBLIC_ORIGIN|" \
  "$TARGET_FILE"
rm -f "$TARGET_FILE.bak"
chmod 600 "$TARGET_FILE"

echo "Created $TARGET_FILE with mode 0600."
echo "Review WEB_ORIGIN and the endpoint allowlist before deployment."
