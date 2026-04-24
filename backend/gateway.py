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
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

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
from billing import (
    get_billing_status,
    is_user_suspended,
    mark_invoice_paid,
    ensure_invoices_for_user,
)
from tunnel import TunnelConnection, tunnel_manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s %(message)s")
logger = logging.getLogger("gateway")

# Upstream timeouts: connect/write/pool bounded; no read timeout so long generations
# are bounded only by the client's disconnect, not by a hardcoded wall clock.
UPSTREAM_TIMEOUT = httpx.Timeout(connect=15.0, write=30.0, pool=30.0, read=None)

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


# ── Asia/Shanghai day/hour helpers ──────────────────────
SHANGHAI = ZoneInfo("Asia/Shanghai")


def sh_now() -> datetime:
    return datetime.now(SHANGHAI)


def sh_hour_start(dt: datetime | None = None) -> str:
    dt = (dt or sh_now()).astimezone(SHANGHAI)
    return dt.strftime("%Y-%m-%d %H:00:00")


def sh_day(dt: datetime | None = None) -> str:
    dt = (dt or sh_now()).astimezone(SHANGHAI)
    return dt.strftime("%Y-%m-%d")


def sh_month_start(dt: datetime | None = None) -> str:
    """YYYY-MM-01 string for the current month's first day (Asia/Shanghai).
    Monthly totals reset at 00:00 on the 1st of each month."""
    dt = (dt or sh_now()).astimezone(SHANGHAI)
    return dt.strftime("%Y-%m-01")


def seconds_until_next_sh_midnight() -> float:
    now = sh_now()
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(1.0, (tomorrow - now).total_seconds())


# ── Daily 00:00 Asia/Shanghai job: promote pending prices + archive usage ────
async def daily_rollover_loop():
    """Run once per Asia/Shanghai midnight:
       1. Promote backends.pending_{input_price,output_price,cache_price,currency} to live.
       2. Archive prior-day usage_hourly rows into usage_daily, then delete them.
    """
    while True:
        try:
            await asyncio.sleep(seconds_until_next_sh_midnight())
        except asyncio.CancelledError:
            return
        try:
            await run_daily_rollover()
        except Exception as e:
            logger.error(f"daily_rollover error: {e}")


async def run_daily_rollover():
    yesterday = sh_day(sh_now() - timedelta(days=1))
    db = await get_db()
    try:
        # 1. Promote pending prices whose effective date is <= today.
        today = sh_day()
        await db.execute(
            """UPDATE backends SET
                 input_price  = COALESCE(pending_input_price,  input_price),
                 output_price = COALESCE(pending_output_price, output_price),
                 cache_price  = COALESCE(pending_cache_price,  cache_price),
                 currency     = COALESCE(pending_currency,     currency),
                 pending_input_price = NULL,
                 pending_output_price = NULL,
                 pending_cache_price = NULL,
                 pending_currency = NULL,
                 pending_effective_at = NULL,
                 updated_at = datetime('now')
               WHERE pending_effective_at IS NOT NULL
                 AND pending_effective_at <= ?""",
            (today,),
        )
        # 2. Archive yesterday's hourly rows into daily, then delete.
        await db.execute(
            """INSERT INTO usage_daily(user_id, backend_id, model, currency, day,
                                       requests, input_tokens, output_tokens, cached_tokens, cost)
               SELECT user_id, backend_id, model, currency, ?,
                      SUM(requests), SUM(input_tokens), SUM(output_tokens), SUM(cached_tokens), SUM(cost)
               FROM usage_hourly
               WHERE substr(hour_start, 1, 10) = ?
               GROUP BY user_id, backend_id, model, currency
               ON CONFLICT(user_id, backend_id, model, currency, day) DO UPDATE SET
                   requests      = usage_daily.requests      + excluded.requests,
                   input_tokens  = usage_daily.input_tokens  + excluded.input_tokens,
                   output_tokens = usage_daily.output_tokens + excluded.output_tokens,
                   cached_tokens = usage_daily.cached_tokens + excluded.cached_tokens,
                   cost          = usage_daily.cost          + excluded.cost""",
            (yesterday, yesterday),
        )
        await db.execute(
            "DELETE FROM usage_hourly WHERE substr(hour_start, 1, 10) = ?",
            (yesterday,),
        )
        await db.commit()
        logger.info(f"daily_rollover: archived {yesterday}, promoted pending prices")
    finally:
        await db.close()


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
        # Backfill: ensure every backend owner is auto-subscribed to their own models
        cur = await db.execute("SELECT id, owner_id, models FROM backends")
        all_backends = await cur.fetchall()
        for brow in all_backends:
            bid, owner_id, models_json = brow[0], brow[1], brow[2]
            if not owner_id or not models_json:
                continue
            try:
                model_list = json.loads(models_json)
            except Exception:
                continue
            for model_name in model_list:
                cur = await db.execute(
                    "SELECT id, is_active FROM subscriptions WHERE user_id = ? AND backend_id = ? AND model = ?",
                    (owner_id, bid, model_name),
                )
                existing = await cur.fetchone()
                if existing:
                    if not existing[1]:
                        await db.execute("UPDATE subscriptions SET is_active = 1 WHERE id = ?", (existing[0],))
                else:
                    sub_key = f"sub-{secrets.token_urlsafe(24)}"
                    await db.execute(
                        "INSERT INTO subscriptions (user_id, backend_id, model, sub_key, sort_order) "
                        "VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM subscriptions WHERE user_id = ?))",
                        (owner_id, bid, model_name, sub_key, owner_id),
                    )
        await db.commit()
    finally:
        await db.close()
    task = asyncio.create_task(health_check_loop())
    roll_task = asyncio.create_task(daily_rollover_loop())
    logger.info("Gateway started")
    yield
    task.cancel()
    roll_task.cancel()


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
        "user": {"id": user["id"], "username": user["username"], "role": user["role"]},
    }


@app.get("/api/auth/me")
async def me(user=Depends(get_current_user)):
    keys = user.keys()
    billing = await get_billing_status(user["id"])
    return {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"],
        "role": user["role"],
        "verified": user["verified"],
        "active_subscription_id": user["active_subscription_id"] if "active_subscription_id" in keys else None,
        "auto_fallback": bool(user["auto_fallback"]) if "auto_fallback" in keys else True,
        "billing": {
            "current_month_cost": billing["current_month_cost"],
            "current_month_by_currency": billing["current_month_by_currency"],
            "unpaid_total": billing["unpaid_total"],
            "unpaid_by_currency": billing["unpaid_by_currency"],
            "overdue_total": billing["overdue_total"],
            "overdue_by_currency": billing["overdue_by_currency"],
            "is_suspended": billing["is_suspended"],
        },
    }


@app.get("/api/billing/status")
async def billing_status(user=Depends(get_current_user)):
    return await get_billing_status(user["id"])


class AutoFallbackRequest(BaseModel):
    enabled: bool


@app.post("/api/user/auto-fallback")
async def set_auto_fallback(req: AutoFallbackRequest, user=Depends(get_current_user)):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE users SET auto_fallback = ? WHERE id = ?",
            (1 if req.enabled else 0, user["id"]),
        )
        await db.commit()
    finally:
        await db.close()
    return {"ok": True, "auto_fallback": req.enabled}


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


