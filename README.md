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
- **OpenAI 兼容 API**：`/v1/models`、`/v1/chat/completions`（含流式）
- **双模式后端接入**：
  - **直连**：后端有公网 IP，网关直接 HTTP 转发
  - **隧道**：后端在 NAT 后，运行 client.py 建立 WebSocket 长连接
- **API Key 管理**：创建、查看、吊销
- **按量计费**：按 token 计费，余额扣减，余额不足拒绝请求
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
echo "NEXT_PUBLIC_API_URL=http://localhost:8080" > .env.local
npm run dev
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

## 使用

### 作为消费者

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://GATEWAY_HOST:8080/v1",
    api_key="sk-xxxxx"
)

resp = client.chat.completions.create(
    model="Qwen3-8B",
    messages=[{"role": "user", "content": "Hello"}],
    stream=True
)
for chunk in resp:
    print(chunk.choices[0].delta.content or "", end="")
```

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
| WS | `/ws/tunnel` | 提供者隧道连接 | API Key |
| GET | `/api/admin/users` | 用户列表 | JWT (Admin) |
| POST | `/api/admin/users/{id}/balance` | 调整余额 | JWT (Admin) |
| POST | `/api/admin/users/{id}/toggle` | 启用/禁用用户 | JWT (Admin) |
| GET | `/api/admin/usage` | 全局用量统计 | JWT (Admin) |
| GET | `/health` | 健康检查 | 无 |
