FROM python:3.12-slim

# Tunnel client for InferStation / Tianshu gateway.
# Exposes private-network GPUs to the public gateway over a single
# outbound WebSocket — no port-forwarding or public IP required.
#
# Build (from the backend/ directory):
#   docker build -f tunnel/Dockerfile -t inferstation/tunnel-client:latest .
# Run:     docker run -d --restart=always --network=host \
#            -e GATEWAY_URL=wss://tianshu-gateway.cloud/ws/tunnel \
#            -e PROVIDER_TOKEN=sk-... \
#            -e BACKEND_NAME=my-gpu-server \
#            -e LOCAL_URL=http://localhost:8000 \
#            inferstation/tunnel-client:latest
#
# Note: --network=host lets the container reach a vLLM/SGLang server
# listening on the docker host's 127.0.0.1. On macOS / Windows use
# host.docker.internal in LOCAL_URL instead and drop --network=host.

LABEL org.opencontainers.image.title="InferStation tunnel client" \
      org.opencontainers.image.source="https://github.com/JoursBleu/InferStation" \
      org.opencontainers.image.licenses="MIT"

RUN pip install --no-cache-dir --root-user-action=ignore \
        "websockets>=12.0,<14" "httpx>=0.27,<1.0"

WORKDIR /app
COPY tunnel_client.py /app/tunnel_client.py
COPY tunnel_entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Sensible defaults — override via -e
ENV LOCAL_URL=http://localhost:8000

ENTRYPOINT ["/app/entrypoint.sh"]
