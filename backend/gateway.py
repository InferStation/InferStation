"""LLM Gateway - Main Application."""
import asyncio
import hashlib
import json
import logging
import os
import secrets
import sys
import time
from contextlib import asynccontextmanager

import httpx
import yaml
from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from auth import (
    JWT_ALGORITHM,
    create_access_token,
    generate_api_key,
    get_current_user,
    hash_password,
    require_admin,
    require_provider,
    verify_password,
)
import auth
from database import get_db, init_db
from tunnel import TunnelConnection, tunnel_manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s %(message)s")
logger = logging.getLogger("gateway")

# ── Config ──────────────────────────────────────────────
CONFIG = {}


def load_config():
    global CONFIG
    path = os.environ.get("GATEWAY_CONFIG", "config.yaml")
    if os.path.exists(path):
        with open(path) as f:
            CONFIG = yaml.safe_load(f) or {}
    else:
        CONFIG = {}
    # Apply JWT config
    jwt_cfg = CONFIG.get("jwt", {})
    auth.JWT_SECRET = jwt_cfg.get("secret_key", os.environ.get("JWT_SECRET", "dev-secret-change-me"))
    auth.JWT_ALGORITHM = jwt_cfg.get("algorithm", "HS256")
    auth.JWT_EXPIRE_MINUTES = jwt_cfg.get("access_token_expire_minutes", 1440)


# ── Health Check Background Task ───────────────────────
async def health_check_loop():
    interval = CONFIG.get("health_check", {}).get("interval_seconds", 30)
    while True:
        await asyncio.sleep(interval)
        try:
            db = await get_db()
            try:
                cur = await db.execute("SELECT id, name, url, mode, client_info FROM backends")
                backends = [dict(r) for r in await cur.fetchall()]
            finally:
                await db.close()

            for b in backends:
                new_status = "offline"
                if b["mode"] == "tunnel":
                    if await tunnel_manager.health_probe(b["id"]):
                        new_status = "online"
                elif b["url"]:
                    try:
                        headers = {}
                        ci = json.loads(b["client_info"]) if b.get("client_info") else {}
                        if ci.get("api_key"):
                            headers["Authorization"] = f"Bearer {ci['api_key']}"
                        async with httpx.AsyncClient(timeout=10) as client:
                            resp = await client.get(f"{b['url'].rstrip('/')}/v1/models", headers=headers)
                            if resp.status_code == 200:
                                new_status = "online"
                    except Exception:
                        pass

                db2 = await get_db()
                try:
                    await db2.execute(
                        "UPDATE backends SET status = ?, updated_at = datetime('now') WHERE id = ?",
                        (new_status, b["id"]),
                    )
                    await db2.commit()
                finally:
                    await db2.close()
        except Exception as e:
            logger.error(f"Health check error: {e}")


# ── Lifespan ────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    load_config()
    await init_db()
    await ensure_admin()
    # Reset all tunnel backends to offline on startup (tunnels need to reconnect)
    db = await get_db()
    try:
        await db.execute("UPDATE backends SET status = 'offline' WHERE mode = 'tunnel'")
        await db.commit()
    finally:
        await db.close()
    task = asyncio.create_task(health_check_loop())
    logger.info("Gateway started")
    yield
    task.cancel()


async def ensure_admin():
    admin_cfg = CONFIG.get("admin", {})
    username = admin_cfg.get("username", "admin")
    password = admin_cfg.get("password", "admin123")
    email = admin_cfg.get("email", "admin@llm-gateway.local")

    db = await get_db()
    try:
        cur = await db.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
        if not await cur.fetchone():
            await db.execute(
                "INSERT INTO users (username, email, password_hash, role, balance) VALUES (?, ?, ?, 'admin', 999999)",
                (username, email, hash_password(password)),
            )
            await db.commit()
            logger.info(f"Admin user created: {username}")
    finally:
        await db.close()