class ChangeEmailRequest(BaseModel):
    new_email: str


@app.post("/api/auth/change-email")
async def change_email(req: ChangeEmailRequest, user=Depends(get_current_user)):
    import re
    email = req.new_email.strip()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(400, "邮箱格式不正确")
    db = await get_db()
    try:
        existing = await db.execute("SELECT id FROM users WHERE email = ? AND id != ?", (email, user["id"]))
        if await existing.fetchone():
            raise HTTPException(400, "该邮箱已被其他账号使用")
        await db.execute("UPDATE users SET email = ? WHERE id = ?", (email, user["id"]))
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
    cache_price: float | None = None
    currency: str = "CNY"
    client_info: dict = {}


ALLOWED_MODEL_FAMILIES = ["Qwen", "THUDM", "deepseek-ai", "google", "OpenAI"]

# Pricing currencies accepted by /api/backends; UI shows the matching symbol.
ALLOWED_CURRENCIES = ["CNY", "USD"]
CURRENCY_SYMBOLS = {"CNY": "¥", "USD": "$"}

# Whitelisted models per family for the registration UI. Keep these as plain
# model names (no family prefix); the UI joins them with the selected family.
ALLOWED_MODELS_BY_FAMILY: dict[str, list[str]] = {
    "Qwen": [
        "Qwen3-0.6B", "Qwen3-1.7B", "Qwen3-4B", "Qwen3-8B",
        "Qwen3-14B", "Qwen3-32B",
        "Qwen3-30B-A3B", "Qwen3-235B-A22B",
        "Qwen3.5-4B", "Qwen3.5-8B", "Qwen3.5-14B", "Qwen3.5-32B",
        "Qwen3.6-35B-A3B",
        "Qwen2.5-7B-Instruct", "Qwen2.5-14B-Instruct", "Qwen2.5-32B-Instruct", "Qwen2.5-72B-Instruct",
        "Qwen2.5-Coder-7B-Instruct", "Qwen2.5-Coder-14B-Instruct", "Qwen2.5-Coder-32B-Instruct",
    ],
    "THUDM": [
        "glm-4-9b-chat",
        "GLM-4-32B-0414", "GLM-4-9B-0414",
        "GLM-Z1-32B-0414", "GLM-Z1-9B-0414",
    ],
    "deepseek-ai": [
        "DeepSeek-R1",
        "DeepSeek-R1-Distill-Qwen-7B", "DeepSeek-R1-Distill-Qwen-14B",
        "DeepSeek-R1-Distill-Qwen-32B", "DeepSeek-R1-Distill-Llama-70B",
        "DeepSeek-V3", "DeepSeek-V3.2-Exp",
    ],
    "google": [
        "gemma-4-31B-it",
    ],
    "OpenAI": [
        "GPT-5.4",
    ],
}


def _sanitize_client_info(ci: dict, models: list[str]) -> dict:
    """Drop model_map entries whose key is not an exact match to one of the
    backend's declared models. Keys must be the full canonical name (e.g.
    'Qwen/Qwen3.6-35B-A3B'), not a short/family-less form."""
    if not isinstance(ci, dict):
        return {}
    ci = dict(ci)
    mm = ci.get("model_map")
    if isinstance(mm, dict) and models:
        model_set = set(models)
        ci["model_map"] = {k: v for k, v in mm.items() if k in model_set}
    return ci


@app.get("/api/model-families")
async def get_model_families():
    return ALLOWED_MODEL_FAMILIES


@app.get("/api/model-catalog")
async def get_model_catalog():
    return ALLOWED_MODELS_BY_FAMILY


@app.post("/api/backends")
async def register_backend(req: RegisterBackendRequest, user=Depends(require_provider)):
    if req.mode not in ("direct", "tunnel"):
        raise HTTPException(400, "mode must be 'direct' or 'tunnel'")
    if req.mode == "direct" and not req.url:
        raise HTTPException(400, "url required for direct mode")
    currency = (req.currency or "CNY").upper()
    if currency not in ALLOWED_CURRENCIES:
        raise HTTPException(400, f"currency must be one of {ALLOWED_CURRENCIES}")
    for m in req.models:
        family = m.split("/")[0] if "/" in m else m
        if family not in ALLOWED_MODEL_FAMILIES:
            raise HTTPException(400, f"模型 {m} 不在允许的大类中，当前支持: {', '.join(ALLOWED_MODEL_FAMILIES)}")
        short = m.split("/", 1)[1] if "/" in m else m
        if short not in ALLOWED_MODELS_BY_FAMILY.get(family, []):
            raise HTTPException(400, f"模型 {m} 不在 {family} 的白名单中")

    req.client_info = _sanitize_client_info(req.client_info, req.models)

    db = await get_db()
    try:
        cur = await db.execute("SELECT id, owner_id FROM backends WHERE name = ?", (req.name,))
        existing = await cur.fetchone()
        if existing:
            if existing["owner_id"] == user["id"]:
                raise HTTPException(409, f"后端名 '{req.name}' 已存在，请改用编辑页修改，或换一个名字再注册")
            raise HTTPException(409, f"后端名 '{req.name}' 已被其他用户占用")
        await db.execute(
            """INSERT INTO backends (name, owner_id, url, mode, models, tags, input_price, output_price, cache_price, currency, is_public, client_info, enabled)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0)""",
            (
                req.name, user["id"], req.url, req.mode, json.dumps(req.models), json.dumps(req.tags),
                req.input_price, req.output_price, req.cache_price, currency, json.dumps(req.client_info),
            ),
        )
        await db.commit()

        # Auto-subscribe the owner to all models of this backend (cannot be unsubscribed).
        cur = await db.execute("SELECT id FROM backends WHERE name = ?", (req.name,))
        brow = await cur.fetchone()
        if brow:
            backend_id = brow[0]
            for model_name in req.models:
                cur = await db.execute(
                    "SELECT id, is_active FROM subscriptions WHERE user_id = ? AND backend_id = ? AND model = ?",
                    (user["id"], backend_id, model_name),
                )
                existing = await cur.fetchone()
                if existing:
                    if not existing[1]:
                        await db.execute("UPDATE subscriptions SET is_active = 1 WHERE id = ?", (existing[0],))
                else:
                    sub_key = f"sub-{secrets.token_urlsafe(24)}"
                    await db.execute(
                        "INSERT INTO subscriptions (user_id, backend_id, model, sub_key, sort_order) "
                        "VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM subscriptions WHERE user_id = ?))",
                        (user["id"], backend_id, model_name, sub_key, user["id"]),
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


@app.get("/api/backends/stats")
async def my_backend_stats(user=Depends(require_provider)):
    """Per-(backend, model) subscription count + usage aggregates for backends owned by caller."""
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, name, models FROM backends WHERE owner_id = ?",
            (user["id"],),
        )
        owned = [dict(r) for r in await cur.fetchall()]
        if not owned:
            return []
        ids = [b["id"] for b in owned]
        placeholders = ",".join(["?"] * len(ids))

        cur = await db.execute(
            f"SELECT backend_id, model, COUNT(*) AS subs FROM subscriptions "
            f"WHERE backend_id IN ({placeholders}) GROUP BY backend_id, model",
            ids,
        )
        sub_rows = await cur.fetchall()

        # Stats scoped to current month (Asia/Shanghai); resets on the 1st.
        month_start = sh_month_start()
        today = sh_day()
        cur = await db.execute(
            f"SELECT backend_id, model, "
            f"SUM(requests) AS requests, "
            f"SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, "
            f"SUM(cached_tokens) AS cached_tokens, "
            f"SUM(cost) AS cost FROM ("
            f"  SELECT backend_id, model, requests, input_tokens, output_tokens, cached_tokens, cost "
            f"  FROM usage_hourly WHERE backend_id IN ({placeholders}) AND substr(hour_start, 1, 10) >= ? "
            f"  UNION ALL "
            f"  SELECT backend_id, model, requests, input_tokens, output_tokens, cached_tokens, cost "
            f"  FROM usage_daily WHERE backend_id IN ({placeholders}) AND day >= ? AND day < ?"
            f") GROUP BY backend_id, model",
            ids + [month_start] + ids + [month_start, today],
        )
        usage_rows = await cur.fetchall()
    finally:
        await db.close()

    sub_map: dict[tuple[int, str], int] = {}
    for r in sub_rows:
        sub_map[(r["backend_id"], r["model"])] = r["subs"]

    usage_map: dict[tuple[int, str], dict] = {}
    for r in usage_rows:
        usage_map[(r["backend_id"], r["model"])] = {
            "requests": r["requests"] or 0,
            "input_tokens": r["input_tokens"] or 0,
            "output_tokens": r["output_tokens"] or 0,
            "cached_tokens": r["cached_tokens"] or 0,
            "cost": round(r["cost"] or 0.0, 6),
        }

    result = []
    for b in owned:
        models = json.loads(b["models"]) if b["models"] else []
        per_model = []
        for m in models:
            # usage_logs stores the user-facing model name which may be the bare
            # short name (e.g. "Qwen3-8B") rather than "family/Qwen3-8B". Try both.
            short = m.split("/", 1)[1] if "/" in m else m
            u = usage_map.get((b["id"], m)) or usage_map.get((b["id"], short)) or {
                "requests": 0, "input_tokens": 0, "output_tokens": 0, "cached_tokens": 0, "cost": 0.0,
            }
            per_model.append({
                "model": m,
                "subscribers": sub_map.get((b["id"], m), 0),
                **u,
            })
        result.append({"id": b["id"], "name": b["name"], "models": per_model})
    return result


