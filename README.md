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
│ (直接可达)   │  │ (运行 tunnel_client) │
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
│   │   ├── dashboard/      # 用户控制台 (account/keys/usage/invoices/other)
│   │   ├── my-subscriptions/  # 我的订阅（顶级路由）
│   │   ├── my-services/      # 我的服务（顶级路由）
│   │   └── admin/          # 管理员面板
│   ├── src/context/        # AuthContext
│   ├── src/components/     # AppShell / SideNav / TopBar / ui/*
│   └── src/lib/api.ts      # API 请求封装
└── client/
    └── tunnel_client.py    # 提供者隧道客户端（永久指数退避重连）
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
  - **隧道**：后端在 NAT 后，运行 `tunnel_client.py` 建立 WebSocket 长连接
- **路由三模式**（请求体 `model` 字段决定钉定粒度）：
  - `Auto`（case-insensitive）：跨所有激活订阅 fallback；online 优先于 offline，同 tier 按订阅优先级
  - `<model>`（如 `Qwen/Qwen3.6-35B-A3B`）：仅在该模型组内的多个 provider 间 fallback（同模型可订阅多个后端）
  - `<model>/<backend_name>`：钉死单 backend，**不**做 fallback
  - 空 / 未知 model 直接 4xx 并列出可用清单
- **同模型多 provider**：`subscriptions` UNIQUE `(user_id, backend_id, model)`，新订阅按 (input+output) 升序入组；高优先级失败 / 5xx / 连接错 / 首字节超时自动切下一候选（4xx 透传）；流式响应先 pre-flight 首 chunk，未输出字节才允许切换 provider
- **唯一对外入口**：用 API Key 调 `/v1/*`；旧 `/s/{sub_key}/v1/*` 已下线
- **自动订阅**：Provider 注册 Backend 后自身自动激活该订阅（方便测试）
- **API Key 管理**：创建、查看、吊销
- **按量计费**：按 token 计费，余额扣减，余额不足拒绝请求；`/v1/responses` 自动归一 `input_tokens`/`output_tokens`
- **定价优先级**：Backend 定价 > 配置模型定价 > 全局默认
- **管理面板**：用户管理、余额充值、用量统计、启用/禁用用户
- **邮箱验证码二次确认**：注册 / 登录 / 修改邮箱 / 注销账号均需 6 位验证码（10 分钟有效，60 秒发送间隔，每邮箱每用途每小时 ≤ 3 条）
- **自助账号管理**：弹窗式修改密码；注销账号需通过密码 + 邮箱验证码 + 输入 `DELETE` 三重确认，且必须先取消订阅、下架后端、静默 30 分钟、提前结清当月、清账
- **提前结清本月账单**：用户取消订阅且静默 ≥ 30 分钟后可主动出账，便于尽快注销（`POST /api/billing/settle-now`）
- **自有模型减免**：调用自己名下的后端模型时，用量正常入账但「按模型汇总」与账单结算阶段全额减免，不计入月账单（`/api/usage` 返回 `self_cost` / `billable_cost`，使用明细页表格可见）

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
python tunnel_client.py \
  --gateway wss://your-gateway/ws/tunnel \
  --token sk-你的API-Key \
  --backend-name my-gpu-server \
  --local-url http://localhost:8000
```

> `tunnel_client.py` 在 auth-fail / connect-fail / 1012 service-restart 全部走指数退避 1→60 s 永久重试，不会自行退出。

> **隧道协议更新（2026-04）**：WebSocket 消息新增可选 `path` 字段，用于支持 `/v1/completions`、`/v1/responses` 等非 chat 路径。若 `path` 缺省，兼容默认回落到 `/v1/chat/completions`。

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
    model="Auto",
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


#### 2. 订阅管理与优先级（前端 /my-subscriptions）

- "激活/停用"：控制该订阅是否参与统一入口的自动路由
- "↑ / ↓"：调整已激活订阅的优先级（越靠上越优先）
- 页面显示的 API 链接使用当前访问域名动态生成，可直接复制给 SDK 使用

### API 端点

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/auth/register` | 注册 | 无 |
| POST | `/api/auth/login` | 登录 | 无 |
| GET | `/api/auth/me` | 当前用户信息 | JWT |
| POST | `/api/auth/send-code` | 发送邮箱验证码（register / login / change-email / delete-account） | 无 |
| POST | `/api/auth/change-password` | 修改密码（旧密码确认） | JWT |
| POST | `/api/auth/change-email` | 修改邮箱（验证码） | JWT |
| POST | `/api/auth/delete-account` | 自助注销（密码 + 验证码 + DELETE；需先取消订阅 / 下架后端 / 静默 30 分钟 / 提前结清当月 / 无未付账单） | JWT |
| POST | `/api/user/upgrade-role` | 升级角色 | JWT |
| GET/POST | `/api/keys` | 列出/创建 API Key | JWT |
| DELETE | `/api/keys/{id}` | 吊销 Key | JWT |
| GET/POST | `/api/backends` | 列出/注册后端 | JWT (Provider) |
| DELETE | `/api/backends/{name}` | 软删除后端（要求 listing_status=offline；订阅停用，下次结账归档） | JWT (Provider) |
| GET | `/api/models` | 模型市场（公开在线模型）| 无 |
| GET | `/api/models/{model_id}` | 模型详情（默认公开已上架；登录后 owner 可预览自己未上架/未公开后端） | 可选 JWT |
| GET | `/api/models/{model_id}/performance` | 按 provider 的性能概要（占位实现，数值字段为 `null`、`available=false`） | 无 |
| GET | `/api/usage` | 用户用量统计 | JWT |
| GET | `/api/billing/status` | 本月用量与未付账单 | JWT |
| GET | `/api/billing/settle-now/eligibility` | 能否提前结清本月账单 | JWT |
| POST | `/api/billing/settle-now` | 提前结清本月账单（需无激活订阅 + 无 listed/pending 后端 + 静默 ≥ 30 分钟） | JWT |
| GET | `/v1/models` | OpenAI 兼容模型列表 | API Key |
| POST | `/v1/chat/completions` | OpenAI 兼容对话 | API Key |
| POST | `/v1/completions` | OpenAI 兼容 Completion | API Key |
| POST | `/v1/responses` | OpenAI Responses API | API Key |
| GET/POST/DELETE | `/api/subscriptions` | 订阅列表/创建/退订 | JWT |
| POST | `/api/subscriptions/{id}/activate` | 激活/停用订阅 | JWT |
| POST | `/api/subscriptions/reorder` | 调整激活订阅优先级 | JWT |
| WS | `/ws/tunnel` | 提供者隧道连接 | API Key |
| GET | `/api/admin/users` | 用户列表 | JWT (Admin) |
| POST | `/api/admin/users/{id}/balance` | 调整余额 | JWT (Admin) |
| POST | `/api/admin/users/{id}/toggle` | 启用/禁用用户 | JWT (Admin) |
| GET | `/api/admin/usage` | 全局用量统计 | JWT (Admin) |
| GET | `/health` | 健康检查 | 无 |