# ── App ─────────────────────────────────────────────────
app = FastAPI(title="LLM Gateway", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ══════════════════════════════════════════════════════════
#  Auth Routes
# ══════════════════════════════════════════════════════════

class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str


class LoginRequest(BaseModel):
    login: str  # username or email
    password: str


@app.post("/api/auth/register")
async def register(req: RegisterRequest):
    if len(req.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    db = await get_db()
    try:
        cur = await db.execute("SELECT id FROM users WHERE username = ? OR email = ?", (req.username, req.email))
        if await cur.fetchone():
            raise HTTPException(400, "Username or email already exists")
        cur = await db.execute(
            "INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, 'consumer')",
            (req.username, req.email, hash_password(req.password)),
        )
        await db.commit()
        user_id = cur.lastrowid
    finally:
        await db.close()
    token = create_access_token(user_id, "consumer")
    return {"token": token, "user": {"id": user_id, "username": req.username, "role": "consumer"}}


@app.post("/api/auth/login")
async def login(req: LoginRequest):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT * FROM users WHERE (username = ? OR email = ?) AND is_active = 1",
            (req.login, req.login),
        )
        user = await cur.fetchone()
    finally:
        await db.close()
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "Invalid credentials")
    user = dict(user)
    token = create_access_token(user["id"], user["role"])
    return {
        "token": token,
        "user": {"id": user["id"], "username": user["username"], "role": user["role"], "balance": user["balance"]},
    }


@app.get("/api/auth/me")
async def me(user=Depends(get_current_user)):
    return {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"],
        "role": user["role"],
        "balance": user["balance"],
        "verified": user["verified"],
    }


# ══════════════════════════════════════════════════════════
#  User - Role upgrade
# ══════════════════════════════════════════════════════════

class UpgradeRequest(BaseModel):
    target_role: str  # "provider" or "both"


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


@app.post("/api/auth/change-password")
async def change_password(req: ChangePasswordRequest, user=Depends(get_current_user)):
    from auth import verify_password, hash_password

    db = await get_db()
    try:
        row = await db.execute("SELECT password_hash FROM users WHERE id = ?", (user["id"],))
        row = await row.fetchone()
        if not verify_password(req.old_password, row["password_hash"]):
            raise HTTPException(400, "原密码错误")
        if len(req.new_password) < 8:
            raise HTTPException(400, "新密码不能少于8位")
        new_hash = hash_password(req.new_password)
        await db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, user["id"]))
        await db.commit()
    finally:
        await db.close()
    return {"ok": True}


@app.post("/api/user/upgrade-role")
async def upgrade_role(req: UpgradeRequest, user=Depends(get_current_user)):
    if req.target_role not in ("provider", "both"):
        raise HTTPException(400, "target_role must be 'provider' or 'both'")
    if user["role"] == "admin":
        raise HTTPException(400, "Admin role cannot be changed")

    new_role = req.target_role
    if user["role"] == "consumer" and req.target_role == "provider":
        new_role = "provider"
    elif user["role"] == "consumer" and req.target_role == "both":
        new_role = "both"
    elif user["role"] == "provider" and req.target_role == "both":
        new_role = "both"
    else:
        new_role = req.target_role

    db = await get_db()
    try:
        await db.execute("UPDATE users SET role = ? WHERE id = ?", (new_role, user["id"]))
        await db.commit()
    finally:
        await db.close()
    return {"role": new_role}


# ══════════════════════════════════════════════════════════
#  API Key Management
# ══════════════════════════════════════════════════════════

class CreateKeyRequest(BaseModel):
    name: str = ""


@app.post("/api/keys")
async def create_key(req: CreateKeyRequest, user=Depends(get_current_user)):
    raw, key_hash, prefix = generate_api_key()
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO api_keys (user_id, key_hash, key_prefix, name) VALUES (?, ?, ?, ?)",
            (user["id"], key_hash, prefix, req.name),
        )
        await db.commit()
    finally:
        await db.close()
    return {"key": raw, "prefix": prefix, "name": req.name}


