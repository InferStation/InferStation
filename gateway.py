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
    if cols and ("owner_id" not in cols or "pricing" not in cols):
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
                    r = await client.get(f"{b['url']}/v1/models")
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
    for row in DB.execute("SELECT name, url, models, client_info, owner_id, pricing FROM backends").fetchall():
        if not _find_backend(row["name"]):
            backends.append({
                "name": row["name"],
                "url": row["url"],
                "models": json.loads(row["models"]),
                "client_info": json.loads(row["client_info"]),
                "owner_id": row["owner_id"],
                "pricing": json.loads(row["pricing"] or "{}"),
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


async def _forward(backend: dict, body: dict, user: dict, model: str) -> JSONResponse:
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


# ─── Admin endpoints ─────────────────────────────────────────────────────────


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
        })
    return result


@app.post("/register")
async def register_backend(request: Request):
    """Backend self-registration. Body: {name, url, models[], token, client_info?, owner?, pricing?}
    owner can be a username string or user_id int. If omitted, backend is shared (visible to all).
    pricing: {input: X, output: Y} per million tokens. If omitted, uses config default.
    """
    body = await request.json()
    token = body.get("token", "")
    admin_key = CFG["server"].get("admin_key", "")
    if not secrets.compare_digest(token, admin_key):
        raise HTTPException(403, "Invalid registration token")
    name = body["name"]
    url = body["url"].rstrip("/")
    models = body.get("models", [])
    client_info = body.get("client_info", {})
    client_info["registered_at"] = time.time()
    pricing = body.get("pricing", {})
    # Resolve owner
    owner_id = None
    owner = body.get("owner")
    if owner is not None:
        if isinstance(owner, int):
            row = DB.execute("SELECT id FROM users WHERE id = ?", (owner,)).fetchone()
        else:
            row = DB.execute("SELECT id FROM users WHERE username = ?", (str(owner),)).fetchone()
        if not row:
            raise HTTPException(404, f"Owner user not found: {owner}")
        owner_id = row["id"]
    existing = _find_backend(name)
    if existing:
        existing["url"] = url
        existing["models"] = models
        existing["client_info"] = client_info
        existing["owner_id"] = owner_id
        existing["pricing"] = pricing
    else:
        backends.append({"name": name, "url": url, "models": models, "client_info": client_info, "owner_id": owner_id, "pricing": pricing})
    # Persist to DB
    DB.execute(
        "INSERT INTO backends (name, url, models, client_info, owner_id, pricing, updated_at) VALUES (?, ?, ?, ?, ?, ?, unixepoch()) "
        "ON CONFLICT(name) DO UPDATE SET url=excluded.url, models=excluded.models, client_info=excluded.client_info, owner_id=excluded.owner_id, pricing=excluded.pricing, updated_at=excluded.updated_at",
        (name, url, json.dumps(models), json.dumps(client_info), owner_id, json.dumps(pricing)),
    )
    DB.commit()
    backend_health[name] = False  # will be verified by next health check
    # immediate health check
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{url}/v1/models")
            backend_health[name] = r.status_code == 200
    except Exception:
        pass
    return {"status": "registered", "name": name, "healthy": backend_health.get(name, False)}


