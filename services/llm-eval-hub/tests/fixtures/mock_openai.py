from __future__ import annotations

import asyncio
import hashlib
import re
import time
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

app = FastAPI(title="Eval Hub Mock OpenAI")
_attempts_by_sample: dict[str, int] = {}
_request_log: list[dict[str, Any]] = []
_faults_enabled = True
_default_delay_ms = 0


class ChatRequest(BaseModel):
    model: str
    messages: list[dict[str, Any]]
    temperature: float = 0
    max_tokens: int = 32
    stream: bool = False
    seed: int | None = None
    stop: list[str] = Field(default_factory=list)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/__control/reset")
def reset() -> dict[str, int]:
    global _default_delay_ms, _faults_enabled
    cleared = len(_attempts_by_sample)
    _attempts_by_sample.clear()
    _request_log.clear()
    _faults_enabled = True
    _default_delay_ms = 0
    return {"cleared_samples": cleared}


@app.post("/__control/faults/{enabled}")
def faults(enabled: bool) -> dict[str, bool]:
    global _faults_enabled
    _faults_enabled = enabled
    return {"faults_enabled": _faults_enabled}


@app.post("/__control/delay/{delay_ms}")
def delay(delay_ms: int) -> dict[str, int]:
    global _default_delay_ms
    if delay_ms < 0 or delay_ms > 60_000:
        raise HTTPException(status_code=422, detail="delay_ms must be between 0 and 60000")
    _default_delay_ms = delay_ms
    return {"default_delay_ms": _default_delay_ms}


@app.get("/__control/state")
def state() -> dict[str, Any]:
    return {
        "attempts_by_sample": dict(sorted(_attempts_by_sample.items())),
        "requests": list(_request_log),
        "faults_enabled": _faults_enabled,
        "default_delay_ms": _default_delay_ms,
    }


@app.get("/v1/models")
def models(request: Request) -> dict[str, Any]:
    if request.headers.get("authorization") == "Bearer reject-me":
        raise HTTPException(status_code=401, detail="invalid key")
    return {
        "object": "list",
        "data": [{"id": "mock-intent-v1", "object": "model", "owned_by": "evalhub"}],
    }


def _intent(text: str) -> str:
    billing = ["信用卡", "扣", "发票", "金额", "退款", "套餐", "续费", "价格"]
    technical = ["502", "超时", "页面", "空白", "接口", "上传", "错误"]
    account = ["邮箱", "账号", "团队成员", "两步验证", "登录"]
    if any(keyword in text for keyword in billing):
        return "billing"
    if any(keyword in text for keyword in technical):
        return "technical"
    if any(keyword in text for keyword in account):
        return "account"
    return "OK"


@app.post("/v1/chat/completions")
async def chat(payload: ChatRequest, request: Request):
    text = "\n".join(str(message.get("content", "")) for message in payload.messages)
    sample_match = re.search(r"\[sample-id:([A-Za-z0-9_-]+)\]", text)
    sample_id = sample_match.group(1) if sample_match else hashlib.sha256(text.encode()).hexdigest()
    attempt = _attempts_by_sample.get(sample_id, 0) + 1
    _attempts_by_sample[sample_id] = attempt
    authorization = request.headers.get("authorization")
    _request_log.append(
        {
            "sample_id": sample_id,
            "attempt": attempt,
            "monotonic_ns": time.monotonic_ns(),
            "authorization_sha256": (
                hashlib.sha256(authorization.encode("utf-8")).hexdigest()
                if authorization
                else None
            ),
        }
    )
    fail_first = re.search(r"\[fail-first:(\d+):(\d{3})\]", text) if _faults_enabled else None
    if fail_first and attempt <= int(fail_first.group(1)):
        status_code = int(fail_first.group(2))
        headers = {"Retry-After": "0.01"} if status_code == 429 else None
        raise HTTPException(status_code=status_code, detail="forced transient", headers=headers)
    if _faults_enabled and "[http:401]" in text:
        raise HTTPException(status_code=401, detail="forced")
    if _faults_enabled and "[http:429]" in text:
        raise HTTPException(status_code=429, detail="forced", headers={"Retry-After": "0.01"})
    if _faults_enabled and "[http:500]" in text:
        raise HTTPException(status_code=500, detail="forced")
    if _faults_enabled and "[invalid-json]" in text:
        return PlainTextResponse("not-json", media_type="application/json")
    if _faults_enabled and "[schema-mismatch]" in text:
        return {"id": "schema-fault", "choices": []}
    delay = re.search(r"\[delay:(\d+(?:\.\d+)?)\]", text) if _faults_enabled else None
    if delay:
        await asyncio.sleep(float(delay.group(1)))
    elif _default_delay_ms:
        await asyncio.sleep(_default_delay_ms / 1000)
    numeric_output = re.search(r"\[numeric-output:([^\]]+)\]", text)
    if _faults_enabled and "[empty]" in text:
        answer = ""
    elif _faults_enabled and "[parse-error]" in text:
        answer = "unsupported-label"
    elif numeric_output:
        answer = numeric_output.group(1)
    else:
        answer = _intent(text)
    prompt_tokens = max(1, len(text) // 4)
    return {
        "id": f"chatcmpl-{hashlib.sha256(f'{sample_id}:{attempt}'.encode()).hexdigest()[:24]}",
        "object": "chat.completion",
        "created": 0,
        "model": payload.model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": answer},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": 1,
            "total_tokens": prompt_tokens + 1,
        },
    }