@app.get("/api/backends/{name}")
async def get_backend_detail(name: str, user=Depends(require_provider)):
    db = await get_db()
    try:
        if user["role"] == "admin":
            cur = await db.execute(
                "SELECT b.*, u.username as owner_name FROM backends b LEFT JOIN users u ON b.owner_id = u.id WHERE b.name = ?",
                (name,),
            )
        else:
            cur = await db.execute(
                "SELECT b.*, u.username as owner_name FROM backends b LEFT JOIN users u ON b.owner_id = u.id WHERE b.name = ? AND b.owner_id = ?",
                (name, user["id"]),
            )
        row = await cur.fetchone()
    finally:
        await db.close()
    if not row:
        raise HTTPException(404, "Backend not found")
    r = dict(row)
    r["models"] = json.loads(r["models"]) if r["models"] else []
    r["tags"] = json.loads(r["tags"]) if r.get("tags") else {}
    r["client_info"] = json.loads(r["client_info"]) if r["client_info"] else {}
    return r


class UpdateBackendRequest(BaseModel):
    url: str | None = None
    models: list[str] | None = None
    tags: dict[str, str] | None = None
    input_price: float | None = None
    output_price: float | None = None
    cache_price: float | None = None
    clear_cache_price: bool = False  # explicit clear of cache_price
    currency: str | None = None
    is_public: bool | None = None
    client_info: dict | None = None
    clear_price: bool = False  # set True to clear pricing


@app.put("/api/backends/{name}")
async def update_backend(name: str, req: UpdateBackendRequest, user=Depends(require_provider)):
    if req.models is not None:
        for m in req.models:
            family = m.split("/")[0] if "/" in m else m
            if family not in ALLOWED_MODEL_FAMILIES:
                raise HTTPException(400, f"模型 {m} 不在允许的大类中，当前支持: {', '.join(ALLOWED_MODEL_FAMILIES)}")
            short = m.split("/", 1)[1] if "/" in m else m
            if short not in ALLOWED_MODELS_BY_FAMILY.get(family, []):
                raise HTTPException(400, f"模型 {m} 不在 {family} 的白名单中")
    if req.currency is not None and req.currency.upper() not in ALLOWED_CURRENCIES:
        raise HTTPException(400, f"currency must be one of {ALLOWED_CURRENCIES}")

    db = await get_db()
    try:
        if user["role"] == "admin":
            cur = await db.execute("SELECT id FROM backends WHERE name = ?", (name,))
        else:
            cur = await db.execute("SELECT id FROM backends WHERE name = ? AND owner_id = ?", (name, user["id"]))
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Backend not found")

        updates = []
        params = []
        if req.url is not None:
            updates.append("url = ?")
            params.append(req.url)
        if req.models is not None:
            updates.append("models = ?")
            params.append(json.dumps(req.models))
        if req.tags is not None:
            updates.append("tags = ?")
            params.append(json.dumps(req.tags))
        if req.is_public is not None:
            updates.append("is_public = ?")
            params.append(1 if req.is_public else 0)
        if req.client_info is not None:
            if req.models is not None:
                effective_models = req.models
            else:
                cur = await db.execute("SELECT models FROM backends WHERE name = ?", (name,))
                r = await cur.fetchone()
                effective_models = json.loads(r["models"]) if r and r["models"] else []
            sanitized = _sanitize_client_info(req.client_info, effective_models)
            updates.append("client_info = ?")
            params.append(json.dumps(sanitized))
        # Price/currency edits are staged to pending_* and promoted at 00:00
        # Asia/Shanghai the next day.  clear_price still takes effect immediately.
        effective_day = (sh_now() + timedelta(days=1)).strftime("%Y-%m-%d")
        pending_touched = False
        if req.clear_price:
            updates.append("input_price = NULL")
            updates.append("output_price = NULL")
            updates.append("cache_price = NULL")
            updates.append("pending_input_price = NULL")
            updates.append("pending_output_price = NULL")
            updates.append("pending_cache_price = NULL")
            updates.append("pending_effective_at = NULL")
        else:
            if req.input_price is not None:
                updates.append("pending_input_price = ?")
                params.append(req.input_price)
                pending_touched = True
            if req.output_price is not None:
                updates.append("pending_output_price = ?")
                params.append(req.output_price)
                pending_touched = True
            if req.clear_cache_price:
                updates.append("cache_price = NULL")
                updates.append("pending_cache_price = NULL")
            elif req.cache_price is not None:
                updates.append("pending_cache_price = ?")
                params.append(req.cache_price)
                pending_touched = True
        if req.currency is not None:
            updates.append("pending_currency = ?")
            params.append(req.currency.upper())
            pending_touched = True
        if pending_touched:
            updates.append("pending_effective_at = ?")
            params.append(effective_day)

        if updates:
            updates.append("updated_at = datetime('now')")
            params.append(name)
            await db.execute(f"UPDATE backends SET {', '.join(updates)} WHERE name = ?", params)
            await db.commit()
    finally:
        await db.close()
    return {"ok": True}


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


