import json

import httpx
import pytest

from apps.api.app.services.endpoints import probe_openai_endpoint


@pytest.mark.asyncio
async def test_probe_calls_only_the_supplied_chat_model() -> None:
    requested_paths: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requested_paths.append(request.url.path)
        assert request.url.path == "/v1/chat/completions"
        assert json.loads(request.content) == {
            "model": "minicpm-v",
            "messages": [{"role": "user", "content": "Only answer OK"}],
        }
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "OK"}}],
                "usage": {"prompt_tokens": 3, "completion_tokens": 1},
            },
        )

    result = await probe_openai_endpoint(
        base_url="https://provider.example/v1",
        auth_type="bearer",
        api_key="test-secret",
        extra_headers={},
        requested_model="minicpm-v",
        transport=httpx.MockTransport(handler),
    )

    assert result["status"] == "healthy"
    assert requested_paths == ["/v1/chat/completions"]
    assert result["models"] == ["minicpm-v"]
    assert result["capabilities"]["models_list"] is False
    assert result["capabilities"]["chat_completions"] is True
    assert result["capabilities"]["probed_model"] == "minicpm-v"


@pytest.mark.asyncio
async def test_probe_rejects_a_missing_target_model_without_network_access() -> None:
    async def handler(_: httpx.Request) -> httpx.Response:
        raise AssertionError("A model-less probe must not make a network request")

    result = await probe_openai_endpoint(
        base_url="https://provider.example/v1",
        auth_type="none",
        api_key=None,
        extra_headers={},
        requested_model=None,
        transport=httpx.MockTransport(handler),
    )

    assert result["status"] == "failed"
    assert result["models"] == []
    assert result["error_type"] == "request.model_required"
