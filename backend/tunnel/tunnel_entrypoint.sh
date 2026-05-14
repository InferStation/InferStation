#!/bin/sh
# Tunnel client entrypoint — translates env vars to CLI flags.
# Accepts either GATEWAY_TOKEN (preferred) or PROVIDER_TOKEN (legacy alias).
set -e

: "${GATEWAY_URL:?GATEWAY_URL is required (e.g. wss://tianshu-gateway.cloud/ws/tunnel)}"
GATEWAY_TOKEN="${GATEWAY_TOKEN:-${PROVIDER_TOKEN:-}}"
: "${GATEWAY_TOKEN:?GATEWAY_TOKEN (or PROVIDER_TOKEN) is required — your provider API key}"
: "${BACKEND_NAME:?BACKEND_NAME is required (the backend name you registered in 'My Services')}"
LOCAL_URL="${LOCAL_URL:-http://localhost:8000}"

exec python /app/tunnel_client.py \
    --gateway "$GATEWAY_URL" \
    --token "$GATEWAY_TOKEN" \
    --backend-name "$BACKEND_NAME" \
    --local-url "$LOCAL_URL"
