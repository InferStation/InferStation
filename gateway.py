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


def get_backends_for_model(model: str) -> list[dict]:
    """Return healthy backends that serve the given model."""
    results = []
    for b in backends:
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
    # seed from config
    for b in CFG.get("backends", []):
        if not _find_backend(b["name"]):
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
    auth_user(authorization)
    models = set()
    for b in backends:
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
    for b in backends:
        result.append({
            "name": b["name"],
            "url": b["url"],
            "models": b.get("models", []),
            "healthy": backend_health.get(b["name"], False),
        })
    return result


@app.post("/register")
async def register_backend(request: Request):
    """Backend self-registration. Body: {name, url, models[], token, client_info?}"""
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
    existing = _find_backend(name)
    if existing:
        existing["url"] = url
        existing["models"] = models
        existing["client_info"] = client_info
    else:
        backends.append({"name": name, "url": url, "models": models, "client_info": client_info})
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
    }
    # Fetch live model details from vLLM
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{b['url']}/models")
            if r.status_code == 200:
                data = r.json()
                result["vllm_models"] = data.get("data", [])
    except Exception:
        pass
    return result


# ─── Web UI ──────────────────────────────────────────────────────────────────

ADMIN_HTML = """\
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LLM Gateway</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,system-ui,sans-serif;background:#f5f5f5;color:#333}
.header{background:#1a1a2e;color:#fff;padding:16px 24px;display:flex;align-items:center;gap:12px}
.header h1{font-size:18px;font-weight:600}
.container{max-width:1100px;margin:20px auto;padding:0 16px}
.login-box{max-width:380px;margin:80px auto;background:#fff;border-radius:8px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.1)}
.login-box h2{margin-bottom:16px;text-align:center}
.card{background:#fff;border-radius:8px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.card h3{font-size:15px;color:#666;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px}
.stat{background:#f8f9fa;border-radius:6px;padding:14px;text-align:center}
.stat .val{font-size:24px;font-weight:700;color:#1a1a2e}
.stat .lbl{font-size:12px;color:#888;margin-top:4px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #eee}
th{font-weight:600;color:#666;font-size:12px;text-transform:uppercase}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600}
.badge.up{background:#d4edda;color:#155724}
.badge.down{background:#f8d7da;color:#721c24}
.expand-btn{cursor:pointer;user-select:none;font-size:16px;display:inline-block;transition:transform .2s}
.expand-btn.open{transform:rotate(90deg)}
.detail-row td{padding:0!important;border:none!important}
.detail-panel{background:#f8f9fa;padding:16px 20px;font-size:13px;display:none}
.detail-panel.show{display:block}
.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
.detail-section{background:#fff;border-radius:6px;padding:12px;border:1px solid #eee}
.detail-section h4{font-size:13px;color:#4a6cf7;margin-bottom:8px;font-weight:600}
.detail-section .item{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #f5f5f5}
.detail-section .item:last-child{border:none}
.detail-section .label{color:#888}
.detail-section .value{font-weight:500;font-family:monospace;font-size:12px}
input,select,button{font-size:14px;padding:8px 12px;border-radius:6px;border:1px solid #ddd;outline:none}
input:focus{border-color:#4a6cf7}
button{background:#4a6cf7;color:#fff;border:none;cursor:pointer;font-weight:600}
button:hover{background:#3a5ce5}
button.secondary{background:#6c757d}
button.sm{padding:4px 10px;font-size:12px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.mt{margin-top:12px}
.actions{display:flex;gap:8px;margin-top:12px}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:100;display:none}
.modal{background:#fff;border-radius:10px;padding:24px;min-width:340px;max-width:90vw}
.modal h3{margin-bottom:14px}
.modal .field{margin-bottom:10px}
.modal .field label{display:block;font-size:13px;color:#666;margin-bottom:4px}
.modal .field input{width:100%}
.key-display{background:#f1f3f5;padding:10px;border-radius:6px;font-family:monospace;word-break:break-all;margin:10px 0;font-size:13px}
.tabs{display:flex;gap:0;border-bottom:2px solid #eee;margin-bottom:16px}
.tab{padding:8px 18px;cursor:pointer;font-weight:500;color:#888;border-bottom:2px solid transparent;margin-bottom:-2px}
.tab.active{color:#4a6cf7;border-color:#4a6cf7}
#app{display:none}
</style>
</head>
<body>
<div class="header">
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
<h1>LLM Gateway</h1>
</div>

<div id="login" class="login-box">
<h2>🔐 管理登录</h2>
<div class="field"><label>Admin Key</label><input id="key-input" type="password" placeholder="sk-admin-..." style="width:100%;margin:10px 0"></div>
<button onclick="doLogin()" style="width:100%">登录</button>
<p id="login-err" style="color:red;font-size:13px;margin-top:8px;text-align:center"></p>
</div>

<div id="app">
<div class="container">
<div class="tabs">
<div class="tab active" onclick="switchTab('overview',this)">概览</div>
<div class="tab" onclick="switchTab('users',this)">用户管理</div>
<div class="tab" onclick="switchTab('usage',this)">用量统计</div>
</div>
<div id="tab-overview">
<div class="grid" id="stats"></div>
<div class="card"><h3>📡 后端状态</h3><table id="backends-table"><thead><tr><th></th><th>名称</th><th>地址</th><th>模型</th><th>状态</th></tr></thead><tbody></tbody></table></div>
</div>
<div id="tab-users" style="display:none">
<div class="actions"><button onclick="showModal('create-user')">+ 新建用户</button></div>
<div class="card mt"><table id="users-table"><thead><tr><th>ID</th><th>用户名</th><th>余额</th><th>创建时间</th><th>操作</th></tr></thead><tbody></tbody></table></div>
</div>
<div id="tab-usage" style="display:none">
<div class="row"><label>天数</label><select id="usage-days" onchange="loadUsage()"><option value="1">1天</option><option value="7" selected>7天</option><option value="30">30天</option></select></div>
<div class="card mt"><table id="usage-table"><thead><tr><th>用户</th><th>模型</th><th>请求数</th><th>Input tokens</th><th>Output tokens</th><th>费用</th></tr></thead><tbody></tbody></table></div>
</div>
</div>
</div>

<!-- Modals -->
<div class="modal-bg" id="modal-create-user"><div class="modal">
<h3>新建用户</h3>
<div class="field"><label>用户名</label><input id="nu-name"></div>
<div class="field"><label>初始余额</label><input id="nu-balance" type="number" value="0"></div>
<div class="row mt"><button onclick="createUser()">创建</button><button class="secondary" onclick="hideModals()">取消</button></div>
</div></div>

<div class="modal-bg" id="modal-add-balance"><div class="modal">
<h3>调整余额</h3>
<div class="field"><label>金额（正数充值，负数扣减）</label><input id="ab-amount" type="number"></div>
<input type="hidden" id="ab-uid">
<div class="row mt"><button onclick="addBalance()">确认</button><button class="secondary" onclick="hideModals()">取消</button></div>
</div></div>

<div class="modal-bg" id="modal-create-key"><div class="modal">
<h3>创建 API Key</h3>
<div class="field"><label>名称（备注）</label><input id="ck-name" placeholder="可选"></div>
<input type="hidden" id="ck-uid">
<div id="ck-result"></div>
<div class="row mt"><button onclick="createKey()">生成</button><button class="secondary" onclick="hideModals()">取消</button></div>
</div></div>

<script>
let KEY='';
const H=()=>({headers:{'Authorization':'Bearer '+KEY,'Content-Type':'application/json'}});

async function doLogin(){
  KEY=document.getElementById('key-input').value.trim();
  try{
    const r=await fetch('/admin/backends',H());
    if(!r.ok) throw 0;
    document.getElementById('login').style.display='none';
    document.getElementById('app').style.display='block';
    loadAll();
  }catch(e){document.getElementById('login-err').textContent='Key 无效';}
}

function switchTab(name,el){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  ['overview','users','usage'].forEach(n=>{
    document.getElementById('tab-'+n).style.display=n===name?'':'none';
  });
  if(name==='users') loadUsers();
  if(name==='usage') loadUsage();
}

async function loadAll(){await Promise.all([loadBackends(),loadUsers(),loadUsage()]);}

async function loadBackends(){
  const data=await(await fetch('/admin/backends',H())).json();
  const users=await(await fetch('/admin/users',H())).json();
  const healthy=data.filter(b=>b.healthy).length;
  const models=new Set();data.forEach(b=>b.models.forEach(m=>models.add(m)));
  const totalBal=users.reduce((s,u)=>s+u.balance,0);
  document.getElementById('stats').innerHTML=`
    <div class="stat"><div class="val">${data.length}</div><div class="lbl">后端节点</div></div>
    <div class="stat"><div class="val">${healthy}/${data.length}</div><div class="lbl">健康节点</div></div>
    <div class="stat"><div class="val">${models.size}</div><div class="lbl">可用模型</div></div>
    <div class="stat"><div class="val">${users.length}</div><div class="lbl">用户数</div></div>
    <div class="stat"><div class="val">${totalBal.toFixed(2)}</div><div class="lbl">总余额</div></div>`;
  const tb=document.querySelector('#backends-table tbody');
  tb.innerHTML=data.map(b=>`<tr>
    <td><span class="expand-btn" onclick="toggleDetail(this,'${b.name}')">▶</span></td>
    <td>${b.name}</td><td>${b.url}</td><td>${b.models.join(', ')}</td>
    <td><span class="badge ${b.healthy?'up':'down'}">${b.healthy?'● 健康':'● 离线'}</span></td>
  </tr><tr class="detail-row" id="detail-${b.name}"><td colspan="5"><div class="detail-panel" id="panel-${b.name}">
    <div style="color:#999;padding:8px">加载中...</div>
  </div></td></tr>`).join('');
}

async function toggleDetail(el,name){
  const panel=document.getElementById('panel-'+name);
  const isOpen=panel.classList.toggle('show');
  el.classList.toggle('open',isOpen);
  if(!isOpen) return;
  panel.innerHTML='<div style="color:#999;padding:8px">加载中...</div>';
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
        ${gpus.length?gpus.map(g=>`<div class="item"><span class="label">GPU ${g.id}</span><span class="value">${g.name}${g.vram_mb?' · '+g.vram_mb+'MB':''}</span></div>`).join(''):'<div style="color:#999">未上报 GPU 信息</div>'}
      </div>
      <div class="detail-section"><h4>🤖 vLLM 模型详情</h4>
        ${vm.length?vm.map(m=>`<div class="item"><span class="label">${m.id}</span><span class="value">ctx: ${(m.max_model_len||0).toLocaleString()}</span></div>
        <div class="item"><span class="label">root</span><span class="value">${m.root||'-'}</span></div>`).join(''):'<div style="color:#999">无法获取模型详情</div>'}
      </div>
      <div class="detail-section"><h4>🔗 服务地址</h4>
        <div class="item"><span class="label">后端 URL</span><span class="value">${d.url}</span></div>
        <div class="item"><span class="label">健康状态</span><span class="value">${d.healthy?'✅ 健康':'❌ 离线'}</span></div>
      </div>
    </div>`;
  }catch(e){panel.innerHTML='<div style="color:red;padding:8px">加载失败: '+e.message+'</div>';}
}

async function loadUsers(){
  const data=await(await fetch('/admin/users',H())).json();
  const tb=document.querySelector('#users-table tbody');
  tb.innerHTML=data.map(u=>`<tr><td>${u.id}</td><td>${u.username}</td><td>${u.balance.toFixed(4)}</td>
    <td>${new Date(u.created_at*1000).toLocaleString()}</td>
    <td><button class="sm" onclick="showBalanceModal(${u.id})">充值</button>
    <button class="sm secondary" onclick="showKeyModal(${u.id})">+ Key</button></td></tr>`).join('');
}

async function loadUsage(){
  const days=document.getElementById('usage-days').value;
  const data=await(await fetch('/admin/usage?days='+days,H())).json();
  const tb=document.querySelector('#usage-table tbody');
  tb.innerHTML=data.map(r=>`<tr><td>${r.username||'-'}</td><td>${r.model}</td><td>${r.requests}</td>
    <td>${(r.input_tokens||0).toLocaleString()}</td><td>${(r.output_tokens||0).toLocaleString()}</td>
    <td>${(r.total_cost||0).toFixed(4)}</td></tr>`).join('');
  if(!data.length) tb.innerHTML='<tr><td colspan="6" style="text-align:center;color:#999">暂无数据</td></tr>';
}

function showModal(id){document.getElementById('modal-'+id).style.display='flex';}
function hideModals(){document.querySelectorAll('.modal-bg').forEach(m=>{m.style.display='none';});document.getElementById('ck-result').innerHTML='';}

function showBalanceModal(uid){document.getElementById('ab-uid').value=uid;document.getElementById('ab-amount').value='';showModal('add-balance');}
function showKeyModal(uid){document.getElementById('ck-uid').value=uid;document.getElementById('ck-name').value='';document.getElementById('ck-result').innerHTML='';showModal('create-key');}

async function createUser(){
  const name=document.getElementById('nu-name').value.trim();
  const balance=parseFloat(document.getElementById('nu-balance').value)||0;
  if(!name){alert('请输入用户名');return;}
  await fetch('/admin/users',{...H(),method:'POST',body:JSON.stringify({username:name,balance})});
  hideModals();loadUsers();loadBackends();
}

async function addBalance(){
  const uid=document.getElementById('ab-uid').value;
  const amount=parseFloat(document.getElementById('ab-amount').value);
  if(isNaN(amount)){alert('请输入金额');return;}
  await fetch(`/admin/users/${uid}/balance`,{...H(),method:'POST',body:JSON.stringify({amount})});
  hideModals();loadUsers();loadBackends();
}

async function createKey(){
  const uid=document.getElementById('ck-uid').value;
  const name=document.getElementById('ck-name').value.trim();
  const r=await(await fetch(`/admin/users/${uid}/keys`,{...H(),method:'POST',body:JSON.stringify({name})})).json();
  document.getElementById('ck-result').innerHTML=`<div class="key-display">⚠️ 仅显示一次，请复制保存：<br><strong>${r.key}</strong></div>`;
}

// auto-refresh backends every 30s
setInterval(()=>{if(KEY)loadBackends();},30000);

// Enter key to login
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
