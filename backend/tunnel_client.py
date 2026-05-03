#!/usr/bin/env python3
"""LLM Gateway Provider Client.

Connects to the gateway via WebSocket tunnel, allowing NAT-behind backends
to serve models through the gateway.

Usage:
    python tunnel_client.py --gateway wss://gateway.example.com/ws/tunnel \
                     --token sk-xxxxx \
                     --backend-name my-gpu-server \
                     --local-url http://localhost:8000
"""
import argparse
import asyncio
import json
import logging
import signal
import sys

import httpx

try:
    import websockets
except ImportError:
    print("pip install websockets httpx")
    sys.exit(1)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [client] %(levelname)s %(message)s")
logger = logging.getLogger("client")


# Long-running inference: reasonable connect/write/pool timeouts but NO read timeout,
# otherwise httpx will kill the request 120s after the last byte regardless of actual progress.
_LOCAL_TIMEOUT = httpx.Timeout(connect=15.0, write=30.0, pool=30.0, read=None)


async def forward_to_local(local_url: str, request_data: dict,
                            path: str = "/v1/chat/completions") -> dict:
    """Forward a non-streaming request to the local vLLM/OpenAI-compatible server."""
    url = f"{local_url.rstrip('/')}{path}"
    async with httpx.AsyncClient(timeout=_LOCAL_TIMEOUT) as client:
        resp = await client.post(url, json=request_data)
        return resp.json()


async def health_check_local(local_url: str) -> int:
    """Check if local vLLM server is alive by hitting /v1/models."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{local_url.rstrip('/')}/v1/models")
            return resp.status_code
    except Exception:
        return 0


async def run_tunnel(gateway_ws_url: str, token: str, backend_name: str, local_url: str):
    """Main tunnel loop with auto-reconnect.

    Reconnect policy: exponential backoff (1s -> 2 -> 4 -> 8 -> 16 -> 32 -> capped at 60s),
    reset to 1s after a successful authenticated session. NEVER gives up.

    Liveness: websockets pings every PING_INTERVAL s and expects a pong within
    PING_TIMEOUT s. On top of that, an application-level read watchdog forces a
    reconnect if no frame at all arrives for READ_IDLE_TIMEOUT s. This catches
    the rare case where Cloudflare / NAT silently drops the TCP connection and
    the websockets library doesn't surface the failure.
    """
    PING_INTERVAL = 20
    PING_TIMEOUT = 20
    READ_IDLE_TIMEOUT = 300.0

    backoff = 1.0
    max_backoff = 60.0
    attempt = 0
    while True:
        attempt += 1
        try:
            logger.info(f"[attempt {attempt}] Connecting to {gateway_ws_url} ...")
            async with websockets.connect(
                gateway_ws_url,
                ping_interval=PING_INTERVAL,
                ping_timeout=PING_TIMEOUT,
                close_timeout=5,
                max_size=None,
            ) as ws:
                # Send auth
                await ws.send(json.dumps({"token": token, "backend_name": backend_name}))
                resp = json.loads(await ws.recv())
                if "error" in resp:
                    logger.error(f"Auth rejected: {resp['error']}. Will retry in {backoff:.0f}s.")
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, max_backoff)
                    continue
                logger.info(f"Connected! backend_id={resp.get('backend_id')}")
                backoff = 1.0

                # Handle requests with a read watchdog.
                while True:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=READ_IDLE_TIMEOUT)
                    except asyncio.TimeoutError:
                        logger.warning(
                            f"No frame received for {READ_IDLE_TIMEOUT:.0f}s; "
                            "assuming dead connection, forcing reconnect."
                        )
                        try:
                            await ws.close(code=1011, reason="read idle timeout")
                        except Exception:
                            pass
                        break

                    msg = json.loads(raw)
                    req_id = msg.get("id", "")
                    msg_type = msg.get("type", "")

                    if msg_type == "request":
                        asyncio.create_task(_handle_request(ws, req_id, local_url, msg["data"],
                                                             msg.get("path", "/v1/chat/completions")))
                    elif msg_type == "stream_request":
                        asyncio.create_task(_handle_stream(ws, req_id, local_url, msg["data"],
                                                            msg.get("path", "/v1/chat/completions")))
                    elif msg_type == "health_check":
                        asyncio.create_task(_handle_health_check(ws, req_id, local_url))

        except asyncio.CancelledError:
            logger.info("Tunnel loop cancelled, exiting.")
            raise
        except (websockets.ConnectionClosed, ConnectionError, OSError) as e:
            logger.warning(f"Disconnected: {type(e).__name__}: {e}. Reconnecting in {backoff:.0f}s...")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, max_backoff)
        except Exception as e:
            logger.exception(f"Unexpected error: {type(e).__name__}: {e}. Reconnecting in {backoff:.0f}s...")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, max_backoff)


async def _handle_request(ws, req_id: str, local_url: str, data: dict, path: str = "/v1/chat/completions"):
    try:
        result = await forward_to_local(local_url, data, path=path)
        await ws.send(json.dumps({"id": req_id, "type": "response", "data": result}))
    except Exception as e:
        logger.error(f"Request {req_id} failed: {e}")
        await ws.send(json.dumps({"id": req_id, "type": "response", "data": {"error": str(e)}}))


async def _handle_stream(ws, req_id: str, local_url: str, data: dict, path: str = "/v1/chat/completions"):
    """Stream chunks from local server to gateway as they arrive (no buffering)."""
    data["stream"] = True
    url = f"{local_url.rstrip('/')}{path}"
    try:
        async with httpx.AsyncClient(timeout=_LOCAL_TIMEOUT) as client:
            async with client.stream("POST", url, json=data) as resp:
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    chunk_str = line[6:]
                    if chunk_str.strip() == "[DONE]":
                        break
                    try:
                        chunk = json.loads(chunk_str)
                    except json.JSONDecodeError:
                        continue
                    await ws.send(json.dumps({"id": req_id, "type": "stream_chunk", "data": chunk}))
        await ws.send(json.dumps({"id": req_id, "type": "stream_end"}))
    except Exception as e:
        logger.error(f"Stream {req_id} failed: {e}")
        try:
            await ws.send(json.dumps({"id": req_id, "type": "stream_end"}))
        except Exception:
            pass


async def _handle_health_check(ws, req_id: str, local_url: str):
    status = await health_check_local(local_url)
    await ws.send(json.dumps({"id": req_id, "type": "response", "data": {"status": status}}))


def main():
    parser = argparse.ArgumentParser(description="LLM Gateway Provider Client")
    parser.add_argument("--gateway", required=True, help="Gateway WebSocket URL (ws://host:port/ws/tunnel)")
    parser.add_argument("--token", required=True, help="API key for authentication")
    parser.add_argument("--backend-name", required=True, help="Registered backend name")
    parser.add_argument("--local-url", default="http://localhost:8000", help="Local vLLM server URL")
    args = parser.parse_args()

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(run_tunnel(args.gateway, args.token, args.backend_name, args.local_url))
    except KeyboardInterrupt:
        logger.info("Shutting down...")


if __name__ == "__main__":
    main()