@app.get("/api/keys")
async def list_keys(user=Depends(get_current_user)):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, key_prefix, name, is_active, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
            (user["id"],),
        )
        keys = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    return keys


@app.put("/api/keys/{key_id}/toggle")
async def toggle_key(key_id: int, user=Depends(get_current_user)):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE api_keys SET is_active = 1 - is_active WHERE id = ? AND user_id = ?",
            (key_id, user["id"]),
        )
        await db.commit()
    finally:
        await db.close()
    return {"ok": True}


@app.delete("/api/keys/{key_id}")
async def delete_key(key_id: int, user=Depends(get_current_user)):
    db = await get_db()
    try:
        await db.execute(
            "DELETE FROM api_keys WHERE id = ? AND user_id = ?",
            (key_id, user["id"]),
        )
        await db.commit()
    finally:
        await db.close()
    return {"ok": True}


# ══════════════════════════════════════════════════════════
#  Backend Management (Provider)
# ══════════════════════════════════════════════════════════

class RegisterBackendRequest(BaseModel):
    name: str
    url: str | None = None
    mode: str = "direct"  # "direct" or "tunnel"
    models: list[str] = []
    tags: dict[str, str] = {}  # e.g. {"hardware": "MI300X", "framework": "vLLM"}
    input_price: float | None = None
    output_price: float | None = None
    is_public: bool = True
    client_info: dict = {}


ALLOWED_MODEL_FAMILIES = ["Qwen", "THUDM", "deepseek-ai"]


@app.get("/api/model-families")
async def get_model_families():
    return ALLOWED_MODEL_FAMILIES


