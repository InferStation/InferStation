from __future__ import annotations

import time
from typing import Any

import httpx

BLOCKED_HEADERS = {
    "api-key",
    "authorization",
    "connection",
    "content-length",
    "cookie",
    "host",
    "proxy-authorization",
    "set-cookie",
    "transfer-encoding",
    "x-api-key",
}


def sanitized_extra_headers(headers: dict[str, str]) -> dict[str, str]:
    blocked = sorted(name for name in headers if name.strip().lower() in BLOCKED_HEADERS)
    if blocked:
        raise ValueError(f"Forbidden extra headers: {blocked}")
    return headers


def auth_headers(auth_type: str, api_key: str | None) -> dict[str, str]:
    if not api_key or auth_type == "none":
        return {}
    if auth_type == "bearer":
        return {"Authorization": f"Bearer {api_key}"}
    if auth_type == "api-key-header":
        return {"api-key": api_key}
    raise ValueError(f"Unsupported auth type: {auth_type}")


async def probe_openai_endpoint(
    *,
    base_url: str,
    auth_type: str,
    api_key: str | None,
    extra_headers: dict[str, str],
    requested_model: str | None,
    timeout_seconds: float = 15,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    headers = {**auth_headers(auth_type, api_key), **sanitized_extra_headers(extra_headers)}
    models: list[str] = []
    models_error: str | None = None
    started = time.perf_counter()
    async with httpx.AsyncClient(
        headers=headers,
        timeout=timeout_seconds,
        follow_redirects=False,
        transport=transport,
    ) as client:
        try:
            response = await client.get(f"{base_url}/models")
            response.raise_for_status()
            payload = response.json()
            models = [str(item["id"]) for item in payload.get("data", []) if "id" in item]
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            models_error = type(exc).__name__

        model = requested_model or (models[0] if models else None)
        if not model:
            return {
                "status": "failed",
                "models": models,
                "capabilities": {"models_list": False, "chat_completions": False},
                "latency_ms": (time.perf_counter() - started) * 1000,
                "error_type": "response.model_unavailable",
                "error_message": "No model ID discovered; add a model manually or pass model_id",
            }

        payload = {
            "model": model,
            "messages": [{"role": "user", "content": "Only answer OK"}],
            "temperature": 0,
            "max_tokens": 4,
            "stream": False,
        }
        try:
            response = await client.post(f"{base_url}/chat/completions", json=payload)
            response.raise_for_status()
            body = response.json()
            text = body["choices"][0]["message"]["content"]
            if not isinstance(text, str):
                raise ValueError("Response content is not a string")
            return {
                "status": "healthy",
                "models": models,
                "capabilities": {
                    "models_list": models_error is None,
                    "chat_completions": True,
                    "usage": isinstance(body.get("usage"), dict),
                    "stream": "unknown",
                    "seed": "unknown",
                    "logprobs": "unknown",
                    "response_format": "unknown",
                },
                "latency_ms": (time.perf_counter() - started) * 1000,
            }
        except httpx.TimeoutException:
            error_type = "transport.timeout"
            error_message = "Endpoint probe timed out"
        except httpx.ConnectError:
            error_type = "transport.connect"
            error_message = "Unable to connect to endpoint"
        except httpx.HTTPStatusError as exc:
            code = exc.response.status_code
            error_type = f"http.{code}" if code < 500 else "http.5xx"
            error_message = f"Endpoint returned HTTP {code}"
        except (ValueError, KeyError, IndexError):
            error_type = "response.schema_mismatch"
            error_message = "Endpoint returned an incompatible chat response"
        return {
            "status": "failed",
            "models": models,
            "capabilities": {
                "models_list": models_error is None,
                "chat_completions": False,
            },
            "latency_ms": (time.perf_counter() - started) * 1000,
            "error_type": error_type,
            "error_message": error_message,
        }