@app.put("/api/backends/{name}/toggle")
async def toggle_backend(name: str, user=Depends(require_provider)):
    """Provider-facing listing toggle with review workflow.

    - listed    -> offline  (立即下架，变为仅私有)
    - offline   -> pending  (提交上架审核)
    
    - pending   -> offline  (撤回申请)
    Admins bypass review and flip listed<->offline directly.
    """
    db = await get_db()
    try:
        if user["role"] == "admin":
            cur = await db.execute(
                "SELECT enabled, listing_status FROM backends WHERE name = ?", (name,))
        else:
            cur = await db.execute(
                "SELECT enabled, listing_status FROM backends WHERE name = ? AND owner_id = ?",
                (name, user["id"]))
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Backend not found")
        status = row["listing_status"] or ("listed" if row["enabled"] else "offline")
        now = sh_now().strftime("%Y-%m-%d %H:%M:%S")
        if user["role"] == "admin":
            # Admin toggle: flip listed<->offline directly, skip review.
            if status == "listed":
                new_status, new_enabled = "offline", 0
            else:
                new_status, new_enabled = "listed", 1
            await db.execute(
                """UPDATE backends SET enabled = ?, listing_status = ?,
                   reviewed_at = ?, reviewed_by = ? WHERE name = ?""",
                (new_enabled, new_status, now, user["id"], name),
            )
        else:
            if status == "listed":
                # Take offline immediately.
                await db.execute(
                    """UPDATE backends SET enabled = 0, listing_status = 'offline'
                       WHERE name = ? AND owner_id = ?""",
                    (name, user["id"]),
                )
                new_status, new_enabled = "offline", 0
            elif status == "pending":
                # Withdraw the pending request.
                await db.execute(
                    """UPDATE backends SET listing_status = 'offline',
                       review_requested_at = NULL WHERE name = ? AND owner_id = ?""",
                    (name, user["id"]),
                )
                new_status, new_enabled = "offline", 0
            else:
                # offline -> pending review (keep review_note for history display).
                await db.execute(
                    """UPDATE backends SET listing_status = 'pending',
                       review_requested_at = ?
                       WHERE name = ? AND owner_id = ?""",
                    (now, name, user["id"]),
                )
                new_status, new_enabled = "pending", 0
        await db.commit()
    finally:
        await db.close()
    return {"ok": True, "enabled": bool(new_enabled), "listing_status": new_status}