@app.post("/api/backends")
async def register_backend(req: RegisterBackendRequest, user=Depends(require_provider)):
    if req.mode not in ("direct", "tunnel"):
        raise HTTPException(400, "mode must be 'direct' or 'tunnel'")
    if req.mode == "direct" and not req.url:
        raise HTTPException(400, "url required for direct mode")
    for m in req.models:
        family = m.split("/")[0] if "/" in m else m
        if family not in ALLOWED_MODEL_FAMILIES:
            raise HTTPException(400, f"模型 {m} 不在允许的大类中，当前支持: {', '.join(ALLOWED_MODEL_FAMILIES)}")

    db = await get_db()
    try:
        cur = await db.execute("SELECT id FROM backends WHERE name = ?", (req.name,))
        existing = await cur.fetchone()
        if existing:
            # Update
            await db.execute(
                """UPDATE backends SET url=?, mode=?, models=?, tags=?, input_price=?, output_price=?,
                   is_public=?, client_info=?, updated_at=datetime('now') WHERE name=? AND owner_id=?""",
                (
                    req.url, req.mode, json.dumps(req.models), json.dumps(req.tags), req.input_price, req.output_price,
                    1 if req.is_public else 0, json.dumps(req.client_info), req.name, user["id"],
                ),
            )
        else:
            await db.execute(
                """INSERT INTO backends (name, owner_id, url, mode, models, tags, input_price, output_price, is_public, client_info)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    req.name, user["id"], req.url, req.mode, json.dumps(req.models), json.dumps(req.tags),
                    req.input_price, req.output_price, 1 if req.is_public else 0, json.dumps(req.client_info),
                ),
            )
        await db.commit()
    finally:
        await db.close()
    return {"ok": True, "name": req.name}


@app.get("/api/backends")
async def list_backends(mine: bool = False, user=Depends(get_current_user)):
    db = await get_db()
    try:
        if mine:
            cur = await db.execute(
                "SELECT b.*, u.username as owner_name FROM backends b LEFT JOIN users u ON b.owner_id = u.id WHERE b.owner_id = ? ORDER BY b.name",
                (user["id"],),
            )
        elif user["role"] == "admin":
            cur = await db.execute(
                "SELECT b.*, u.username as owner_name FROM backends b LEFT JOIN users u ON b.owner_id = u.id ORDER BY b.name"
            )
        else:
            cur = await db.execute(
                """SELECT b.*, u.username as owner_name FROM backends b LEFT JOIN users u ON b.owner_id = u.id
                   WHERE b.is_public = 1 OR b.owner_id = ? ORDER BY b.name""",
                (user["id"],),
            )
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    for r in rows:
        r["models"] = json.loads(r["models"]) if r["models"] else []
        r["tags"] = json.loads(r["tags"]) if r.get("tags") else {}
        # Only show sensitive fields to the backend owner or admin
        if user["role"] == "admin" or r.get("owner_id") == user["id"]:
            r["client_info"] = json.loads(r["client_info"]) if r["client_info"] else {}
        else:
            r.pop("client_info", None)
            r.pop("url", None)
    return rows


@app.delete("/api/backends/{name}")
async def delete_backend(name: str, user=Depends(require_provider)):
    db = await get_db()
    try:
        if user["role"] == "admin":
            await db.execute("DELETE FROM backends WHERE name = ?", (name,))
        else:
            await db.execute("DELETE FROM backends WHERE name = ? AND owner_id = ?", (name, user["id"]))
        await db.commit()
    finally:
        await db.close()
    tunnel_manager.unregister_by_name(name) if hasattr(tunnel_manager, "unregister_by_name") else None
    return {"ok": True}


# ══════════════════════════════════════════════════════════
#  Model Market (public)
# ══════════════════════════════════════════════════════════

@app.get("/api/models")
async def list_models():
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT b.name as backend, b.models, b.tags, b.status, b.input_price, b.output_price, u.username as provider "
            "FROM backends b LEFT JOIN users u ON b.owner_id = u.id WHERE b.is_public = 1"
        )
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()

    models = []
    for r in rows:
        model_list = json.loads(r["models"]) if r["models"] else []
        for m in model_list:
            models.append({
                "id": m,
                "backend": r["backend"],
                "provider": r["provider"],
                "status": r["status"],
                "tags": json.loads(r["tags"]) if r.get("tags") else {},
                "input_price": r["input_price"],
                "output_price": r["output_price"],
            })
    return models


@app.get("/api/models/{model_id:path}")
async def get_model_detail(model_id: str):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT b.name as backend, b.models, b.tags, b.status, b.input_price, b.output_price, "
            "b.mode, b.created_at, b.updated_at, u.username as provider "
            "FROM backends b LEFT JOIN users u ON b.owner_id = u.id WHERE b.is_public = 1"
        )
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()

    for r in rows:
        model_list = json.loads(r["models"]) if r["models"] else []
        if model_id in model_list:
            return {
                "id": model_id,
                "backend": r["backend"],
                "provider": r["provider"],
                "status": r["status"],
                "mode": r["mode"],
                "tags": json.loads(r["tags"]) if r.get("tags") else {},
                "input_price": r["input_price"],
                "output_price": r["output_price"],
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
    raise HTTPException(404, "Model not found")


# ══════════════════════════════════════════════════════════
#  Subscriptions (consumer → model binding)
# ══════════════════════════════════════════════════════════

class SubscribeRequest(BaseModel):
    model: str


@app.post("/api/subscriptions")
async def subscribe_model(req: SubscribeRequest, user=Depends(get_current_user)):
    """Subscribe to a model and get a unique sub_key for API access."""
    # Find a public+online backend serving this model
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, models FROM backends WHERE is_public = 1"
        )
        rows = [dict(r) for r in await cur.fetchall()]
        backend_id = None
        for r in rows:
            model_list = json.loads(r["models"]) if r["models"] else []
            if req.model in model_list:
                backend_id = r["id"]
                break
        if not backend_id:
            raise HTTPException(404, "Model not found")

        # Check existing subscription
        cur = await db.execute(
            "SELECT id, sub_key, is_active FROM subscriptions WHERE user_id = ? AND model = ?",
            (user["id"], req.model),
        )
        existing = await cur.fetchone()
        if existing:
            existing = dict(existing)
            if existing["is_active"]:
                return {"sub_key": existing["sub_key"], "model": req.model}
            # Re-activate
            await db.execute("UPDATE subscriptions SET is_active = 1, backend_id = ? WHERE id = ?", (backend_id, existing["id"]))
            await db.commit()
            return {"sub_key": existing["sub_key"], "model": req.model}

        sub_key = f"sub-{secrets.token_urlsafe(24)}"
        await db.execute(
            "INSERT INTO subscriptions (user_id, backend_id, model, sub_key) VALUES (?, ?, ?, ?)",
            (user["id"], backend_id, req.model, sub_key),
        )
        await db.commit()
    finally:
        await db.close()
    return {"sub_key": sub_key, "model": req.model}


@app.get("/api/subscriptions")
async def list_subscriptions(user=Depends(get_current_user)):
    """List all subscriptions for the current user."""
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT s.id, s.model, s.sub_key, s.is_active, s.created_at, "
            "b.name as backend, b.status as backend_status, b.input_price, b.output_price "
            "FROM subscriptions s JOIN backends b ON s.backend_id = b.id "
            "WHERE s.user_id = ? ORDER BY s.created_at DESC",
            (user["id"],),
        )
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    return rows


@app.delete("/api/subscriptions/{sub_id}")
async def unsubscribe_model(sub_id: int, user=Depends(get_current_user)):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE subscriptions SET is_active = 0 WHERE id = ? AND user_id = ?",
            (sub_id, user["id"]),
        )
        await db.commit()
    finally:
        await db.close()
    return {"ok": True}


# ── Subscription proxy endpoint ────────────────────────

@app.post("/s/{sub_key}/v1/chat/completions")
async def sub_chat(sub_key: str, request: Request):
    """Proxy chat completions via subscription key."""
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT s.*, u.balance, u.is_active as user_active "
            "FROM subscriptions s JOIN users u ON s.user_id = u.id "
            "WHERE s.sub_key = ? AND s.is_active = 1",
            (sub_key,),
        )
        sub = await cur.fetchone()
        if not sub:
            raise HTTPException(401, "Invalid or inactive subscription")
        sub = dict(sub)
        if not sub["user_active"]:
            raise HTTPException(403, "User account disabled")
        if sub["balance"] <= 0:
            raise HTTPException(402, "Insufficient balance")

        cur = await db.execute("SELECT * FROM backends WHERE id = ?", (sub["backend_id"],))
        backend = await cur.fetchone()
        if not backend:
            raise HTTPException(503, "Backend not found")
        backend = dict(backend)
    finally:
        await db.close()

    if backend["status"] != "online":
        raise HTTPException(503, "Backend is offline")

    body = await request.json()
    body["model"] = sub["model"]  # Force the subscribed model
    stream = body.get("stream", False)

    # Rewrite model name if mapping exists
    client_info = json.loads(backend["client_info"]) if backend.get("client_info") else {}
    model_map = client_info.get("model_map", {})
    if sub["model"] in model_map:
        body["model"] = model_map[sub["model"]]

    input_price, output_price = get_pricing(backend)
    api_user = {"user_id": sub["user_id"], "key_id": 0}

    if backend["mode"] == "tunnel":
        return await _proxy_tunnel(api_user, backend, body, stream, input_price, output_price)
    else:
        return await _proxy_direct(api_user, backend, body, stream, input_price, output_price)


@app.get("/s/{sub_key}/v1/models")
async def sub_models(sub_key: str):
    """List models available for this subscription."""
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT s.model FROM subscriptions s WHERE s.sub_key = ? AND s.is_active = 1",
            (sub_key,),
        )
        sub = await cur.fetchone()
        if not sub:
            raise HTTPException(401, "Invalid or inactive subscription")
    finally:
        await db.close()
    return {
        "object": "list",
        "data": [{"id": sub["model"], "object": "model", "owned_by": "llm-gateway"}],
    }


# ══════════════════════════════════════════════════════════
#  OpenAI-Compatible API
# ══════════════════════════════════════════════════════════

async def authenticate_api_key(request: Request):
    """Authenticate via API key in Authorization header."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(401, "Missing API key")
    raw_key = auth_header[7:]
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()

    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT ak.id as key_id, ak.user_id, u.balance, u.is_active "
            "FROM api_keys ak JOIN users u ON ak.user_id = u.id "
            "WHERE ak.key_hash = ? AND ak.is_active = 1",
            (key_hash,),
        )
        row = await cur.fetchone()
    finally:
        await db.close()

    if not row:
        raise HTTPException(401, "Invalid API key")
    row = dict(row)
    if not row["is_active"]:
        raise HTTPException(403, "User account disabled")
    if row["balance"] <= 0:
        raise HTTPException(402, "Insufficient balance")
    return row


