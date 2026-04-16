"""
LLM Gateway — 轻量级 OpenAI 兼容 API 网关
单文件实现：路由 / 鉴权 / 计费 / 健康检查
"""

import asyncio
import hashlib
import json
import random
import secrets
import sqlite3
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import httpx
import yaml
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse

# ─── Config ──────────────────────────────────────────────────────────────────

CONFIG_PATH = Path(__file__).parent / "config.yaml"
DB_PATH = Path(__file__).parent / "gateway.db"


def load_config() -> dict:
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


CFG = load_config()

# ─── Database ────────────────────────────────────────────────────────────────


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            balance REAL DEFAULT 0,
            created_at REAL DEFAULT (unixepoch())
        );
        CREATE TABLE IF NOT EXISTS api_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            key_hash TEXT UNIQUE NOT NULL,
            key_prefix TEXT NOT NULL,
            name TEXT DEFAULT '',
            is_active INTEGER DEFAULT 1,
            created_at REAL DEFAULT (unixepoch())
        );
        CREATE TABLE IF NOT EXISTS usage_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            api_key_id INTEGER NOT NULL,
            model TEXT NOT NULL,
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            cost REAL DEFAULT 0,
            created_at REAL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_logs(user_id);
        CREATE INDEX IF NOT EXISTS idx_usage_time ON usage_logs(created_at);
        CREATE TABLE IF NOT EXISTS backends (
            name TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            models TEXT DEFAULT '[]',
            client_info TEXT DEFAULT '{}',
            owner_id INTEGER REFERENCES users(id),
            pricing TEXT DEFAULT '{}',
            model_map TEXT DEFAULT '{}',
            updated_at REAL DEFAULT (unixepoch())
        );
    """
    )
    # Migration: add columns if missing (existing DBs)
    cols = [r[1] for r in conn.execute("PRAGMA table_info(backends)").fetchall()]
    if "owner_id" not in cols:
        conn.execute("ALTER TABLE backends ADD COLUMN owner_id INTEGER REFERENCES users(id)")
    if "pricing" not in cols:
        conn.execute("ALTER TABLE backends ADD COLUMN pricing TEXT DEFAULT '{}'")
    if "model_map" not in cols:
        conn.execute("ALTER TABLE backends ADD COLUMN model_map TEXT DEFAULT '{}'")
    # Migration: add password_hash and email to users table
    user_cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
    if "password_hash" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN password_hash TEXT DEFAULT ''")
    if "email" not in user_cols:
        conn.execute("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''")
    conn.commit()
    conn.close()


DB = None  # initialized in lifespan

# ─── Auth helpers ────────────────────────────────────────────────────────────


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def verify_admin(authorization: Optional[str]):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing authorization")
    token = authorization[7:]
    admin_key = CFG["server"].get("admin_key", "")
    if not secrets.compare_digest(token, admin_key):
        raise HTTPException(403, "Invalid admin key")


def auth_user(authorization: Optional[str]) -> dict:
    """Validate API key, return {'user': Row, 'key': Row}."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing API key")
    token = authorization[7:]
    h = hash_key(token)
    row = DB.execute(
        """SELECT k.id as key_id, k.user_id, k.is_active,
                  u.id as uid, u.username, u.balance
           FROM api_keys k JOIN users u ON k.user_id = u.id
           WHERE k.key_hash = ?""",
        (h,),
    ).fetchone()
    if not row:
        raise HTTPException(401, "Invalid API key")
    if not row["is_active"]:
        raise HTTPException(403, "API key disabled")
    if row["balance"] <= 0:
        raise HTTPException(402, "Insufficient balance")
    return {
        "user_id": row["uid"],
        "key_id": row["key_id"],
        "username": row["username"],
        "balance": row["balance"],
    }


# ─── User session management ────────────────────────────────────────────────

# token -> {user_id, username, created_at}
user_sessions: dict[str, dict] = {}


def create_session(user_id: int, username: str) -> str:
    token = "sess-" + secrets.token_urlsafe(32)
    user_sessions[token] = {
        "user_id": user_id,
        "username": username,
        "created_at": time.time(),
    }
    return token


def verify_user_session(authorization: Optional[str]) -> dict:
    """Validate user session token, return session dict."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing authorization")
    token = authorization[7:]
    session = user_sessions.get(token)
    if not session:
        raise HTTPException(401, "Invalid or expired session")
    return session


def verify_admin_or_user(authorization: Optional[str]) -> dict:
    """Check if request is from admin or user session. Returns {role, ...}."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing authorization")
    token = authorization[7:]
    admin_key = CFG["server"].get("admin_key", "")
    if secrets.compare_digest(token, admin_key):
        return {"role": "admin"}
    session = user_sessions.get(token)
    if session:
        return {"role": "user", **session}
    raise HTTPException(401, "Invalid authorization")


# ─── Backend registry ────────────────────────────────────────────────────────

# Dynamic backend list: [{name, url, models}]
# Initialized from config, can be updated at runtime via /register
backends: list[dict] = []
backend_health: dict[str, bool] = {}  # name -> healthy


def _find_backend(name: str) -> Optional[dict]:
    return next((b for b in backends if b["name"] == name), None)


async def health_check_loop():
    while True:
        async with httpx.AsyncClient(timeout=5) as client:
            for b in backends:
                name = b["name"]
                try:
                    r = await client.get(f"{b['url']}/models")
                    backend_health[name] = r.status_code == 200
                except Exception:
                    backend_health[name] = False
        await asyncio.sleep(30)


def get_backends_for_model(model: str, user_id: Optional[int] = None) -> list[dict]:
    """Return healthy backends that serve the given model, filtered by owner."""
    results = []
    for b in backends:
        if model in b.get("models", []) and backend_health.get(b["name"], False):
            # Filter: user sees only own backends (owner_id matches or owner_id is None=shared)
            if user_id is not None:
                bid = b.get("owner_id")
                if bid is not None and bid != user_id:
                    continue
            results.append(b)
    return results


# ─── Pricing ─────────────────────────────────────────────────────────────────


def calc_cost(model: str, input_tokens: int, output_tokens: int, backend: dict = None) -> float:
    # Priority: backend pricing > config per-model > config default
    p = None
    if backend:
        bp = backend.get("pricing", {})
        if bp and "input" in bp:
            p = bp
    if not p:
        pricing = CFG.get("pricing", {})
        p = pricing.get(model, pricing.get("default", {"input": 1.0, "output": 3.0}))
    # price per million tokens → per token
    return input_tokens * p["input"] / 1_000_000 + output_tokens * p["output"] / 1_000_000


def record_usage(user_id: int, key_id: int, model: str, inp: int, out: int, cost: float):
    DB.execute(
        "INSERT INTO usage_logs (user_id, api_key_id, model, input_tokens, output_tokens, cost) VALUES (?,?,?,?,?,?)",
        (user_id, key_id, model, inp, out, cost),
    )
    DB.execute("UPDATE users SET balance = balance - ? WHERE id = ?", (cost, user_id))
    DB.commit()


# ─── App ─────────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    global DB
    init_db()
    DB = get_db()
    # Load persisted backends from DB
    for row in DB.execute("SELECT name, url, models, client_info, owner_id, pricing, model_map FROM backends").fetchall():
        if not _find_backend(row["name"]):
            backends.append({
                "name": row["name"],
                "url": row["url"],
                "models": json.loads(row["models"]),
                "client_info": json.loads(row["client_info"]),
                "owner_id": row["owner_id"],
                "pricing": json.loads(row["pricing"] or "{}"),
                "model_map": json.loads(row["model_map"] or "{}"),
            })
            backend_health[row["name"]] = False
    # seed from config (override DB if same name)
    for b in CFG.get("backends", []):
        existing = _find_backend(b["name"])
        if existing:
            existing["url"] = b["url"]
            existing["models"] = b.get("models", [])
        else:
            backends.append({"name": b["name"], "url": b["url"], "models": b.get("models", [])})
            backend_health[b["name"]] = False
    task = asyncio.create_task(health_check_loop())
    yield
    task.cancel()
    DB.close()


app = FastAPI(title="LLM Gateway", lifespan=lifespan)

# ─── OpenAI compatible endpoints ─────────────────────────────────────────────


@app.get("/v1/models")
async def list_models(authorization: Optional[str] = Header(None)):
    user = auth_user(authorization)
    uid = user["user_id"]
    models = set()
    for b in backends:
        if backend_health.get(b["name"], False):
            bid = b.get("owner_id")
            if bid is not None and bid != uid:
                continue
            models.update(b.get("models", []))
    data = [{"id": m, "object": "model", "owned_by": "llm-gateway"} for m in sorted(models)]
    return {"object": "list", "data": data}


@app.post("/v1/chat/completions")
async def chat_completions(request: Request, authorization: Optional[str] = Header(None)):
    user = auth_user(authorization)
    body = await request.json()
    model = body.get("model", "")
    stream = body.get("stream", False)

    avail_backends = get_backends_for_model(model, user["user_id"])
    if not avail_backends:
        raise HTTPException(503, f"No healthy backend for model '{model}'")

    # Ensure usage info is returned for billing
    if stream:
        body.setdefault("stream_options", {})
        body["stream_options"]["include_usage"] = True

    # Try backends in random order
    random.shuffle(avail_backends)
    last_err = None
    for backend in avail_backends:
        try:
            if stream:
                return await _stream_forward(backend, body, user, model)
            else:
                return await _forward(backend, body, user, model)
        except httpx.HTTPError as e:
            last_err = e
            backend_health[backend["name"]] = False
            continue

    raise HTTPException(502, f"All backends failed: {last_err}")