@app.get("/api/admin/backends/pending")
async def admin_list_pending_backends(admin=Depends(require_admin)):
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT b.*, u.username as owner_name
               FROM backends b LEFT JOIN users u ON b.owner_id = u.id
               WHERE b.listing_status = 'pending'
               ORDER BY b.review_requested_at ASC""")
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    for r in rows:
        r["models"] = json.loads(r["models"]) if r["models"] else []
        r["tags"] = json.loads(r["tags"]) if r.get("tags") else {}
        r["client_info"] = json.loads(r["client_info"]) if r["client_info"] else {}
    return rows


class ReviewDecisionRequest(BaseModel):
    note: str | None = None


@app.post("/api/admin/backends/{name}/approve")
async def admin_approve_backend(name: str, req: ReviewDecisionRequest = ReviewDecisionRequest(), admin=Depends(require_admin)):
    db = await get_db()
    try:
        cur = await db.execute("SELECT id FROM backends WHERE name = ?", (name,))
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Backend not found")
        now = sh_now().strftime("%Y-%m-%d %H:%M:%S")
        await db.execute(
            """UPDATE backends SET enabled = 1, is_public = 1, listing_status = 'listed',
               reviewed_at = ?, reviewed_by = ?, review_note = ? WHERE name = ?""",
            (now, admin["id"], req.note, name),
        )
        await db.commit()
    finally:
        await db.close()
    return {"ok": True, "listing_status": "listed"}


@app.post("/api/admin/backends/{name}/reject")
async def admin_reject_backend(name: str, req: ReviewDecisionRequest, admin=Depends(require_admin)):
    if not req.note:
        raise HTTPException(400, "驳回时必须填写原因 (note)")
    db = await get_db()
    try:
        cur = await db.execute("SELECT id FROM backends WHERE name = ?", (name,))
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Backend not found")
        now = sh_now().strftime("%Y-%m-%d %H:%M:%S")
        await db.execute(
            """UPDATE backends SET enabled = 0, is_public = 0, listing_status = 'offline',
               reviewed_at = ?, reviewed_by = ?, review_note = ? WHERE name = ?""",
            (now, admin["id"], req.note, name),
        )
        await db.commit()
    finally:
        await db.close()
    return {"ok": True, "listing_status": "offline"}


# ══════════════════════════════════════════════════════════
#  Model Market (public)
# ══════════════════════════════════════════════════════════

@app.get("/api/models")
async def list_models():
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT b.id as backend_id, b.name as backend, b.models, b.tags, b.status, b.input_price, b.output_price, b.cache_price, b.currency, u.username as provider "
            "FROM backends b LEFT JOIN users u ON b.owner_id = u.id WHERE b.is_public = 1 AND b.enabled = 1"
        )
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()

    result = []
    for r in rows:
        model_list = json.loads(r["models"]) if r["models"] else []
        for m in model_list:
            result.append({
                "id": m,
                "backend_id": r["backend_id"],
                "backend": r["backend"],
                "provider": r["provider"],
                "status": r["status"],
                "tags": json.loads(r["tags"]) if r.get("tags") else {},
                "input_price": r["input_price"],
                "output_price": r["output_price"],
                "cache_price": r["cache_price"],
                "currency": r["currency"] or "CNY",
            })
    return result


@app.get("/api/models/{model_id:path}")
async def get_model_detail(model_id: str, backend_id: int | None = None):
    db = await get_db()
    try:
        if backend_id is not None:
            cur = await db.execute(
                "SELECT b.id as backend_id, b.name as backend, b.models, b.tags, b.status, b.input_price, b.output_price, b.cache_price, b.currency, "
                "b.mode, b.created_at, b.updated_at, u.username as provider "
                "FROM backends b LEFT JOIN users u ON b.owner_id = u.id WHERE b.id = ? AND b.is_public = 1 AND b.enabled = 1",
                (backend_id,),
            )
        else:
            cur = await db.execute(
                "SELECT b.id as backend_id, b.name as backend, b.models, b.tags, b.status, b.input_price, b.output_price, b.cache_price, b.currency, "
                "b.mode, b.created_at, b.updated_at, u.username as provider "
                "FROM backends b LEFT JOIN users u ON b.owner_id = u.id WHERE b.is_public = 1 AND b.enabled = 1"
            )
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()

    best = None
    for r in rows:
        model_list = json.loads(r["models"]) if r["models"] else []
        if model_id in model_list:
            if best is None or (best["status"] != "online" and r["status"] == "online"):
                best = r
    if not best:
        raise HTTPException(404, "Model not found")
    return {
        "id": model_id,
        "backend_id": best["backend_id"],
        "backend": best["backend"],
        "provider": best["provider"],
        "status": best["status"],
        "mode": best["mode"],
        "tags": json.loads(best["tags"]) if best.get("tags") else {},
        "input_price": best["input_price"],
        "output_price": best["output_price"],
        "cache_price": best["cache_price"],
        "currency": best["currency"] or "CNY",
        "created_at": best["created_at"],
        "updated_at": best["updated_at"],
    }


# ══════════════════════════════════════════════════════════
#  Subscriptions (consumer → model binding)
# ══════════════════════════════════════════════════════════

class SubscribeRequest(BaseModel):
    model: str
    backend_id: int


@app.post("/api/subscriptions")
async def subscribe_model(req: SubscribeRequest, user=Depends(get_current_user)):
    """Subscribe to a model on a specific backend and get a unique sub_key for API access."""
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, models FROM backends WHERE id = ? AND is_public = 1",
            (req.backend_id,),
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Backend not found")
        row = dict(row)
        model_list = json.loads(row["models"]) if row["models"] else []
        if req.model not in model_list:
            raise HTTPException(404, "Model not found on this backend")

        # Check existing subscription for this user + backend + model
        cur = await db.execute(
            "SELECT id, sub_key, is_active FROM subscriptions WHERE user_id = ? AND backend_id = ? AND model = ?",
            (user["id"], req.backend_id, req.model),
        )
        existing = await cur.fetchone()
        if existing:
            existing = dict(existing)
            if existing["is_active"]:
                return {"sub_key": existing["sub_key"], "model": req.model}
            await db.execute("UPDATE subscriptions SET is_active = 1 WHERE id = ?", (existing["id"],))
            await db.commit()
            return {"sub_key": existing["sub_key"], "model": req.model}

        sub_key = f"sub-{secrets.token_urlsafe(24)}"
        cur = await db.execute(
            "SELECT COALESCE(MAX(sort_order), 0) FROM subscriptions WHERE user_id = ?",
            (user["id"],),
        )
        max_order = (await cur.fetchone())[0] or 0
        await db.execute(
            "INSERT INTO subscriptions (user_id, backend_id, model, sub_key, sort_order) VALUES (?, ?, ?, ?, ?)",
            (user["id"], req.backend_id, req.model, sub_key, max_order + 1),
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
            "SELECT s.id, s.backend_id, s.model, s.sub_key, s.is_active, s.is_activated, s.created_at, s.sort_order, "
            "b.name as backend, b.status as backend_status, b.input_price, b.output_price, b.cache_price, b.currency, "
            "CASE WHEN b.owner_id = ? THEN 1 ELSE 0 END as is_owned "
            "FROM subscriptions s JOIN backends b ON s.backend_id = b.id "
            "WHERE s.user_id = ? ORDER BY s.sort_order ASC, s.id ASC",
            (user["id"], user["id"]),
        )
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    return rows


class ReorderSubscriptionsRequest(BaseModel):
    ids: list[int]


@app.put("/api/subscriptions/reorder")
async def reorder_subscriptions(req: ReorderSubscriptionsRequest, user=Depends(get_current_user)):
    """Reorder the user's subscriptions. `ids` is the full list of subscription ids in desired order."""
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id FROM subscriptions WHERE user_id = ?",
            (user["id"],),
        )
        owned = {r[0] for r in await cur.fetchall()}
        if set(req.ids) - owned:
            raise HTTPException(400, "包含不属于当前用户的订阅")
        for order, sub_id in enumerate(req.ids, start=1):
            await db.execute(
                "UPDATE subscriptions SET sort_order = ? WHERE id = ? AND user_id = ?",
                (order, sub_id, user["id"]),
            )
        await db.commit()
    finally:
        await db.close()
    return {"ok": True}


@app.delete("/api/subscriptions/{sub_id}")
async def unsubscribe_model(sub_id: int, user=Depends(get_current_user)):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT s.id, b.owner_id FROM subscriptions s JOIN backends b ON s.backend_id = b.id "
            "WHERE s.id = ? AND s.user_id = ?",
            (sub_id, user["id"]),
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "订阅不存在")
        if row[1] == user["id"]:
            raise HTTPException(400, "无法取消订阅自己注册的模型服务")
        await db.execute(
            "UPDATE subscriptions SET is_active = 0 WHERE id = ? AND user_id = ?",
            (sub_id, user["id"]),
        )
        # Clear active subscription if it points to this one
        await db.execute(
            "UPDATE users SET active_subscription_id = NULL "
            "WHERE id = ? AND active_subscription_id = ?",
            (user["id"], sub_id),
        )
        await db.commit()
    finally:
        await db.close()
    return {"ok": True}


class ActiveSubRequest(BaseModel):
    subscription_id: int | None = None


class ToggleActivateRequest(BaseModel):
    activated: bool


@app.put("/api/subscriptions/{sub_id}/activate")
async def toggle_subscription_activated(sub_id: int, req: ToggleActivateRequest, user=Depends(get_current_user)):
    """Toggle whether this subscription participates in unified /v1 routing."""
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id FROM subscriptions WHERE id = ? AND user_id = ? AND is_active = 1",
            (sub_id, user["id"]),
        )
        if not await cur.fetchone():
            raise HTTPException(404, "订阅不存在或已取消")
        await db.execute(
            "UPDATE subscriptions SET is_activated = ? WHERE id = ? AND user_id = ?",
            (1 if req.activated else 0, sub_id, user["id"]),
        )
        await db.commit()
    finally:
        await db.close()
    return {"ok": True, "id": sub_id, "activated": req.activated}


@app.put("/api/user/active-subscription")
async def set_active_subscription(req: ActiveSubRequest, user=Depends(get_current_user)):
    """Legacy: exclusive activation. Activates only the given sub, deactivates all others."""
    db = await get_db()
    try:
        if req.subscription_id is not None:
            cur = await db.execute(
                "SELECT id FROM subscriptions WHERE id = ? AND user_id = ? AND is_active = 1",
                (req.subscription_id, user["id"]),
            )
            if not await cur.fetchone():
                raise HTTPException(404, "订阅不存在或已取消")
            await db.execute(
                "UPDATE subscriptions SET is_activated = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE user_id = ?",
                (req.subscription_id, user["id"]),
            )
        else:
            await db.execute(
                "UPDATE subscriptions SET is_activated = 0 WHERE user_id = ?",
                (user["id"],),
            )
        await db.execute(
            "UPDATE users SET active_subscription_id = ? WHERE id = ?",
            (req.subscription_id, user["id"]),
        )
        await db.commit()
    finally:
        await db.close()
    return {"ok": True, "active_subscription_id": req.subscription_id}