async def find_backend_for_model(model: str, user_id: int):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT * FROM backends WHERE status = 'online' AND (is_public = 1 OR owner_id = ?)", (user_id,)
        )
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()

    for r in rows:
        models = json.loads(r["models"]) if r["models"] else []
        if model in models:
            return r
    return None


def get_pricing(backend: dict) -> tuple[float, float]:
    default = CONFIG.get("pricing", {}).get("default", {})
    inp = backend.get("input_price") or default.get("input", 1.0)
    out = backend.get("output_price") or default.get("output", 3.0)
    return inp, out


@app.get("/v1/models")
async def openai_models(request: Request):
    api_user = await authenticate_api_key(request)
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT models FROM backends WHERE status = 'online' AND (is_public = 1 OR owner_id = ?)",
            (api_user["user_id"],),
        )
        rows = await cur.fetchall()
    finally:
        await db.close()

    model_set = set()
    for r in rows:
        for m in json.loads(r["models"] or "[]"):
            model_set.add(m)

    return {
        "object": "list",
        "data": [{"id": m, "object": "model", "owned_by": "llm-gateway"} for m in sorted(model_set)],
    }


@app.post("/v1/chat/completions")
async def openai_chat(request: Request):
    api_user = await authenticate_api_key(request)
    body = await request.json()
    model = body.get("model", "")
    stream = body.get("stream", False)

    backend = await find_backend_for_model(model, api_user["user_id"])
    if not backend:
        raise HTTPException(404, f"Model '{model}' not available")

    # Rewrite model name to served name if mapping exists
    client_info = json.loads(backend["client_info"]) if backend.get("client_info") else {}
    model_map = client_info.get("model_map", {})
    if model in model_map:
        body["model"] = model_map[model]

    input_price, output_price = get_pricing(backend)

    if backend["mode"] == "tunnel":
        return await _proxy_tunnel(api_user, backend, body, stream, input_price, output_price)
    else:
        return await _proxy_direct(api_user, backend, body, stream, input_price, output_price)