def _translate_model(backend: dict, body: dict) -> dict:
    """If backend has model_map, replace display model name with backend API name."""
    mm = backend.get("model_map", {})
    req_model = body.get("model", "")
    if mm and req_model in mm:
        body = {**body, "model": mm[req_model]}
    return body


async def _forward(backend: dict, body: dict, user: dict, model: str) -> JSONResponse:
    body = _translate_model(backend, body)
    async with httpx.AsyncClient(timeout=300) as client:
        r = await client.post(f"{backend['url']}/chat/completions", json=body)
        r.raise_for_status()
        data = r.json()

    usage = data.get("usage", {})
    inp = usage.get("prompt_tokens", 0)
    out = usage.get("completion_tokens", 0)
    cost = calc_cost(model, inp, out, backend)
    record_usage(user["user_id"], user["key_id"], model, inp, out, cost)
    return JSONResponse(content=data)


async def _stream_forward(backend: dict, body: dict, user: dict, model: str) -> StreamingResponse:
    body = _translate_model(backend, body)
    client = httpx.AsyncClient(timeout=300)
    req = client.build_request("POST", f"{backend['url']}/chat/completions", json=body)
    resp = await client.send(req, stream=True)
    resp.raise_for_status()

    async def generate():
        inp, out = 0, 0
        try:
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    yield f"{line}\n\n" if line.strip() else ""
                    continue
                payload = line[6:].strip()
                if payload == "[DONE]":
                    yield "data: [DONE]\n\n"
                    break
                try:
                    chunk = json.loads(payload)
                    usage = chunk.get("usage")
                    if usage:
                        inp = usage.get("prompt_tokens", inp)
                        out = usage.get("completion_tokens", out)
                except json.JSONDecodeError:
                    pass
                yield f"{line}\n\n"
        finally:
            await resp.aclose()
            await client.aclose()
            if inp or out:
                cost = calc_cost(model, inp, out, backend)
                record_usage(user["user_id"], user["key_id"], model, inp, out, cost)

    return StreamingResponse(generate(), media_type="text/event-stream")


# ─── Auth endpoints ──────────────────────────────────────────────────────────


@app.post("/auth/register")
async def register_user(request: Request):
    """Register a new user with username + email + password."""
    import re as _re
    body = await request.json()
    username = body.get("username", "").strip()
    email = body.get("email", "").strip()
    password = body.get("password", "")
    if not username or not email or not password:
        raise HTTPException(400, "用户名、邮箱和密码不能为空")
    if len(username) < 2 or len(username) > 32:
        raise HTTPException(400, "用户名长度需在 2-32 个字符之间")
    if not _re.match(r'^[a-zA-Z][a-zA-Z0-9_-]*$', username):
        raise HTTPException(400, "用户名只能包含字母、数字、下划线和连字符，且以字母开头")
    if not _re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
        raise HTTPException(400, "请输入有效的邮箱地址")
    if len(password) < 8:
        raise HTTPException(400, "密码长度至少 8 个字符")
    complexity = sum([
        bool(_re.search(r'[A-Z]', password)),
        bool(_re.search(r'[a-z]', password)),
        bool(_re.search(r'[0-9]', password)),
        bool(_re.search(r'[^a-zA-Z0-9]', password)),
    ])
    if complexity < 3:
        raise HTTPException(400, "密码需包含大写字母、小写字母、数字、特殊符号中的至少三种")
    pw_hash = hash_key(password)
    # Check email uniqueness
    if DB.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone():
        raise HTTPException(409, "该邮箱已注册")
    try:
        cur = DB.execute(
            "INSERT INTO users (username, email, password_hash, balance) VALUES (?, ?, ?, ?)",
            (username, email, pw_hash, 0),
        )
        DB.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(409, "用户名已存在")
    user_id = cur.lastrowid
    token = create_session(user_id, username)
    return {"status": "ok", "role": "user", "token": token, "user_id": user_id, "username": username}


# ─── Admin endpoints ─────────────────────────────────────────────────────────


@app.post("/admin/login")
async def admin_login(request: Request):
    """Verify credentials. Admin uses admin_key, regular users use password."""
    body = await request.json()
    username = body.get("username", "")
    key = body.get("key", "")
    # Check admin credentials first
    expected_user = CFG["server"].get("admin_username", "")
    expected_key = CFG["server"].get("admin_key", "")
    if secrets.compare_digest(username, expected_user) and secrets.compare_digest(key, expected_key):
        return {"status": "ok", "role": "admin", "token": expected_key}
    # Check regular user credentials (by username or email)
    row = DB.execute(
        "SELECT id, username, password_hash FROM users WHERE username = ? OR email = ?", (username, username)
    ).fetchone()
    if row and row["password_hash"] and secrets.compare_digest(row["password_hash"], hash_key(key)):
        token = create_session(row["id"], row["username"])
        return {"status": "ok", "role": "user", "token": token, "user_id": row["id"], "username": row["username"]}
    raise HTTPException(403, "Invalid credentials")


@app.post("/admin/users")
async def create_user(request: Request, authorization: Optional[str] = Header(None)):
    verify_admin(authorization)
    body = await request.json()
    username = body["username"]
    balance = body.get("balance", 0)
    try:
        cur = DB.execute(
            "INSERT INTO users (username, balance) VALUES (?, ?)", (username, balance)
        )
        DB.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Username already exists")
    return {"id": cur.lastrowid, "username": username, "balance": balance}


@app.post("/admin/users/{user_id}/keys")
async def create_key(user_id: int, request: Request, authorization: Optional[str] = Header(None)):
    verify_admin(authorization)
    body = await request.json()
    name = body.get("name", "")
    # Generate key: sk-<random>
    raw_key = "sk-" + secrets.token_urlsafe(32)
    prefix = raw_key[:12] + "..."
    DB.execute(
        "INSERT INTO api_keys (user_id, key_hash, key_prefix, name) VALUES (?,?,?,?)",
        (user_id, hash_key(raw_key), prefix, name),
    )
    DB.commit()
    return {"key": raw_key, "prefix": prefix, "name": name}


