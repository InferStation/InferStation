from __future__ import annotations

import asyncio
import hashlib
import math
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from types import TracebackType

import redis.asyncio as redis

_QPS_SLOT_SCRIPT = """
local timestamp = redis.call('TIME')
local now_us = (timestamp[1] * 1000000) + timestamp[2]
local next_us = tonumber(redis.call('GET', KEYS[1])) or now_us
if next_us > now_us then
  return next_us - now_us
end
local reserved_us = now_us + tonumber(ARGV[1])
local ttl_ms = math.ceil(tonumber(ARGV[1]) / 1000) + 1000
redis.call('SET', KEYS[1], reserved_us, 'PX', ttl_ms)
return 0
"""

_CONCURRENCY_ACQUIRE_SCRIPT = """
local timestamp = redis.call('TIME')
local now_ms = (timestamp[1] * 1000) + math.floor(timestamp[2] / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now_ms)
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[1]) then
  redis.call('ZADD', KEYS[1], now_ms + tonumber(ARGV[2]), ARGV[3])
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]) + 1000)
  return 0
end
local earliest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
return math.max(1, math.ceil(tonumber(earliest[2]) - now_ms))
"""

_CONCURRENCY_RELEASE_SCRIPT = """
return redis.call('ZREM', KEYS[1], ARGV[1])
"""


class RedisEndpointLimiter:
    def __init__(
        self,
        *,
        redis_url: str,
        endpoint_revision_id: str,
        qps: float,
        concurrency_limit: int,
        lease_seconds: float,
        run_id: str | None = None,
        run_concurrency_limit: int | None = None,
        namespace: str = "evalhub",
    ) -> None:
        if qps <= 0:
            raise ValueError("qps must be positive")
        if concurrency_limit <= 0:
            raise ValueError("concurrency_limit must be positive")
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        endpoint_key = hashlib.sha256(endpoint_revision_id.encode()).hexdigest()[:32]
        self._qps_key = f"{namespace}:endpoint:{endpoint_key}:qps-next"
        self._concurrency_key = f"{namespace}:endpoint:{endpoint_key}:leases"
        run_key = hashlib.sha256((run_id or "").encode()).hexdigest()[:32]
        self._run_concurrency_key = (
            f"{namespace}:run:{run_key}:leases" if run_id is not None else None
        )
        self._interval_us = math.ceil(1_000_000 / qps)
        self._concurrency_limit = concurrency_limit
        self._run_concurrency_limit = run_concurrency_limit
        if run_id is not None and (run_concurrency_limit is None or run_concurrency_limit <= 0):
            raise ValueError("run_concurrency_limit must be positive when run_id is set")
        self._lease_ms = math.ceil(lease_seconds * 1000)
        self._redis = redis.Redis.from_url(redis_url, decode_responses=True)
        self._qps_script = self._redis.register_script(_QPS_SLOT_SCRIPT)
        self._acquire_script = self._redis.register_script(_CONCURRENCY_ACQUIRE_SCRIPT)
        self._release_script = self._redis.register_script(_CONCURRENCY_RELEASE_SCRIPT)

    async def __aenter__(self) -> RedisEndpointLimiter:
        await self._redis.ping()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc, traceback
        await self.close()

    async def close(self) -> None:
        await self._redis.aclose()

    async def wait_for_qps_slot(self) -> None:
        while True:
            delay_us = int(
                await self._qps_script(keys=[self._qps_key], args=[self._interval_us])
            )
            if delay_us == 0:
                return
            await asyncio.sleep(delay_us / 1_000_000)

    async def _acquire_semaphore(self, key: str, limit: int) -> str:
        token = uuid.uuid4().hex
        while True:
            delay_ms = int(
                await self._acquire_script(
                    keys=[key],
                    args=[limit, self._lease_ms, token],
                )
            )
            if delay_ms == 0:
                return token
            # A holder can release before its lease expires, so poll with a short cap.
            await asyncio.sleep(min(delay_ms, 20) / 1000)

    async def _release_semaphore(self, key: str, token: str) -> None:
        await self._release_script(keys=[key], args=[token])

    async def acquire_concurrency(self) -> str:
        return await self._acquire_semaphore(
            self._concurrency_key, self._concurrency_limit
        )

    async def release_concurrency(self, token: str) -> None:
        await self._release_semaphore(self._concurrency_key, token)

    @asynccontextmanager
    async def request_slot(self) -> AsyncIterator[None]:
        endpoint_token = await self.acquire_concurrency()
        run_token: str | None = None
        try:
            if self._run_concurrency_key is not None:
                assert self._run_concurrency_limit is not None
                run_token = await self._acquire_semaphore(
                    self._run_concurrency_key, self._run_concurrency_limit
                )
            await self.wait_for_qps_slot()
            yield
        finally:
            if run_token is not None and self._run_concurrency_key is not None:
                await self._release_semaphore(self._run_concurrency_key, run_token)
            await self.release_concurrency(endpoint_token)