# ── Subscription proxy endpoint ────────────────────────

@app.post("/s/{sub_key}/v1/chat/completions")
async def sub_chat(sub_key: str, request: Request):
    """Proxy chat completions via subscription key."""
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT s.*, u.is_active as user_active "
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
        suspended, overdue_total = await is_user_suspended(sub["user_id"])
        if suspended:
            raise HTTPException(402, f"服务已停用：有逾期未付账单 (累计 ¥{overdue_total:.6f})")

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

    input_price, output_price, cache_price = get_pricing(backend)
    api_user = {"user_id": sub["user_id"], "key_id": 0}

    if backend["mode"] == "tunnel":
        return await _proxy_tunnel(api_user, backend, body, stream, input_price, output_price,
                                    cache_price=cache_price)
    else:
        return await _proxy_direct(api_user, backend, body, stream, input_price, output_price,
                                    cache_price=cache_price)


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
            "SELECT ak.id as key_id, ak.user_id, u.balance, u.is_active, u.auto_fallback "
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
    suspended, overdue_total = await is_user_suspended(row["user_id"])
    if suspended:
        raise HTTPException(402, f"服务已停用：有逾期未付账单 (累计 ¥{overdue_total:.6f})，请结清后继续使用")
    return row


async def get_active_subscription_backend(user_id: int, auto_fallback: bool = True,
                                          requested_model: str | None = None):
    """Pick a backend from the user's activated subscriptions.

    - auto_fallback=True: prefer a sub whose model matches requested_model (if any);
      if none match or the matching one is offline, fall back to activated subs by
      priority and pick the first online. 503 if all offline.
    - auto_fallback=False: require requested_model to exactly match one of the
      user's activated subs; use that one. 404 if not matched; 503 if offline.

    Returns (backend_row, forced_model) or (None, None) if user has no activated subs
    AND auto_fallback=True (caller may then fall back to public backends)."""
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT s.model, b.* "
            "FROM subscriptions s JOIN backends b ON b.id = s.backend_id "
            "WHERE s.user_id = ? AND s.is_active = 1 AND s.is_activated = 1 "
            "ORDER BY s.sort_order ASC, s.id ASC",
            (user_id,),
        )
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()

    if not rows:
        if auto_fallback:
            return None, None
        raise HTTPException(404, "你还没有激活任何订阅模型服务")

    if auto_fallback:
        # 1) Try exact match on requested_model first (respects what the user asked for)
        if requested_model:
            for r in rows:
                if r["model"] == requested_model and r.get("status") == "online":
                    forced_model = r.pop("model")
                    return r, forced_model
        # 2) Fallback: first online by priority
        for r in rows:
            if r.get("status") == "online":
                forced_model = r.pop("model")
                return r, forced_model
        raise HTTPException(503, "所有已激活的订阅模型服务都当前离线")

    # Manual mode: user must specify the model
    if not requested_model:
        available = sorted({r["model"] for r in rows})
        raise HTTPException(400,
            f"自动回退已关闭，请在请求中显式指定 model，可用：{available}")
    matches = [r for r in rows if r["model"] == requested_model]
    if not matches:
        available = sorted({r["model"] for r in rows})
        raise HTTPException(404,
            f"模型 '{requested_model}' 不在你已激活的订阅中。可用：{available}")
    r = matches[0]
    if r.get("status") != "online":
        raise HTTPException(503, f"模型 '{requested_model}' 的订阅服务当前离线（自动回退已关闭）")
    forced_model = r.pop("model")
    return r, forced_model


async def get_activated_models(user_id: int) -> list[str]:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT DISTINCT s.model FROM subscriptions s "
            "WHERE s.user_id = ? AND s.is_active = 1 AND s.is_activated = 1 "
            "ORDER BY s.sort_order ASC",
            (user_id,),
        )
        return [r[0] for r in await cur.fetchall()]
    finally:
        await db.close()


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


def get_pricing(backend: dict) -> tuple[float, float, float]:
    """Return (input_price, output_price, cache_price).

    ``cache_price`` defaults to ``0.1 * input_price`` when unset, matching the
    10% cache-hit discount used by OpenAI, Anthropic, DeepSeek V4-Flash and
    Aliyun Bailian 显式缓存.  Providers that want a different ratio can set
    ``cache_price`` explicitly."""
    default = CONFIG.get("pricing", {}).get("default", {})
    inp = backend.get("input_price")
    out = backend.get("output_price")
    cache = backend.get("cache_price")
    if inp is None:
        inp = default.get("input", 1.0)
    if out is None:
        out = default.get("output", 3.0)
    if cache is None:
        cache = inp * 0.1
    return inp, out, cache


@app.get("/v1/models")
async def openai_models(request: Request):
    api_user = await authenticate_api_key(request)
    # If user has activated subscriptions, only expose those models
    activated_models = await get_activated_models(api_user["user_id"])
    if activated_models:
        return {
            "object": "list",
            "data": [{"id": m, "object": "model", "owned_by": "llm-gateway"} for m in activated_models],
        }

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
    return await _handle_openai_request(request, "/v1/chat/completions",
                                         usage_keys=("prompt_tokens", "completion_tokens"))


@app.post("/v1/completions")
async def openai_completions(request: Request):
    return await _handle_openai_request(request, "/v1/completions",
                                         usage_keys=("prompt_tokens", "completion_tokens"))


@app.post("/v1/responses")
async def openai_responses(request: Request):
    return await _handle_openai_request(request, "/v1/responses",
                                         usage_keys=("input_tokens", "output_tokens"))


async def _handle_openai_request(request: Request, path: str, usage_keys: tuple[str, str]):
    api_user = await authenticate_api_key(request)
    body = await request.json()
    stream = body.get("stream", False)

    # Prefer user's activated subscriptions (priority routing with optional failover)
    auto_fallback = bool(api_user.get("auto_fallback", 1))
    requested_model = body.get("model", "")
    backend, forced_model = await get_active_subscription_backend(
        api_user["user_id"], auto_fallback, requested_model)
    if backend:
        body["model"] = forced_model
        model = forced_model
    else:
        model = body.get("model", "")
        backend = await find_backend_for_model(model, api_user["user_id"])
        if not backend:
            raise HTTPException(404, f"Model '{model}' not available")

    # Remember the user-facing model name for usage logging (before rewrite)
    display_model = model

    # Rewrite model name to served name if mapping exists
    client_info = json.loads(backend["client_info"]) if backend.get("client_info") else {}
    model_map = client_info.get("model_map", {})
    if model in model_map:
        body["model"] = model_map[model]

    # For OpenAI chat/completions streaming, force include_usage so the final
    # chunk carries token counts (vLLM/OpenAI omit usage in stream by default).
    if stream and path in ("/v1/chat/completions", "/v1/completions"):
        opts = body.get("stream_options")
        if not isinstance(opts, dict):
            opts = {}
        opts.setdefault("include_usage", True)
        body["stream_options"] = opts

    input_price, output_price, cache_price = get_pricing(backend)

    if backend["mode"] == "tunnel":
        return await _proxy_tunnel(api_user, backend, body, stream, input_price, output_price,
                                    path=path, usage_keys=usage_keys, display_model=display_model,
                                    cache_price=cache_price)
    else:
        return await _proxy_direct(api_user, backend, body, stream, input_price, output_price,
                                    path=path, usage_keys=usage_keys, display_model=display_model,
                                    cache_price=cache_price)