def _upstream_headers(backend) -> dict:
    ci = json.loads(backend["client_info"]) if backend.get("client_info") else {}
    headers = {"Content-Type": "application/json"}
    if ci.get("api_key"):
        headers["Authorization"] = f"Bearer {ci['api_key']}"
    return headers


async def _proxy_direct(api_user, backend, body, stream, input_price, output_price):
    url = f"{backend['url'].rstrip('/')}/v1/chat/completions"
    headers = _upstream_headers(backend)

    if stream:
        return StreamingResponse(
            _stream_direct(api_user, backend, body, url, input_price, output_price, headers),
            media_type="text/event-stream",
        )

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(url, json=body, headers=headers)
        data = resp.json()

    usage = data.get("usage", {})
    await _record_usage(api_user, backend, body["model"], usage, input_price, output_price)
    return data


async def _stream_direct(api_user, backend, body, url, input_price, output_price, headers=None):
    total_input = 0
    total_output = 0
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream("POST", url, json=body, headers=headers) as resp:
            async for line in resp.aiter_lines():
                if line.startswith("data: "):
                    yield line + "\n\n"
                    chunk_data = line[6:]
                    if chunk_data.strip() == "[DONE]":
                        continue
                    try:
                        chunk = json.loads(chunk_data)
                        usage = chunk.get("usage", {})
                        if usage:
                            total_input = usage.get("prompt_tokens", total_input)
                            total_output = usage.get("completion_tokens", total_output)
                    except json.JSONDecodeError:
                        pass

    await _record_usage(
        api_user, backend, body["model"],
        {"prompt_tokens": total_input, "completion_tokens": total_output},
        input_price, output_price,
    )


