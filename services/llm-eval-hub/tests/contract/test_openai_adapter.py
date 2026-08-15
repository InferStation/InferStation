import httpx
import pytest

from packages.eval_engine.adapters import OpenAICompatibleAdapter
from packages.eval_engine.contracts import ModelRequest
from tests.fixtures.mock_openai import app


def request(content: str) -> ModelRequest:
    return ModelRequest(
        request_id="r1",
        model="mock-intent-v1",
        mode="chat_completions",
        messages=[{"role": "user", "content": content}],
        prompt=None,
        params={"temperature": 0, "max_tokens": 8},
    )


@pytest.mark.asyncio
async def test_adapter_extracts_text_and_usage() -> None:
    transport = httpx.ASGITransport(app=app)
    adapter = OpenAICompatibleAdapter(base_url="http://test/v1", transport=transport, max_retries=0)

    result = await adapter.infer(request("如何申请退款？"))

    assert result.output_text == "billing"
    assert result.error_type is None
    assert result.prompt_tokens is not None
    assert len(result.attempt_traces) == 1


@pytest.mark.asyncio
async def test_adapter_classifies_and_retries_429() -> None:
    transport = httpx.ASGITransport(app=app)
    adapter = OpenAICompatibleAdapter(base_url="http://test/v1", transport=transport, max_retries=1)

    result = await adapter.infer(request("[http:429]"))

    assert result.error_type == "http.429"
    assert result.attempts == 2
    assert all(trace.error_type == "http.429" for trace in result.attempt_traces)


@pytest.mark.asyncio
async def test_adapter_keeps_invalid_json_separate_from_model_error() -> None:
    transport = httpx.ASGITransport(app=app)
    adapter = OpenAICompatibleAdapter(base_url="http://test/v1", transport=transport, max_retries=0)

    result = await adapter.infer(request("[invalid-json]"))

    assert result.error_type == "response.invalid_json"
    assert result.output_text is None


@pytest.mark.asyncio
async def test_mock_fail_first_is_deterministic_and_resettable() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post("/__control/reset")
    adapter = OpenAICompatibleAdapter(base_url="http://test/v1", transport=transport, max_retries=2)

    first = await adapter.infer(
        request("[sample-id:retry-case-1] [fail-first:2:429] 如何退款？")
    )
    second = await adapter.infer(
        request("[sample-id:retry-case-1] [fail-first:2:429] 如何退款？")
    )

    assert first.error_type is None
    assert first.output_text == "billing"
    assert first.attempts == 3
    assert [trace.http_status for trace in first.attempt_traces] == [429, 429, 200]
    assert second.attempts == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("marker", "error_type"),
    [
        ("[schema-mismatch]", "response.schema_mismatch"),
        ("[empty]", "response.empty"),
    ],
)
async def test_mock_response_faults_have_stable_error_types(
    marker: str, error_type: str
) -> None:
    transport = httpx.ASGITransport(app=app)
    adapter = OpenAICompatibleAdapter(base_url="http://test/v1", transport=transport, max_retries=0)

    result = await adapter.infer(request(marker))

    assert result.error_type == error_type


@pytest.mark.asyncio
async def test_mock_numeric_output_is_exact() -> None:
    transport = httpx.ASGITransport(app=app)
    adapter = OpenAICompatibleAdapter(base_url="http://test/v1", transport=transport, max_retries=0)

    result = await adapter.infer(request("[numeric-output:-12.495]"))

    assert result.error_type is None
    assert result.output_text == "-12.495"
