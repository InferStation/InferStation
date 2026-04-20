# 天枢 Provider 客户端开发计划

> 本文档仅记录方向与范围，暂不开发。实际动工前再细化接口和里程碑。

## 背景

当前 provider 接入网关的方式是裸脚本 `backend/tunnel_client.py`，流程完全手工：

1. ssh 到自家 GPU 机器
2. 手动起 vLLM（记住端口、served-model-name、TP 等）
3. 手动在网关前端"我的后端"里创建 backend 条目，记住 API key
4. `scp` 或 `wget` `tunnel_client.py` 到机器
5. `sudo python3 tunnel_client.py --gateway wss://tianshu-gateway.cloud/ws/tunnel --token sk-xxx --backend-name xxx --local-url http://localhost:PORT`
6. 机器重启后得再来一遍

目前工作状态（截至 2026-04-20）：
- nginx 已配 `/ws/` WebSocket 代理（tencent:/etc/nginx/sites-enabled/tianshu-gateway）
- 客户端连 `wss://tianshu-gateway.cloud/ws/tunnel`
- 内网绕过 Cloudflare：`/etc/hosts` 加 `82.156.115.203 tianshu-gateway.cloud`
- niuma 的两个 vLLM backends (`vllm-qwen35-awq`、`vllm-qwen36-awq`) 就是这种手工模式

## 目标

一个 provider 装完即用的客户端（`tianshu` CLI + 可选 GUI），从"零 vLLM 的机器"到"网关上出现在线模型"一条龙。

## 范围（Provider 向导 + 运行时）

### 1. 注册 / 登录向导
- 首次运行 `tianshu init`
- 两种鉴权方式任选：
  - 用户名 + 密码 → 网关签发长期 API key（需后端新增 `/api/auth/api-key` 或复用 token）
  - 手动粘贴 `sk-xxx` API key
- 拉取当前账户下已有的 backends（`GET /api/backends?mine=true`）
- 本地写 `~/.tianshu/config.yaml`：

```yaml
gateway:
  ws_url: wss://tianshu-gateway.cloud/ws/tunnel
  api_url: https://tianshu-gateway.cloud
  # 用于内网回源绕过 Cloudflare 的可选项
  resolve_hosts:
    tianshu-gateway.cloud: 82.156.115.203
api_key: sk-...
backends:
  - name: vllm-qwen35-awq
    local_url: http://localhost:8001
  - name: vllm-qwen36-awq
    local_url: http://localhost:8002
```

### 2. 模型部署向导
- `tianshu deploy` 交互式：
  1. 检测本地 GPU（优先 `rocm-smi --showmeminfo`、回退 `nvidia-smi --query-gpu=...`）
  2. 从网关拉推荐模型目录（需后端新增 `GET /api/recommended-models`，含 model_id / 建议量化 / 建议 TP / 最低显存）
  3. 根据 GPU 数 / 显存过滤，推荐最合适的 3-5 个
  4. 选定后生成 vLLM 启动脚本（`docker run ... rocm/vllm:latest ...` 或裸 `python -m vllm.entrypoints.openai.api_server`）
  5. 询问用户："代跑" / "只输出命令"
  6. 跑起来后自动 `POST /api/backends` 登记 + 写 config.yaml + 启动 tunnel
- 支持 `tianshu deploy --from-file custom.yaml` 用自定义配置

### 3. Tunnel 运行（复用现有 `backend/tunnel_client.py` 骨架）
- `tianshu run`：前台跑所有 backends 的 tunnel
- 单进程多 backend（asyncio.gather），不再一个脚本一个进程
- 指数退避 + 上限 60s
- 每个 backend 独立日志：`~/.tianshu/logs/<backend-name>.log` + 滚动（日 / 按大小）
- 本地 vLLM `/v1/models` 探活，下线时打 offline 事件给网关

### 4. 守护进程安装
- Linux: `tianshu service install`
  - 优先 user unit：`~/.config/systemd/user/tianshu.service`，`loginctl enable-linger` 提示用户自己启
  - root 模式：`/etc/systemd/system/tianshu.service`