async def _proxy_tunnel(api_user, backend, body, stream, input_price, output_price):
    if not tunnel_manager.is_connected(backend["id"]):
        raise HTTPException(503, "Backend tunnel not connected")

    if stream:
        return StreamingResponse(
            _stream_tunnel(api_user, backend, body, input_price, output_price),
            media_type="text/event-stream",
        )

    data = await tunnel_manager.forward_request(backend["id"], body)
    usage = data.get("usage", {})
    await _record_usage(api_user, backend, body["model"], usage, input_price, output_price)
    return data


async def _stream_tunnel(api_user, backend, body, input_price, output_price):
    total_input = 0
    total_output = 0
    async for chunk in tunnel_manager.forward_stream(backend["id"], body):
        line = f"data: {json.dumps(chunk)}\n\n"
        yield line
        usage = chunk.get("usage", {})
        if usage:
            total_input = usage.get("prompt_tokens", total_input)
            total_output = usage.get("completion_tokens", total_output)
    yield "data: [DONE]\n\n"

    await _record_usage(
        api_user, backend, body["model"],
        {"prompt_tokens": total_input, "completion_tokens": total_output},
        input_price, output_price,
    )


async def _record_usage(api_user, backend, model, usage, input_price, output_price):
    input_tokens = usage.get("prompt_tokens", 0)
    output_tokens = usage.get("completion_tokens", 0)
    cost = (input_tokens * input_price + output_tokens * output_price) / 1_000_000

    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO usage_logs (user_id, api_key_id, backend_id, model, input_tokens, output_tokens, cost) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (api_user["user_id"], api_user["key_id"], backend["id"], model, input_tokens, output_tokens, cost),
        )
        await db.execute("UPDATE users SET balance = balance - ? WHERE id = ?", (cost, api_user["user_id"]))
        await db.commit()
    finally:
        await db.close()


# ══════════════════════════════════════════════════════════
#  WebSocket Tunnel Endpoint
# ══════════════════════════════════════════════════════════

@app.websocket("/ws/tunnel")
async def tunnel_ws(ws: WebSocket):
    await ws.accept()
    backend_id = None
    try:
        # First message: auth + registration
        init = await ws.receive_json()
        token = init.get("token", "")
        backend_name = init.get("backend_name", "")

        # Verify token
        key_hash = hashlib.sha256(token.encode()).hexdigest()
        db = await get_db()
        try:
            cur = await db.execute(
                "SELECT ak.user_id FROM api_keys ak WHERE ak.key_hash = ? AND ak.is_active = 1",
                (key_hash,),
            )
            key_row = await cur.fetchone()
            if not key_row:
                await ws.send_json({"error": "Invalid token"})
                await ws.close()
                return

            cur = await db.execute(
                "SELECT * FROM backends WHERE name = ? AND owner_id = ?",
                (backend_name, key_row["user_id"]),
            )
            backend = await cur.fetchone()
            if not backend:
                await ws.send_json({"error": "Backend not found or not owned by you"})
                await ws.close()
                return
            backend = dict(backend)
            backend_id = backend["id"]

            await db.execute(
                "UPDATE backends SET status = 'online', updated_at = datetime('now') WHERE id = ?",
                (backend_id,),
            )
            await db.commit()
        finally:
            await db.close()

        models = json.loads(backend["models"]) if backend["models"] else []
        conn = TunnelConnection(ws=ws, backend_id=backend_id, backend_name=backend_name, models=models)
        tunnel_manager.register(backend_id, conn)
        await ws.send_json({"status": "connected", "backend_id": backend_id})

        # Message loop
        while True:
            msg = await ws.receive_json()
            msg_type = msg.get("type", "")
            req_id = msg.get("id", "")

            if msg_type == "response":
                tunnel_manager.resolve_response(backend_id, req_id, msg.get("data", {}))
            elif msg_type == "stream_chunk":
                tunnel_manager.push_stream_chunk(backend_id, req_id, msg.get("data"))
            elif msg_type == "stream_end":
                tunnel_manager.push_stream_chunk(backend_id, req_id, None)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Tunnel error: {e}")
    finally:
        if backend_id:
            tunnel_manager.unregister(backend_id)
            db = await get_db()
            try:
                await db.execute(
                    "UPDATE backends SET status = 'offline', updated_at = datetime('now') WHERE id = ?",
                    (backend_id,),
                )
                await db.commit()
            finally:
                await db.close()


