# LLM Gateway

模型服务聚合平台 — 连接 AI 消费者与模型提供者。

## 架构

```
┌──────────────────────────────────┐
│  用户 (浏览器 / OpenAI SDK)       │
└──────────────┬───────────────────┘
               │
┌──────────────▼───────────────────┐
│  Frontend (Next.js)              │
│  模型市场 / 控制台 / 管理面板      │
├──────────────────────────────────┤
│  Backend (FastAPI)               │
│  认证 / 路由 / 计费 / 隧道管理     │
└──────┬───────────────┬───────────┘
       │ HTTP 直连       │ WebSocket 隧道
       ▼                ▼
┌────────────┐  ┌─────────────────┐
│ 公网 vLLM   │  │ NAT 内网 vLLM    │
│ (直接可达)   │  │ (运行 client.py) │
└────────────┘  └─────────────────┘
```

## 项目结构

```
llm-gateway/
├── backend/                # FastAPI 后端
│   ├── gateway.py          # 主程序（所有 API 路由）
│   ├── auth.py             # JWT 认证、密码哈希、角色检查
│   ├── database.py         # SQLite 数据库模型
│   ├── tunnel.py           # WebSocket 隧道管理
│   ├── config.example.yaml # 配置示例
│   └── requirements.txt    # Python 依赖
├── frontend/               # Next.js 前端
│   ├── src/app/
│   │   ├── page.tsx        # 首页（模型展示）
│   │   ├── models/         # 模型市场
│   │   ├── login/          # 登录
│   │   ├── register/       # 注册
│   │   ├── dashboard/      # 用户控制台
│   │   ├── keys/           # API Key 管理
│   │   ├── backends/       # 提供者后端管理
│   │   └── admin/          # 管理员面板
│   ├── src/context/        # AuthContext
│   ├── src/components/     # Navbar
│   └── src/lib/api.ts      # API 请求封装
└── client/
    └── client.py           # 提供者隧道客户端
```

## 用户角色

| 角色 | 说明 |
|------|------|
| `consumer` | 消费者（默认注册角色），调用 API |
| `provider` | 提供者，注册后端服务 |
| `both` | 同时是消费者和提供者 |
| `admin` | 超级管理员，首次启动从配置创建 |

- 用户自行注册，默认为 consumer
- consumer 可在控制台升级为 provider 或 both
- provider 后续可要求实名认证

## 功能

- **模型市场**：浏览/搜索所有在线模型
- **OpenAI 兼容 API**：`/v1/models`、`/v1/chat/completions`、`/v1/completions`、`/v1/responses`（均支持流式）
- **双模式后端接入**：
  - **直连**：后端有公网 IP，网关直接 HTTP 转发
  - **隧道**：后端在 NAT 后，运行 client.py 建立 WebSocket 长连接
- **订阅 + 多激活 + 优先级回退**：
  - 用户在模型市场订阅 Backend 的某个模型 → 获得独立的 `sub_key`
  - 同一个用户可**同时激活多个订阅**；平台按用户设置的优先级依次尝试
  - 高优先级订阅的 Backend 离线或失败时，**自动回退**到下一个
  - 自动订阅：Provider 注册 Backend 后，自身自动激活该订阅（方便测试）
- **Auto fallback 开关（用户级）**：
  - **开启（默认）**：调用 `/v1/*` 时忽略请求里的 `model`，按优先级选一个在线的已激活订阅；离线自动回退
  - **关闭**：必须在请求体里显式指定 `model`，且只能是已激活订阅里的模型名；只走对应那一个订阅，**不自动切换**
  - 在 `/dashboard/my-models` 页面可直接切换
- **两种调用方式**：
  - **统一入口**：用自己的 API Key 调 `/v1/*`，按优先级自动路由到已激活订阅
  - **指定订阅**：用 `sub_key` 调 `/s/{sub_key}/v1/*`，强制使用该订阅
- **API Key 管理**：创建、查看、吊销
- **按量计费**：按 token 计费，余额扣减，余额不足拒绝请求；`/v1/responses` 自动归一 `input_tokens`/`output_tokens`
- **定价优先级**：Backend 定价 > 配置模型定价 > 全局默认
- **管理面板**：用户管理、余额充值、用量统计、启用/禁用用户

## 部署

### 后端

```bash
cd backend
cp config.example.yaml config.yaml  # 编辑配置
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python gateway.py
```

### 前端

```bash
cd frontend
npm install
# 可选：在 URL 展示框中显示自定义域名（否则使用当前访问地址）
echo "NEXT_PUBLIC_API_URL=" > .env.local
echo "NEXT_PUBLIC_PUBLIC_BASE_URL=https://your-domain" >> .env.local
npm run dev
# 生产构建（本项目为 output: "standalone"）
npm run build
node .next/standalone/server.js
# 注意：standalone 构建下首次启动需将静态资源拷入：
#   cp -r .next/static .next/standalone/.next/
#   cp -r public      .next/standalone/public        # 如有 public
```

