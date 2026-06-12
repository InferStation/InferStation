"""LLM Gateway - Main Application."""
import asyncio
import hashlib
import json
import logging
import os
import re
import secrets
import sys
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

import httpx
import yaml
from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel

from auth import (
    JWT_ALGORITHM,
    bump_token_version,
    check_api_key_rate_limit,
    create_access_token,
    generate_api_key,
    get_current_user,
    get_optional_user,
    hash_password,
    require_admin,
    require_provider,
    verify_password,
)
import auth
import email_service
from database import get_db, init_db
from billing import (
    get_billing_status,
    is_user_suspended,
    mark_invoice_paid,
    ensure_invoices_for_user,
    settle_user_partial,
    is_user_idle_for_settle,
    SETTLE_IDLE_MINUTES,
    get_balance_status,
    is_over_credit_limit,
    deduct_user_balance,
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
    # Apply SMTP config
    email_service.configure(CONFIG.get("smtp"))
    # Google OAuth: env vars override YAML, so prod can inject secrets without
    # editing config.yaml. `enabled` is only true if a client_id is actually set.
    g = dict(CONFIG.get("google_oauth") or {})
    g["client_id"] = os.environ.get("GOOGLE_CLIENT_ID") or g.get("client_id") or ""
    g["client_secret"] = os.environ.get("GOOGLE_CLIENT_SECRET") or g.get("client_secret") or ""
    g["redirect_uri"] = os.environ.get("GOOGLE_REDIRECT_URI") or g.get("redirect_uri") or ""
    g["enabled"] = bool(g.get("enabled") and g["client_id"] and g["client_secret"] and g["redirect_uri"])
    CONFIG["google_oauth"] = g
    CONFIG["frontend_url"] = (
        os.environ.get("FRONTEND_URL")
        or CONFIG.get("frontend_url")
        or "http://localhost:3000"
    )


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
       1. Promote backends.pending_{input_price,output_price,cache_price} to live.
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
                 pending_input_price = NULL,
                 pending_output_price = NULL,
                 pending_cache_price = NULL,
                 pending_effective_at = NULL,
                 updated_at = datetime('now')
               WHERE pending_effective_at IS NOT NULL
                 AND pending_effective_at <= ?""",
            (today,),
        )
        # 2. Archive yesterday's hourly rows into daily, then delete.
        await db.execute(
            """INSERT INTO usage_daily(user_id, backend_id, model, day,
                                       requests, input_tokens, output_tokens, cached_tokens, cost)
               SELECT user_id, backend_id, model, ?,
                      SUM(requests), SUM(input_tokens), SUM(output_tokens), SUM(cached_tokens), SUM(cost)
               FROM usage_hourly
               WHERE substr(hour_start, 1, 10) = ?
               GROUP BY user_id, backend_id, model
               ON CONFLICT(user_id, backend_id, model, day) DO UPDATE SET
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
    # On the 1st of the (Asia/Shanghai) month, finalize last month's provider
    # earnings ledger so /api/provider/earnings can show definitive payouts.
    if sh_now().day == 1:
        try:
            from billing import settle_provider_earnings
            rows = await settle_provider_earnings(None)
            logger.info(f"daily_rollover: settled provider_earnings for {len(rows)} providers")
        except Exception as e:
            logger.error(f"settle_provider_earnings error: {e}")


# ── Health Check Background Task ───────────────────────
async def probe_backend_status(b: dict) -> tuple[str, str | None]:
    """Probe a single backend (tunnel or direct) and return (status, error).

    `b` must contain id / mode / url / client_info. Does not touch DB.

    Direct probe levels:
      1. If `client_info.model_map` is set: send a 1-token chat dry-run with the
         first mapped upstream model. This catches broken deployment names that
         `/v1/models` would silently 200 through (see 4-28 incident with
         backend id=20 mapping to a non-existent `openai-qwen36-a3b`).
      2. Otherwise fall back to `GET /v1/models` 200 = online.
    """
    if b["mode"] == "tunnel":
        if await tunnel_manager.health_probe(b["id"]):
            return "online", None
        return "offline", "隧道未连接或心跳失败"
    if not b.get("url"):
        return "offline", "未配置 URL"
    try:
        headers = {}
        ci = json.loads(b["client_info"]) if b.get("client_info") else {}
        if ci.get("api_key"):
            headers["Authorization"] = f"Bearer {ci['api_key']}"
        base = b["url"].rstrip("/")
        model_map = ci.get("model_map") or {}
        async with httpx.AsyncClient(timeout=15) as client:
            if model_map:
                # Pick a deterministic upstream model so the same row is probed
                # consistently across restarts.
                upstream = sorted(model_map.values())[0]
                payload = {
                    "model": upstream,
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 1,
                    "stream": False,
                }
                _normalize_max_tokens(payload, upstream)
                resp = await client.post(f"{base}/v1/chat/completions",
                                         json=payload, headers=headers)
                body_excerpt = (resp.text or "")[:200].replace("\n", " ")
                if not (200 <= resp.status_code < 300):
                    return "offline", f"chat dry-run 返回 {resp.status_code}: {body_excerpt}"
                # Some providers (e.g. SiliconFlow) return HTTP 200 with an
                # error envelope `{"code":30003,"message":"Model disabled"}`
                # for delisted models. Require a real `choices` array.
                try:
                    j = resp.json()
                except Exception:
                    return "offline", f"chat dry-run 返回非 JSON: {body_excerpt}"
                if isinstance(j, dict) and j.get("choices"):
                    return "online", None
                # Extract upstream error code/message if present.
                code = j.get("code") if isinstance(j, dict) else None
                msg = j.get("message") if isinstance(j, dict) else None
                if code is not None or msg:
                    return "offline", f"chat dry-run 上游错误 code={code} message={msg}"
                return "offline", f"chat dry-run 响应缺少 choices: {body_excerpt}"
            resp = await client.get(f"{base}/v1/models", headers=headers)
            if resp.status_code == 200:
                return "online", None
            return "offline", f"上游 /v1/models 返回 {resp.status_code}"
    except Exception as e:
        return "offline", f"探测失败: {e.__class__.__name__}: {e}"


async def update_backend_status(backend_id: int, status: str) -> None:
    db = await get_db()
    try:
        await db.execute(
            "UPDATE backends SET status = ?, updated_at = datetime('now') WHERE id = ?",
            (status, backend_id),
        )
        await db.commit()
    finally:
        await db.close()


# Per-backend timestamp (monotonic seconds) of the last successful upstream
# response. The health-check loop skips backends with a recent success, so
# active traffic alone keeps a backend marked online without paying for an
# extra dry-run round-trip.
_last_upstream_success: dict[int, float] = {}


def mark_backend_success(backend_id: int) -> None:
    """Record that ``backend_id`` just returned a successful upstream response."""
    try:
        _last_upstream_success[int(backend_id)] = time.monotonic()
    except Exception:  # pragma: no cover - defensive, backend_id should always be int
        pass


async def health_check_loop():
    interval = CONFIG.get("health_check", {}).get("interval_seconds", 600)
    while True:
        await asyncio.sleep(interval)
        try:
            db = await get_db()
            try:
                # Only auto-probe backends that are publicly listed; unlisted/offline rows
                # are probed on demand via POST /api/backends/{name}/check.
                cur = await db.execute(
                    "SELECT id, name, url, mode, client_info, status FROM backends "
                    "WHERE listing_status = 'listed'"
                )
                backends = [dict(r) for r in await cur.fetchall()]
            finally:
                await db.close()

            now = time.monotonic()
            for b in backends:
                # Skip the dry-run if a real call succeeded inside the last
                # interval window AND the row is already marked online.
                last_ok = _last_upstream_success.get(b["id"])
                if (last_ok is not None
                        and now - last_ok < interval
                        and b.get("status") == "online"):
                    continue
                new_status, _ = await probe_backend_status(b)
                await update_backend_status(b["id"], new_status)
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

# Freemius topup endpoints (prepaid balance, USD only, hosted checkout).
from payments import router as payments_router, admin_router as payments_admin_router  # noqa: E402
app.include_router(payments_router)
app.include_router(payments_admin_router)

# Provider earnings + withdrawal endpoints.
from withdrawals import router as withdrawals_router  # noqa: E402
app.include_router(withdrawals_router)


# ══════════════════════════════════════════════════════════
#  Auth Routes
# ══════════════════════════════════════════════════════════

class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str
    code: str
    # Legacy field kept for backwards-compat with older frontends; ignored.
    invite_code: str = ""


class LoginRequest(BaseModel):
    login: str  # username or email
    password: str
    code: str = ""
    remember: bool = False


class SendCodeRequest(BaseModel):
    email: str
    purpose: str  # "register" | "change-email" | "delete-account"


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


async def _issue_verification_code(email: str, purpose: str) -> str:
    """Create a 6-digit code, rate-limit 60s, max 3/hour, keep only one active per (email, purpose)."""
    if purpose not in ("register", "change-email", "delete-account", "login"):
        raise HTTPException(400, "Invalid purpose")
    if not _EMAIL_RE.match(email):
        raise HTTPException(400, "邮箱格式不正确")
    db = await get_db()
    try:
        # Rate-limit: reject if the last unconsumed code was issued < 60s ago.
        cur = await db.execute(
            "SELECT id, created_at FROM email_verifications "
            "WHERE email=? AND purpose=? AND consumed=0 "
            "AND datetime(created_at) > datetime(\'now\', \'-60 seconds\') "
            "ORDER BY id DESC LIMIT 1",
            (email, purpose),
        )
        if await cur.fetchone():
            raise HTTPException(429, "发送过于频繁，请稍后再试（60 秒限流）")
        # Hourly cap: max 3 codes per (email, purpose) in the last hour.
        cur = await db.execute(
            "SELECT COUNT(*) AS n FROM email_verifications "
            "WHERE email=? AND purpose=? "
            "AND datetime(created_at) > datetime(\'now\', \'-1 hour\')",
            (email, purpose),
        )
        row = await cur.fetchone()
        if row and row["n"] >= 3:
            raise HTTPException(429, "该邮箱 1 小时内验证码发送已达上限（3 次），请稍后再试")
        # Invalidate older unconsumed codes.
        await db.execute(
            "UPDATE email_verifications SET consumed=1 WHERE email=? AND purpose=? AND consumed=0",
            (email, purpose),
        )
        code = email_service.generate_code(6)
        await db.execute(
            "INSERT INTO email_verifications (email, code, purpose, expires_at) "
            "VALUES (?, ?, ?, datetime(\'now\', \'+10 minutes\'))",
            (email, code, purpose),
        )
        await db.commit()
    finally:
        await db.close()
    # Look up the recipient's configured locale (if any). Unknown email or
    # NULL locale → English (default).
    recipient_locale: Optional[str] = None
    db = await get_db()
    try:
        cur = await db.execute("SELECT locale FROM users WHERE email = ?", (email,))
        row = await cur.fetchone()
        if row:
            recipient_locale = row["locale"]
    finally:
        await db.close()
    await email_service.send_verification_code(email, code, purpose, locale=recipient_locale)
    return code


async def _consume_verification_code(email: str, purpose: str, code: str) -> None:
    code = (code or "").strip()
    if not code:
        raise HTTPException(400, "请填写邮箱验证码")
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT id, code, attempts FROM email_verifications "
            "WHERE email=? AND purpose=? AND consumed=0 "
            "AND datetime(expires_at) > datetime(\'now\') "
            "ORDER BY id DESC LIMIT 1",
            (email, purpose),
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(400, "验证码已过期或未发送，请重新获取")
        if row["attempts"] >= 5:
            await db.execute("UPDATE email_verifications SET consumed=1 WHERE id=?", (row["id"],))
            await db.commit()
            raise HTTPException(400, "验证码尝试次数过多，请重新获取")
        if row["code"] != code:
            await db.execute("UPDATE email_verifications SET attempts=attempts+1 WHERE id=?", (row["id"],))
            await db.commit()
            raise HTTPException(400, "验证码错误")
        await db.execute("UPDATE email_verifications SET consumed=1 WHERE id=?", (row["id"],))
        await db.commit()
    finally:
        await db.close()


@app.post("/api/auth/send-code")
async def send_code(req: SendCodeRequest):
    raw = (req.email or "").strip()
    purpose = req.purpose
    if purpose == "login":
        # For login, the input may be username or email; look up the user and
        # send to the user\'s registered email.
        login_id = raw.lower()
        db = await get_db()
        try:
            cur = await db.execute(
                "SELECT id, email FROM users WHERE (username = ? OR email = ?) AND is_active = 1",
                (raw, login_id),
            )
            row = await cur.fetchone()
        finally:
            await db.close()
        if not row:
            raise HTTPException(400, "账号不存在")
        target_email = (row["email"] or "").lower()
        code = await _issue_verification_code(target_email, "login")
        resp = {"ok": True}
        if email_service.expose_dev_code():
            resp["dev_code"] = code
        return resp
    email = raw.lower()
    db = await get_db()
    try:
        cur = await db.execute("SELECT id FROM users WHERE email = ?", (email,))
        existing = await cur.fetchone()
    finally:
        await db.close()
    if purpose == "register" and existing:
        # Don't leak account existence to anonymous callers. Pretend the code
        # was sent so attackers can't enumerate registered emails. The real
        # email is never dispatched in this branch.
        return {"ok": True}
    if purpose == "change-email" and existing:
        raise HTTPException(400, "该邮箱已被其他账号使用")
    if purpose == "delete-account" and not existing:
        raise HTTPException(400, "该邮箱未注册")
    code = await _issue_verification_code(email, purpose)
    resp = {"ok": True}
    if email_service.expose_dev_code():
        resp["dev_code"] = code
    return resp


@app.post("/api/auth/register")
async def register(req: RegisterRequest):
    if len(req.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    email = req.email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(400, "邮箱格式不正确")
    await _consume_verification_code(email, "register", req.code)
    db = await get_db()
    try:
        cur = await db.execute("SELECT id FROM users WHERE username = ? OR email = ?", (req.username, email))
        if await cur.fetchone():
            raise HTTPException(400, "Username or email already exists")
        cur = await db.execute(
            "INSERT INTO users (username, email, password_hash, role, verified) VALUES (?, ?, ?, 'consumer', 1)",
            (req.username, email, hash_password(req.password)),
        )
        await db.commit()
        user_id = cur.lastrowid
    finally:
        await db.close()
    token = create_access_token(user_id, "consumer", token_version=0)
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
    # Admin accounts skip the mandatory email verification code on login.
    if user.get("role") != "admin":
        await _consume_verification_code((user["email"] or "").lower(), "login", req.code)
    # "记住我" → 7 天 token；否则默认 24 小时
    expires_minutes = 7 * 24 * 60 if req.remember else None
    token = create_access_token(
        user["id"], user["role"],
        token_version=int(user.get("token_version") or 0),
        expires_minutes=expires_minutes,
    )
    return {
        "token": token,
        "user": {"id": user["id"], "username": user["username"], "role": user["role"]},
    }


# ════════════════════════════════════════════════════════════════════════════
# Google OAuth 2.0 — one-click sign-in / sign-up.
# Flow:
#   1. Frontend → GET /api/auth/google/login?remember=0|1
#        → server sets a short-lived signed state cookie, 302s to Google's
#          OAuth consent page.
#   2. Google → GET /api/auth/google/callback?code=...&state=...
#        → server verifies the state cookie, exchanges code for tokens,
#          fetches userinfo, looks up or creates the user, mints a JWT,
#          then 302s to `<frontend_url>/auth/google/done#token=...&remember=...`
#          so the SPA picks it up (fragment is never sent to the server).
# ════════════════════════════════════════════════════════════════════════════
_OAUTH_STATE_COOKIE = "tianshu_oauth_state"
_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"


def _google_oauth_cfg() -> dict | None:
    g = CONFIG.get("google_oauth") or {}
    return g if g.get("enabled") else None


def _frontend_redirect(path: str) -> str:
    base = (CONFIG.get("frontend_url") or "http://localhost:3000").rstrip("/")
    return f"{base}{path}"


@app.get("/api/auth/google/config")
async def google_oauth_config():
    """Lets the frontend know whether to show the Google button."""
    return {"enabled": _google_oauth_cfg() is not None}


@app.get("/api/auth/google/login")
async def google_oauth_login(remember: int = 0):
    g = _google_oauth_cfg()
    if not g:
        raise HTTPException(503, "Google OAuth not configured")
    state = secrets.token_urlsafe(24)
    # Pack remember-me into the state itself so the callback restores it
    # without needing extra cookies.
    state_payload = f"{state}.{1 if remember else 0}"
    from urllib.parse import urlencode

    params = {
        "client_id": g["client_id"],
        "redirect_uri": g["redirect_uri"],
        "response_type": "code",
        "scope": "openid email profile",
        "state": state_payload,
        "access_type": "online",
        "prompt": "select_account",
    }
    resp = RedirectResponse(f"{_GOOGLE_AUTH_URL}?{urlencode(params)}", status_code=302)
    # HttpOnly + SameSite=Lax so Google can POST back. 10-minute TTL.
    resp.set_cookie(
        _OAUTH_STATE_COOKIE,
        state_payload,
        max_age=600,
        httponly=True,
        samesite="lax",
        path="/api/auth/google",
    )
    return resp


async def _exchange_google_code(code: str, redirect_uri: str, client_id: str, client_secret: str) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        tok_resp = await client.post(
            _GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if tok_resp.status_code != 200:
            raise HTTPException(400, f"Google token exchange failed: {tok_resp.text[:200]}")
        tok = tok_resp.json()
        access_token = tok.get("access_token")
        if not access_token:
            raise HTTPException(400, "Google did not return an access token")
        ui_resp = await client.get(
            _GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if ui_resp.status_code != 200:
            raise HTTPException(400, f"Failed to fetch Google userinfo: {ui_resp.text[:200]}")
        return ui_resp.json()


async def _find_or_create_google_user(userinfo: dict) -> dict:
    sub = userinfo.get("sub")
    email = (userinfo.get("email") or "").strip().lower()
    if not sub or not email:
        raise HTTPException(400, "Google account is missing sub/email")
    if not userinfo.get("email_verified", False):
        raise HTTPException(400, "Google email is not verified")
    name = (userinfo.get("name") or "").strip()
    picture = (userinfo.get("picture") or "").strip()

    db = await get_db()
    try:
        # 1) Match by google_sub (the stable identifier).
        cur = await db.execute("SELECT * FROM users WHERE google_sub = ? AND is_active = 1", (sub,))
        row = await cur.fetchone()
        if row:
            return dict(row)
        # 2) Match by verified email → link the Google identity to that account.
        cur = await db.execute("SELECT * FROM users WHERE email = ? AND is_active = 1", (email,))
        row = await cur.fetchone()
        if row:
            await db.execute(
                "UPDATE users SET google_sub = ?, auth_provider = COALESCE(auth_provider, 'local'), "
                "verified = 1, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?",
                (sub, picture or None, row["id"]),
            )
            await db.commit()
            cur = await db.execute("SELECT * FROM users WHERE id = ?", (row["id"],))
            return dict(await cur.fetchone())
        # 3) New user: synthesize a unique username from the email local-part.
        base = re.sub(r"[^a-z0-9_]", "", email.split("@", 1)[0].lower()) or "user"
        username = base
        for _ in range(5):
            cur = await db.execute("SELECT 1 FROM users WHERE username = ?", (username,))
            if not await cur.fetchone():
                break
            username = f"{base}_{secrets.token_hex(3)}"
        # OAuth users get a random un-guessable password_hash so the local
        # /api/auth/login path can never match them by password.
        placeholder = hash_password(secrets.token_urlsafe(32))
        cur = await db.execute(
            "INSERT INTO users (username, email, password_hash, role, verified, "
            "auth_provider, google_sub, avatar_url) "
            "VALUES (?, ?, ?, 'consumer', 1, 'google', ?, ?)",
            (username, email, placeholder, sub, picture or None),
        )
        await db.commit()
        cur = await db.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,))
        return dict(await cur.fetchone())
    finally:
        await db.close()


@app.get("/api/auth/google/callback")
async def google_oauth_callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None):
    g = _google_oauth_cfg()
    if not g:
        raise HTTPException(503, "Google OAuth not configured")

    def _fail(msg: str) -> RedirectResponse:
        from urllib.parse import quote

        resp = RedirectResponse(_frontend_redirect(f"/login?error={quote(msg)}"), status_code=302)
        resp.delete_cookie(_OAUTH_STATE_COOKIE, path="/api/auth/google")
        return resp

    if error:
        return _fail(f"Google: {error}")
    if not code or not state:
        return _fail("missing_code_or_state")

    cookie_state = request.cookies.get(_OAUTH_STATE_COOKIE)
    if not cookie_state or not secrets.compare_digest(cookie_state, state):
        return _fail("state_mismatch")
    try:
        remember = state.rsplit(".", 1)[1] == "1"
    except (IndexError, ValueError):
        remember = False

    try:
        userinfo = await _exchange_google_code(
            code=code,
            redirect_uri=g["redirect_uri"],
            client_id=g["client_id"],
            client_secret=g["client_secret"],
        )
        user = await _find_or_create_google_user(userinfo)
    except HTTPException as e:
        return _fail(str(e.detail))
    except Exception as e:
        logger.exception("google oauth callback failed")
        return _fail(f"server_error: {e!s}"[:200])

    expires_minutes = 7 * 24 * 60 if remember else None
    token = create_access_token(
        user["id"], user["role"],
        token_version=int(user.get("token_version") or 0),
        expires_minutes=expires_minutes,
    )
    # Token is placed in the URL fragment so it never hits the server logs.
    target = _frontend_redirect(f"/auth/google/done#token={token}&remember={'1' if remember else '0'}")
    resp = RedirectResponse(target, status_code=302)
    resp.delete_cookie(_OAUTH_STATE_COOKIE, path="/api/auth/google")
    return resp


@app.get("/healthz")
async def healthz():
    db = await get_db()
    try:
        await (await db.execute("SELECT 1")).fetchone()
    finally:
        await db.close()
    return {"status": "ok"}


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
        "locale": (user["locale"] if "locale" in keys else None) or None,
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


@app.get("/api/billing/balance")
async def billing_balance(user=Depends(get_current_user)):
    """Current prepaid balance, credit limit, and available headroom.

    Returns both USD floats (legacy) and *_cents (used by the v2 frontend).
    """
    s = await get_balance_status(user["id"])
    return {
        **s,
        "balance_cents": round(s["balance"] * 100),
        "credit_limit_cents": round(s["credit_limit_usd"] * 100),
        "available_cents": round(s["available_credit_usd"] * 100),
    }


@app.get("/api/billing/settle-now/eligibility")
async def settle_now_eligibility(user=Depends(get_current_user)):
    """Tell the UI whether the user is currently allowed to early-settle."""
    uid = user["id"]
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ? AND is_active = 1",
            (uid,),
        )
        active_subs = int((await cur.fetchone())["n"])
        cur = await db.execute(
            "SELECT COUNT(*) AS n FROM backends WHERE owner_id = ? "
            "AND listing_status IN ('listed', 'pending')",
            (uid,),
        )
        listed_backends = int((await cur.fetchone())["n"])
    finally:
        await db.close()
    idle_ok, last_activity = await is_user_idle_for_settle(uid)
    reasons: list[str] = []
    if active_subs > 0:
        reasons.append(f"请先取消全部订阅（当前有 {active_subs} 条仍激活）")
    if listed_backends > 0:
        reasons.append(f"请先下架/撤回审核所有名下服务（当前 {listed_backends} 个 listed/pending）")
    if not idle_ok:
        reasons.append(f"为防止漏计在途请求，需账户静默至少 {SETTLE_IDLE_MINUTES} 分钟（最近一次计费在 {last_activity} CST）")
    return {
        "eligible": not reasons,
        "active_subscriptions": active_subs,
        "listed_backends": listed_backends,
        "idle_minutes_required": SETTLE_IDLE_MINUTES,
        "last_activity": last_activity,
        "reasons": reasons,
    }