@app.post("/admin/users/{user_id}/balance")
async def adjust_balance(user_id: int, request: Request, authorization: Optional[str] = Header(None)):
    verify_admin(authorization)
    body = await request.json()
    amount = body["amount"]  # positive=充值, negative=扣减
    DB.execute("UPDATE users SET balance = balance + ? WHERE id = ?", (amount, user_id))
    DB.commit()
    row = DB.execute("SELECT balance FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(404, "User not found")
    return {"user_id": user_id, "balance": row["balance"]}


@app.get("/admin/users")
async def list_users(authorization: Optional[str] = Header(None)):
    verify_admin(authorization)
    rows = DB.execute("SELECT id, username, balance, created_at FROM users ORDER BY id").fetchall()
    return [dict(r) for r in rows]


@app.get("/admin/usage")
async def get_usage(
    authorization: Optional[str] = Header(None),
    user_id: Optional[int] = None,
    days: int = 7,
):
    verify_admin(authorization)
    since = time.time() - days * 86400
    if user_id:
        rows = DB.execute(
            """SELECT model, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens,
                      SUM(cost) as total_cost, COUNT(*) as requests
               FROM usage_logs WHERE user_id = ? AND created_at > ? GROUP BY model""",
            (user_id, since),
        ).fetchall()
    else:
        rows = DB.execute(
            """SELECT u.username, l.model, SUM(l.input_tokens) as input_tokens,
                      SUM(l.output_tokens) as output_tokens, SUM(l.cost) as total_cost,
                      COUNT(*) as requests
               FROM usage_logs l JOIN users u ON l.user_id = u.id
               WHERE l.created_at > ? GROUP BY u.username, l.model""",
            (since,),
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/admin/backends")
async def list_backends(authorization: Optional[str] = Header(None)):
    verify_admin(authorization)
    # Build owner_id -> username map
    user_map = {}
    for r in DB.execute("SELECT id, username FROM users").fetchall():
        user_map[r["id"]] = r["username"]
    result = []
    for b in backends:
        oid = b.get("owner_id")
        result.append({
            "name": b["name"],
            "url": b["url"],
            "models": b.get("models", []),
            "healthy": backend_health.get(b["name"], False),
            "owner_id": oid,
            "owner": user_map.get(oid, "共享") if oid else "共享",
            "pricing": b.get("pricing", {}),
            "model_map": b.get("model_map", {}),
        })
    return result


@app.post("/register")
async def register_backend(request: Request):
    """Backend self-registration.
    Auth: admin token (via body token field) OR user API key / session token (via Authorization header).
    Admin can set owner to any user; regular users automatically own their backends.
    Body: {name, url, models[], token?, client_info?, owner?, pricing?, model_map?}
    """
    body = await request.json()
    authorization = request.headers.get("authorization")
    token = body.get("token", "")
    admin_key = CFG["server"].get("admin_key", "")
    is_admin = token and secrets.compare_digest(token, admin_key)
    if not is_admin and authorization and authorization.startswith("Bearer "):
        bearer = authorization[7:]
        if secrets.compare_digest(bearer, admin_key):
            is_admin = True
    # Try user auth if not admin
    caller_user = None
    if not is_admin:
        if authorization and authorization.startswith("Bearer "):
            bearer = authorization[7:]
            # Try API key
            h = hash_key(bearer)
            row = DB.execute(
                """SELECT k.id as key_id, k.user_id, k.is_active,
                          u.id as uid, u.username
                   FROM api_keys k JOIN users u ON k.user_id = u.id
                   WHERE k.key_hash = ?""", (h,)).fetchone()
            if row and row["is_active"]:
                caller_user = {"user_id": row["uid"], "username": row["username"]}
            else:
                # Try session token
                session = user_sessions.get(bearer)
                if session:
                    caller_user = {"user_id": session["user_id"], "username": session["username"]}
        if not caller_user:
            raise HTTPException(403, "Invalid registration token or API key")
    name = body["name"]
    url = body["url"].rstrip("/")
    models = body.get("models", [])
    client_info = body.get("client_info", {})
    client_info["registered_at"] = time.time()
    pricing = body.get("pricing", {})
    model_map = body.get("model_map", {})
    # Resolve owner
    owner_id = None
    if is_admin:
        owner = body.get("owner")
        if owner is not None:
            if isinstance(owner, int):
                row = DB.execute("SELECT id FROM users WHERE id = ?", (owner,)).fetchone()
            else:
                row = DB.execute("SELECT id FROM users WHERE username = ?", (str(owner),)).fetchone()
            if not row:
                raise HTTPException(404, f"Owner user not found: {owner}")
            owner_id = row["id"]
    else:
        # Regular user: always own their own backend
        owner_id = caller_user["user_id"]
    # Regular users can only update their own backends
    existing = _find_backend(name)
    if existing and not is_admin and existing.get("owner_id") != owner_id:
        raise HTTPException(403, "You can only update your own backends")
    if existing:
        existing["url"] = url
        existing["models"] = models
        existing["client_info"] = client_info
        existing["owner_id"] = owner_id
        existing["pricing"] = pricing
        existing["model_map"] = model_map
    else:
        backends.append({"name": name, "url": url, "models": models, "client_info": client_info, "owner_id": owner_id, "pricing": pricing, "model_map": model_map})
    # Persist to DB
    DB.execute(
        "INSERT INTO backends (name, url, models, client_info, owner_id, pricing, model_map, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch()) "
        "ON CONFLICT(name) DO UPDATE SET url=excluded.url, models=excluded.models, client_info=excluded.client_info, owner_id=excluded.owner_id, pricing=excluded.pricing, model_map=excluded.model_map, updated_at=excluded.updated_at",
        (name, url, json.dumps(models), json.dumps(client_info), owner_id, json.dumps(pricing), json.dumps(model_map)),
    )
    DB.commit()
    backend_health[name] = False  # will be verified by next health check
    # immediate health check
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{url}/models")
            backend_health[name] = r.status_code == 200
    except Exception:
        pass
    return {"status": "registered", "name": name, "healthy": backend_health.get(name, False)}


@app.post("/unregister")
async def unregister_backend(request: Request):
    """Remove a backend. Body: {name, token?}. Auth: admin token or user API key/session."""
    body = await request.json()
    authorization = request.headers.get("authorization")
    token = body.get("token", "")
    admin_key = CFG["server"].get("admin_key", "")
    is_admin = token and secrets.compare_digest(token, admin_key)
    if not is_admin and authorization and authorization.startswith("Bearer "):
        bearer = authorization[7:]
        if secrets.compare_digest(bearer, admin_key):
            is_admin = True
    caller_user = None
    if not is_admin:
        if authorization and authorization.startswith("Bearer "):
            bearer = authorization[7:]
            h = hash_key(bearer)
            row = DB.execute(
                """SELECT k.id as key_id, k.user_id, k.is_active,
                          u.id as uid, u.username
                   FROM api_keys k JOIN users u ON k.user_id = u.id
                   WHERE k.key_hash = ?""", (h,)).fetchone()
            if row and row["is_active"]:
                caller_user = {"user_id": row["uid"], "username": row["username"]}
            else:
                session = user_sessions.get(bearer)
                if session:
                    caller_user = {"user_id": session["user_id"], "username": session["username"]}
        if not caller_user:
            raise HTTPException(403, "Invalid token or API key")
    name = body["name"]
    existing = _find_backend(name)
    if existing:
        if not is_admin and existing.get("owner_id") != caller_user["user_id"]:
            raise HTTPException(403, "You can only remove your own backends")
        backends.remove(existing)
        backend_health.pop(name, None)
    # Remove from DB
    if is_admin:
        DB.execute("DELETE FROM backends WHERE name = ?", (name,))
    else:
        DB.execute("DELETE FROM backends WHERE name = ? AND owner_id = ?", (name, caller_user["user_id"]))
    DB.commit()
    return {"status": "removed", "name": name}


@app.get("/admin/backends/{name}/details")
async def backend_details(name: str, authorization: Optional[str] = Header(None)):
    """Fetch detailed info about a backend: client_info + live model details from vLLM."""
    verify_admin(authorization)
    b = _find_backend(name)
    if not b:
        raise HTTPException(404, "Backend not found")
    result = {
        "name": b["name"],
        "url": b["url"],
        "models": b.get("models", []),
        "healthy": backend_health.get(name, False),
        "client_info": b.get("client_info", {}),
        "vllm_models": [],
        "vllm_version": "",
    }
    # Fetch live model details and version from vLLM
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{b['url']}/models")
            if r.status_code == 200:
                data = r.json()
                result["vllm_models"] = data.get("data", [])
            rv = await client.get(f"{b['url']}/version")
            if rv.status_code == 200:
                result["vllm_version"] = rv.json().get("version", "")
    except Exception:
        pass
    return result


@app.get("/admin/marketplace")
async def admin_marketplace(authorization: Optional[str] = Header(None)):
    """Return all backends grouped by model for the marketplace view."""
    verify_admin(authorization)
    model_map = {}  # model_name -> [{backend info}]
    for b in backends:
        healthy = backend_health.get(b["name"], False)
        pr = b.get("pricing", {})
        owner_id = b.get("owner_id")
        owner_name = "共享"
        if owner_id:
            row = DB.execute("SELECT username FROM users WHERE id = ?", (owner_id,)).fetchone()
            if row:
                owner_name = row["username"]
        info = {
            "backend": b["name"],
            "url": b["url"],
            "healthy": healthy,
            "owner": owner_name,
            "pricing": pr,
            "client_info": b.get("client_info", {}),
            "model_map": b.get("model_map", {}),
        }
        for m in b.get("models", []):
            model_map.setdefault(m, []).append(info)
    result = []
    for model, svcs in sorted(model_map.items()):
        healthy_count = sum(1 for s in svcs if s["healthy"])
        result.append({"model": model, "services": svcs, "total": len(svcs), "healthy": healthy_count})
    return result


# ─── User endpoints (for logged-in regular users) ───────────────────────────


@app.get("/user/info")
async def user_info(authorization: Optional[str] = Header(None)):
    session = verify_user_session(authorization)
    row = DB.execute(
        "SELECT id, username, balance, created_at FROM users WHERE id = ?",
        (session["user_id"],),
    ).fetchone()
    if not row:
        raise HTTPException(404, "User not found")
    keys_count = DB.execute(
        "SELECT COUNT(*) as cnt FROM api_keys WHERE user_id = ? AND is_active = 1",
        (session["user_id"],),
    ).fetchone()["cnt"]
    return {**dict(row), "keys_count": keys_count}


@app.get("/user/keys")
async def user_keys(authorization: Optional[str] = Header(None)):
    session = verify_user_session(authorization)
    rows = DB.execute(
        "SELECT id, key_prefix, name, is_active, created_at FROM api_keys WHERE user_id = ? ORDER BY id",
        (session["user_id"],),
    ).fetchall()
    return [dict(r) for r in rows]


@app.post("/user/keys")
async def user_create_key(request: Request, authorization: Optional[str] = Header(None)):
    session = verify_user_session(authorization)
    body = await request.json()
    name = body.get("name", "")
    raw_key = "sk-" + secrets.token_urlsafe(32)
    prefix = raw_key[:12] + "..."
    DB.execute(
        "INSERT INTO api_keys (user_id, key_hash, key_prefix, name) VALUES (?,?,?,?)",
        (session["user_id"], hash_key(raw_key), prefix, name),
    )
    DB.commit()
    return {"key": raw_key, "prefix": prefix, "name": name}


@app.get("/user/usage")
async def user_usage(authorization: Optional[str] = Header(None), days: int = 7):
    session = verify_user_session(authorization)
    since = time.time() - days * 86400
    rows = DB.execute(
        """SELECT model, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens,
                  SUM(cost) as total_cost, COUNT(*) as requests
           FROM usage_logs WHERE user_id = ? AND created_at > ? GROUP BY model""",
        (session["user_id"], since),
    ).fetchall()
    return [dict(r) for r in rows]


@app.get("/user/marketplace")
async def user_marketplace(authorization: Optional[str] = Header(None)):
    """Return marketplace data for regular users (same view as admin)."""
    verify_user_session(authorization)
    model_map = {}
    for b in backends:
        healthy = backend_health.get(b["name"], False)
        pr = b.get("pricing", {})
        owner_id = b.get("owner_id")
        owner_name = "共享"
        if owner_id:
            row = DB.execute("SELECT username FROM users WHERE id = ?", (owner_id,)).fetchone()
            if row:
                owner_name = row["username"]
        info = {
            "backend": b["name"],
            "url": b["url"],
            "healthy": healthy,
            "owner": owner_name,
            "pricing": pr,
            "client_info": b.get("client_info", {}),
            "model_map": b.get("model_map", {}),
        }
        for m in b.get("models", []):
            model_map.setdefault(m, []).append(info)
    result = []
    for model, svcs in sorted(model_map.items()):
        healthy_count = sum(1 for s in svcs if s["healthy"])
        result.append({"model": model, "services": svcs, "total": len(svcs), "healthy": healthy_count})
    return result


# ─── Web UI ──────────────────────────────────────────────────────────────────

ADMIN_HTML = """\
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LLM Gateway - Admin</title>
<style>
:root{--primary:#4361ee;--primary-dark:#3a56d4;--primary-light:#eef1ff;--bg:#f0f2f5;--card:#fff;--text:#1a1a2e;--text2:#64748b;--border:#e2e8f0;--success:#10b981;--danger:#ef4444;--warning:#f59e0b;--radius:10px;--shadow:0 1px 3px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;display:flex;flex-direction:column}
a{color:var(--primary);text-decoration:none}

/* ── Layout ── */
.layout{display:flex;flex:1;min-height:0}
.sidebar{width:220px;background:linear-gradient(180deg,#1a1a2e 0%,#16213e 100%);color:#fff;display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;z-index:50;transition:transform .3s}
.sidebar .brand{padding:20px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(255,255,255,.1)}
.sidebar .brand svg{flex-shrink:0}
.sidebar .brand h1{font-size:16px;font-weight:700;letter-spacing:-.5px}
.sidebar .brand small{font-size:10px;color:rgba(255,255,255,.5);display:block;margin-top:2px}
.sidebar nav{flex:1;padding:12px 0}
.sidebar nav a{display:flex;align-items:center;gap:10px;padding:10px 20px;color:rgba(255,255,255,.6);font-size:14px;font-weight:500;transition:all .15s;border-left:3px solid transparent}
.sidebar nav a:hover{color:#fff;background:rgba(255,255,255,.05)}
.sidebar nav a.active{color:#fff;background:rgba(255,255,255,.08);border-left-color:var(--primary)}
.sidebar .status{padding:16px 20px;border-top:1px solid rgba(255,255,255,.1);font-size:12px;color:rgba(255,255,255,.4)}
.sidebar .status .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--success);margin-right:6px}
.main{flex:1;margin-left:220px;display:flex;flex-direction:column;min-height:100vh}
.topbar{background:var(--card);border-bottom:1px solid var(--border);padding:14px 28px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:40}
.topbar h2{font-size:16px;font-weight:600;color:var(--text)}
.topbar .actions{display:flex;gap:8px;align-items:center}
.topbar .refresh-hint{font-size:11px;color:var(--text2)}
.content{flex:1;padding:24px 28px}
.footer{padding:12px 28px;text-align:center;font-size:12px;color:var(--text2);border-top:1px solid var(--border);background:var(--card)}

/* ── Login ── */
.login-wrap{display:flex;align-items:center;justify-content:center;min-height:100vh;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)}
.login-card{background:var(--card);border-radius:16px;padding:40px;width:400px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.3)}
.login-card .logo{text-align:center;margin-bottom:28px}
.login-card .logo svg{margin-bottom:12px}
.login-card .logo h2{font-size:22px;color:var(--text)}
.login-card .logo p{font-size:13px;color:var(--text2);margin-top:4px}
.login-tabs{display:flex;margin-bottom:22px;border-bottom:2px solid var(--border)}
.login-tab{flex:1;text-align:center;padding:10px 0;font-size:14px;font-weight:600;color:var(--text2);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .15s}
.login-tab.active{color:var(--primary);border-bottom-color:var(--primary)}
.login-tab:hover{color:var(--primary)}
.login-card .field{margin-bottom:18px}
.login-card .field label{display:block;font-size:13px;font-weight:500;color:var(--text2);margin-bottom:6px}
.login-card .field input{width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:8px;font-size:14px;transition:border .2s;outline:none;box-sizing:border-box}
.login-card .field input:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(67,97,238,.1)}
.pwd-row{display:flex;align-items:center;border:1px solid var(--border);border-radius:8px;overflow:hidden;transition:border-color .2s}
.pwd-row:focus-within{border-color:var(--primary);box-shadow:0 0 0 3px rgba(67,97,238,.1)}
.pwd-row input{flex:1;padding:10px 14px;border:none;outline:none;font-size:14px;background:transparent;min-width:0}
.pwd-row button{background:none;border:none;border-left:1px solid var(--border);padding:0 12px;cursor:pointer;color:var(--text2);display:flex;align-items:center;justify-content:center;height:40px}
.pwd-row button svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;transition:stroke .15s}
.pwd-row button:hover svg{stroke:var(--primary)}
.login-card>.login-btn{width:100%;padding:12px;background:var(--primary);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:background .15s;margin-top:4px}
.login-card>.login-btn:hover{background:var(--primary-dark)}
.login-card .err{color:var(--danger);font-size:13px;text-align:center;margin-top:10px;min-height:20px}
.pw-hint{font-size:12px;color:var(--text2);margin:-8px 0 10px;line-height:1.5}

/* ── Cards & Stats ── */
.stats-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px}
.stat-card{background:var(--card);border-radius:var(--radius);padding:18px;box-shadow:var(--shadow);display:flex;align-items:center;gap:14px}
.stat-card .icon{width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.stat-card .icon.blue{background:#eef1ff;color:var(--primary)}
.stat-card .icon.green{background:#ecfdf5;color:var(--success)}
.stat-card .icon.amber{background:#fffbeb;color:var(--warning)}
.stat-card .icon.purple{background:#f3e8ff;color:#8b5cf6}
.stat-card .info .val{font-size:22px;font-weight:700;color:var(--text);line-height:1.2}
.stat-card .info .lbl{font-size:12px;color:var(--text2);margin-top:2px}
.card{background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;margin-bottom:16px}
.card-head{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.card-head h3{font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px}
.card-body{padding:0}
.card-body.padded{padding:16px 20px}

/* ── Marketplace ── */
.mp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:18px;padding:4px 0}
.mp-model{background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;border:1px solid var(--border);transition:box-shadow .2s}
.mp-model:hover{box-shadow:0 4px 16px rgba(0,0,0,.08)}
.mp-model-head{padding:16px 18px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);background:linear-gradient(135deg,#f8faff 0%,#f0f4ff 100%)}
.mp-model-head h4{font-size:15px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:8px}
.mp-api-name{font-size:11px;color:var(--text2);background:#f1f5f9;padding:2px 8px;border-radius:8px;font-weight:500;font-family:monospace}
.mp-model-head .mp-counts{display:flex;gap:8px}
.mp-model-head .mp-counts span{font-size:11px;padding:3px 8px;border-radius:12px;font-weight:600}
.mp-counts .total{background:#eef1ff;color:var(--primary)}
.mp-counts .healthy{background:#ecfdf5;color:#059669}
.mp-svc-list{padding:0}
.mp-svc{padding:12px 18px;border-bottom:1px solid #f5f5f5;display:flex;justify-content:space-between;align-items:center;font-size:13px;transition:background .1s}
.mp-svc:last-child{border-bottom:none}
.mp-svc:hover{background:#fafbfc}
.mp-svc .svc-left{display:flex;align-items:center;gap:10px}
.mp-svc .svc-name{font-weight:600;color:var(--text)}
.mp-svc .svc-owner{font-size:11px;color:var(--text2);background:#f5f5f5;padding:2px 8px;border-radius:10px}
.mp-svc .svc-right{display:flex;align-items:center;gap:14px}
.mp-svc .svc-price{font-family:'SF Mono',Monaco,monospace;font-size:12px;color:var(--text)}
.mp-svc .svc-price .unit{font-size:10px;color:var(--text2)}
.mp-svc .svc-gpu{font-size:11px;color:var(--text2);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mp-empty{text-align:center;padding:60px 20px;color:var(--text2)}
.mp-empty svg{margin-bottom:12px;opacity:.4}
.mp-search{display:flex;gap:12px;margin-bottom:18px;align-items:center}
.mp-search input{flex:1;max-width:360px;padding:9px 14px;border-radius:8px;border:1px solid var(--border);font-size:14px}
.mp-summary{display:flex;gap:14px;margin-bottom:18px}
.mp-summary .mp-chip{padding:6px 14px;border-radius:20px;font-size:13px;font-weight:600;background:var(--card);border:1px solid var(--border);box-shadow:var(--shadow)}

/* ── Table ── */
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:10px 16px;font-weight:600;color:var(--text2);font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#fafbfc;border-bottom:1px solid var(--border)}
td{padding:10px 16px;border-bottom:1px solid #f5f5f5;vertical-align:middle}
tbody tr:hover{background:#fafbfc}
tbody tr:last-child td{border-bottom:none}
.badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}
.badge.up{background:#ecfdf5;color:#059669}
.badge.down{background:#fef2f2;color:#dc2626}

/* ── Expand detail ── */
.expand-btn{cursor:pointer;user-select:none;font-size:12px;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;transition:all .2s;color:var(--text2);background:#f5f5f5}
.expand-btn:hover{background:var(--primary-light);color:var(--primary)}
.expand-btn.open{transform:rotate(-90deg);background:var(--primary-light);color:var(--primary)}
.detail-row td{padding:0!important;border:none!important}
.detail-panel{background:#fafbfc;padding:16px 20px;font-size:13px;display:none;border-top:1px solid var(--border)}
.detail-panel.show{display:block}
.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
.detail-section{background:var(--card);border-radius:8px;padding:14px;border:1px solid var(--border)}
.detail-section h4{font-size:12px;color:var(--primary);margin-bottom:8px;font-weight:600;text-transform:uppercase;letter-spacing:.3px}
.detail-section .item{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f5f5f5}
.detail-section .item:last-child{border:none}
.detail-section .label{color:var(--text2);font-size:12px}
.detail-section .value{font-weight:500;font-family:'SF Mono',Monaco,monospace;font-size:12px;color:var(--text);text-align:right;max-width:60%;word-break:break-all}

/* ── Forms ── */
input,select,button{font-size:14px;padding:8px 14px;border-radius:8px;border:1px solid var(--border);outline:none;font-family:inherit}
input:focus,select:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(67,97,238,.08)}
button{background:var(--primary);color:#fff;border:none;cursor:pointer;font-weight:600;transition:all .15s}
button:hover{background:var(--primary-dark);transform:translateY(-1px);box-shadow:0 2px 8px rgba(67,97,238,.25)}
button:active{transform:translateY(0)}
button.secondary{background:#6b7280;color:#fff}
button.secondary:hover{background:#4b5563}
button.sm{padding:5px 12px;font-size:12px;border-radius:6px}
button.outline{background:transparent;color:var(--primary);border:1px solid var(--primary)}
button.outline:hover{background:var(--primary-light)}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.mt{margin-top:12px}

/* ── Modal ── */
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:100;display:none;animation:fadeIn .15s}
.modal{background:var(--card);border-radius:14px;padding:28px;min-width:380px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.2);animation:slideUp .2s}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.modal h3{font-size:16px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border)}
.modal .field{margin-bottom:14px}
.modal .field label{display:block;font-size:13px;font-weight:500;color:var(--text2);margin-bottom:6px}
.modal .field input{width:100%;padding:10px 14px}
.key-display{background:#fef3c7;border:1px solid #fcd34d;padding:12px;border-radius:8px;font-family:monospace;word-break:break-all;margin:12px 0;font-size:13px;line-height:1.6}

/* ── Toast ── */
.toast{position:fixed;top:20px;right:20px;background:var(--text);color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;z-index:200;animation:slideIn .3s;box-shadow:0 4px 12px rgba(0,0,0,.15)}
@keyframes slideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}

/* ── Responsive ── */
@media(max-width:768px){
  .sidebar{transform:translateX(-100%)}
  .sidebar.open{transform:translateX(0)}
  .main{margin-left:0}
  .topbar .menu-btn{display:block}
  .stats-row{grid-template-columns:repeat(2,1fr)}
  .detail-grid{grid-template-columns:1fr}
}
#app{display:none}
</style>
</head>
<body>

<!-- Login -->
<div id="login" class="login-wrap">
<div class="login-card">
  <div class="logo">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#4361ee" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
    <h2>LLM Gateway</h2>
    <p>轻量级 LLM 路由管理平台</p>
  </div>
  <div class="login-tabs">
    <span class="login-tab active" id="tab-login-btn" onclick="switchLoginTab('login')">登录</span>
    <span class="login-tab" id="tab-register-btn" onclick="switchLoginTab('register')">注册</span>
  </div>
  <div class="field" id="nickname-field" style="display:none"><label>用户名</label><input id="nickname-input" type="text" placeholder="请输入用户名" autocomplete="username"></div>
  <div class="field"><label id="username-label">用户名或邮箱</label><input id="username-input" type="text" placeholder="请输入用户名或邮箱" autocomplete="email"></div>
  <div class="field">
    <label>密码</label>
    <div class="pwd-row">
      <input id="key-input" type="password" placeholder="请输入密码" autocomplete="current-password">
      <button type="button" onclick="togglePwd()">
        <svg id="eye-open" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        <svg id="eye-closed" viewBox="0 0 24 24" style="display:none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
      </button>
    </div>
  </div>
  <p class="pw-hint" id="pw-hint" style="display:none">密码至少 8 位，需包含大写字母、小写字母、数字、特殊符号中的至少三种</p>
  <div class="field" id="confirm-pw-field" style="display:none">
    <label>确认密码</label>
    <div class="pwd-row">
      <input id="confirm-pw-input" type="password" placeholder="请再次输入密码" autocomplete="new-password">
      <button type="button" onclick="toggleConfirmPwd()">
        <svg id="confirm-eye-open" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        <svg id="confirm-eye-closed" viewBox="0 0 24 24" style="display:none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
      </button>
    </div>
  </div>
  <button class="login-btn" id="auth-btn" onclick="doAuth()">登 录</button>
  <p class="err" id="login-err"></p>
</div>
</div>

<!-- App -->
<div id="app">
<div class="layout">
  <aside class="sidebar" id="sidebar">
    <div class="brand">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      <div><h1>LLM Gateway</h1><small>Admin Console</small></div>
    </div>
    <nav>
      <a href="#" class="active" onclick="switchTab('overview',this);return false">📊 概览</a>
      <a href="#" onclick="switchTab('marketplace',this);return false">🏪 模型广场</a>
      <a href="#" onclick="switchTab('users',this);return false">👥 用户管理</a>
      <a href="#" onclick="switchTab('usage',this);return false">📈 用量统计</a>
    </nav>
    <div class="status"><span class="dot"></span>系统运行中</div>
  </aside>
  <div class="main">
    <div class="topbar">
      <h2 id="page-title">概览</h2>
      <div class="actions">
        <span class="refresh-hint" id="refresh-hint"></span>
        <button class="sm outline" onclick="ROLE==='admin'?loadAll():loadUserAll()">↻ 刷新</button>
        <button class="sm secondary" onclick="doLogout()">退出</button>
      </div>
    </div>
    <div class="content">

      <!-- Overview -->
      <div id="tab-overview">
        <div class="stats-row" id="stats"></div>
        <div class="card">
          <div class="card-head"><h3>📡 后端节点</h3></div>
          <div class="card-body">
            <table id="backends-table"><thead><tr><th>名称</th><th>地址</th><th>模型</th><th>归属</th><th>定价(输入/输出)</th><th>状态</th><th style="width:40px"></th></tr></thead><tbody></tbody></table>
          </div>
        </div>
      </div>

      <!-- Marketplace -->
      <div id="tab-marketplace" style="display:none">
        <div class="mp-search">
          <input id="mp-filter" placeholder="搜索模型名称..." oninput="filterMarketplace()">
          <button class="sm outline" onclick="loadMarketplace()">↻ 刷新</button>
        </div>
        <div class="mp-summary" id="mp-summary"></div>
        <div id="mp-content"></div>
      </div>

      <!-- Users -->
      <div id="tab-users" style="display:none">
        <div style="margin-bottom:14px"><button onclick="showModal('create-user')">+ 新建用户</button></div>
        <div class="card">
          <div class="card-head"><h3>👥 用户列表</h3></div>
          <div class="card-body">
            <table id="users-table"><thead><tr><th>ID</th><th>邮箱</th><th>余额</th><th>创建时间</th><th>操作</th></tr></thead><tbody></tbody></table>
          </div>
        </div>
      </div>

      <!-- Usage -->
      <div id="tab-usage" style="display:none">
        <div class="row" style="margin-bottom:14px">
          <span style="font-size:13px;color:var(--text2)">时间范围：</span>
          <select id="usage-days" onchange="ROLE==='admin'?loadUsage():loadUserUsage()"><option value="1">1 天</option><option value="7" selected>7 天</option><option value="30">30 天</option></select>
        </div>
        <div class="card">
          <div class="card-head"><h3>📈 用量明细</h3></div>
          <div class="card-body">
            <table id="usage-table"><thead><tr><th>用户</th><th>模型</th><th>请求数</th><th>Input Tokens</th><th>Output Tokens</th><th>费用</th></tr></thead><tbody></tbody></table>
          </div>
        </div>
      </div>

      <!-- User Dashboard -->
      <div id="tab-user-dashboard" style="display:none">
        <div class="stats-row" id="user-stats"></div>
        <div class="card" style="margin-bottom:18px">
          <div class="card-head"><h3>🔑 我的 API Keys</h3><button class="sm" style="margin-left:auto" onclick="showUserKeyModal()">+ 创建 Key</button></div>
          <div class="card-body">
            <table id="user-keys-table"><thead><tr><th>ID</th><th>前缀</th><th>名称</th><th>状态</th><th>创建时间</th></tr></thead><tbody></tbody></table>
          </div>
        </div>
      </div>

    </div>
    <div class="footer">LLM Gateway &copy; 2026 &mdash; Lightweight LLM Routing Platform</div>
  </div>
</div>
</div>

<!-- Modals -->
<div class="modal-bg" id="modal-create-user"><div class="modal">
<h3>新建用户</h3>
<div class="field"><label>邮箱</label><input id="nu-name" type="email" placeholder="输入邮箱"></div>
<div class="field"><label>初始余额</label><input id="nu-balance" type="number" value="0" step="0.01"></div>
<div class="row mt"><button onclick="createUser()">创建</button><button class="secondary" onclick="hideModals()">取消</button></div>
</div></div>

<div class="modal-bg" id="modal-add-balance"><div class="modal">
<h3>调整余额</h3>
<div class="field"><label>金额（正数充值，负数扣减）</label><input id="ab-amount" type="number" step="0.01"></div>
<input type="hidden" id="ab-uid">
<div class="row mt"><button onclick="addBalance()">确认</button><button class="secondary" onclick="hideModals()">取消</button></div>
</div></div>

<div class="modal-bg" id="modal-create-key"><div class="modal">
<h3>创建 API Key</h3>
<div class="field"><label>名称（备注）</label><input id="ck-name" placeholder="可选"></div>
<input type="hidden" id="ck-uid">
<div id="ck-result"></div>
<div class="row mt"><button onclick="createKey()">生成 Key</button><button class="secondary" onclick="hideModals()">取消</button></div>
</div></div>

<div class="modal-bg" id="modal-user-create-key"><div class="modal">
<h3>创建 API Key</h3>
<div class="field"><label>名称（备注）</label><input id="uk-name" placeholder="可选"></div>
<div id="uk-result"></div>
<div class="row mt"><button onclick="createUserKey()">生成 Key</button><button class="secondary" onclick="hideModals()">取消</button></div>
</div></div>

<script>
let KEY='';
let ROLE='';
let USER_ID=0;
let USERNAME='';
let lastRefresh=0;
let authMode='login'; // 'login' or 'register'
const H=()=>({headers:{'Authorization':'Bearer '+KEY,'Content-Type':'application/json'}});

function toast(msg,dur=2500){const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),dur);}

function switchLoginTab(mode){
  authMode=mode;
  document.getElementById('tab-login-btn').classList.toggle('active',mode==='login');
  document.getElementById('tab-register-btn').classList.toggle('active',mode==='register');
  document.getElementById('nickname-field').style.display=mode==='register'?'':'none';
  document.getElementById('pw-hint').style.display=mode==='register'?'':'none';
  document.getElementById('confirm-pw-field').style.display=mode==='register'?'':'none';
  document.getElementById('auth-btn').textContent=mode==='register'?'注 册':'登 录';
  document.getElementById('username-label').textContent=mode==='register'?'邮箱':'用户名或邮箱';
  document.getElementById('username-input').placeholder=mode==='register'?'请输入邮箱':'请输入用户名或邮箱';
  document.getElementById('username-input').type=mode==='register'?'email':'text';
  document.getElementById('login-err').textContent='';
  document.getElementById('pw-hint').style.color='var(--text2)';
}

function togglePwd(){
  var inp=document.getElementById('key-input');
  var open=document.getElementById('eye-open');
  var closed=document.getElementById('eye-closed');
  if(inp.type==='password'){
    inp.type='text';
    open.style.display='none';
    closed.style.display='';
  }else{
    inp.type='password';
    open.style.display='';
    closed.style.display='none';
  }
}
function toggleConfirmPwd(){
  var inp=document.getElementById('confirm-pw-input');
  var open=document.getElementById('confirm-eye-open');
  var closed=document.getElementById('confirm-eye-closed');
  if(inp.type==='password'){
    inp.type='text';
    open.style.display='none';
    closed.style.display='';
  }else{
    inp.type='password';
    open.style.display='';
    closed.style.display='none';
  }
}

async function doAuth(){
  if(authMode==='register') return doRegister();
  return doLogin();
}

async function doRegister(){
  const nickname=document.getElementById('nickname-input').value.trim();
  const email=document.getElementById('username-input').value.trim();
  const password=document.getElementById('key-input').value.trim();
  const confirm=document.getElementById('confirm-pw-input').value.trim();
  if(!nickname||nickname.length<2){document.getElementById('login-err').textContent='用户名长度至少 2 个字符';return;}
  if(!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(nickname)){document.getElementById('login-err').textContent='用户名只能包含字母、数字、下划线和连字符，且以字母开头';return;}
  if(!email||!email.includes('@')){document.getElementById('login-err').textContent='请输入有效的邮箱地址';return;}
  if(!password){document.getElementById('login-err').textContent='请输入密码';return;}
  if(password.length<8){document.getElementById('login-err').textContent='密码长度至少 8 个字符';return;}
  {let c=(/[A-Z]/.test(password)?1:0)+(/[a-z]/.test(password)?1:0)+(/[0-9]/.test(password)?1:0)+(/[^a-zA-Z0-9]/.test(password)?1:0);if(c<3){document.getElementById('pw-hint').style.color='var(--danger)';return;}}
  if(password!==confirm){document.getElementById('login-err').textContent='两次输入的密码不一致';return;}
  try{
    const r=await fetch('/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:nickname,email,password})});
    const data=await r.json();
    if(!r.ok){document.getElementById('login-err').textContent=data.detail||'注册失败';return;}
    KEY=data.token;ROLE=data.role;USER_ID=data.user_id;USERNAME=data.username;
    enterApp();
  }catch(e){document.getElementById('login-err').textContent='注册失败，请重试';}
}

async function doLogin(){
  const username=document.getElementById('username-input').value.trim();
  KEY=document.getElementById('key-input').value.trim();
  if(!username||!KEY){document.getElementById('login-err').textContent='请输入用户名或邮箱和密码';return;}
  try{
    const r=await fetch('/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,key:KEY})});
    const data=await r.json();
    if(!r.ok) throw 0;
    ROLE=data.role||'admin';
    KEY=data.token||KEY;
    USER_ID=data.user_id||0;
    USERNAME=data.username||username;
    enterApp();
  }catch(e){document.getElementById('login-err').textContent='用户名/邮箱或密码错误，请重试';}
}

function enterApp(){
  document.getElementById('login').style.display='none';
  document.getElementById('app').style.display='block';
  setupRoleUI();
  if(ROLE==='admin') loadAll();
  else loadUserAll();
}

function setupRoleUI(){
  const sidebar=document.getElementById('sidebar');
  const brand=sidebar.querySelector('.brand small');
  if(ROLE==='admin'){
    brand.textContent='Admin Console';
    sidebar.querySelector('nav').innerHTML=`
      <a href="#" class="active" onclick="switchTab('overview',this);return false">📊 概览</a>
      <a href="#" onclick="switchTab('marketplace',this);return false">🏪 模型广场</a>
      <a href="#" onclick="switchTab('users',this);return false">👥 用户管理</a>
      <a href="#" onclick="switchTab('usage',this);return false">📈 用量统计</a>`;
    document.getElementById('tab-user-dashboard').style.display='none';
    ['overview','marketplace','users','usage'].forEach(n=>document.getElementById('tab-'+n).style.display=n==='overview'?'':'none');
    document.getElementById('page-title').textContent='概览';
  } else {
    brand.textContent=USERNAME;
    sidebar.querySelector('nav').innerHTML=`
      <a href="#" class="active" onclick="switchTab('user-dashboard',this);return false">📊 我的概览</a>
      <a href="#" onclick="switchTab('marketplace',this);return false">🏪 模型广场</a>
      <a href="#" onclick="switchTab('usage',this);return false">📈 用量统计</a>`;
    ['overview','users'].forEach(n=>document.getElementById('tab-'+n).style.display='none');
    document.getElementById('tab-user-dashboard').style.display='';
    document.getElementById('tab-marketplace').style.display='none';
    document.getElementById('tab-usage').style.display='none';
    document.getElementById('page-title').textContent='我的概览';
  }
}

function doLogout(){KEY='';ROLE='';USER_ID=0;USERNAME='';document.getElementById('app').style.display='none';document.getElementById('login').style.display='flex';document.getElementById('key-input').value='';document.getElementById('key-input').type='password';document.getElementById('eye-open').style.display='';document.getElementById('eye-closed').style.display='none';document.getElementById('username-input').value='';document.getElementById('nickname-input').value='';document.getElementById('confirm-pw-input').value='';document.getElementById('confirm-pw-input').type='password';document.getElementById('confirm-eye-open').style.display='';document.getElementById('confirm-eye-closed').style.display='none';document.getElementById('login-err').textContent='';switchLoginTab('login');}

const tabNames={overview:'概览',marketplace:'模型服务广场',users:'用户管理',usage:'用量统计','user-dashboard':'我的概览'};
let mpData=[];
function switchTab(name,el){
  document.querySelectorAll('.sidebar nav a').forEach(a=>a.classList.remove('active'));
  if(el)el.classList.add('active');
  ['overview','marketplace','users','usage','user-dashboard'].forEach(n=>{document.getElementById('tab-'+n).style.display=n===name?'':'none';});
  document.getElementById('page-title').textContent=tabNames[name]||name;
  if(name==='marketplace') ROLE==='admin'?loadMarketplace():loadUserMarketplace();
  if(name==='users') loadUsers();
  if(name==='usage') ROLE==='admin'?loadUsage():loadUserUsage();
  if(name==='user-dashboard') loadUserDashboard();
}

async function loadAll(){
  await Promise.all([loadBackends(),loadUsers(),loadUsage()]);
  lastRefresh=Date.now();
  updateRefreshHint();
  toast('数据已刷新');
}
function updateRefreshHint(){
  if(!lastRefresh)return;
  const s=Math.round((Date.now()-lastRefresh)/1000);
  const el=document.getElementById('refresh-hint');
  if(s<10)el.textContent='刚刚更新';
  else if(s<60)el.textContent=s+'秒前更新';
  else el.textContent=Math.round(s/60)+'分钟前更新';
}
setInterval(updateRefreshHint,10000);

async function loadBackends(){
  const data=await(await fetch('/admin/backends',H())).json();
  const users=await(await fetch('/admin/users',H())).json();
  const healthy=data.filter(b=>b.healthy).length;
  const models=new Set();data.forEach(b=>b.models.forEach(m=>models.add(m)));
  const totalBal=users.reduce((s,u)=>s+u.balance,0);
  document.getElementById('stats').innerHTML=`
    <div class="stat-card"><div class="icon blue">📡</div><div class="info"><div class="val">${data.length}</div><div class="lbl">后端节点</div></div></div>
    <div class="stat-card"><div class="icon green">💚</div><div class="info"><div class="val">${healthy}/${data.length}</div><div class="lbl">健康节点</div></div></div>
    <div class="stat-card"><div class="icon purple">🤖</div><div class="info"><div class="val">${models.size}</div><div class="lbl">可用模型</div></div></div>
    <div class="stat-card"><div class="icon amber">👥</div><div class="info"><div class="val">${users.length}</div><div class="lbl">用户数</div></div></div>
    <div class="stat-card"><div class="icon blue">💰</div><div class="info"><div class="val">${totalBal.toFixed(2)}</div><div class="lbl">总余额</div></div></div>`;
  const tb=document.querySelector('#backends-table tbody');
  tb.innerHTML=data.map(b=>{const pr=b.pricing||{};const hasP=pr.input!=null;return `<tr>
    <td><strong>${b.name}</strong></td><td style="font-family:monospace;font-size:12px">${b.url}</td><td>${b.models.map(m=>'<code style="background:#f0f0f0;padding:1px 6px;border-radius:4px;font-size:12px">'+m+'</code>').join(' ')}</td>
    <td><span style="font-size:12px;color:${b.owner_id?'var(--primary)':'var(--text2)'}">${b.owner}</span></td>
    <td style="font-size:12px;font-family:monospace">${hasP?pr.input+' / '+pr.output:'<span style="color:var(--text2)">默认</span>'}</td>
    <td><span class="badge ${b.healthy?'up':'down'}">${b.healthy?'● 健康':'● 离线'}</span></td>
    <td><span class="expand-btn" onclick="toggleDetail(this,'${b.name}')">◀</span></td>
  </tr><tr class="detail-row" id="detail-${b.name}"><td colspan="7"><div class="detail-panel" id="panel-${b.name}">
    <div style="color:var(--text2);padding:8px">加载中...</div>
  </div></td></tr>`}).join('');
}

async function toggleDetail(el,name){
  const panel=document.getElementById('panel-'+name);
  const isOpen=panel.classList.toggle('show');
  el.classList.toggle('open',isOpen);
  if(!isOpen) return;
  panel.innerHTML='<div style="color:var(--text2);padding:8px">加载中...</div>';
  try{
    const d=await(await fetch('/admin/backends/'+encodeURIComponent(name)+'/details',H())).json();
    const ci=d.client_info||{};
    const gpus=ci.gpus||[];
    const regTime=ci.registered_at?new Date(ci.registered_at*1000).toLocaleString():'未知';
    const vm=d.vllm_models||[];
    panel.innerHTML=`<div class="detail-grid">
      <div class="detail-section"><h4>🖥️ 客户端信息</h4>
        <div class="item"><span class="label">主机名</span><span class="value">${ci.hostname||'未上报'}</span></div>
        <div class="item"><span class="label">操作系统</span><span class="value">${ci.os||'未上报'}</span></div>
        <div class="item"><span class="label">架构</span><span class="value">${ci.arch||'未上报'}</span></div>
        <div class="item"><span class="label">Python</span><span class="value">${ci.python||'未上报'}</span></div>
        <div class="item"><span class="label">注册时间</span><span class="value">${regTime}</span></div>
      </div>
      <div class="detail-section"><h4>🎮 显卡信息 (${gpus.length})</h4>
        ${gpus.length?gpus.map(g=>`<div class="item"><span class="label">GPU ${g.id}</span><span class="value">${g.name}${g.vram_mb?' · '+g.vram_mb+'MB':''}</span></div>`).join(''):'<div style="color:var(--text2)">未上报 GPU 信息</div>'}
      </div>
      <div class="detail-section"><h4>🤖 vLLM 模型详情</h4>
        ${d.vllm_version?`<div class="item"><span class="label">vLLM 版本</span><span class="value">${d.vllm_version}</span></div>`:''}
        ${vm.length?vm.map(m=>`<div class="item"><span class="label">${m.id}</span><span class="value">ctx: ${(m.max_model_len||0).toLocaleString()}</span></div>
        <div class="item"><span class="label">模型</span><span class="value">${m.root?(m.root.split('/').pop()||m.root):'-'}</span></div>`).join(''):'<div style="color:var(--text2)">无法获取模型详情</div>'}
      </div>
      <div class="detail-section"><h4>🔗 服务地址</h4>
        <div class="item"><span class="label">后端 URL</span><span class="value">${d.url}</span></div>
        <div class="item"><span class="label">健康状态</span><span class="value">${d.healthy?'✅ 健康':'❌ 离线'}</span></div>
      </div>
    </div>`;
  }catch(e){panel.innerHTML='<div style="color:var(--danger);padding:8px">加载失败: '+e.message+'</div>';}
}

async function loadUsers(){
  const data=await(await fetch('/admin/users',H())).json();
  const tb=document.querySelector('#users-table tbody');
  tb.innerHTML=data.map(u=>`<tr><td>${u.id}</td><td><strong>${u.username}</strong></td><td style="font-family:monospace">${u.balance.toFixed(4)}</td>
    <td>${new Date(u.created_at*1000).toLocaleString()}</td>
    <td><button class="sm" onclick="showBalanceModal(${u.id})">充值</button>
    <button class="sm secondary" onclick="showKeyModal(${u.id})">+ Key</button></td></tr>`).join('');
  if(!data.length) tb.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:24px">暂无用户</td></tr>';
}

async function loadUsage(){
  const days=document.getElementById('usage-days').value;
  const data=await(await fetch('/admin/usage?days='+days,H())).json();
  const tb=document.querySelector('#usage-table tbody');
  tb.innerHTML=data.map(r=>`<tr><td>${r.username||'-'}</td><td><code style="background:#f0f0f0;padding:1px 6px;border-radius:4px;font-size:12px">${r.model}</code></td><td>${r.requests}</td>
    <td style="font-family:monospace">${(r.input_tokens||0).toLocaleString()}</td><td style="font-family:monospace">${(r.output_tokens||0).toLocaleString()}</td>
    <td style="font-family:monospace">${(r.total_cost||0).toFixed(4)}</td></tr>`).join('');
  if(!data.length) tb.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:24px">暂无数据</td></tr>';
}

function showModal(id){document.getElementById('modal-'+id).style.display='flex';}
function hideModals(){document.querySelectorAll('.modal-bg').forEach(m=>{m.style.display='none';});document.getElementById('ck-result').innerHTML='';document.getElementById('uk-result').innerHTML='';}
document.querySelectorAll('.modal-bg').forEach(bg=>bg.addEventListener('click',e=>{if(e.target===bg)hideModals();}));

function showBalanceModal(uid){document.getElementById('ab-uid').value=uid;document.getElementById('ab-amount').value='';showModal('add-balance');}
function showKeyModal(uid){document.getElementById('ck-uid').value=uid;document.getElementById('ck-name').value='';document.getElementById('ck-result').innerHTML='';showModal('create-key');}

async function createUser(){
  const name=document.getElementById('nu-name').value.trim();
  const balance=parseFloat(document.getElementById('nu-balance').value)||0;
  if(!name){toast('请输入邮箱');return;}
  await fetch('/admin/users',{...H(),method:'POST',body:JSON.stringify({username:name,balance})});
  hideModals();loadUsers();loadBackends();toast('用户已创建');
}
async function addBalance(){
  const uid=document.getElementById('ab-uid').value;
  const amount=parseFloat(document.getElementById('ab-amount').value);
  if(isNaN(amount)){toast('请输入金额');return;}
  await fetch('/admin/users/'+uid+'/balance',{...H(),method:'POST',body:JSON.stringify({amount})});
  hideModals();loadUsers();loadBackends();toast('余额已更新');
}
async function createKey(){
  const uid=document.getElementById('ck-uid').value;
  const name=document.getElementById('ck-name').value.trim();
  const r=await(await fetch('/admin/users/'+uid+'/keys',{...H(),method:'POST',body:JSON.stringify({name})})).json();
  document.getElementById('ck-result').innerHTML='<div class="key-display">⚠️ 仅显示一次，请复制保存：<br><strong>'+r.key+'</strong></div>';
}

async function loadMarketplace(){
  try{
    mpData=await(await fetch('/admin/marketplace',H())).json();
    renderMarketplace();
  }catch(e){document.getElementById('mp-content').innerHTML='<div class="mp-empty">加载失败: '+e.message+'</div>';}
}
function renderMarketplace(){
  const filter=(document.getElementById('mp-filter').value||'').toLowerCase();
  const filtered=filter?mpData.filter(m=>m.model.toLowerCase().includes(filter)):mpData;
  const totalModels=filtered.length;
  const totalSvcs=filtered.reduce((s,m)=>s+m.total,0);
  const totalHealthy=filtered.reduce((s,m)=>s+m.healthy,0);
  document.getElementById('mp-summary').innerHTML=`
    <div class="mp-chip">🤖 ${totalModels} 个模型</div>
    <div class="mp-chip">📡 ${totalSvcs} 个服务</div>
    <div class="mp-chip">💚 ${totalHealthy} 个在线</div>`;
  if(!filtered.length){
    document.getElementById('mp-content').innerHTML='<div class="mp-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><br>没有找到匹配的模型</div>';
    return;
  }
  document.getElementById('mp-content').innerHTML='<div class="mp-grid">'+filtered.map(m=>{
    const svcs=m.services.map(s=>{
      const pr=s.pricing||{};
      const hasP=pr.input!=null;
      const gpus=(s.client_info&&s.client_info.gpus)||[];
      const gpuStr=gpus.length?gpus.map(g=>g.name).filter((v,i,a)=>a.indexOf(v)===i).join(', '):'';
      return `<div class="mp-svc">
        <div class="svc-left">
          <span class="badge ${s.healthy?'up':'down'}" style="padding:2px 8px;font-size:11px">${s.healthy?'●':'●'}</span>
          <span class="svc-name">${s.backend}</span>
          <span class="svc-owner">${s.owner}</span>
        </div>
        <div class="svc-right">
          ${gpuStr?'<span class="svc-gpu" title="'+gpuStr+'">'+gpuStr+'</span>':''}
          <span class="svc-price">${hasP?'¥'+pr.input+' <span class="unit">输入</span> / ¥'+pr.output+' <span class="unit">输出</span>':'<span class="unit">默认定价</span>'}</span>
        </div>
      </div>`;
    }).join('');
    const apiNames=[...new Set(m.services.map(s=>(s.model_map&&s.model_map[m.model])?s.model_map[m.model]:m.model).filter(n=>n!==m.model))];
    const apiTag=apiNames.length?'<span class="mp-api-name" title="API 调用名">API: '+apiNames.join(', ')+'</span>':'';
    return `<div class="mp-model">
      <div class="mp-model-head">
        <h4>🤖 ${m.model}</h4>${apiTag}
        <div class="mp-counts">
          <span class="total">${m.total} 服务</span>
          <span class="healthy">${m.healthy} 在线</span>
        </div>
      </div>
      <div class="mp-svc-list">${svcs}</div>
    </div>`;
  }).join('')+'</div>';
}
function filterMarketplace(){renderMarketplace();}

// ─── User dashboard functions ───
async function loadUserAll(){
  await Promise.all([loadUserDashboard(),loadUserMarketplace()]);
  lastRefresh=Date.now();
  updateRefreshHint();
  toast('数据已刷新');
}

async function loadUserDashboard(){
  try{
    const info=await(await fetch('/user/info',H())).json();
    const keys=await(await fetch('/user/keys',H())).json();
    document.getElementById('user-stats').innerHTML=`
      <div class="stat-card"><div class="icon blue">👤</div><div class="info"><div class="val">${info.username}</div><div class="lbl">邮箱</div></div></div>
      <div class="stat-card"><div class="icon green">💰</div><div class="info"><div class="val">${info.balance.toFixed(4)}</div><div class="lbl">余额</div></div></div>
      <div class="stat-card"><div class="icon purple">🔑</div><div class="info"><div class="val">${info.keys_count}</div><div class="lbl">活跃 Keys</div></div></div>`;
    const tb=document.querySelector('#user-keys-table tbody');
    tb.innerHTML=keys.map(k=>`<tr><td>${k.id}</td><td style="font-family:monospace;font-size:12px">${k.key_prefix}</td><td>${k.name||'-'}</td>
      <td><span class="badge ${k.is_active?'up':'down'}">${k.is_active?'活跃':'禁用'}</span></td>
      <td>${new Date(k.created_at*1000).toLocaleString()}</td></tr>`).join('');
    if(!keys.length) tb.innerHTML='<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:24px">暂无 API Key，点击上方按钮创建</td></tr>';
  }catch(e){console.error(e);}
}

async function loadUserMarketplace(){
  try{
    mpData=await(await fetch('/user/marketplace',H())).json();
    renderMarketplace();
  }catch(e){document.getElementById('mp-content').innerHTML='<div class="mp-empty">加载失败: '+e.message+'</div>';}
}

async function loadUserUsage(){
  const days=document.getElementById('usage-days').value;
  const data=await(await fetch('/user/usage?days='+days,H())).json();
  const tb=document.querySelector('#usage-table tbody');
  tb.innerHTML=data.map(r=>`<tr><td>${USERNAME}</td><td><code style="background:#f0f0f0;padding:1px 6px;border-radius:4px;font-size:12px">${r.model}</code></td><td>${r.requests}</td>
    <td style="font-family:monospace">${(r.input_tokens||0).toLocaleString()}</td><td style="font-family:monospace">${(r.output_tokens||0).toLocaleString()}</td>
    <td style="font-family:monospace">${(r.total_cost||0).toFixed(4)}</td></tr>`).join('');
  if(!data.length) tb.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:24px">暂无数据</td></tr>';
}

function showUserKeyModal(){document.getElementById('uk-name').value='';document.getElementById('uk-result').innerHTML='';showModal('user-create-key');}
async function createUserKey(){
  const name=document.getElementById('uk-name').value.trim();
  const r=await(await fetch('/user/keys',{...H(),method:'POST',body:JSON.stringify({name})})).json();
  document.getElementById('uk-result').innerHTML='<div class="key-display">⚠️ 仅显示一次，请复制保存：<br><strong>'+r.key+'</strong></div>';
  loadUserDashboard();
}

setInterval(()=>{if(KEY&&ROLE==='admin')loadBackends();},30000);
document.getElementById('key-input').addEventListener('keydown',e=>{if(e.key==='Enter')doAuth();});
document.getElementById('confirm-pw-input').addEventListener('keydown',e=>{if(e.key==='Enter')doAuth();});
</script>
</body>
</html>
"""


@app.get("/admin/", response_class=HTMLResponse)
async def admin_ui():
    return ADMIN_HTML


# ─── CLI ─────────────────────────────────────────────────────────────────────


def cli():
    import argparse

    parser = argparse.ArgumentParser(description="LLM Gateway")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("serve", help="Start the gateway server")

    p = sub.add_parser("create-user", help="Create a user")
    p.add_argument("username")
    p.add_argument("--balance", type=float, default=0)

    p = sub.add_parser("create-key", help="Create an API key")
    p.add_argument("user_id", type=int)
    p.add_argument("--name", default="")

    p = sub.add_parser("add-balance", help="Adjust user balance")
    p.add_argument("user_id", type=int)
    p.add_argument("amount", type=float)

    p = sub.add_parser("list-users", help="List all users")

    args = parser.parse_args()

    if args.command == "serve" or args.command is None:
        import uvicorn

        uvicorn.run(
            "gateway:app",
            host=CFG["server"].get("host", "0.0.0.0"),
            port=CFG["server"].get("port", 8080),
            log_level="info",
        )
    else:
        init_db()
        conn = get_db()
        if args.command == "create-user":
            cur = conn.execute(
                "INSERT INTO users (username, balance) VALUES (?, ?)",
                (args.username, args.balance),
            )
            conn.commit()
            print(f"Created user: id={cur.lastrowid} username={args.username} balance={args.balance}")

        elif args.command == "create-key":
            raw_key = "sk-" + secrets.token_urlsafe(32)
            prefix = raw_key[:12] + "..."
            conn.execute(
                "INSERT INTO api_keys (user_id, key_hash, key_prefix, name) VALUES (?,?,?,?)",
                (args.user_id, hash_key(raw_key), prefix, args.name),
            )
            conn.commit()
            print(f"API Key (save it now!): {raw_key}")

        elif args.command == "add-balance":
            conn.execute(
                "UPDATE users SET balance = balance + ? WHERE id = ?",
                (args.amount, args.user_id),
            )
            conn.commit()
            row = conn.execute("SELECT balance FROM users WHERE id = ?", (args.user_id,)).fetchone()
            print(f"User {args.user_id} balance: {row['balance']}")

        elif args.command == "list-users":
            for r in conn.execute("SELECT * FROM users ORDER BY id").fetchall():
                print(f"  id={r['id']}  user={r['username']}  balance={r['balance']:.2f}")

        conn.close()


if __name__ == "__main__":
    cli()
