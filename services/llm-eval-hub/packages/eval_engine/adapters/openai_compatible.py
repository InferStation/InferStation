from __future__ import annotations

import asyncio
import random
import time
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any

import httpx

from packages.eval_engine.contracts import AttemptTrace, InferenceResult, ModelRequest


def _http_error_type(status_code: int) -> str:
    if status_code in {401, 403, 404, 429}:
        return f"http.{status_code}"
    if status_code >= 500:
        return "http.5xx"
    return "http.other"


def _retry_after_seconds(response: httpx.Response) -> float | None:
    value = response.headers.get("retry-after")
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(value)
            return max(0.0, (retry_at - datetime.now(UTC)).total_seconds())
        except (TypeError, ValueError):
            return None


class OpenAICompatibleAdapter:
    def __init__(
        self,
        *,
        base_url: str,
        headers: dict[str, str] | None = None,
        timeout_seconds: float = 60,
        max_retries: int = 2,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.headers = headers or {}
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self.transport = transport
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> OpenAICompatibleAdapter:
        self._client = httpx.AsyncClient(
            headers=self.headers,
            timeout=self.timeout_seconds,
            follow_redirects=False,
            transport=self.transport,
        )
        return self

    async def __aexit__(self, *_: object) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    def _payload(self, request: ModelRequest) -> tuple[str, dict[str, Any]]:
        payload: dict[str, Any] = {"model": request.model, **dict(request.params)}
        if request.mode == "chat_completions":
            payload["messages"] = request.messages
            path = "/chat/completions"
        elif request.mode == "completions":
            payload["prompt"] = request.prompt
            path = "/completions"
        else:
            raise ValueError(f"Unsupported request mode: {request.mode}")
        payload["stream"] = False
        return path, payload

    async def infer(self, request: ModelRequest) -> InferenceResult:
        owns_client = self._client is None
        if owns_client:
            await self.__aenter__()
        assert self._client is not None
        path, payload = self._payload(request)
        traces: list[AttemptTrace] = []
        overall_started = time.perf_counter()
        final_status: int | None = None
        final_error: str | None = None
        final_message: str | None = None
        response_body: dict[str, Any] | None = None
        output_text: str | None = None
        prompt_tokens: int | None = None
        completion_tokens: int | None = None
        try:
            for attempt_no in range(1, self.max_retries + 2):
                attempt_started_at = datetime.now(UTC)
                attempt_started = time.perf_counter()
                response: httpx.Response | None = None
                error_type: str | None = None
                excerpt: str | None = None
                try:
                    response = await self._client.post(f"{self.base_url}{path}", json=payload)
                    final_status = response.status_code
                    if response.status_code >= 400:
                        error_type = _http_error_type(response.status_code)
                        excerpt = f"HTTP {response.status_code}"
                    else:
                        try:
                            parsed = response.json()
                        except ValueError:
                            error_type = "response.invalid_json"
                        else:
                            if not isinstance(parsed, dict):
                                error_type = "response.schema_mismatch"
                            else:
                                response_body = parsed
                                try:
                                    if request.mode == "chat_completions":
                                        output_text = parsed["choices"][0]["message"]["content"]
                                    else:
                                        output_text = parsed["choices"][0]["text"]
                                    if not isinstance(output_text, str):
                                        raise TypeError
                                except (KeyError, IndexError, TypeError):
                                    error_type = "response.schema_mismatch"
                                if output_text is not None and not output_text.strip():
                                    error_type = "response.empty"
                                usage = parsed.get("usage", {})
                                if isinstance(usage, dict):
                                    prompt_tokens = usage.get("prompt_tokens")
                                    completion_tokens = usage.get("completion_tokens")
                except httpx.TimeoutException:
                    error_type = "transport.timeout"
                except httpx.ConnectError:
                    error_type = "transport.connect"
                except httpx.TransportError:
                    error_type = "transport.connect"

                duration_ms = (time.perf_counter() - attempt_started) * 1000
                traces.append(
                    AttemptTrace(
                        attempt_no=attempt_no,
                        started_at=attempt_started_at.isoformat(),
                        duration_ms=duration_ms,
                        http_status=response.status_code if response else None,
                        error_type=error_type,
                        response_excerpt_redacted=excerpt,
                    )
                )
                if error_type is None:
                    final_error = None
                    break
                final_error = error_type
                retryable = error_type in {
                    "transport.timeout",
                    "transport.connect",
                    "http.429",
                    "http.5xx",
                }
                if not retryable or attempt_no > self.max_retries:
                    break
                retry_after = _retry_after_seconds(response) if response is not None else None
                delay = (
                    retry_after
                    if retry_after is not None
                    else min(8.0, 0.25 * (2 ** (attempt_no - 1)))
                )
                await asyncio.sleep(delay + random.uniform(0, delay * 0.1))

            if final_error:
                final_message = {
                    "transport.timeout": "Model request timed out",
                    "transport.connect": "Unable to connect to model endpoint",
                    "response.invalid_json": "Model endpoint returned invalid JSON",
                    "response.schema_mismatch": "Model endpoint returned an incompatible response",
                    "response.empty": "Model endpoint returned an empty answer",
                }.get(final_error, f"Model endpoint request failed ({final_error})")
            return InferenceResult(
                request_id=request.request_id,
                raw_response=response_body,
                output_text=output_text,
                latency_ms=(time.perf_counter() - overall_started) * 1000,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                error_type=final_error,
                error_message_redacted=final_message,
                http_status=final_status,
                attempts=len(traces),
                attempt_traces=tuple(traces),
            )
        finally:
            if owns_client:
                await self.__aexit__()