@app.post("/api/billing/settle-now")
async def settle_now(user=Depends(get_current_user)):
    """Proactively close out the running month into an invoice.

    Allowed only when:
      - all subscriptions are deactivated;
      - no backend is currently listed or pending review;
      - the user has had no billable usage in the last SETTLE_IDLE_MINUTES.
    """
    if user["role"] == "admin":
        raise HTTPException(400, "管理员账号无须结清")
    uid = user["id"]
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ? AND is_active = 1",
            (uid,),
        )
        if int((await cur.fetchone())["n"]) > 0:
            raise HTTPException(400, "请先取消全部订阅")
        cur = await db.execute(
            "SELECT COUNT(*) AS n FROM backends WHERE owner_id = ? "
            "AND listing_status IN ('listed', 'pending')",
            (uid,),
        )
        if int((await cur.fetchone())["n"]) > 0:
            raise HTTPException(400, "请先下架/撤回审核所有名下服务")
    finally:
        await db.close()
    idle_ok, last_activity = await is_user_idle_for_settle(uid)
    if not idle_ok:
        raise HTTPException(
            400,
            f"为防止漏计在途请求，需账户静默至少 {SETTLE_IDLE_MINUTES} 分钟（最近一次计费在 {last_activity} CST）",
        )
    # Make sure any past months are invoiced first, then bill the running month.
    await ensure_invoices_for_user(uid)
    created = await settle_user_partial(uid)
    billing = await get_billing_status(uid)
    return {
        "ok": True,
        "created": created,
        "unpaid_total": billing["unpaid_total"],
        "unpaid_by_currency": billing["unpaid_by_currency"],
    }


