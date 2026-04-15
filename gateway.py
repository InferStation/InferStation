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
from fastapi.responses import JSONResponse, StreamingResponse

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
    """
    )
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


# ─── Backend health ─────────────────────────────────────────────────────────

backend_health: dict[str, bool] = {}  # name -> healthy


async def health_check_loop():
    while True:
        async with httpx.AsyncClient(timeout=5) as client:
            for b in CFG.get("backends", []):
                name = b["name"]
                try:
                    r = await client.get(f"{b['url']}/models")
                    backend_health[name] = r.status_code == 200
                except Exception:
                    backend_health[name] = False
        await asyncio.sleep(30)


def get_backends_for_model(model: str) -> list[dict]:
    """Return healthy backends that serve the given model."""
    results = []
    for b in CFG.get("backends", []):
        if model in b.get("models", []) and backend_health.get(b["name"], False):
            results.append(b)
    return results


# ─── Pricing ─────────────────────────────────────────────────────────────────


def calc_cost(model: str, input_tokens: int, output_tokens: int) -> float:
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
    # mark all backends unknown first
    for b in CFG.get("backends", []):
        backend_health[b["name"]] = False
    task = asyncio.create_task(health_check_loop())
    yield
    task.cancel()
    DB.close()


app = FastAPI(title="LLM Gateway", lifespan=lifespan)

# ─── OpenAI compatible endpoints ─────────────────────────────────────────────


@app.get("/v1/models")
async def list_models(authorization: Optional[str] = Header(None)):
    auth_user(authorization)
    models = set()
    for b in CFG.get("backends", []):
        if backend_health.get(b["name"], False):
            models.update(b.get("models", []))
    data = [{"id": m, "object": "model", "owned_by": "llm-gateway"} for m in sorted(models)]
    return {"object": "list", "data": data}


@app.post("/v1/chat/completions")
async def chat_completions(request: Request, authorization: Optional[str] = Header(None)):
    user = auth_user(authorization)
    body = await request.json()
    model = body.get("model", "")
    stream = body.get("stream", False)

    backends = get_backends_for_model(model)
    if not backends:
        raise HTTPException(503, f"No healthy backend for model '{model}'")

    # Ensure usage info is returned for billing
    if stream:
        body.setdefault("stream_options", {})
        body["stream_options"]["include_usage"] = True

    # Try backends in random order
    random.shuffle(backends)
    last_err = None
    for backend in backends:
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
    cost = calc_cost(model, inp, out)
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
                cost = calc_cost(model, inp, out)
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
    result = []
    for b in CFG.get("backends", []):
        result.append({
            "name": b["name"],
            "url": b["url"],
            "models": b.get("models", []),
            "healthy": backend_health.get(b["name"], False),
        })
    return result


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
