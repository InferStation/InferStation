import json

import httpx
import pytest

from apps.api.app.services.endpoints import probe_openai_endpoint


@pytest.mark.asyncio
async def test_probe_uses_manual_model_when_models_route_is_unavailable() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/models":
            return httpx.Response(404, json={"detail": "Not Found"})
        assert request.url.path == "/v1/chat/completions"
        assert json.loads(request.content)["model"] == "minicpm-v"
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
    assert result["models"] == []
    assert result["capabilities"]["models_list"] is False
    assert result["capabilities"]["chat_completions"] is True
