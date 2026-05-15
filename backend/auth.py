"""Authentication and authorization."""
import hashlib
import secrets
import time
from collections import deque
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from database import get_db

security = HTTPBearer(auto_error=False)

# Set from config at startup
JWT_SECRET = ""
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 1440

# Per-API-key sliding-window rate limit for the OpenAI-compatible proxy.
# Token bucket would be marginally more permissive on bursty workloads but
# this sliding window is simpler and bound to a small fixed memory footprint.
API_KEY_RATE_LIMIT_PER_MIN = 60
_api_key_hits: dict[str, deque] = {}


def check_api_key_rate_limit(key_hash: str, limit_per_min: int = API_KEY_RATE_LIMIT_PER_MIN) -> None:
    """Raise HTTP 429 when this key exceeds `limit_per_min` requests in 60s.

    In-memory, per-process. Good enough for our single-replica gateway; if we
    ever scale out we'll move this to Redis.
    """
    now = time.monotonic()
    bucket = _api_key_hits.get(key_hash)
    if bucket is None:
        bucket = deque()
        _api_key_hits[key_hash] = bucket
    while bucket and now - bucket[0] >= 60.0:
        bucket.popleft()
    if len(bucket) >= limit_per_min:
        retry_after = max(1, int(60.0 - (now - bucket[0])))
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded: {limit_per_min}/min for this API key. Retry in {retry_after}s.",
            headers={"Retry-After": str(retry_after)},
        )
    bucket.append(now)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(user_id: int, role: str, *, token_version: int = 0, expires_minutes: int | None = None) -> str:
    minutes = expires_minutes if expires_minutes is not None else JWT_EXPIRE_MINUTES
    expire = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    payload = {"sub": str(user_id), "role": role, "tv": int(token_version or 0), "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def generate_api_key() -> tuple[str, str, str]:
    """Returns (raw_key, key_hash, key_prefix)."""
    raw = "sk-" + secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(raw.encode()).hexdigest()
    prefix = raw[:8]
    return raw, key_hash, prefix


async def get_current_user(creds: HTTPAuthorizationCredentials = Depends(security)):
    if not creds:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
        token_tv = int(payload.get("tv", 0))
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token")

    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM users WHERE id = ? AND is_active = 1", (user_id,))
        user = await cur.fetchone()
    finally:
        await db.close()

    if not user:
        raise HTTPException(status_code=401, detail="User not found or disabled")
    user = dict(user)
    # Reject tokens that pre-date a password change / forced logout. Existing
    # tokens issued before the migration carry no `tv` claim (defaults to 0)
    # and remain valid until the user.token_version is bumped past 0.
    if int(user.get("token_version") or 0) != token_tv:
        raise HTTPException(status_code=401, detail="Token revoked, please sign in again")
    return user


async def bump_token_version(user_id: int) -> None:
    """Force-invalidate every currently issued JWT for this user."""
    db = await get_db()
    try:
        await db.execute(
            "UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?",
            (user_id,),
        )
        await db.commit()
    finally:
        await db.close()


async def require_admin(user=Depends(get_current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def require_provider(user=Depends(get_current_user)):
    if user["role"] not in ("provider", "both", "admin"):
        raise HTTPException(status_code=403, detail="Provider access required")
    return user


async def get_optional_user(creds: HTTPAuthorizationCredentials = Depends(security)):
    """Like get_current_user but returns None when no/invalid token."""
    if not creds:
        return None
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
        token_tv = int(payload.get("tv", 0))
    except (JWTError, KeyError, ValueError):
        return None
    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM users WHERE id = ? AND is_active = 1", (user_id,))
        user = await cur.fetchone()
    finally:
        await db.close()
    if not user:
        return None
    user = dict(user)
    if int(user.get("token_version") or 0) != token_tv:
        return None
    return user