@app.post("/unregister")
async def unregister_backend(request: Request):
    """Remove a backend. Body: {name, token}"""
    body = await request.json()
    token = body.get("token", "")
    admin_key = CFG["server"].get("admin_key", "")
    if not secrets.compare_digest(token, admin_key):
        raise HTTPException(403, "Invalid token")
    name = body["name"]
    existing = _find_backend(name)
    if existing:
        backends.remove(existing)
        backend_health.pop(name, None)
    # Remove from DB
    DB.execute("DELETE FROM backends WHERE name = ?", (name,))
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
            r = await client.get(f"{b['url']}/v1/models")
            if r.status_code == 200:
                data = r.json()
                result["vllm_models"] = data.get("data", [])
            rv = await client.get(f"{b['url']}/version")
            if rv.status_code == 200:
                result["vllm_version"] = rv.json().get("version", "")
    except Exception:
        pass
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
.login-card .logo{text-align:center;margin-bottom:24px}
.login-card .logo svg{margin-bottom:12px}
.login-card .logo h2{font-size:22px;color:var(--text)}
.login-card .logo p{font-size:13px;color:var(--text2);margin-top:4px}
.login-card .field{margin-bottom:16px}
.login-card .field label{display:block;font-size:13px;font-weight:500;color:var(--text2);margin-bottom:6px}
.login-card .field input{width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:8px;font-size:14px;transition:border .2s;outline:none}
.login-card .field input:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(67,97,238,.1)}
.login-card button{width:100%;padding:11px;background:var(--primary);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:background .15s}
.login-card button:hover{background:var(--primary-dark)}
.login-card .err{color:var(--danger);font-size:13px;text-align:center;margin-top:10px;min-height:20px}

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
  <div class="field"><label>管理密钥</label><input id="key-input" type="password" placeholder="sk-admin-..."></div>
  <button onclick="doLogin()">登 录</button>
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
        <button class="sm outline" onclick="loadAll()">↻ 刷新</button>
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
            <table id="backends-table"><thead><tr><th>名称</th><th>地址</th><th>模型</th><th>归属</th><th>定价(入/出)</th><th>状态</th><th style="width:40px"></th></tr></thead><tbody></tbody></table>
          </div>
        </div>
      </div>

      <!-- Users -->
      <div id="tab-users" style="display:none">
        <div style="margin-bottom:14px"><button onclick="showModal('create-user')">+ 新建用户</button></div>
        <div class="card">
          <div class="card-head"><h3>👥 用户列表</h3></div>
          <div class="card-body">
            <table id="users-table"><thead><tr><th>ID</th><th>用户名</th><th>余额</th><th>创建时间</th><th>操作</th></tr></thead><tbody></tbody></table>
          </div>
        </div>
      </div>

      <!-- Usage -->
      <div id="tab-usage" style="display:none">
        <div class="row" style="margin-bottom:14px">
          <span style="font-size:13px;color:var(--text2)">时间范围：</span>
          <select id="usage-days" onchange="loadUsage()"><option value="1">1 天</option><option value="7" selected>7 天</option><option value="30">30 天</option></select>
        </div>
        <div class="card">
          <div class="card-head"><h3>📈 用量明细</h3></div>
          <div class="card-body">
            <table id="usage-table"><thead><tr><th>用户</th><th>模型</th><th>请求数</th><th>Input Tokens</th><th>Output Tokens</th><th>费用</th></tr></thead><tbody></tbody></table>
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
<div class="field"><label>用户名</label><input id="nu-name" placeholder="输入用户名"></div>
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

<script>
let KEY='';
let lastRefresh=0;
const H=()=>({headers:{'Authorization':'Bearer '+KEY,'Content-Type':'application/json'}});

function toast(msg,dur=2500){const t=document.createElement('div');t.className='toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),dur);}

async function doLogin(){
  KEY=document.getElementById('key-input').value.trim();
  try{
    const r=await fetch('/admin/backends',H());
    if(!r.ok) throw 0;
    document.getElementById('login').style.display='none';
    document.getElementById('app').style.display='block';
    loadAll();
  }catch(e){document.getElementById('login-err').textContent='密钥无效，请重试';}
}
function doLogout(){KEY='';document.getElementById('app').style.display='none';document.getElementById('login').style.display='flex';document.getElementById('key-input').value='';document.getElementById('login-err').textContent='';}

const tabNames={overview:'概览',users:'用户管理',usage:'用量统计'};
function switchTab(name,el){
  document.querySelectorAll('.sidebar nav a').forEach(a=>a.classList.remove('active'));
  if(el)el.classList.add('active');
  ['overview','users','usage'].forEach(n=>{document.getElementById('tab-'+n).style.display=n===name?'':'none';});
  document.getElementById('page-title').textContent=tabNames[name]||name;
  if(name==='users') loadUsers();
  if(name==='usage') loadUsage();
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
function hideModals(){document.querySelectorAll('.modal-bg').forEach(m=>{m.style.display='none';});document.getElementById('ck-result').innerHTML='';}
document.querySelectorAll('.modal-bg').forEach(bg=>bg.addEventListener('click',e=>{if(e.target===bg)hideModals();}));

function showBalanceModal(uid){document.getElementById('ab-uid').value=uid;document.getElementById('ab-amount').value='';showModal('add-balance');}
function showKeyModal(uid){document.getElementById('ck-uid').value=uid;document.getElementById('ck-name').value='';document.getElementById('ck-result').innerHTML='';showModal('create-key');}

async function createUser(){
  const name=document.getElementById('nu-name').value.trim();
  const balance=parseFloat(document.getElementById('nu-balance').value)||0;
  if(!name){toast('请输入用户名');return;}
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

setInterval(()=>{if(KEY)loadBackends();},30000);
document.getElementById('key-input').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
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