def _upstream_headers(backend) -> dict:
    ci = json.loads(backend["client_info"]) if backend.get("client_info") else {}
    headers = {"Content-Type": "application/json"}
    if ci.get("api_key"):
        headers["Authorization"] = f"Bearer {ci['api_key']}"
    return headers


async def _proxy_direct(api_user, backend, body, stream, input_price, output_price,
                         path="/v1/chat/completions", usage_keys=("prompt_tokens", "completion_tokens"),
                         display_model=None, cache_price=None):
    url = f"{backend['url'].rstrip('/')}{path}"
    headers = _upstream_headers(backend)
    log_model = display_model or body.get("model", "")

    if stream:
        return StreamingResponse(
            _stream_direct(api_user, backend, body, url, input_price, output_price, headers, usage_keys, log_model,
                           cache_price=cache_price),
            media_type="text/event-stream",
        )

    async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT) as client:
        resp = await client.post(url, json=body, headers=headers)
        data = resp.json()

    usage = _extract_usage(data, usage_keys)
    await _record_usage(api_user, backend, log_model, usage, input_price, output_price,
                        cache_price=cache_price)
    return data


async def _stream_direct(api_user, backend, body, url, input_price, output_price, headers=None,
                          usage_keys=("prompt_tokens", "completion_tokens"), log_model=None, cache_price=None):
    total_input = 0
    total_output = 0
    total_cached = 0
    async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT) as client:
        async with client.stream("POST", url, json=body, headers=headers) as resp:
            async for line in resp.aiter_lines():
                if line.startswith("data: "):
                    yield line + "\n\n"
                    chunk_data = line[6:]
                    if chunk_data.strip() == "[DONE]":
                        continue
                    try:
                        chunk = json.loads(chunk_data)
                        u = _extract_usage(chunk, usage_keys)
                        if u["prompt_tokens"] or u["completion_tokens"]:
                            total_input = u["prompt_tokens"] or total_input
                            total_output = u["completion_tokens"] or total_output
                            total_cached = u["cached_tokens"] or total_cached
                    except json.JSONDecodeError:
                        pass

    await _record_usage(
        api_user, backend, log_model or body.get("model", ""),
        {"prompt_tokens": total_input, "completion_tokens": total_output,
         "cached_tokens": total_cached},
        input_price, output_price, cache_price=cache_price,
    )


async def _proxy_tunnel(api_user, backend, body, stream, input_price, output_price,
                         path="/v1/chat/completions", usage_keys=("prompt_tokens", "completion_tokens"),
                         display_model=None, cache_price=None):
    if not tunnel_manager.is_connected(backend["id"]):
        raise HTTPException(503, "Backend tunnel not connected")
    log_model = display_model or body.get("model", "")

    if stream:
        return StreamingResponse(
            _stream_tunnel(api_user, backend, body, input_price, output_price, path, usage_keys, log_model,
                           cache_price=cache_price),
            media_type="text/event-stream",
        )

    data = await tunnel_manager.forward_request(backend["id"], body, path=path)
    usage = _extract_usage(data, usage_keys)
    await _record_usage(api_user, backend, log_model, usage, input_price, output_price,
                        cache_price=cache_price)
    return data


async def _stream_tunnel(api_user, backend, body, input_price, output_price,
                          path="/v1/chat/completions", usage_keys=("prompt_tokens", "completion_tokens"),
                          log_model=None, cache_price=None):
    total_input = 0
    total_output = 0
    total_cached = 0
    async for chunk in tunnel_manager.forward_stream(backend["id"], body, path=path):
        line = f"data: {json.dumps(chunk)}\n\n"
        yield line
        u = _extract_usage(chunk, usage_keys)
        if u["prompt_tokens"] or u["completion_tokens"]:
            total_input = u["prompt_tokens"] or total_input
            total_output = u["completion_tokens"] or total_output
            total_cached = u["cached_tokens"] or total_cached
    yield "data: [DONE]\n\n"

    await _record_usage(
        api_user, backend, log_model or body.get("model", ""),
        {"prompt_tokens": total_input, "completion_tokens": total_output,
         "cached_tokens": total_cached},
        input_price, output_price, cache_price=cache_price,
    )


def _extract_usage(obj: dict, usage_keys: tuple[str, str]) -> dict:
    """Extract usage from a response/chunk, normalized to prompt/completion keys.

    Looks under top-level `usage` first, then under `response.usage` (Responses API
    final events), returning zeros when absent.
    """
    in_key, out_key = usage_keys
    usage = obj.get("usage") if isinstance(obj, dict) else None
    if not usage and isinstance(obj, dict):
        resp_obj = obj.get("response")
        if isinstance(resp_obj, dict):
            usage = resp_obj.get("usage")
    if not isinstance(usage, dict):
        usage = {}
    cached = 0
    # OpenAI / vLLM: usage.prompt_tokens_details.cached_tokens
    details = usage.get("prompt_tokens_details") if isinstance(usage, dict) else None
    if isinstance(details, dict):
        cached = int(details.get("cached_tokens", 0) or 0)
    # DeepSeek: usage.prompt_cache_hit_tokens
    if not cached and isinstance(usage, dict):
        cached = int(usage.get("prompt_cache_hit_tokens", 0) or 0)
    # Anthropic: usage.cache_read_input_tokens
    if not cached and isinstance(usage, dict):
        cached = int(usage.get("cache_read_input_tokens", 0) or 0)
    return {
        "prompt_tokens": int(usage.get(in_key, 0) or 0),
        "completion_tokens": int(usage.get(out_key, 0) or 0),
        "cached_tokens": cached,
    }


