"""WebSocket tunnel management for NAT-behind backends."""
import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field

from fastapi import WebSocket

logger = logging.getLogger("gateway.tunnel")


@dataclass
class TunnelConnection:
    ws: WebSocket
    backend_id: int
    backend_name: str
    models: list[str]
    pending: dict[str, asyncio.Future] = field(default_factory=dict)


class TunnelManager:
    def __init__(self):
        self._tunnels: dict[int, TunnelConnection] = {}  # backend_id -> conn

    def is_connected(self, backend_id: int) -> bool:
        return backend_id in self._tunnels

    async def health_probe(self, backend_id: int, timeout: float = 10) -> bool:
        """Send a health check through the tunnel and verify the backend is alive."""
        conn = self._tunnels.get(backend_id)
        if not conn:
            logger.debug(f"Health probe: no tunnel for backend {backend_id}")
            return False
        req_id = str(uuid.uuid4())
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        conn.pending[req_id] = fut
        try:
            await conn.ws.send_json({"id": req_id, "type": "health_check"})
            result = await asyncio.wait_for(fut, timeout=timeout)
            status = result.get("status")
            logger.info(f"Health probe: {conn.backend_name} (id={backend_id}) -> status={status}")
            return status == 200
        except Exception as e:
            logger.warning(f"Health probe failed: {conn.backend_name} (id={backend_id}): {e}")
            return False
        finally:
            conn.pending.pop(req_id, None)

    def register(self, backend_id: int, conn: TunnelConnection):
        self._tunnels[backend_id] = conn
        logger.info(f"Tunnel connected: {conn.backend_name} (id={backend_id})")

    def unregister(self, backend_id: int):
        conn = self._tunnels.pop(backend_id, None)
        if conn:
            for fut in conn.pending.values():
                if not fut.done():
                    fut.set_exception(ConnectionError("Tunnel disconnected"))
            logger.info(f"Tunnel disconnected: {conn.backend_name} (id={backend_id})")

    async def forward_request(self, backend_id: int, request_data: dict, timeout: float = 120,
                               path: str = "/v1/chat/completions") -> dict:
        conn = self._tunnels.get(backend_id)
        if not conn:
            raise ConnectionError(f"No tunnel for backend {backend_id}")

        req_id = str(uuid.uuid4())
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        conn.pending[req_id] = fut

        try:
            await conn.ws.send_json({"id": req_id, "type": "request", "path": path, "data": request_data})
            return await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            raise TimeoutError(f"Tunnel request timed out ({timeout}s)")
        finally:
            conn.pending.pop(req_id, None)

    async def forward_stream(self, backend_id: int, request_data: dict, timeout: float = 120,
                              path: str = "/v1/chat/completions"):
        conn = self._tunnels.get(backend_id)
        if not conn:
            raise ConnectionError(f"No tunnel for backend {backend_id}")

        req_id = str(uuid.uuid4())
        queue: asyncio.Queue = asyncio.Queue()
        conn.pending[req_id] = queue  # type: ignore

        try:
            await conn.ws.send_json({"id": req_id, "type": "stream_request", "path": path, "data": request_data})
            while True:
                chunk = await asyncio.wait_for(queue.get(), timeout=timeout)
                if chunk is None:  # stream end
                    break
                yield chunk
        except asyncio.TimeoutError:
            raise TimeoutError(f"Tunnel stream timed out ({timeout}s)")
        finally:
            conn.pending.pop(req_id, None)

    def resolve_response(self, backend_id: int, req_id: str, data: dict):
        conn = self._tunnels.get(backend_id)
        if not conn:
            return
        fut = conn.pending.get(req_id)
        if fut and isinstance(fut, asyncio.Future) and not fut.done():
            fut.set_result(data)

    def push_stream_chunk(self, backend_id: int, req_id: str, chunk: dict | None):
        conn = self._tunnels.get(backend_id)
        if not conn:
            return
        q = conn.pending.get(req_id)
        if q and isinstance(q, asyncio.Queue):
            q.put_nowait(chunk)


tunnel_manager = TunnelManager()
