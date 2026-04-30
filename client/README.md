# 天枢 Provider 客户端（Tauri 2 跨平台）

> Provider 桌面客户端：登录天枢账号、注册/编辑/删除模型服务、管理本地推理引擎（vLLM / llama.cpp）、维持反向 wss 隧道（自动 watchdog 重连）、本地模型仓库、实时状态面板、系统托盘 + 开机自启。
>
> 目标平台：Windows / macOS / Linux（Tauri 2，单一代码库）。

## 仓库布局

```
client/
├── README.md                ← 本文件
├── package.json             ← 前端 (React + TS + Vite)
├── vite.config.ts
├── tsconfig.json
├── index.html
├── src/                     ← 前端源码
│   ├── main.tsx / App.tsx
│   ├── api.ts               ← invoke 包装 (前端 ↔ Rust)
│   ├── pages/               ← 6 个主页面
│   ├── components/
│   └── styles.css
└── src-tauri/               ← Rust + Tauri 后端
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── build.rs
    ├── capabilities/default.json
    └── src/
        ├── main.rs / lib.rs
        ├── state.rs         ← 持久化设置（凭据 / 路径）
        ├── gateway.rs       ← 天枢 REST 客户端
        ├── tunnel.rs        ← tunnel_client 进程管理 + watchdog
        ├── engine.rs        ← vLLM / llama.cpp 进程管理
        ├── models.rs        ← 本地模型仓库 + HF/ModelScope 下载器
        ├── tray.rs          ← 系统托盘
        └── autostart.rs     ← 开机自启
```

## 配套服务

- 网关公网入口：`https://tianshu-gateway.cloud`
- REST API（OpenAI 部分 + 内部 API 前缀 `/api/...`）
- WebSocket 反向隧道：`wss://tianshu-gateway.cloud/ws/tunnel`
- 鉴权：登录拿 JWT（24h；勾选「记住我」7d），或直接用 `sk-...` API Key

## 开发环境

| 工具 | 版本 |
|------|------|
| Rust | stable ≥ 1.77 (rustup 装) |
| Node | ≥ 18 |
| pnpm | ≥ 8（推荐）或 npm ≥ 9 |
| Tauri CLI | `pnpm add -D @tauri-apps/cli@^2`（已在 package.json） |

Windows 还需要：
- Microsoft Edge WebView2（Win11 自带；Win10 需自行装）
- C++ 构建工具（VS Build Tools 2022）

## 启动

```bash
cd client
pnpm install                      # 装前端 + Tauri CLI

# 第一次启动前需要图标 (Tauri bundle 必需). 准备一张 ≥ 1024×1024 的方形 PNG, 然后:
pnpm tauri icon path/to/source.png

pnpm tauri dev                    # 开发模式, 热重载
pnpm tauri build                  # 出 .exe / .dmg / .AppImage
```

构建产物：
- Windows: `src-tauri/target/release/bundle/msi/*.msi` 与 `src-tauri/target/release/bundle/nsis/*.exe`
- macOS:   `src-tauri/target/release/bundle/dmg/*.dmg`
- Linux:   `src-tauri/target/release/bundle/appimage/*.AppImage`

## 主要功能

| 模块 | 入口 | Rust 命令 |
|------|------|-----------|
| 登录 / API Key | `pages/Login.tsx` | `gateway::login`、`gateway::set_api_key` |
| 我的服务（增删改查 + 在线检查） | `pages/Services.tsx` | `gateway::list_backends`、`create_backend`、`update_backend`、`delete_backend`、`check_backend` |
| 隧道管理 + watchdog | `pages/Tunnels.tsx` | `tunnel::start`、`stop`、`status`、`tail_log` |
| 推理引擎 | `pages/Engines.tsx` | `engine::start_vllm`、`start_llama_cpp`、`stop`、`tail_log` |
| 本地模型仓库 | `pages/Models.tsx` | `models::list_local`、`download_hf`、`download_ms`、`delete_local`、`disk_usage` |
| 实时面板 | `pages/Dashboard.tsx` | `gateway::stats` |

### Tunnel watchdog（解决 4-30 那次孤儿进程问题）

`src-tauri/src/tunnel.rs` 内置：

1. **Stall 检测**：`tunnel_client.py` 每条业务请求都打 `[client] INFO HTTP Request: ...`；watchdog 每 30 s 检查 `~/tunnel-logs/<name>.log` 的最后 mtime + 末尾几行，**若距上次活跃 > 5 min 仍无进展**（且 backend 在网关侧 status=offline），视为 stall → SIGTERM 子进程 → spawn 新进程。
2. **WebSocket 心跳超时**：直接 kill PID（同 systemd-user `Restart=always`），不等 await 卡死。
3. **指数退避**：重启间隔 1/2/4/.../60 s，与 `tunnel_client.py` 内部退避叠加。
4. **持久化**：进程退出码 + 时间写入 `state` store，UI 显示「过去 24h 重启次数」。

> 4-30 那次故障：`tunnel_client.py` v0.1（无 watchdog）在 ws 静默断连后卡死在 await，systemd unit 又被清空，没人拉起来。新客户端把这两层兜底合一。

### 安全 / 凭据

- 登录后 JWT 写入 OS 钥匙串（macOS Keychain / Windows DPAPI / Linux `secret-service`），不进 disk plaintext。
- API Key 可选独立保存（部分 provider 不想用账号登录）。
- `tauri.conf.json` 的 CSP 限制：仅允许 `https://tianshu-gateway.cloud` + `wss://tianshu-gateway.cloud`。
