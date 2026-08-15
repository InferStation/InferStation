import secrets
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status

from apps.api.app.core.settings import Settings, get_settings


@dataclass(frozen=True)
class Actor:
    username: str
    role: str


def require_actor(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> Actor:
    api_key = request.headers.get("x-api-key")
    authorization = request.headers.get("authorization", "")
    if not api_key and authorization.lower().startswith("bearer "):
        api_key = authorization[7:]
    if not api_key or not secrets.compare_digest(api_key, settings.admin_api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Missing or invalid API key"},
        )
    return Actor(username="local-admin", role="admin")


ActorDependency = Depends(require_actor)