### 提供者客户端

在 NAT 内网的 GPU 机器上运行：

```bash
pip install websockets httpx
python client.py \
  --gateway ws://GATEWAY_HOST:8080/ws/tunnel \
  --token sk-你的API-Key \
  --backend-name my-gpu-server \
  --local-url http://localhost:8000
```

> **隧道协议更新（2026-04）**：WebSocket 消息新增可选 `path` 字段，用于支持 `/v1/completions`、`/v1/responses` 等非 chat 路径。若 `path` 缺省，兼容默认回落到 `/v1/chat/completions`。老版 `client.py` 仍可服务 chat 场景，如需完整 OpenAI 兼容，请拉取最新版。

## 使用

### 作为消费者

#### 1. 统一入口（推荐）

用你自己在"API Keys"里创建的 Key，调用网关的 `/v1/*`；平台会按你"我的订阅"里的优先级顺序，自动选择一个**已激活**的订阅转发，高优先级失败时自动回退到下一个。

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-gateway/v1",   # 或 http://IP:8080/v1
    api_key="sk-你的API-Key"
)

# model 可填 "auto"，由网关按优先级选；也可填某个已激活订阅里的模型名
resp = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "Hello"}],
    stream=True
)
for chunk in resp:
    print(chunk.choices[0].delta.content or "", end="")
```

支持的 OpenAI 兼容端点：

| 路径 | 用途 |
|------|------|
| `GET  /v1/models` | 列出当前用户可用模型 |
| `POST /v1/chat/completions` | Chat 对话（含流式）|
| `POST /v1/completions` | 旧版 Completion（含流式）|
| `POST /v1/responses` | Responses API（含流式；usage 自动归一）|

> 自签证书场景（直接用 IP 访问）需要在客户端跳过证书校验，例如 `curl -k`；使用配置好的域名则不需要。

#### 2. 指定订阅（sub_key）

每个订阅有独立 `sub_key`，可以用来强制走某一个 Backend，路径前缀为 `/s/{sub_key}`：

```bash
curl https://your-gateway/s/SUB_KEY/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"Qwen3-8B","messages":[{"role":"user","content":"hi"}]}'
```

> `sub_key` 本身即携带身份和计费归属，无需再带 `Authorization`。

#### 3. 订阅管理与优先级（前端 /dashboard/my-models）

- "激活/停用"：控制该订阅是否参与统一入口的自动路由
- "↑ / ↓"：调整已激活订阅的优先级（越靠上越优先）
- 页面显示的 API 链接使用当前访问域名动态生成，可直接复制给 SDK 使用

### API 端点

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/auth/register` | 注册 | 无 |
| POST | `/api/auth/login` | 登录 | 无 |
| GET | `/api/auth/me` | 当前用户信息 | JWT |
| POST | `/api/user/upgrade-role` | 升级角色 | JWT |
| GET/POST | `/api/keys` | 列出/创建 API Key | JWT |
| DELETE | `/api/keys/{id}` | 吊销 Key | JWT |
| GET/POST | `/api/backends` | 列出/注册后端 | JWT (Provider) |
| DELETE | `/api/backends/{name}` | 删除后端 | JWT (Provider) |
| GET | `/api/models` | 模型市场（公开在线模型）| 无 |
| GET | `/api/usage` | 用户用量统计 | JWT |
| GET | `/v1/models` | OpenAI 兼容模型列表 | API Key |
| POST | `/v1/chat/completions` | OpenAI 兼容对话 | API Key |
| POST | `/v1/completions` | OpenAI 兼容 Completion | API Key |
| POST | `/v1/responses` | OpenAI Responses API | API Key |
| ALL | `/s/{sub_key}/v1/*` | 指定订阅的 OpenAI 调用 | sub_key（免 Authorization）|
| GET/POST/DELETE | `/api/subscriptions` | 订阅列表/创建/退订 | JWT |
| POST | `/api/subscriptions/{id}/activate` | 激活/停用订阅 | JWT |
| POST | `/api/subscriptions/reorder` | 调整激活订阅优先级 | JWT |
| WS | `/ws/tunnel` | 提供者隧道连接 | API Key |
| GET | `/api/admin/users` | 用户列表 | JWT (Admin) |
| POST | `/api/admin/users/{id}/balance` | 调整余额 | JWT (Admin) |
| POST | `/api/admin/users/{id}/toggle` | 启用/禁用用户 | JWT (Admin) |
| GET | `/api/admin/usage` | 全局用量统计 | JWT (Admin) |
| GET | `/health` | 健康检查 | 无 |
