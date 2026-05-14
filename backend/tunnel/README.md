# InferStation / Tianshu tunnel client

A tiny Python WebSocket client that lets a private-network GPU serve traffic
through the public gateway — no port forwarding, no public IP, no inbound
firewall rules. One outbound WebSocket connection is all it needs.

## Quick start (Docker)

```bash
docker run -d --restart=always --network=host \
    --name tianshu-tunnel \
    -e GATEWAY_URL=wss://tianshu-gateway.cloud/ws/tunnel \
    -e GATEWAY_TOKEN=sk-...your-provider-key... \
    -e BACKEND_NAME=my-mi300x-server \
    -e LOCAL_URL=http://localhost:8000 \
    ghcr.io/joursbleu/inferstation-tunnel:latest
```

- `--network=host` lets the container reach a vLLM / SGLang server bound to
  `127.0.0.1` on the docker host. On macOS / Windows drop `--network=host`
  and set `LOCAL_URL=http://host.docker.internal:8000` instead.
- `GATEWAY_TOKEN` is one of your API keys (any active key works; create a
  dedicated one under **Dashboard → API Keys** if you want easy rotation).
- `BACKEND_NAME` must match the name you registered under **My Services**.

## Build from source

```bash
cd backend/
docker build -f tunnel/Dockerfile -t inferstation/tunnel-client:latest .
```

The Dockerfile copies `tunnel_client.py` from the build context (i.e. the
`backend/` directory), so always run `docker build` from `backend/`, not
from `backend/tunnel/`.

## Run natively (no Docker)

```bash
pip install "websockets>=12" "httpx>=0.27"
python tunnel_client.py \
    --gateway wss://tianshu-gateway.cloud/ws/tunnel \
    --token sk-... \
    --backend-name my-mi300x-server \
    --local-url http://localhost:8000
```

CLI flags and env-vars are equivalent — flags take precedence:

| Flag             | Env var          | Default                   |
| ---------------- | ---------------- | ------------------------- |
| `--gateway`      | `GATEWAY_URL`    | _required_                |
| `--token`        | `GATEWAY_TOKEN`  | _required_                |
| `--backend-name` | `BACKEND_NAME`   | _required_                |
| `--local-url`    | `LOCAL_URL`      | `http://localhost:8000`   |

## What it does

1. Opens an authenticated WebSocket to the gateway with your token.
2. Subscribes itself as `BACKEND_NAME` so the gateway can route traffic to it.
3. Receives request frames, forwards them to the local OpenAI-compatible
   server, streams the response back.
4. Reconnects with exponential backoff on any failure (1s → 2 → 4 → 8 → 16 →
   32 → capped 60s). On a successful authenticated session the backoff
   resets to 1s.

There is no inbound port; the tunnel **never** initiates a connection back
into your network — only the local upstream URL is dialed, and only when a
gateway request arrives.

## Troubleshooting

- **`Connection refused` on the gateway-side health probe**: your `LOCAL_URL`
  is wrong, or the local vLLM/SGLang server is not running. Check
  `curl $LOCAL_URL/v1/models` from inside the container.
- **Status reverts to `offline` after 30s**: the tunnel is connected but
  the local server is failing health checks. The gateway probes
  `/v1/models` over the tunnel every 30s; that endpoint must return HTTP 200.
- **Constant reconnect loop**: usually a wrong token or a stale backend
  name. Recreate the API key and verify the name under My Services.
