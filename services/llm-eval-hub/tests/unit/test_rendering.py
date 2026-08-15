import pytest
from jinja2 import UndefinedError

from packages.eval_engine.contracts import EvalSample
from packages.eval_engine.rendering import JinjaPromptRenderer


def test_chat_renderer_freezes_rendered_messages() -> None:
    renderer = JinjaPromptRenderer(
        {
            "mode": "chat_completions",
            "messages": [{"role": "user", "content": "Classify: {{ question }}"}],
            "parameters": {"temperature": 0},
        },
        "mock-model",
    )

    request = renderer.render(EvalSample("s1", {"question": "refund"}, "billing"))

    assert request.messages == [{"role": "user", "content": "Classify: refund"}]
    assert request.params == {"temperature": 0}
    assert request.prompt is None


def test_renderer_rejects_undefined_fields() -> None:
    renderer = JinjaPromptRenderer(
        {"mode": "chat_completions", "messages": [{"role": "user", "content": "{{ missing }}"}]},
        "mock-model",
    )

    with pytest.raises(UndefinedError):
        renderer.render(EvalSample("s1", {"question": "refund"}, "billing"))