class AutoFallbackRequest(BaseModel):
    enabled: bool


class LocaleRequest(BaseModel):
    locale: Optional[str] = None  # "en" | "zh" | None (clear preference)


@app.post("/api/user/locale")
async def set_user_locale(req: LocaleRequest, user=Depends(get_current_user)):
    """Persist the user's preferred language for transactional emails.

    NULL clears the preference; with no preference, emails default to English.
    """
    raw = (req.locale or "").strip().lower() or None
    if raw is not None and raw not in ("en", "zh"):
        raise HTTPException(400, "Unsupported locale (expected 'en' or 'zh')")
    db = await get_db()
    try:
        await db.execute("UPDATE users SET locale = ? WHERE id = ?", (raw, user["id"]))
        await db.commit()
    finally:
        await db.close()
    return {"ok": True, "locale": raw}


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
        await db.execute(
            "UPDATE users SET password_hash = ?, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?",
            (new_hash, user["id"]),
        )
        await db.commit()
    finally:
        await db.close()
    return {"ok": True}


class ChangeEmailRequest(BaseModel):
    new_email: str
    code: str


@app.post("/api/auth/change-email")
async def change_email(req: ChangeEmailRequest, user=Depends(get_current_user)):
    email = req.new_email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(400, "邮箱格式不正确")
    await _consume_verification_code(email, "change-email", req.code)
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


class DeleteAccountRequest(BaseModel):
    password: str
    code: str
    confirm: str  # must be "DELETE"


@app.post("/api/auth/delete-account")
async def delete_account(req: DeleteAccountRequest, user=Depends(get_current_user)):
    """Self-service account cancellation.

    Safety rails:
      * Admin accounts cannot be self-deleted.
      * User must re-auth (password) and prove email ownership (6-digit code).
      * User must type DELETE as confirmation.
      * Blocks if any subscription is still active.
      * Blocks if any owned backend is currently listed or has a pending review.
      * Blocks if the account has had billable usage in the last
        SETTLE_IDLE_MINUTES (prevents losing in-flight requests).
      * Blocks if the running month has uninvoiced usage — user must
        early-settle first via POST /api/billing/settle-now.
      * Blocks if any invoice remains unpaid.

    Effects (soft-delete, to preserve financial/audit trail):
      * users.is_active = 0
      * username/email anonymised to release uniqueness for future registrations
      * all api_keys disabled
      * all subscriptions deactivated
      * all owned backends taken offline (listing_status=offline, enabled=0)
      * invoices & usage_logs are kept intact with the same user_id
    """
    if user["role"] == "admin":
        raise HTTPException(400, "管理员账号不能自助注销")
    if (req.confirm or "").strip().upper() != "DELETE":
        raise HTTPException(400, '请在确认框中输入 "DELETE"')
    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(400, "密码错误")

    email = (user["email"] or "").strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(400, "账号邮箱无效，请先修改邮箱")
    await _consume_verification_code(email, "delete-account", req.code)

    uid = user["id"]
    db = await get_db()
    try:
        # Subscription gate: all subscriptions must be cancelled first.
        cur = await db.execute(
            "SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ? AND is_active = 1",
            (uid,),
        )
        row = await cur.fetchone()
        if row and row["n"]:
            raise HTTPException(400, "请先取消全部订阅后再注销")

        # Provider gate: any listed / under-review backend blocks deletion so
        # the admin queue does not end up referencing a ghost user.
        cur = await db.execute(
            "SELECT COUNT(*) AS n FROM backends WHERE owner_id = ? "
            "AND listing_status IN ('listed', 'pending')",
            (uid,),
        )
        row = await cur.fetchone()
        if row and row["n"]:
            raise HTTPException(400, "请先下架所有服务并撤回审核后再注销")
    finally:
        await db.close()

    # Idle gate: block if there is billable usage within the last
    # SETTLE_IDLE_MINUTES — prevents deleting while in-flight requests still
    # accrue cost, and prevents skipping the early-settle step below.
    idle_ok, last_activity = await is_user_idle_for_settle(uid)
    if not idle_ok:
        raise HTTPException(
            400,
            f"账户在最近 {SETTLE_IDLE_MINUTES} 分钟内仍有计费（{last_activity} CST），请等待静默后再注销",
        )

    # Financial gate: can't quit with unpaid invoices, and must have settled
    # the running month first (current_month_cost > 0 means uninvoiced usage
    # remains — user should call POST /api/billing/settle-now first).
    billing = await get_billing_status(uid)
    if billing.get("unpaid_total", 0) > 0:
        raise HTTPException(400, "存在未支付账单，请先结清后再注销")
    if billing.get("current_month_cost", 0) > 0:
        raise HTTPException(
            400,
            "当前月份仍有未出账用量，请先在账单页「提前结清本月账单」并结清后再注销",
        )

    db = await get_db()
    try:
        anon_suffix = secrets.token_hex(4)
        # Preserve original username in anonymized handle for audit traceability,
        # while keeping the row collision-free via uid+random suffix.
        safe_orig = re.sub(r"[^A-Za-z0-9_.-]", "_", user["username"] or "")[:32] or "user"
        anon_username = f"deleted_{uid}_{anon_suffix}_{safe_orig}"
        anon_email = f"deleted_{uid}_{anon_suffix}@deleted.invalid"

        await db.execute("UPDATE api_keys SET is_active = 0 WHERE user_id = ?", (uid,))
        await db.execute("UPDATE subscriptions SET is_active = 0, is_activated = 0 WHERE user_id = ?", (uid,))
        await db.execute(
            "UPDATE backends SET enabled = 0, listing_status = 'offline' WHERE owner_id = ?",
            (uid,),
        )
        await db.execute(
            "UPDATE users SET is_active = 0, username = ?, email = ?, "
            "active_subscription_id = NULL, token_version = COALESCE(token_version, 0) + 1 "
            "WHERE id = ?",
            (anon_username, anon_email, uid),
        )
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
    if user["role"] == "admin":
        raise HTTPException(status_code=403, detail="Admin accounts cannot create API keys")
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
    client_info: dict = {}
    # Model-card metadata (optional; used on the /models/[id] page).
    context_length: int | None = None
    capabilities: list[str] = []  # subset of {"streaming","tools","reasoning","json_output"}
    description: str | None = None


ALLOWED_MODEL_FAMILIES = ["Qwen", "THUDM", "deepseek-ai", "google", "OpenAI"]