async def _record_usage(api_user, backend, model, usage, input_price, output_price, cache_price=None):
    input_tokens = usage.get("prompt_tokens", 0)
    output_tokens = usage.get("completion_tokens", 0)
    cached_tokens = usage.get("cached_tokens", 0) or 0
    # cache_price defaults to 10% of input_price (industry-standard hit
    # discount).  Cost splits the prompt into non-cached (billed at
    # input_price) + cached (billed at cache_price).
    if cache_price is None:
        cache_price = input_price * 0.1
    billable_input = max(input_tokens - cached_tokens, 0)
    cost = (billable_input * input_price
            + cached_tokens * cache_price
            + output_tokens * output_price) / 1_000_000
    currency = backend.get("currency") or "CNY"
    hour_start = sh_hour_start()

    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO usage_logs (user_id, api_key_id, backend_id, model, input_tokens, output_tokens, cached_tokens, cost, currency) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (api_user["user_id"], api_user["key_id"], backend["id"], model, input_tokens, output_tokens, cached_tokens, cost, currency),
        )
        # Hourly rollup (Asia/Shanghai).
        await db.execute(
            """INSERT INTO usage_hourly(user_id, backend_id, model, currency, hour_start,
                                        requests, input_tokens, output_tokens, cached_tokens, cost)
               VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
               ON CONFLICT(user_id, backend_id, model, currency, hour_start) DO UPDATE SET
                   requests      = requests      + 1,
                   input_tokens  = input_tokens  + excluded.input_tokens,
                   output_tokens = output_tokens + excluded.output_tokens,
                   cached_tokens = cached_tokens + excluded.cached_tokens,
                   cost          = cost          + excluded.cost""",
            (api_user["user_id"], backend["id"], model, currency, hour_start,
             input_tokens, output_tokens, cached_tokens, cost),
        )
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
async def get_usage(user=Depends(get_current_user)):
    """Per-model usage summary for the CURRENT MONTH (Asia/Shanghai).
       Totals reset at 00:00 on the 1st of each month (previous month is
       settled and archived — kept in usage_daily but excluded from totals)."""
    today = sh_day()
    month_start = sh_month_start()
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT model, currency,
                      SUM(input_tokens) AS total_input,
                      SUM(output_tokens) AS total_output,
                      SUM(cached_tokens) AS total_cached,
                      SUM(cost) AS total_cost,
                      SUM(requests) AS requests
               FROM (
                   SELECT model, currency, input_tokens, output_tokens, cached_tokens, cost, requests
                   FROM usage_daily WHERE user_id = ? AND day >= ? AND day < ?
                   UNION ALL
                   SELECT model, currency, input_tokens, output_tokens, cached_tokens, cost, requests
                   FROM usage_hourly WHERE user_id = ? AND substr(hour_start, 1, 10) >= ?
               )
               GROUP BY model, currency
               ORDER BY total_cost DESC""",
            (user["id"], month_start, today, user["id"], month_start),
        )
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    return rows


@app.get("/api/usage/hourly")
async def get_usage_hourly(user=Depends(get_current_user)):
    """Today's hourly usage buckets (Asia/Shanghai).  Past days live in
       usage_daily and are exposed via /api/usage/daily."""
    today = sh_day()
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT hour_start, model, currency,
                      SUM(requests) AS requests,
                      SUM(input_tokens) AS total_input,
                      SUM(output_tokens) AS total_output,
                      SUM(cached_tokens) AS total_cached,
                      SUM(cost) AS total_cost
               FROM usage_hourly
               WHERE user_id = ? AND substr(hour_start, 1, 10) = ?
               GROUP BY hour_start, model, currency
               ORDER BY hour_start DESC, total_cost DESC""",
            (user["id"], today),
        )
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


@app.get("/api/usage/daily")
async def get_usage_daily(days: int = Query(30, ge=1, le=365), user=Depends(get_current_user)):
    """Per-day archived usage (Asia/Shanghai).  Today is NOT included here;
       query /api/usage/hourly for intraday data."""
    today = sh_day()
    earliest_day = sh_day(sh_now() - timedelta(days=days))
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT day, model, currency,
                      SUM(requests) AS requests,
                      SUM(input_tokens) AS total_input,
                      SUM(output_tokens) AS total_output,
                      SUM(cached_tokens) AS total_cached,
                      SUM(cost) AS total_cost
               FROM usage_daily
               WHERE user_id = ? AND day >= ? AND day < ?
               GROUP BY day, model, currency
               ORDER BY day DESC, total_cost DESC""",
            (user["id"], earliest_day, today),
        )
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


# ══════════════════════════════════════════════════════════
#  Admin Routes
# ══════════════════════════════════════════════════════════

@app.get("/api/admin/users")
async def admin_list_users(admin=Depends(require_admin)):
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, username, email, role, is_active, verified, created_at FROM users ORDER BY id"
        )
        users = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    # Attach billing summary
    for u in users:
        try:
            await ensure_invoices_for_user(u["id"])
        except Exception:
            pass
    db = await get_db()
    try:
        for u in users:
            cur = await db.execute(
                "SELECT COALESCE(currency,'CNY') AS currency, COALESCE(SUM(total_cost),0) AS total "
                "FROM invoices WHERE user_id = ? AND status = 'unpaid' "
                "GROUP BY COALESCE(currency,'CNY')",
                (u["id"],),
            )
            unpaid_by_currency = {(r["currency"] or "CNY"): float(r["total"] or 0.0) for r in await cur.fetchall()}
            u["unpaid_by_currency"] = unpaid_by_currency
            u["unpaid_total"] = sum(unpaid_by_currency.values())
            cur = await db.execute(
                "SELECT COALESCE(currency,'CNY') AS currency, COALESCE(SUM(total_cost),0) AS total "
                "FROM invoices WHERE user_id = ? AND status = 'unpaid' AND due_date < date('now') "
                "GROUP BY COALESCE(currency,'CNY')",
                (u["id"],),
            )
            overdue_by_currency = {(r["currency"] or "CNY"): float(r["total"] or 0.0) for r in await cur.fetchall()}
            u["overdue_by_currency"] = overdue_by_currency
            u["overdue_total"] = sum(overdue_by_currency.values())
    finally:
        await db.close()
    return users


@app.get("/api/admin/invoices")
async def admin_list_invoices(admin=Depends(require_admin), status: str | None = None, user_id: int | None = None):
    db = await get_db()
    try:
        sql = ("SELECT i.*, u.username FROM invoices i JOIN users u ON u.id = i.user_id WHERE 1=1")
        params: list = []
        if status:
            sql += " AND i.status = ?"
            params.append(status)
        if user_id:
            sql += " AND i.user_id = ?"
            params.append(user_id)
        sql += " ORDER BY i.period_start DESC, i.user_id"
        cur = await db.execute(sql, params)
        return [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()


@app.post("/api/admin/invoices/{invoice_id}/pay")
async def admin_mark_invoice_paid(invoice_id: int, admin=Depends(require_admin)):
    inv = await mark_invoice_paid(invoice_id)
    if not inv:
        raise HTTPException(404, "Invoice not found")
    return inv


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
async def admin_usage(admin=Depends(require_admin)):
    """Admin aggregate usage for the CURRENT MONTH (Asia/Shanghai).
       Totals reset at 00:00 on the 1st of each month."""
    today = sh_day()
    month_start = sh_month_start()
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT u.username, t.model, COALESCE(t.currency,'CNY') AS currency,
                      SUM(t.input_tokens) AS total_input,
                      SUM(t.output_tokens) AS total_output,
                      SUM(t.cached_tokens) AS total_cached,
                      SUM(t.cost) AS total_cost,
                      SUM(t.requests) AS requests
               FROM (
                   SELECT user_id, model, currency, input_tokens, output_tokens, cached_tokens, cost, requests
                   FROM usage_daily WHERE day >= ? AND day < ?
                   UNION ALL
                   SELECT user_id, model, currency, input_tokens, output_tokens, cached_tokens, cost, requests
                   FROM usage_hourly WHERE substr(hour_start, 1, 10) >= ?
               ) t
               JOIN users u ON u.id = t.user_id
               GROUP BY u.username, t.model, COALESCE(t.currency,'CNY')
               ORDER BY total_cost DESC""",
            (month_start, today, month_start),
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
