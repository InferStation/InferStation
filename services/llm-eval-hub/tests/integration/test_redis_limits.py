from __future__ import annotations

import asyncio
import os
import uuid

import pytest

from workers.scheduling import RedisEndpointLimiter


def _limiter(
    redis_url: str,
    namespace: str,
    *,
    endpoint: str = "shared-revision",
    qps: float = 20,
    concurrency: int = 2,
    lease_seconds: float = 1,
) -> RedisEndpointLimiter:
    return RedisEndpointLimiter(
        redis_url=redis_url,
        endpoint_revision_id=endpoint,
        qps=qps,
        concurrency_limit=concurrency,
        lease_seconds=lease_seconds,
        namespace=namespace,
    )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_qps_slots_are_shared_across_limiter_instances() -> None:
    redis_url = os.getenv("EVALHUB_TEST_REDIS_URL")
    if not redis_url:
        pytest.skip("EVALHUB_TEST_REDIS_URL is required")
    namespace = f"evalhub-test-{uuid.uuid4().hex}"
    left = _limiter(redis_url, namespace, qps=20)
    right = _limiter(redis_url, namespace, qps=20)
    timestamps: list[float] = []

    async def reserve(limiter: RedisEndpointLimiter) -> None:
        for _ in range(5):
            await limiter.wait_for_qps_slot()
            timestamps.append(asyncio.get_running_loop().time())

    async with left, right:
        await asyncio.gather(reserve(left), reserve(right))

    ordered = sorted(timestamps)
    gaps = [
        later - earlier for earlier, later in zip(ordered[:-1], ordered[1:], strict=True)
    ]
    assert len(ordered) == 10
    assert min(gaps) >= 0.045


@pytest.mark.integration
@pytest.mark.asyncio
async def test_concurrency_leases_are_shared_and_released() -> None:
    redis_url = os.getenv("EVALHUB_TEST_REDIS_URL")
    if not redis_url:
        pytest.skip("EVALHUB_TEST_REDIS_URL is required")
    namespace = f"evalhub-test-{uuid.uuid4().hex}"
    left = _limiter(redis_url, namespace, qps=10000, concurrency=2)
    right = _limiter(redis_url, namespace, qps=10000, concurrency=2)
    active = 0
    maximum_active = 0
    lock = asyncio.Lock()

    async def request(limiter: RedisEndpointLimiter) -> None:
        nonlocal active, maximum_active
        async with limiter.request_slot():
            async with lock:
                active += 1
                maximum_active = max(maximum_active, active)
            await asyncio.sleep(0.03)
            async with lock:
                active -= 1

    started = asyncio.get_running_loop().time()
    async with left, right:
        await asyncio.gather(
            *[request(left if index % 2 else right) for index in range(8)]
        )
    elapsed = asyncio.get_running_loop().time() - started

    assert maximum_active == 2
    assert active == 0
    assert elapsed < 0.5


@pytest.mark.integration
@pytest.mark.asyncio
async def test_abandoned_concurrency_lease_expires() -> None:
    redis_url = os.getenv("EVALHUB_TEST_REDIS_URL")
    if not redis_url:
        pytest.skip("EVALHUB_TEST_REDIS_URL is required")
    namespace = f"evalhub-test-{uuid.uuid4().hex}"
    holder = _limiter(redis_url, namespace, concurrency=1, lease_seconds=0.08)
    waiter = _limiter(redis_url, namespace, concurrency=1, lease_seconds=0.08)

    async with holder, waiter:
        await holder.acquire_concurrency()
        started = asyncio.get_running_loop().time()
        recovered_token = await waiter.acquire_concurrency()
        elapsed = asyncio.get_running_loop().time() - started
        await waiter.release_concurrency(recovered_token)

    assert elapsed >= 0.07