# Capability flags advertised on the /models/[id] page. Keep the list short
# and stable; rendering / i18n on the FE keys off these strings.
ALLOWED_CAPABILITIES = ["streaming", "tools", "reasoning", "json_output"]

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
        "DeepSeek-R1-0528-Qwen3-8B",
        "DeepSeek-R1-Distill-Qwen-7B", "DeepSeek-R1-Distill-Qwen-14B",
        "DeepSeek-R1-Distill-Qwen-32B", "DeepSeek-R1-Distill-Llama-70B",
        "DeepSeek-V3", "DeepSeek-V3.2-Exp",
    ],
    "google": [
        "gemma-4-31B-it",
    ],
    "OpenAI": [
        "GPT-5.4",
        "GPT-5.5",
        "GPT-oss-120B",
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
    req.name = (req.name or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", req.name):
        raise HTTPException(400, "后端名只能含字母、数字、 . _ - （不能有 / 或空格），长度 1-64")
    if req.mode not in ("direct", "tunnel"):
        raise HTTPException(400, "mode must be 'direct' or 'tunnel'")
    if req.mode == "direct" and not req.url:
        raise HTTPException(400, "url required for direct mode")
    for m in req.models:
        family = m.split("/")[0] if "/" in m else m
        if family not in ALLOWED_MODEL_FAMILIES:
            raise HTTPException(400, f"模型 {m} 不在允许的大类中，当前支持: {', '.join(ALLOWED_MODEL_FAMILIES)}")
        short = m.split("/", 1)[1] if "/" in m else m
        if short not in ALLOWED_MODELS_BY_FAMILY.get(family, []):
            raise HTTPException(400, f"模型 {m} 不在 {family} 的白名单中")

    req.client_info = _sanitize_client_info(req.client_info, req.models)

    # Validate capability flags.
    bad_caps = [c for c in req.capabilities if c not in ALLOWED_CAPABILITIES]
    if bad_caps:
        raise HTTPException(400, f"capabilities must be a subset of {ALLOWED_CAPABILITIES}; got {bad_caps}")

    db = await get_db()
    try:
        cur = await db.execute("SELECT id, owner_id FROM backends WHERE name = ?", (req.name,))
        existing = await cur.fetchone()
        if existing:
            if existing["owner_id"] == user["id"]:
                raise HTTPException(409, f"后端名 '{req.name}' 已存在，请改用编辑页修改，或换一个名字再注册")
            raise HTTPException(409, f"后端名 '{req.name}' 已被其他用户占用")
        await db.execute(
            """INSERT INTO backends (name, owner_id, url, mode, models, tags, input_price, output_price, cache_price, is_public, client_info, enabled, context_length, capabilities, description)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?)""",
            (
                req.name, user["id"], req.url, req.mode, json.dumps(req.models), json.dumps(req.tags),
                req.input_price, req.output_price, req.cache_price, json.dumps(req.client_info),
                req.context_length, json.dumps(req.capabilities), req.description,
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
        # Visibility model for soft-deletion:
        #   - admin: sees everything (including 'archived')
        #   - owner via mine=true: sees own active + own 'deleted' (NOT 'archived')
        #   - non-owner / non-admin: only active rows are visible
        if mine:
            cur = await db.execute(
                "SELECT b.*, u.username as owner_name FROM backends b LEFT JOIN users u ON b.owner_id = u.id "
                "WHERE b.owner_id = ? AND COALESCE(b.deletion_status,'') != 'archived' ORDER BY b.name",
                (user["id"],),
            )
        elif user["role"] == "admin":
            cur = await db.execute(
                "SELECT b.*, u.username as owner_name FROM backends b LEFT JOIN users u ON b.owner_id = u.id ORDER BY b.name"
            )
        else:
            cur = await db.execute(
                """SELECT b.*, u.username as owner_name FROM backends b LEFT JOIN users u ON b.owner_id = u.id
                   WHERE (b.is_public = 1 OR b.owner_id = ?)
                     AND b.deletion_status IS NULL
                   ORDER BY b.name""",
                (user["id"],),
            )
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    for r in rows:
        r["models"] = json.loads(r["models"]) if r["models"] else []
        r["tags"] = json.loads(r["tags"]) if r.get("tags") else {}
        r["capabilities"] = json.loads(r["capabilities"]) if r.get("capabilities") else []
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
        # Exclude self-usage (owner calling their own backend) — those calls
        # are 100% waived from billing/revenue, so they should not appear in
        # the provider's "expected revenue" either.
        month_start = sh_month_start()
        today = sh_day()
        owner_id = user["id"]
        cur = await db.execute(
            f"SELECT backend_id, model, "
            f"SUM(requests) AS requests, "
            f"SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, "
            f"SUM(cached_tokens) AS cached_tokens, "
            f"SUM(cost) AS cost FROM ("
            f"  SELECT backend_id, model, requests, input_tokens, output_tokens, cached_tokens, cost "
            f"  FROM usage_hourly WHERE backend_id IN ({placeholders}) "
            f"    AND user_id != ? AND substr(hour_start, 1, 10) >= ? "
            f"  UNION ALL "
            f"  SELECT backend_id, model, requests, input_tokens, output_tokens, cached_tokens, cost "
            f"  FROM usage_daily WHERE backend_id IN ({placeholders}) "
            f"    AND user_id != ? AND day >= ? AND day < ?"
            f") GROUP BY backend_id, model",
            ids + [owner_id, month_start] + ids + [owner_id, month_start, today],
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
            # Owner can preview own backends including soft-deleted ones, but
            # not after archive (which is admin-only).
            cur = await db.execute(
                "SELECT b.*, u.username as owner_name FROM backends b LEFT JOIN users u ON b.owner_id = u.id "
                "WHERE b.name = ? AND b.owner_id = ? AND COALESCE(b.deletion_status,'') != 'archived'",
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
    r["capabilities"] = json.loads(r["capabilities"]) if r.get("capabilities") else []
    return r


class UpdateBackendRequest(BaseModel):
    url: str | None = None
    models: list[str] | None = None
    tags: dict[str, str] | None = None
    input_price: float | None = None
    output_price: float | None = None
    cache_price: float | None = None
    clear_cache_price: bool = False  # explicit clear of cache_price
    is_public: bool | None = None
    client_info: dict | None = None
    clear_price: bool = False  # set True to clear pricing
    # Model-card metadata.
    context_length: int | None = None
    clear_context_length: bool = False
    capabilities: list[str] | None = None
    description: str | None = None
    clear_description: bool = False


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
    if req.capabilities is not None:
        bad_caps = [c for c in req.capabilities if c not in ALLOWED_CAPABILITIES]
        if bad_caps:
            raise HTTPException(400, f"capabilities must be a subset of {ALLOWED_CAPABILITIES}; got {bad_caps}")

    db = await get_db()
    try:
        if user["role"] == "admin":
            cur = await db.execute("SELECT id, deletion_status FROM backends WHERE name = ?", (name,))
        else:
            cur = await db.execute(
                "SELECT id, deletion_status FROM backends WHERE name = ? AND owner_id = ?",
                (name, user["id"]),
            )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Backend not found")
        if row["deletion_status"] is not None and user["role"] != "admin":
            raise HTTPException(409, "Backend has been deleted; edits are not allowed.")

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
        # Price edits are staged to pending_* and promoted at 00:00
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
        if pending_touched:
            updates.append("pending_effective_at = ?")
            params.append(effective_day)

        # Model-card metadata edits are applied immediately (not staged).
        if req.clear_context_length:
            updates.append("context_length = NULL")
        elif req.context_length is not None:
            updates.append("context_length = ?")
            params.append(req.context_length)
        if req.capabilities is not None:
            updates.append("capabilities = ?")
            params.append(json.dumps(req.capabilities))
        if req.clear_description:
            updates.append("description = NULL")
        elif req.description is not None:
            updates.append("description = ?")
            params.append(req.description)

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
    """Soft-delete a backend.

    Sets `deletion_status='deleted'` and stops routing to it (`enabled=0`,
    `listing_status='offline'`). Active subscriptions to it are deactivated.
    The row is kept until the owner's next billing cycle close, at which point
    `billing._archive_owner_deletions` advances it to `'archived'` (admin-only
    visibility). Hard delete only happens via DB maintenance.
    """
    db = await get_db()
    try:
        if user["role"] == "admin":
            cur = await db.execute(
                "SELECT id, deletion_status, listing_status, enabled FROM backends WHERE name = ?", (name,))
        else:
            cur = await db.execute(
                "SELECT id, deletion_status, listing_status, enabled FROM backends WHERE name = ? AND owner_id = ?",
                (name, user["id"]),
            )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Backend not found")
        if row["deletion_status"] is not None:
            # Already deleted (or archived) — idempotent for owners.
            return {"ok": True, "already": True}
        # Require the backend to be off the marketplace before deletion so that
        # consumers see it disappear from listings before subscriptions break.
        # Admins bypass this guard for emergency takedowns.
        if user["role"] != "admin":
            st = row["listing_status"] or ("listed" if row["enabled"] else "offline")
            if st != "offline":
                raise HTTPException(409, "请先下架后再删除")
        bid = row["id"]
        now = sh_now().strftime("%Y-%m-%d %H:%M:%S")
        await db.execute(
            "UPDATE backends SET deletion_status = 'deleted', deleted_at = ?, "
            "enabled = 0, listing_status = 'offline' WHERE id = ?",
            (now, bid),
        )
        # Subscriptions stay (so usage history references resolve), but are
        # deactivated so consumers stop getting routed.
        await db.execute(
            "UPDATE subscriptions SET is_active = 0, is_activated = 0 WHERE backend_id = ?",
            (bid,),
        )
        await db.commit()
    finally:
        await db.close()
    if hasattr(tunnel_manager, "unregister_by_name"):
        tunnel_manager.unregister_by_name(name)
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
                "SELECT enabled, listing_status, deletion_status FROM backends WHERE name = ? AND owner_id = ?",
                (name, user["id"]))
        row = await cur.fetchone()
        if not row:
            raise HTTPException(404, "Backend not found")
        if user["role"] != "admin" and row["deletion_status"] is not None:
            raise HTTPException(409, "Backend has been deleted; listing changes are not allowed.")
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


@app.post("/api/backends/{name}/check")
async def check_backend(name: str, user=Depends(require_provider)):
    """Manually trigger an online probe for a single backend.

    Owner (or admin) only. Updates `backends.status` and returns the result.
    """
    db = await get_db()
    try:
        if user["role"] == "admin":
            cur = await db.execute(
                "SELECT id, name, url, mode, client_info, deletion_status FROM backends WHERE name = ?",
                (name,),
            )
        else:
            cur = await db.execute(
                "SELECT id, name, url, mode, client_info, deletion_status FROM backends "
                "WHERE name = ? AND owner_id = ?",
                (name, user["id"]),
            )
        row = await cur.fetchone()
    finally:
        await db.close()
    if not row:
        raise HTTPException(404, "Backend not found")
    b = dict(row)
    if user["role"] != "admin" and b.get("deletion_status") is not None:
        raise HTTPException(409, "Backend has been deleted; probes are not allowed.")
    status, error = await probe_backend_status(b)
    await update_backend_status(b["id"], status)
    return {"ok": True, "status": status, "error": error}


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
            "SELECT b.id as backend_id, b.name as backend, b.models, b.tags, b.status, b.input_price, b.output_price, b.cache_price, u.username as provider "
            "FROM backends b LEFT JOIN users u ON b.owner_id = u.id "
            "WHERE b.is_public = 1 AND b.enabled = 1 AND b.deletion_status IS NULL"
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
                "currency": "USD",
            })
    return result


@app.get("/api/models/{model_id:path}/performance")
async def get_model_performance(model_id: str):
    """Per-provider performance summary (TTFT / uptime / errors over last 24h).

    Placeholder: real metrics collection is pending. We return one row per
    online+listed backend that serves the model, with `null` numeric fields
    so the FE can render an "n/a" state and stop falling back to fake data.
    """
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT b.id as backend_id, b.name as backend, b.status, u.username as provider "
            "FROM backends b LEFT JOIN users u ON b.owner_id = u.id "
            "WHERE b.is_public = 1 AND b.enabled = 1 AND b.deletion_status IS NULL"
        )
        rows = [dict(r) for r in await cur.fetchall()]
        cur = await db.execute(
            "SELECT id, models FROM backends WHERE is_public = 1 AND enabled = 1 AND deletion_status IS NULL"
        )
        id_models = {row["id"]: json.loads(row["models"]) if row["models"] else [] for row in await cur.fetchall()}
    finally:
        await db.close()
    out = []
    for r in rows:
        if model_id not in id_models.get(r["backend_id"], []):
            continue
        out.append(
            {
                "backend_id": r["backend_id"],
                "backend": r["backend"],
                "provider": r["provider"],
                "status": r["status"],
                "ttft_ms": None,
                "uptime_pct": None,
                "errors_pct": None,
                "requests_24h": None,
                "available": False,  # FE renders "—" when False
            }
        )
    return {"id": model_id, "providers": out}


@app.get("/api/models/{model_id:path}")
async def get_model_detail(model_id: str, backend_id: int | None = None, user=Depends(get_optional_user)):
    """Return full model card.

    - If `backend_id` is given (legacy single-provider mode), the response
      keeps the old flat shape for back-compat (input_price/output_price/...
      at top level) plus a `providers: [...]` list scoped to that one backend.
    - Otherwise returns model-card aggregate: top-level "best" pricing/state
      (lowest input_price, online-preferred), plus `providers` listing every
      online+listed backend that serves this model.
    """
    db = await get_db()
    try:
        # Public visibility: is_public AND enabled. Owners and admins also see
        # their own / all backends so that "preview" and own-detail pages work
        # for offline / private backends.
        if user and user.get("role") == "admin":
            visibility_clause = "1=1"
            params: tuple = ()
        elif user:
            visibility_clause = "((b.is_public = 1 AND b.enabled = 1) OR b.owner_id = ?) AND b.deletion_status IS NULL"
            params = (user["id"],)
        else:
            visibility_clause = "b.is_public = 1 AND b.enabled = 1 AND b.deletion_status IS NULL"
            params = ()
        cur = await db.execute(
            "SELECT b.id as backend_id, b.name as backend, b.models, b.tags, b.status, "
            "b.input_price, b.output_price, b.cache_price, "
            "b.context_length, b.capabilities, b.description, "
            "b.mode, b.created_at, b.updated_at, u.username as provider "
            "FROM backends b LEFT JOIN users u ON b.owner_id = u.id "
            f"WHERE {visibility_clause}",
            params,
        )
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()

    matching = []
    for r in rows:
        model_list = json.loads(r["models"]) if r["models"] else []
        if model_id not in model_list:
            continue
        if backend_id is not None and r["backend_id"] != backend_id:
            continue
        matching.append(r)

    if not matching:
        raise HTTPException(404, "Model not found")

    def _row_to_provider(r: dict) -> dict:
        return {
            "backend_id": r["backend_id"],
            "backend": r["backend"],
            "provider": r["provider"],
            "status": r["status"],
            "mode": r["mode"],
            "tags": json.loads(r["tags"]) if r.get("tags") else {},
            "input_price": r["input_price"],
            "output_price": r["output_price"],
            "cache_price": r["cache_price"],
            "currency": "USD",
            "context_length": r.get("context_length"),
            "capabilities": json.loads(r["capabilities"]) if r.get("capabilities") else [],
            "description": r.get("description"),
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
        }

    providers = [_row_to_provider(r) for r in matching]

    # Pick "best" provider for top-level fields:
    # 1. prefer online; 2. then lowest input_price (None sorts last);
    # 3. finally the most recently updated.
    def _sort_key(p: dict):
        online = 0 if p["status"] == "online" else 1
        price = p["input_price"] if p["input_price"] is not None else float("inf")
        return (online, price, p.get("updated_at") or "")

    best = sorted(providers, key=_sort_key)[0]

    # Aggregate capabilities (union across all online providers) and
    # context_length (max across all providers).
    online_providers = [p for p in providers if p["status"] == "online"] or providers
    cap_set = set()
    for p in online_providers:
        for c in p["capabilities"]:
            cap_set.add(c)
    aggregated_capabilities = [c for c in ALLOWED_CAPABILITIES if c in cap_set]
    aggregated_context = max(
        (p["context_length"] for p in online_providers if p.get("context_length")),
        default=None,
    )
    description = next(
        (p["description"] for p in online_providers if p.get("description")),
        None,
    )

    return {
        "id": model_id,
        # Legacy flat fields (preserved for callers with backend_id and for
        # the ModelCatalog page which still reads top-level info).
        "backend_id": best["backend_id"],
        "backend": best["backend"],
        "provider": best["provider"],
        "status": best["status"],
        "mode": best["mode"],
        "tags": best["tags"],
        "input_price": best["input_price"],
        "output_price": best["output_price"],
        "cache_price": best["cache_price"],
        "currency": "USD",
        "created_at": best["created_at"],
        "updated_at": best["updated_at"],
        # Model-card metadata (aggregated across providers).
        "context_length": aggregated_context,
        "capabilities": aggregated_capabilities,
        "description": description,
        # All providers serving this model (for the provider grid).
        "providers": providers,
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
        # Hide subscriptions whose underlying backend has been archived; the
        # consumer sub_key was already deactivated at delete time, but row still
        # exists for billing-history references.
        cur = await db.execute(
            "SELECT s.id, s.backend_id, s.model, s.sub_key, s.is_active, s.is_activated, s.created_at, s.sort_order, "
            "b.name as backend, b.status as backend_status, b.listing_status, b.input_price, b.output_price, b.cache_price, "
            "u.username as provider, "
            "CASE WHEN b.owner_id = ? THEN 1 ELSE 0 END as is_owned "
            "FROM subscriptions s JOIN backends b ON s.backend_id = b.id "
            "LEFT JOIN users u ON b.owner_id = u.id "
            "WHERE s.user_id = ? AND COALESCE(b.deletion_status,'') != 'archived' "
            "ORDER BY s.sort_order ASC, s.id ASC",
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
            raise HTTPException(402, f"服务已停用：有逾期未付账单 (累计 ${overdue_total:.6f})")
        over_limit, _bal, _avail = await is_over_credit_limit(sub["user_id"])
        if over_limit:
            raise HTTPException(402, f"Insufficient balance. Please top up to continue. (balance=${_bal:.6f}, credit=${_avail+(-_bal if _bal<0 else 0):.6f})")

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

    # Normalize max_tokens / max_completion_tokens for the upstream model.
    _normalize_max_tokens(body, body.get("model", ""))
    _normalize_for_reasoning(body, body.get("model", ""))
    _normalize_thinking(body, backend, body.get("model", ""))
    _inject_stream_usage(body, stream, "/v1/chat/completions")

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
    # Per-key sliding-window rate limit (default 60/min). Cheaper than a DB
    # lookup, so we check it before hitting SQLite -- DoS-style brute force
    # against a single key gets bounced immediately.
    check_api_key_rate_limit(key_hash)

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
        raise HTTPException(402, f"服务已停用：有逾期未付账单 (累计 ${overdue_total:.6f})，请结清后继续使用")
    over_limit, _bal, _avail = await is_over_credit_limit(row["user_id"])
    if over_limit:
        raise HTTPException(402, f"Insufficient balance. Please top up to continue. (balance=${_bal:.6f})")
    return row


def _accept_lang(request) -> str:
    """Return 'zh' if the client prefers Chinese, else 'en'.

    Reads the standard ``Accept-Language`` header. Anything starting with
    ``zh`` (zh, zh-CN, zh-Hans, zh-TW, ...) maps to Chinese; anything else
    (including missing header, which is common for SDK clients) falls back
    to English so third-party API consumers get an intelligible message.
    """
    try:
        al = (request.headers.get("accept-language") or "").lower()
    except Exception:
        return "en"
    # Pick the first language tag (highest q by header order is a good-enough heuristic).
    first = al.split(",")[0].strip()
    return "zh" if first.startswith("zh") else "en"


async def get_active_subscription_backend(user_id: int, auto_fallback: bool = True,
                                          requested_model: str | None = None, lang: str = "zh"):
    """Pick a backend from the user's activated subscriptions.

    - auto_fallback=True: prefer a sub whose model matches requested_model (if any);
      if none match or the matching one is offline, fall back to activated subs by
      priority and pick the first online. 503 if all offline.
    - auto_fallback=False: require requested_model to exactly match one of the
      user's activated subs; use that one. 404 if not matched; 503 if offline.

    Returns (backend_row, forced_model). Always raises HTTP 404 if the user
    has zero activated subscriptions — callers must NOT fall back to the
    public backend pool. Users must subscribe and activate at least one model
    before any request can be served."""
    db = await get_db()
    try:
        # Non-owners can only route to backends that are currently listed.
        # Owners can always reach their own backends regardless of listing_status
        # (so they can self-test pending / offline backends via their subscription).
        cur = await db.execute(
            "SELECT s.model, b.* "
            "FROM subscriptions s JOIN backends b ON b.id = s.backend_id "
            "WHERE s.user_id = ? AND s.is_active = 1 AND s.is_activated = 1 "
            "  AND (b.owner_id = ? OR b.listing_status = 'listed') "
            "ORDER BY s.sort_order ASC, s.id ASC",
            (user_id, user_id),
        )
        rows = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()

    if not rows:
        msg = ("你还没有激活任何订阅模型服务，请先订阅并激活至少一个模型"
               if lang == "zh"
               else "You have no activated model subscriptions. Please subscribe and activate at least one model before sending requests.")
        raise HTTPException(404, msg)

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
        msg = ("所有已激活的订阅模型服务都当前离线"
               if lang == "zh"
               else "All of your activated model subscriptions are currently offline.")
        raise HTTPException(503, msg)

    # Manual mode: user must specify the model
    if not requested_model:
        available = sorted({r["model"] for r in rows})
        msg = (f"自动回退已关闭，请在请求中显式指定 model，可用：{available}"
               if lang == "zh"
               else f"Automatic fallback is disabled; please specify the `model` field explicitly. Available: {available}")
        raise HTTPException(400, msg)
    matches = [r for r in rows if r["model"] == requested_model]
    if not matches:
        available = sorted({r["model"] for r in rows})
        msg = (f"模型 '{requested_model}' 不在你已激活的订阅中。可用：{available}"
               if lang == "zh"
               else f"Model '{requested_model}' is not in your activated subscriptions. Available: {available}")
        raise HTTPException(404, msg)
    r = matches[0]
    if r.get("status") != "online":
        msg = (f"模型 '{requested_model}' 的订阅服务当前离线（自动回退已关闭）"
               if lang == "zh"
               else f"The subscription serving model '{requested_model}' is currently offline (automatic fallback is disabled).")
        raise HTTPException(503, msg)
    forced_model = r.pop("model")
    return r, forced_model


async def get_activated_models(user_id: int) -> list[str]:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT DISTINCT s.model FROM subscriptions s "
            "JOIN backends b ON b.id = s.backend_id "
            "WHERE s.user_id = ? AND s.is_active = 1 AND s.is_activated = 1 "
            "  AND (b.owner_id = ? OR b.listing_status = 'listed') "
            "ORDER BY s.sort_order ASC",
            (user_id, user_id),
        )
        return [r[0] for r in await cur.fetchall()]
    finally:
        await db.close()


# Models that REQUIRE `max_completion_tokens` and reject `max_tokens` (HTTP 400).
# OpenAI 2024-09 introduced this for reasoning models (o-series) and applied it
# to GPT-5.x as well. Both OpenAI and Azure OpenAI enforce this on these models.
# Other backends (DeepSeek/Qwen/Llama/vLLM/SGLang/Claude/Gemini) keep using
# `max_tokens`, so we normalize bidirectionally based on the upstream model name.
_REASONING_MODEL_RE = re.compile(r"^(o[1-9]|gpt-5|gpt5|gpt-4o)", re.IGNORECASE)


def _normalize_max_tokens(body: dict, upstream_model: str) -> None:
    """In-place rewrite ``max_tokens`` <-> ``max_completion_tokens`` so callers
    can use either field regardless of which upstream the backend points to.

    - Upstream is an OpenAI reasoning / GPT-5 model: force `max_completion_tokens`
      (rename `max_tokens` if only the old name is present).
    - Otherwise: force `max_tokens` (rename `max_completion_tokens` if only the
      new name is present), since most OpenAI-compatible engines silently
      ignore `max_completion_tokens`.
    """
    if not isinstance(body, dict) or not isinstance(upstream_model, str):
        return
    is_reasoning = bool(_REASONING_MODEL_RE.match(upstream_model or ""))
    if is_reasoning:
        if "max_tokens" in body and "max_completion_tokens" not in body:
            body["max_completion_tokens"] = body.pop("max_tokens")
    else:
        if "max_completion_tokens" in body and "max_tokens" not in body:
            body["max_tokens"] = body.pop("max_completion_tokens")


# Fields that Azure OpenAI / OpenAI reject on reasoning models (HTTP 400). We
# silently strip them rather than fail the request, so a generic OpenAI client
# can target a reasoning backend without changing its request shape. Callers
# that genuinely want them should target a non-reasoning backend.
_REASONING_REJECTED_FIELDS = (
    "top_p", "top_k", "presence_penalty", "frequency_penalty",
    "logprobs", "top_logprobs",
)


def _normalize_for_reasoning(body: dict, upstream_model: str) -> None:
    """Strip / coerce parameters that reasoning models (o-series, GPT-5.x) reject.

    - `temperature`: only `1` is accepted; drop any other value (Azure 400s).
    - `top_p`/`top_k`/penalties/logprobs: drop entirely.
    - Pass-through whitelist: `reasoning_effort` (low/medium/high) if present.
    """
    if not isinstance(body, dict):
        return
    if not _REASONING_MODEL_RE.match(upstream_model or ""):
        return
    t = body.get("temperature")
    if t is not None and t != 1 and t != 1.0:
        body.pop("temperature", None)
    for k in _REASONING_REJECTED_FIELDS:
        body.pop(k, None)
    eff = body.get("reasoning_effort")
    if eff is not None and eff not in ("low", "medium", "high"):
        body.pop("reasoning_effort", None)


def _inject_stream_usage(body: dict, stream: bool, path: str) -> None:
    """Force ``stream_options.include_usage = True`` on streaming OpenAI chat /
    completions calls so the final SSE chunk carries token counts. vLLM and
    several OpenAI-compatible backends omit usage in stream by default."""
    if not stream or path not in ("/v1/chat/completions", "/v1/completions"):
        return
    if not isinstance(body, dict):
        return
    opts = body.get("stream_options")
    if not isinstance(opts, dict):
        opts = {}
    opts.setdefault("include_usage", True)
    body["stream_options"] = opts


# Valid values for `reasoning_effort` (OpenAI 2025 spec, incl. "minimal").
_REASONING_EFFORT_VALUES = ("minimal", "low", "medium", "high")


def _backend_family(backend: dict, upstream_model: str) -> str:
    """Classify the upstream so we know how to translate `reasoning_effort`.

    Returns one of:
      - "azure_reasoning": OpenAI o-series / GPT-5.x via Azure or OpenAI direct.
      - "siliconflow": SiliconFlow `api.siliconflow.cn` direct.
      - "vllm": self-hosted vLLM (tunnel) or AMD bridge to vLLM-compat engines.
      - "other": generic OpenAI-compatible (no thinking knob).
    """
    if _REASONING_MODEL_RE.match(upstream_model or ""):
        return "azure_reasoning"
    url = (backend or {}).get("url") or ""
    if "siliconflow.cn" in url:
        return "siliconflow"
    if (backend or {}).get("mode") == "tunnel":
        return "vllm"
    # AMD bridge :17590 currently fronts vLLM-compat (Qwen3.6) and OpenAI/GPT-oss.
    # GPT-oss isn't a thinking model, so vllm-style enable_thinking is harmless
    # for it (most servers ignore unknown chat_template_kwargs); but we play it
    # safe and default unknown OpenAI-style upstreams to "other".
    if "127.0.0.1:17590" in url or "amd" in url.lower():
        # Heuristic: if upstream model looks like a Qwen/GLM thinking variant,
        # treat as vllm; else "other".
        m = (upstream_model or "").lower()
        if "qwen" in m or "glm" in m or "thinking" in m:
            return "vllm"
        return "other"
    return "other"


def _normalize_thinking(body: dict, backend: dict, upstream_model: str) -> None:
    """Translate the unified ``reasoning_effort`` field to whatever the upstream
    actually understands, then strip the original field for non-OpenAI upstreams.

    Accepted incoming values (case-insensitive):
      - "off" / False / 0  → disable thinking
      - "minimal" / "low" / "medium" / "high" → enable thinking (level passed
        through to OpenAI reasoning models; vLLM/SF only have on/off, so any
        non-off value enables thinking).

    Per upstream:
      - azure_reasoning: keep `reasoning_effort` as-is (drop "off"; OpenAI
        accepts minimal/low/medium/high). Drop unknown values.
      - siliconflow / vllm: set
        ``extra_body.chat_template_kwargs.enable_thinking = bool``; remove the
        top-level `reasoning_effort` field so SF/vLLM don't 400 on unknown arg.
      - other: drop `reasoning_effort` silently.
    """
    if not isinstance(body, dict):
        return
    raw = body.get("reasoning_effort", None)
    family = _backend_family(backend or {}, upstream_model or "")

    # Decode incoming value into (enabled, normalized_effort).
    if raw is None:
        enabled = None  # not specified → don't touch upstream defaults
        effort = None
    elif raw is False or raw == 0 or (isinstance(raw, str) and raw.lower() == "off"):
        enabled = False
        effort = None
    elif isinstance(raw, str) and raw.lower() in _REASONING_EFFORT_VALUES:
        enabled = True
        effort = raw.lower()
    else:
        # Unknown value (e.g. True / "on" / 1 / "auto"): treat as enable, default level.
        enabled = True
        effort = "medium"

    if family == "azure_reasoning":
        if enabled is False:
            body.pop("reasoning_effort", None)
        elif enabled is True:
            body["reasoning_effort"] = effort or "medium"
        # else: leave as-is (caller didn't ask).
        return

    if family in ("siliconflow", "vllm"):
        body.pop("reasoning_effort", None)
        if enabled is None:
            return
        # SiliconFlow expects extra_body.chat_template_kwargs.enable_thinking.
        # vLLM accepts extra_body.chat_template_kwargs as well (it forwards the
        # dict into the chat template). Use extra_body for both — when the body
        # is sent to the upstream, the OpenAI SDK convention is to merge
        # `extra_body` into the top-level JSON; since we forward raw JSON we
        # send `chat_template_kwargs` at top level for vLLM, and inside
        # `extra_body` for SiliconFlow.
        if family == "siliconflow":
            extra = body.get("extra_body")
            if not isinstance(extra, dict):
                extra = {}
            ctk = extra.get("chat_template_kwargs")
            if not isinstance(ctk, dict):
                ctk = {}
            ctk["enable_thinking"] = bool(enabled)
            extra["chat_template_kwargs"] = ctk
            body["extra_body"] = extra
        else:  # vllm
            ctk = body.get("chat_template_kwargs")
            if not isinstance(ctk, dict):
                ctk = {}
            ctk["enable_thinking"] = bool(enabled)
            body["chat_template_kwargs"] = ctk
        return

    # other: drop silently.
    body.pop("reasoning_effort", None)


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



# ---------------------------------------------------------------------------
# Azure GPT-5.x compatibility shim: tools + reasoning_effort must use
# /v1/responses on the upstream. We rewrite transparently and convert the
# response back to chat.completion shape.
# ---------------------------------------------------------------------------

def _responses_path_for_backend(backend: dict, upstream_model: str) -> str:
    """Resolve the upstream path for /v1/responses-style calls.

    Per-backend override via client_info.responses_path (str). Supports
    `{model}` placeholder for providers that route by deployment in the path
    (e.g. AMD internal proxy uses /openai/{deployment}/responses).
    """
    try:
        ci = json.loads(backend["client_info"]) if backend.get("client_info") else {}
    except Exception:
        ci = {}
    tmpl = ci.get("responses_path") or "/v1/responses"
    try:
        return tmpl.format(model=upstream_model or "")
    except Exception:
        return tmpl

def _should_use_responses_fallback(body: dict, backend: dict, upstream_model: str, path: str) -> bool:
    if path != "/v1/chat/completions":
        return False
    if not isinstance(body, dict):
        return False
    try:
        ci = json.loads(backend["client_info"]) if backend.get("client_info") else {}
    except Exception:
        ci = {}
    # Per-backend opt-in: upstream only exposes the Responses API for this
    # deployment (e.g. AMD /openai/{model}/responses for codex variants).
    if ci.get("force_responses_path") is True:
        return True
    if not _REASONING_MODEL_RE.match(upstream_model or ""):
        return False
    tools = body.get("tools")
    if not (isinstance(tools, list) and tools):
        return False
    if body.get("reasoning_effort") is None:
        return False
    if ci.get("responses_fallback") is False:
        return False
    return True



def _chat_messages_to_responses_input(messages: list) -> list:
    """Convert chat.completions messages into Responses API input items."""
    out: list = []
    for m in messages or []:
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        content = m.get("content")

        # Assistant tool_calls -> one function_call item each.
        if role == "assistant" and isinstance(m.get("tool_calls"), list) and m["tool_calls"]:
            # Emit any assistant text content first (as output_text).
            if content:
                msg = {"role": "assistant", "content": _normalize_content(content, "assistant")}
                out.append(msg)
            for tc in m["tool_calls"]:
                if not isinstance(tc, dict):
                    continue
                fn = tc.get("function") or {}
                out.append({
                    "type": "function_call",
                    "call_id": tc.get("id") or "",
                    "name": fn.get("name") or "",
                    "arguments": fn.get("arguments") or "",
                })
            continue

        # tool role -> function_call_output item.
        if role == "tool":
            text = content if isinstance(content, str) else _content_to_text(content)
            out.append({
                "type": "function_call_output",
                "call_id": m.get("tool_call_id") or "",
                "output": text,
            })
            continue

        # Regular system/user/assistant message.
        if role in ("system", "user", "assistant", "developer"):
            normalized = _normalize_content(content, role)
            entry = {"role": role, "content": normalized}
            out.append(entry)
            continue

        # Unknown role: pass through.
        out.append(m)

    return out


def _normalize_content(content, role: str):
    """Map chat-style content parts to Responses-API part types.

    - string -> string (Responses accepts plain strings too).
    - list of parts -> list of parts with renamed `type`.
      user/system/developer: text -> input_text, image_url -> input_image, input_file pass.
      assistant: text -> output_text, refusal pass.
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return str(content)
    new_parts = []
    is_assistant = (role == "assistant")
    for p in content:
        if not isinstance(p, dict):
            new_parts.append(p)
            continue
        t = p.get("type")
        if t == "text":
            new_t = "output_text" if is_assistant else "input_text"
            new_parts.append({"type": new_t, "text": p.get("text", "")})
        elif t == "image_url":
            iu = p.get("image_url") or {}
            url = iu.get("url") if isinstance(iu, dict) else iu
            np = {"type": "input_image"}
            if url:
                np["image_url"] = url
            if isinstance(iu, dict) and iu.get("detail"):
                np["detail"] = iu["detail"]
            new_parts.append(np)
        elif t in ("input_text", "input_image", "output_text", "refusal", "input_file"):
            new_parts.append(p)  # already in Responses shape
        elif t == "file" or t == "input_file":
            new_parts.append({"type": "input_file", **{k: v for k, v in p.items() if k != "type"}})
        else:
            # Unknown part: best-effort fallback to text.
            txt = p.get("text") or ""
            new_t = "output_text" if is_assistant else "input_text"
            new_parts.append({"type": new_t, "text": str(txt)})
    return new_parts


def _content_to_text(content) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for p in content:
            if isinstance(p, dict):
                parts.append(p.get("text") or "")
            else:
                parts.append(str(p))
        return "".join(parts)
    return str(content)


def _chat_to_responses_body(body: dict) -> dict:
    out: dict = {}
    if "model" in body:
        out["model"] = body["model"]
    if "messages" in body:
        out["input"] = _chat_messages_to_responses_input(body["messages"] or [])
    tools = body.get("tools")
    if isinstance(tools, list):
        new_tools = []
        for t in tools:
            if isinstance(t, dict) and t.get("type") == "function" and isinstance(t.get("function"), dict):
                fn = t["function"]
                nt = {"type": "function", "name": fn.get("name")}
                if "description" in fn:
                    nt["description"] = fn.get("description")
                if "parameters" in fn:
                    nt["parameters"] = fn.get("parameters")
                if "strict" in fn:
                    nt["strict"] = fn.get("strict")
                new_tools.append(nt)
            else:
                new_tools.append(t)
        out["tools"] = new_tools
    if "tool_choice" in body:
        out["tool_choice"] = body["tool_choice"]
    if "parallel_tool_calls" in body:
        out["parallel_tool_calls"] = body["parallel_tool_calls"]
    if "reasoning_effort" in body:
        out["reasoning"] = {"effort": body["reasoning_effort"]}
    if body.get("max_completion_tokens") is not None:
        out["max_output_tokens"] = body["max_completion_tokens"]
    elif body.get("max_tokens") is not None:
        out["max_output_tokens"] = body["max_tokens"]
    rf = body.get("response_format")
    if isinstance(rf, dict):
        out["text"] = {"format": rf}
    for k in ("temperature", "top_p", "metadata", "user", "store", "stream"):
        if k in body:
            out[k] = body[k]
    return out


def _responses_to_chat_completion(data: dict) -> dict:
    out_items = data.get("output") or []
    text_parts = []
    tool_calls = []
    refusal = None
    finish_reason = "stop"
    tc_index = 0
    for item in out_items:
        if not isinstance(item, dict):
            continue
        t = item.get("type")
        if t == "message":
            for c in item.get("content") or []:
                if not isinstance(c, dict):
                    continue
                ct = c.get("type")
                if ct in ("output_text", "text"):
                    text_parts.append(c.get("text") or "")
                elif ct == "refusal":
                    refusal = c.get("refusal") or c.get("text")
        elif t == "function_call":
            tool_calls.append({
                "index": tc_index,
                "id": item.get("call_id") or item.get("id") or f"call_{tc_index}",
                "type": "function",
                "function": {
                    "name": item.get("name") or "",
                    "arguments": item.get("arguments") or "",
                },
            })
            tc_index += 1
            finish_reason = "tool_calls"
    content_text = "".join(text_parts)
    message = {"role": "assistant", "content": content_text if content_text else None}
    if tool_calls:
        message["tool_calls"] = tool_calls
    if refusal:
        message["refusal"] = refusal
    status = data.get("status")
    incomplete = (data.get("incomplete_details") or {}).get("reason")
    if incomplete == "max_output_tokens":
        finish_reason = "length"
    elif incomplete == "content_filter":
        finish_reason = "content_filter"
    elif status == "incomplete" and not tool_calls:
        finish_reason = "length"
    usage_in = data.get("usage") or {}
    usage = {
        "prompt_tokens": usage_in.get("input_tokens", 0),
        "completion_tokens": usage_in.get("output_tokens", 0),
        "total_tokens": usage_in.get("total_tokens", 0),
    }
    ind = usage_in.get("input_tokens_details") or {}
    outd = usage_in.get("output_tokens_details") or {}
    if "cached_tokens" in ind:
        usage["prompt_tokens_details"] = {"cached_tokens": ind["cached_tokens"]}
    if "reasoning_tokens" in outd:
        usage["completion_tokens_details"] = {"reasoning_tokens": outd["reasoning_tokens"]}
    return {
        "id": data.get("id") or "chatcmpl-resp",
        "object": "chat.completion",
        "created": int(data.get("created_at") or time.time()),
        "model": data.get("model") or "",
        "choices": [{"index": 0, "message": message, "finish_reason": finish_reason, "logprobs": None}],
        "usage": usage,
    }


@app.get("/v1/models")
async def openai_models(request: Request):
    api_user = await authenticate_api_key(request)
    # Only expose models the user has actively subscribed AND activated.
    # Zero activated subscriptions => empty list (mirrors the chat/completions
    # behaviour that requires at least one activated model before any request
    # can be served).
    activated_models = await get_activated_models(api_user["user_id"])
    return {
        "object": "list",
        "data": [{"id": m, "object": "model", "owned_by": "llm-gateway"} for m in activated_models],
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

    # Require at least one activated subscription. get_active_subscription_backend
    # raises 404 otherwise. No fallback to the public backend pool — users must
    # subscribe and activate a model before any request will be routed.
    auto_fallback = bool(api_user.get("auto_fallback", 1))
    requested_model = body.get("model", "")
    if isinstance(requested_model, str) and requested_model.strip().lower() == "auto":
        requested_model = ""
        auto_fallback = True
    lang = _accept_lang(request)
    backend, forced_model = await get_active_subscription_backend(
        api_user["user_id"], auto_fallback, requested_model, lang=lang)
    body["model"] = forced_model
    model = forced_model

    # Remember the user-facing model name for usage logging (before rewrite)
    display_model = model

    # Rewrite model name to served name if mapping exists
    client_info = json.loads(backend["client_info"]) if backend.get("client_info") else {}
    model_map = client_info.get("model_map", {})
    if model in model_map:
        body["model"] = model_map[model]

    # Normalize max_tokens / max_completion_tokens for the upstream model.
    _normalize_max_tokens(body, body.get("model", ""))
    _normalize_for_reasoning(body, body.get("model", ""))
    _normalize_thinking(body, backend, body.get("model", ""))

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
    use_responses_fallback = _should_use_responses_fallback(body, backend, body.get("model", ""), path)
    if use_responses_fallback:
        upstream_path = _responses_path_for_backend(backend, body.get("model", ""))
        upstream_body = _chat_to_responses_body(body)
    else:
        upstream_path = path
        upstream_body = body
    url = f"{backend['url'].rstrip('/')}{upstream_path}"
    headers = _upstream_headers(backend)
    log_model = display_model or body.get("model", "")

    if stream and not use_responses_fallback:
        return StreamingResponse(
            _stream_direct(api_user, backend, body, url, input_price, output_price, headers, usage_keys, log_model,
                           cache_price=cache_price),
            media_type="text/event-stream",
        )
    if stream and use_responses_fallback:
        nonstream_body = dict(upstream_body); nonstream_body.pop("stream", None)
        return StreamingResponse(
            _stream_responses_as_chat(api_user, backend, url, nonstream_body, headers,
                                     input_price, output_price, log_model, cache_price),
            media_type="text/event-stream",
        )

    async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT) as client:
        resp = await client.post(url, json=upstream_body, headers=headers)
        try:
            data = resp.json()
        except Exception:
            raise HTTPException(502, f"上游返回非 JSON ({resp.status_code}): {(resp.text or '')[:200]}")
    if not (200 <= resp.status_code < 300):
        raise HTTPException(resp.status_code, data if isinstance(data, dict) else {"error": str(data)[:500]})
    if use_responses_fallback and isinstance(data, dict) and data.get("object") == "response":
        _resp_usage = _extract_usage(data, ("input_tokens", "output_tokens"))
        data = _responses_to_chat_completion(data)
        await _record_usage(api_user, backend, log_model, _resp_usage, input_price, output_price,
                            cache_price=cache_price)
        return data
    # Some upstreams (e.g. SiliconFlow) return HTTP 200 with `{"code":<nonzero>,
    # "message":...,"data":null}` instead of a real chat completion. Treat as
    # error so callers don't get a silent empty body.
    if isinstance(data, dict) and not data.get("choices"):
        code = data.get("code")
        msg = data.get("message") or data.get("error")
        if code is not None or msg:
            raise HTTPException(502, {"upstream_code": code, "upstream_message": msg, "backend": backend.get("name")})

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
            # If upstream rejected the request (4xx/5xx) or returned a JSON
            # error envelope with HTTP 200 (SiliconFlow style), surface it as
            # a single SSE error chunk instead of a silent 0-byte stream.
            ctype = (resp.headers.get("content-type") or "").lower()
            non_sse = ("text/event-stream" not in ctype)
            if not (200 <= resp.status_code < 300) or non_sse:
                raw = await resp.aread()
                excerpt = raw.decode("utf-8", "replace")[:500]
                payload = {
                    "error": {
                        "message": f"upstream {resp.status_code} {ctype or 'unknown'}: {excerpt}",
                        "type": "upstream_error",
                        "code": resp.status_code,
                        "backend": backend.get("name"),
                    }
                }
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"
                return
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



async def _stream_responses_as_chat(api_user, backend, url, body, headers,
                                    input_price, output_price, log_model, cache_price):
    """Call /v1/responses non-stream and emit one chat.completion.chunk + [DONE]."""
    try:
        async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT) as client:
            resp = await client.post(url, json=body, headers=headers)
        ctype = (resp.headers.get("content-type") or "").lower()
        if not (200 <= resp.status_code < 300) or "application/json" not in ctype:
            excerpt = (resp.text or "")[:500]
            payload = {"error": {"message": f"upstream {resp.status_code} {ctype or 'unknown'}: {excerpt}",
                                  "type": "upstream_error", "code": resp.status_code,
                                  "backend": backend.get("name")}}
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
            return
        data = resp.json()
    except Exception as e:
        payload = {"error": {"message": f"upstream error: {e}", "type": "upstream_error",
                              "backend": backend.get("name")}}
        yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"
        return

    resp_usage = _extract_usage(data, ("input_tokens", "output_tokens"))
    chat = _responses_to_chat_completion(data)
    msg = chat["choices"][0]["message"]
    finish = chat["choices"][0]["finish_reason"]
    delta = {"role": "assistant"}
    if msg.get("content"):
        delta["content"] = msg["content"]
    if msg.get("tool_calls"):
        delta["tool_calls"] = msg["tool_calls"]
    if msg.get("refusal"):
        delta["refusal"] = msg["refusal"]
    chunk = {
        "id": chat["id"],
        "object": "chat.completion.chunk",
        "created": chat["created"],
        "model": chat["model"],
        "choices": [{"index": 0, "delta": delta, "finish_reason": None, "logprobs": None}],
    }
    yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
    final = {
        "id": chat["id"],
        "object": "chat.completion.chunk",
        "created": chat["created"],
        "model": chat["model"],
        "choices": [{"index": 0, "delta": {}, "finish_reason": finish, "logprobs": None}],
        "usage": chat.get("usage"),
    }
    yield f"data: {json.dumps(final, ensure_ascii=False)}\n\n"
    yield "data: [DONE]\n\n"
    await _record_usage(api_user, backend, log_model, resp_usage, input_price, output_price,
                        cache_price=cache_price)


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
    # Reaching _record_usage means the upstream returned a usable response;
    # tell the health-check loop it can skip its next dry-run for this backend.
    try:
        mark_backend_success(backend["id"])
    except Exception:
        pass
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
    hour_start = sh_hour_start()

    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO usage_logs (user_id, api_key_id, backend_id, model, input_tokens, output_tokens, cached_tokens, cost) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (api_user["user_id"], api_user["key_id"], backend["id"], model, input_tokens, output_tokens, cached_tokens, cost),
        )
        # Hourly rollup (Asia/Shanghai).
        await db.execute(
            """INSERT INTO usage_hourly(user_id, backend_id, model, hour_start,
                                        requests, input_tokens, output_tokens, cached_tokens, cost)
               VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
               ON CONFLICT(user_id, backend_id, model, hour_start) DO UPDATE SET
                   requests      = requests      + 1,
                   input_tokens  = input_tokens  + excluded.input_tokens,
                   output_tokens = output_tokens + excluded.output_tokens,
                   cached_tokens = cached_tokens + excluded.cached_tokens,
                   cost          = cost          + excluded.cost""",
            (api_user["user_id"], backend["id"], model, hour_start,
             input_tokens, output_tokens, cached_tokens, cost),
        )
        await db.commit()
    finally:
        await db.close()

    # Deduct balance for non-self usage (self-owned backend is fully waived
    # — owner shouldn't pay themselves). Done outside the usage-record txn so
    # a balance race doesn't roll back the recorded usage row.
    try:
        owner_id = backend.get("owner_id") if isinstance(backend, dict) else None
        if cost > 0 and owner_id is not None and owner_id != api_user["user_id"]:
            await deduct_user_balance(api_user["user_id"], cost)
    except Exception:
        # Balance deduction failure must not break the call response path.
        pass


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
        # is_self = 1 when the serving backend belongs to the requester;
        # such usage is fully waived in summaries (self_cost), and the
        # billable amount is total_cost - self_cost.
        cur = await db.execute(
            """SELECT model, 'USD' AS currency,
                      SUM(input_tokens) AS total_input,
                      SUM(output_tokens) AS total_output,
                      SUM(cached_tokens) AS total_cached,
                      SUM(cost) AS total_cost,
                      SUM(CASE WHEN is_self = 1 THEN cost ELSE 0 END) AS self_cost,
                      SUM(CASE WHEN is_self = 1 THEN 0 ELSE cost END) AS billable_cost,
                      SUM(requests) AS requests
               FROM (
                   SELECT u.model, u.input_tokens, u.output_tokens, u.cached_tokens,
                          u.cost, u.requests,
                          CASE WHEN b.owner_id = ? THEN 1 ELSE 0 END AS is_self
                   FROM usage_daily u
                   LEFT JOIN backends b ON u.backend_id = b.id
                   WHERE u.user_id = ? AND u.day >= ? AND u.day < ?
                   UNION ALL
                   SELECT u.model, u.input_tokens, u.output_tokens, u.cached_tokens,
                          u.cost, u.requests,
                          CASE WHEN b.owner_id = ? THEN 1 ELSE 0 END AS is_self
                   FROM usage_hourly u
                   LEFT JOIN backends b ON u.backend_id = b.id
                   WHERE u.user_id = ? AND substr(u.hour_start, 1, 10) >= ?
               )
               GROUP BY model
               ORDER BY billable_cost DESC, total_cost DESC""",
            (user["id"], user["id"], month_start, today,
             user["id"], user["id"], month_start),
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
            """SELECT u.hour_start, u.model, 'USD' AS currency,
                      SUM(u.requests) AS requests,
                      SUM(u.input_tokens) AS total_input,
                      SUM(u.output_tokens) AS total_output,
                      SUM(u.cached_tokens) AS total_cached,
                      SUM(u.cost) AS total_cost,
                      SUM(CASE WHEN b.owner_id = ? THEN u.cost ELSE 0 END) AS self_cost,
                      SUM(CASE WHEN b.owner_id = ? THEN 0 ELSE u.cost END) AS billable_cost
               FROM usage_hourly u
               LEFT JOIN backends b ON u.backend_id = b.id
               WHERE u.user_id = ? AND substr(u.hour_start, 1, 10) = ?
               GROUP BY u.hour_start, u.model
               ORDER BY u.hour_start DESC, billable_cost DESC, total_cost DESC""",
            (user["id"], user["id"], user["id"], today),
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
            """SELECT u.day, u.model, 'USD' AS currency,
                      SUM(u.requests) AS requests,
                      SUM(u.input_tokens) AS total_input,
                      SUM(u.output_tokens) AS total_output,
                      SUM(u.cached_tokens) AS total_cached,
                      SUM(u.cost) AS total_cost,
                      SUM(CASE WHEN b.owner_id = ? THEN u.cost ELSE 0 END) AS self_cost,
                      SUM(CASE WHEN b.owner_id = ? THEN 0 ELSE u.cost END) AS billable_cost
               FROM usage_daily u
               LEFT JOIN backends b ON u.backend_id = b.id
               WHERE u.user_id = ? AND u.day >= ? AND u.day < ?
               GROUP BY u.day, u.model
               ORDER BY u.day DESC, billable_cost DESC, total_cost DESC""",
            (user["id"], user["id"], user["id"], earliest_day, today),
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
            "SELECT id, username, email, role, is_active, verified, created_at, "
            "COALESCE(balance, 0) AS balance, COALESCE(credit_limit_cents, 0) AS credit_limit_cents "
            "FROM users ORDER BY id"
        )
        users = [dict(r) for r in await cur.fetchall()]
    finally:
        await db.close()
    for u in users:
        u["balance"] = float(u.get("balance") or 0.0)
        u["credit_limit_usd"] = float(u.get("credit_limit_cents") or 0) / 100.0
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
        # Bump token_version unconditionally so that disabling a user also
        # invalidates any JWT they currently hold; re-enabling is harmless
        # (they'll just need to sign in again).
        await db.execute(
            "UPDATE users SET is_active = CASE WHEN is_active=1 THEN 0 ELSE 1 END, "
            "token_version = COALESCE(token_version, 0) + 1 WHERE id = ?",
            (user_id,),
        )
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
            """SELECT u.username, t.model, 'USD' AS currency,
                      SUM(t.input_tokens) AS total_input,
                      SUM(t.output_tokens) AS total_output,
                      SUM(t.cached_tokens) AS total_cached,
                      SUM(t.cost) AS total_cost,
                      SUM(t.requests) AS requests
               FROM (
                   SELECT user_id, model, input_tokens, output_tokens, cached_tokens, cost, requests
                   FROM usage_daily WHERE day >= ? AND day < ?
                   UNION ALL
                   SELECT user_id, model, input_tokens, output_tokens, cached_tokens, cost, requests
                   FROM usage_hourly WHERE substr(hour_start, 1, 10) >= ?
               ) t
               JOIN users u ON u.id = t.user_id
               GROUP BY u.username, t.model
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
    host = CONFIG.get("server", {}).get("host", "127.0.0.1")
    uvicorn.run("gateway:app", host=host, port=port, reload=False)