# ══════════════════════════════════════════════════════════
#  Usage Stats
# ══════════════════════════════════════════════════════════

@app.get("/api/usage")
async def get_usage(days: int = Query(7, ge=1, le=365), user=Depends(get_current_user)):
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT model, SUM(input_tokens) as total_input, SUM(output_tokens) as total_output,
               SUM(cost) as total_cost, COUNT(*) as requests
               FROM usage_logs WHERE user_id = ? AND created_at >= datetime('now', ?)
               GROUP BY model ORDER BY total_cost DESC""",
            (user["id"], f"-{days} days"),
        )
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    return rows


# ══════════════════════════════════════════════════════════
#  Admin Routes
# ══════════════════════════════════════════════════════════

@app.get("/api/admin/users")
async def admin_list_users(admin=Depends(require_admin)):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, username, email, role, balance, is_active, verified, created_at FROM users ORDER BY id"
        )
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


class AdjustBalanceRequest(BaseModel):
    amount: float


@app.post("/api/admin/users/{user_id}/balance")
async def admin_adjust_balance(user_id: int, req: AdjustBalanceRequest, admin=Depends(require_admin)):
    db = await get_db()
    try:
        await db.execute("UPDATE users SET balance = balance + ? WHERE id = ?", (req.amount, user_id))
        await db.commit()
        cur = await db.execute("SELECT balance FROM users WHERE id = ?", (user_id,))
        row = await cur.fetchone()
    finally:
        await db.close()
    return {"balance": row["balance"] if row else 0}


@app.post("/api/admin/users/{user_id}/toggle")
async def admin_toggle_user(user_id: int, admin=Depends(require_admin)):
    db = await get_db()
    try:
        await db.execute("UPDATE users SET is_active = CASE WHEN is_active=1 THEN 0 ELSE 1 END WHERE id = ?", (user_id,))
        await db.commit()
    finally:
        await db.close()
    return {"ok": True}


@app.get("/api/admin/usage")
async def admin_usage(days: int = Query(7, ge=1, le=365), admin=Depends(require_admin)):
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT u.username, ul.model, SUM(ul.input_tokens) as total_input,
               SUM(ul.output_tokens) as total_output, SUM(ul.cost) as total_cost, COUNT(*) as requests
               FROM usage_logs ul JOIN users u ON ul.user_id = u.id
               WHERE ul.created_at >= datetime('now', ?)
               GROUP BY u.username, ul.model ORDER BY total_cost DESC""",
            (f"-{days} days",),
        )
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


# ══════════════════════════════════════════════════════════
#  Health
# ══════════════════════════════════════════════════════════

@app.get("/health")
async def health():
    return {"status": "ok", "time": time.time()}


# ══════════════════════════════════════════════════════════
#  Entry point
# ══════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn

    port = CONFIG.get("server", {}).get("port", 8080) if CONFIG else 8080
    load_config()
    port = CONFIG.get("server", {}).get("port", 8080)
    uvicorn.run("gateway:app", host="0.0.0.0", port=port, reload=False)
