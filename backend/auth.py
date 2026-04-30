"""Authentication and authorization."""
import hashlib
import secrets
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


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(user_id: int, role: str, expires_minutes: int | None = None) -> str:
    minutes = expires_minutes if expires_minutes is not None else JWT_EXPIRE_MINUTES
    expire = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    payload = {"sub": str(user_id), "role": role, "exp": expire}
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
    return dict(user)


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
    except (JWTError, KeyError, ValueError):
        return None
    db = await get_db()
    try:
        cur = await db.execute("SELECT * FROM users WHERE id = ? AND is_active = 1", (user_id,))
        user = await cur.fetchone()
    finally:
        await db.close()
    return dict(user) if user else None
