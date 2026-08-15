from __future__ import annotations

from typing import Any

from jinja2 import StrictUndefined
from jinja2.sandbox import SandboxedEnvironment

from packages.eval_engine.contracts import EvalSample, ModelRequest


class JinjaPromptRenderer:
    def __init__(self, request_spec: dict[str, Any], model: str):
        self.request_spec = request_spec
        self.model = model
        self.environment = SandboxedEnvironment(
            undefined=StrictUndefined,
            autoescape=False,
        )
        self.environment.globals.clear()

    def _render(self, template: str, values: dict[str, Any]) -> str:
        return self.environment.from_string(template).render(**values)

    def render(self, sample: EvalSample) -> ModelRequest:
        mode = self.request_spec["mode"]
        values = dict(sample.inputs)
        messages = None
        prompt = None
        if mode == "chat_completions":
            messages = [
                {**message, "content": self._render(message["content"], values)}
                for message in self.request_spec.get("messages") or []
            ]
            if not messages:
                raise ValueError("chat_completions request requires messages")
        elif mode == "completions":
            prompt_template = self.request_spec.get("prompt")
            if not prompt_template:
                raise ValueError("completions request requires prompt")
            prompt = self._render(prompt_template, values)
        else:
            raise ValueError(f"Unsupported request mode: {mode}")

        params = dict(self.request_spec.get("parameters", {}))
        if self.request_spec.get("stop"):
            params["stop"] = list(self.request_spec["stop"])
        return ModelRequest(
            request_id=sample.sample_id,
            model=self.model,
            mode=mode,
            messages=messages,
            prompt=prompt,
            params=params,
        )
