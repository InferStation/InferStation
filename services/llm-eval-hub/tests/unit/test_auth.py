from fastapi import HTTPException
from starlette.requests import Request

from apps.api.app.core.auth import require_actor
from apps.api.app.core.settings import Settings


def request_with_api_key(api_key: str | None = None) -> Request:
    headers = [] if api_key is None else [(b"x-api-key", api_key.encode())]
    return Request({"type": "http", "headers": headers})


def test_internal_deployment_can_disable_admin_api_key() -> None:
    actor = require_actor(
        request_with_api_key(),
        Settings(require_admin_api_key=False),
    )

    assert actor.username == "internal-operator"
    assert actor.role == "admin"


def test_admin_api_key_remains_required_by_default() -> None:
    try:
        require_actor(request_with_api_key(), Settings(admin_api_key="expected-key"))
    except HTTPException as error:
        assert error.status_code == 401
    else:
        raise AssertionError("missing API key should be rejected")


def test_admin_api_key_is_accepted_when_required() -> None:
    actor = require_actor(
        request_with_api_key("expected-key"),
        Settings(admin_api_key="expected-key"),
    )

    assert actor.username == "local-admin"
