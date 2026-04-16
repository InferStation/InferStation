# LLM Gateway

轻量级 OpenAI 兼容 API 网关，单文件实现路由、鉴权、计费、后端管理。

## 架构

```
Client (OpenAI SDK)
    │
    ▼
┌──────────────────────────────┐
│  LLM Gateway (gateway.py)    │
│  FastAPI + SQLite + 嵌入式UI  │
│  82.156.115.203:8080         │
└──────┬───────────────────────┘
       │  /v1/chat/completions
       ▼
┌──────────────┐  ┌──────────────┐
│ w7900d1      │  │ halo4        │  ...更多 backend
│ vLLM         │  │ vLLM         │
│ Qwen3.5-35B  │  │ Qwen3-8B    │
│ 36.151.243.70│  │ 10.161.176.98│
└──────────────┘  └──────────────┘
```

## 文件结构

| 文件 | 说明 |
|------|------|
| `gateway.py` (1036行) | 完整网关：API 路由、鉴权、计费、后端管理、Admin Web UI |
| `register.py` (175行) | 零依赖 CLI 注册客户端，可在 backend 机器上运行 |
| `config.yaml` | 服务端配置：端口、admin_key、默认定价 |
| `requirements.txt` | 仅 4 个依赖：fastapi, uvicorn, httpx, pyyaml |
| `gateway.db` | SQLite 数据库（自动创建，WAL 模式） |

## 功能

- **OpenAI 兼容 API**：`/v1/models`、`/v1/chat/completions`（含流式）
- **动态后端注册**：backend 通过 `/register` 自注册，支持心跳保活
- **自动健康检查**：每 30 秒轮询各 backend `/v1/models`
- **用户鉴权 & 余额**：API Key 认证，余额扣减，余额不足自动拒绝
- **按量计费**：优先级 backend 定价 > 配置模型定价 > 全局默认定价（元/百万 token）
- **Per-user 后端可见性**：backend 可绑定 owner，用户只能看到自己 + 共享的 backend
- **SQLite 持久化**：用户、API Key、用量日志、backend 注册信息全部持久化
- **嵌入式 Admin UI**：登录、用户管理、余额充值、Key 生成、后端状态、用量统计
- **自动检测 GPU/系统信息**：register.py 采集 hostname/OS/GPU 信息上报

## 部署

### 服务端（腾讯云 82.156.115.203）

```bash
# 首次部署
ssh tencent
cd ~/llm-gateway
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 启动 / 重启
fuser -k 8080/tcp 2>/dev/null
sleep 1
nohup python gateway.py serve >> /tmp/gw.log 2>&1 & disown
```

从本地一键部署更新：

```bash
scp gateway.py tencent:~/llm-gateway/gateway.py
ssh tencent "fuser -k 8080/tcp 2>/dev/null; sleep 1; cd ~/llm-gateway && source .venv/bin/activate && nohup python gateway.py serve >> /tmp/gw.log 2>&1 & disown; sleep 1; curl -s localhost:8080/health"
```

### Admin UI

浏览器访问 `http://82.156.115.203:8080`，使用 admin key 登录。

## 使用

### 注册 Backend

在 backend 机器上运行 register.py：

```bash
python3 register.py \
  --gateway http://82.156.115.203:8080 \
  --token sk-admin-TXWqY--DwCJ4L3Sa5qsKKBv5ZbdyIoxqha2FyxQQWSc \
  --name w7900d1 \
  --url http://36.151.243.70:8000 \
  --input-price 0.5 \
  --output-price 2.0
```

参数说明：
- `--models`：手动指定模型名（不指定则自动从 `/v1/models` 检测）
- `--owner`：绑定到某个用户（名字或 ID），不指定则为共享 backend
- `--input-price` / `--output-price`：每百万 token 价格（元），不指定则用 config.yaml 默认值
- `--heartbeat N`：每 N 秒重新注册一次（保活）
- `--unregister`：注销 backend

### 作为 OpenAI 客户端使用

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://82.156.115.203:8080/v1",
    api_key="sk-xxxxx"  # 用户 API Key（从 Admin UI 创建）
)

resp = client.chat.completions.create(
    model="Qwen3.5-35B-A3B",
    messages=[{"role": "user", "content": "Hello"}],
    stream=True
)
for chunk in resp:
    print(chunk.choices[0].delta.content or "", end="")
```

### Admin API

所有 admin 端点需要 `Authorization: Bearer <admin_key>`。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/admin/users` | 创建用户 `{username, balance}` |
| POST | `/admin/users/{id}/keys` | 生成 API Key `{name}` |
| POST | `/admin/users/{id}/balance` | 调整余额 `{amount}` |
| GET | `/admin/users` | 列出所有用户 |
| GET | `/admin/usage?days=7` | 查看用量统计 |
| GET | `/admin/backends` | 列出所有 backend |
| GET | `/admin/backends/{name}/details` | backend 详情（含 GPU 信息、vLLM 版本） |
| POST | `/register` | 注册 backend（供 register.py 使用） |
| POST | `/unregister` | 注销 backend |
| GET | `/health` | 健康检查 |

## 数据库 Schema

```sql
users       (id, username, balance, created_at)
api_keys    (id, user_id, key_hash, key_prefix, name, is_active, created_at)
usage_logs  (id, user_id, api_key_id, model, input_tokens, output_tokens, cost, created_at)
backends    (name, url, models, client_info, owner_id, pricing, updated_at)
```

## 定价优先级

1. **Backend 定价**：register.py `--input-price` / `--output-price` 设置
2. **模型定价**：config.yaml 中按模型名覆盖
3. **全局默认**：config.yaml `pricing.default`（当前 input=1.0, output=3.0 元/M tokens）

## 当前部署状态

- **Gateway**：82.156.115.203:8080（腾讯云，通过 9700 跳板机 SSH）
- **Git**：`git@github.com:JoursBleu/llm-gateway.git`，master 分支
- **最新 commit**：`a213d89` feat: per-backend pricing
- **已注册 Backend**：w7900d1（36.151.243.70:8000，4×W7900 跑 Qwen3.5-35B-A3B，定价 input=0.5/output=2.0 元/M）

## 开发历程

| Commit | 功能 |
|--------|------|
| `26b77ac` | 初始版本：FastAPI 网关，OpenAI 兼容路由 |
| `a7d5597` | 嵌入式 Admin Web UI |
| `1495d00` | register.py 客户端注册脚本 |
| `bb35790` | Backend 代理路由 |
| `523961d` | 可展开的 backend 详情（GPU/系统信息） |
| `1492c26` | 修复 /v1/models 路径，显示 vLLM 版本 |
| `3876a32` | SQLite 持久化 backend 注册 |
| `42c481d` | UI 大改版：侧边栏导航、统计卡片、Toast |
| `ef0f52f` | Per-user backend ownership |
| `a213d89` | Per-backend pricing |