- Windows: NSSM 或 `sc.exe` + 计划任务
- 命令对称：`service uninstall / status / start / stop / logs`

### 5. 运行时 CLI
- `tianshu login / logout`
- `tianshu backends list / add / remove / rename / logs <name>`
- `tianshu run`（前台）/ `tianshu service *`
- `tianshu doctor`：
  - 外网能否到 `api.tianshu-gateway.cloud:443`
  - ws 握手能否成功
  - 每个 backend 的 vLLM `/v1/models` 能否 200
  - GPU 驱动 / 显存
  - config.yaml 合法性

### 6. 发布形式
- 源码：独立 repo `tianshu-provider` 或放在本 repo `client/` 下
- 分发：
  1. `pip install tianshu-provider`
  2. pyinstaller 打包 `tianshu-linux-x64`、`tianshu-windows-x64.exe`，挂 GitHub Release
  3. 前端"我的后端"页给 curl/powershell 一行安装脚本：
     - Linux: `curl -sSL https://tianshu-gateway.cloud/install.sh | bash`
     - Windows: `iwr https://tianshu-gateway.cloud/install.ps1 -UseBasicParsing | iex`

## 后端需要新增 / 调整的接口

| 接口 | 用途 |
|------|------|
| `POST /api/auth/api-key` | 用账号密码换长期 API key（目前只能前端复制） |
| `GET /api/recommended-models` | 推荐模型目录（id、quant、min_vram、suggested_tp、docker_image、template） |
| `POST /api/backends` 返回值 | 补上 `ws_url` / `api_key` 字段，直接给客户端用 |
| `GET /api/backends/:id/status` | 客户端 doctor 用 |

## 里程碑（真正开工后再排期）

1. M1：抽取 `tunnel_client.py` 为可导入的库，多 backend 单进程
2. M2：CLI 骨架（typer）+ config.yaml 读写 + `login`/`run`/`backends list`
3. M3：后端新增 `/api/auth/api-key`、`/api/recommended-models`；CLI 加 `init`
4. M4：`deploy` 向导（先只支持 ROCm + vLLM docker）
5. M5：`service install` systemd
6. M6：pyinstaller 打包 + 下载页 + 安装脚本
7. M7：Windows 支持 + GUI（Tauri，可选）

## 相关代码位置

- 现有裸客户端：`backend/tunnel_client.py`（有 auto-reconnect、stream 转发）
- 服务端握手：`backend/tunnel.py` 的 `TunnelManager` 与 `backend/gateway.py` 中 `@app.websocket("/ws/tunnel")`
- 预留目录：`client/`（目前仅占位 `client.py`）

## 当前临时操作记录（开发完成后删除本节）

niuma 在 w7900d1（`36.151.243.70`，ssh port 21985）跑：

```bash
# 先确保 /etc/hosts 里有： 82.156.115.203 tianshu-gateway.cloud
sudo pkill -f tunnel_client.py
sudo bash -c "nohup python3 /tmp/tunnel_client.py \
  --gateway wss://tianshu-gateway.cloud/ws/tunnel \
  --token sk-tD6UnhqQi_sZqEZXLdpMjttI9ECvWesV3LOcN3GPAv8 \
  --backend-name vllm-qwen35-awq \
  --local-url http://localhost:8001 \
  > /tmp/tunnel_qwen35.log 2>&1 &"
sudo bash -c "nohup python3 /tmp/tunnel_client.py \
  --gateway wss://tianshu-gateway.cloud/ws/tunnel \
  --token sk-tD6UnhqQi_sZqEZXLdpMjttI9ECvWesV3LOcN3GPAv8 \
  --backend-name vllm-qwen36-awq \
  --local-url http://localhost:8002 \
  > /tmp/tunnel_qwen36.log 2>&1 &"
```

机器重启后需手动再执行一次。正式客户端上线后改走 `tianshu service`。
