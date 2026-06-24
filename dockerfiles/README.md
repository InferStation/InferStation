# InferStation Image Profiles

InferStation 推理镜像的统一构建 / 镜像 (mirror) 配方。

| Profile | Backend | Host arch / GPU | 操作 | Release tag | 公开镜像 (GHCR) |
|---|---|---|---|---|---|
| [llama-cuda-spark](llama-cuda-spark/) | llama.cpp | aarch64 / NVIDIA Spark sm_121 | **build** | `b5350-sm121` | `ghcr.io/inferstation/llama-cuda-spark:b5350-sm121` |
| [llama-vulkan-spark](llama-vulkan-spark/) | llama.cpp | aarch64 / Spark | **build** | `b5350` | `ghcr.io/inferstation/llama-vulkan-spark:b5350` |
| [llama-rocm-halo](llama-rocm-halo/) | llama.cpp | x86_64 / Halo gfx1151 | mirror | `b6652-gfx1151` | `ghcr.io/inferstation/llama-rocm-halo:b6652-gfx1151` |
| [llama-vulkan-halo](llama-vulkan-halo/) | llama.cpp | x86_64 / Halo | mirror | `b5350` | `ghcr.io/inferstation/llama-vulkan-halo:b5350` |
| [vllm-cuda-spark](vllm-cuda-spark/) | vLLM | aarch64 / Spark sm_121 | **build** | `v0.22.0-sm121` | `ghcr.io/inferstation/vllm-cuda-spark:v0.22.0-sm121` |
| [vllm-rocm-halo-wheel](vllm-rocm-halo-wheel/) | vLLM wheel pkg (gfx11 优化分支) | x86_64 / Halo gfx1151 | **build** (wheel) | `gfx11-gfx1151` | *(internal pkg, not on GHCR)* |
| [vllm-rocm-halo](vllm-rocm-halo/) | vLLM **gfx1151 优化版** (ROCm/vllm `gfx11` 分支) | x86_64 / Halo gfx1151 | **build** (assemble) | `gfx11-gfx1151` | `ghcr.io/inferstation/vllm-rocm-halo:nightly-YYYYMMDD` |
| [vllm-rocm-halo-main](vllm-rocm-halo-main/) | vLLM upstream-main (含 DiffusionGemma) | x86_64 / Halo gfx1151 | **build** (assemble) | `nightly-YYYYMMDD` | *(internal-only, 不发 GHCR)* |

> **halo 默认 vLLM = gfx1151 优化版**：`vllm-rocm-halo` 现在追 AMD 官方 [ROCm/vllm](https://github.com/ROCm/vllm) 的 `gfx11` 分支，内含针对 Strix Halo gfx1151 的专属调优内核（W4A16 prefill BLOCK_N、GDN prefill shape-keyed config、unquantized 权重 stride 对齐避开 gfx11x 4096B cliff），且保留 `FusedMoE.tp_size`（AWQ MoE 干净加载）。**这是 daily test 和 GHCR 发布的默认 halo vLLM 镜像。** 代价是落后 upstream main（无 DiffusionGemma）。追 upstream main 的线降级为内部仓库 `vllm-rocm-halo-main`（保留 DiffusionGemma，仅手动/特殊单元用，不发 GHCR）。

每个镜像在 Harbor 内部 (`10.161.176.38:8443/inferstation/<name>:<tag>`) 与 GHCR 公开 (`ghcr.io/inferstation/<name>:<tag>`) 双地址同步；`:latest` 始终指向最新成功 build；`:nightly-YYYYMMDD` 每天自动生成（见下文 [Daily build](#daily-build) 章节）。`vllm-wheel-halo*` 是只在 Harbor 内部使用的 wheel pkg，不发 GHCR；`vllm-rocm-halo-main`（upstream main 线）也仅内部保留。

## Registries

### 内部 Harbor（CI / dispatcher 默认）
- URL: `http://10.161.176.38:8443` (Harbor v2.13 on R9700-Workstation-SH，data at `/dc2/lkang/harbor/data`)
- HTTP only (LAN insecure-registry on 4 bench hosts: 9700/4090/spark2/halo6)
- Web UI + self-signup: open the URL in browser
- 凭据：见 `/memories/api-keys.md`（admin 默认密码）；CI 用 robot account

### 公开 GHCR（外部分发）
- 命名空间：`ghcr.io/inferstation/<name>:<tag>`（GitHub org [InferStation](https://github.com/InferStation)）
- 公开匿名 `docker pull` 即可（首次发布后需在 package settings 把 visibility 切到 Public）
- Push 凭据：classic PAT（`write:packages`），保存在 9700 `/root/.docker/config.json`
- 同步流程：见 [`sync-ghcr.sh`](sync-ghcr.sh)（从 Harbor pull → retag → push GHCR）

## 用法

每个 profile 目录里：
- `meta.json` — profile metadata
- `Dockerfile` — 仅 `kind=build` 的有
- `build.sh` — 在指定 build_host 上执行 build/mirror 并 push

顶层 `build.sh <profile_name>` 是 dispatcher，等价于 `cd <profile>; bash build.sh`。

例：
```bash
# 构建并推送 llama-cuda-spark
./build.sh llama-cuda-spark
# mirror 一个
./build.sh llama-rocm-halo
# 全部
./build.sh all
```

## vLLM wheel-pkg build（编一次，到处装）

vLLM 的 C++/HIP 扩展从源码编译要 30–60 min。为避免每个 nightly/release 都从零编，
`vllm-rocm-halo` 拆成 **wheel builder（慢，增量）** + **assembler（快，干净）** 两层：

```
rocm/vllm base ──► vllm-rocm-halo-wheel ──► vllm-wheel-halo:<tag>   ──► vllm-rocm-halo ──► 干净 runtime 镜像
                   编 wheel（ccache 增量）   FROM scratch pkg          assemble（~2min）   + transformers 5.10.2
                                            (.whl + rocm-reqs)
```

- **`vllm-rocm-halo-wheel`** — 在 rocm/vllm base 上 `pip wheel .` 产出 arch-locked wheel。
  ccache 走 **BuildKit cache mount**（`--mount=type=cache,id=vllm-halo-ccache`），跨 build
  持久 → 只重编改动的 translation unit。产物（`vllm-*.whl` + 解析出的 rocm requirements）
  打包成 **`FROM scratch`** pkg 镜像 `vllm-wheel-halo:<tag>`（~120 MB，无 OS），推 Harbor。
- **`vllm-rocm-halo`** — assembler。`COPY --from=<wheel pkg>` 拉 wheel，`pip install vllm-*.whl`
  （`--no-deps`，torch/triton 来自 base）+ 还原运行时依赖 + 升级 `transformers==5.10.2`，
  **无 git / 无源码 / 无编译器**，~2 min。老的一次性编译版留作 [`Dockerfile.legacy`](vllm-rocm-halo/Dockerfile.legacy) fallback。

用法（**先 wheel 后 assemble**）：
```bash
./build.sh vllm-rocm-halo-wheel        # 1. 编 wheel（版本没变就靠 ccache 秒过）
./build.sh vllm-rocm-halo              # 2. 组装 runtime（~2 min）
# 改 wheel 版本：
./build.sh vllm-rocm-halo-wheel --ref=main --tag=nightly-$(date +%Y%m%d)-gfx1151
```

**ABI 锁**：wheel 编死在 `(VLLM_TAG, VLLM_BASE, gfx1151, py3.13)`。**base 镜像或 vLLM
版本一变，必须重编 wheel**（改 assembler 配置/transformers 版本则只需重跑 assemble）。
所以 release（钉死版本）走 wheel 复用，nightly（每天 main）靠 ccache 增量。

> **为什么 halo 用 transformers 5.10.2**：rocm/vllm base 自带的 5.8.1 在 vLLM 直接
> `Qwen3VLProcessor.from_pretrained()` 加载 Qwen3-VL / Qwen3.5-MoE 多模态 processor 时，
> 对已废弃的 `Qwen2VLImageProcessorFast` 名处理有 bug，导致多模态 serve 启动崩
> `Can't load image processor`。5.10.2 修复了，且**保留完整多模态能力**（不是 text-only）。

## 最小化原则
- multi-stage：builder 用 *-devel base，runtime 用 *-runtime/ubuntu base
- 只编单 arch：`-DCMAKE_CUDA_ARCHITECTURES=121` / `-DAMDGPU_TARGETS=gfx1151`
- 静态链接 ggml/llama (`BUILD_SHARED_LIBS=OFF`)
- 合并 RUN，`apt-get install --no-install-recommends`，结尾 `rm -rf /var/lib/apt/lists/*`
- runtime 阶段 `strip` 掉 binary debug symbols
- `.dockerignore` 排除 `.git build/ models/`

## 添加新 profile
1. `mkdir <name>/`
2. 写 `meta.json` (`kind`, `registry`, `tag`, `build_host`, 如果是 build 还要 `dockerfile`, `build_args`，如果是 mirror 要 `source_image`)
3. 复制别的 `build.sh` 改改
4. 加进顶层 README 表格

## Daily build

镜像每天自动从上游最新代码 build 一版 `nightly-YYYYMMDD`（vLLM 的 release 版另打永久 `<version>-<arch>` tag），`:latest` 指向最新成功 build。按 GPU 家族分成 **spark**（NVIDIA DGX Spark）与 **halo**（AMD Strix Halo）两套，软件栈与目标硬件如下：

| 镜像 | 推理引擎 | 关键软件版本 | 目标硬件 |
|---|---|---|---|
| `llama-cuda-spark` | llama.cpp | CUDA 13.2 (cuDNN) · arch sm_121 | NVIDIA DGX Spark（GB10 / sm_121, aarch64） |
| `llama-vulkan-spark` | llama.cpp (Vulkan) | 上游 ggml-org `full-vulkan` | NVIDIA DGX Spark（GB10, Vulkan, aarch64） |
| `vllm-cuda-spark` | vLLM v0.22.0 | CUDA 13.0 · PyTorch · arch sm_121 | NVIDIA DGX Spark（GB10 / sm_121, aarch64） |
| `llama-rocm-halo` | llama.cpp (HIP) | ROCm 7.2.1 · arch gfx1151 | AMD Strix Halo（Ryzen AI Max+ / gfx1151, x86_64） |
| `llama-vulkan-halo` | llama.cpp (Vulkan) | 上游 ggml-org `full-vulkan` | AMD Strix Halo（gfx1151, Vulkan, x86_64） |
| `vllm-rocm-halo` | vLLM **gfx1151 优化版**（ROCm/vllm `gfx11` 分支） | ROCm 7.13 · PyTorch 2.10 · gfx1151 调优内核 | AMD Strix Halo（gfx1151, x86_64） |
| `vllm-rocm-halo-main` | vLLM upstream-main（内部，含 DiffusionGemma） | ROCm 7.13 · PyTorch 2.10 · arch gfx1151 | AMD Strix Halo（gfx1151, x86_64） |

- `<version>-<arch>` tag（如 `v0.22.0-sm121` / `b9509-gfx1151`）永久保留；`nightly-YYYYMMDD` 保留 7 天滚动窗口（[`prune.sh`](prune.sh) 只清过期 nightly，不动 release / `:latest`）。
- 公开镜像同步到 GHCR（见下文）。

## GHCR 同步

从 Harbor 推到 GHCR 公开仓库。repo 与 tag **每次运行都从 Harbor REST API 自动发现**，无硬编码清单：

```bash
# 在 9700 上跑（已 docker login ghcr.io 为 AlisaLi0）
DRY_RUN=1 bash dockerfiles/sync-ghcr.sh   # 先看会镜像哪些 repo:tag
bash dockerfiles/sync-ghcr.sh             # 实际推送
```

默认镜像策略：`latest` + `weekly-YYYYMMDD` + release tag（`vX.Y.Z-arch` / `bNNNN-arch`）+ 最新一个 `nightly-YYYYMMDD`；排除 `commit-<sha>`。env 可覆盖：`MIRROR_ALL_NIGHTLIES=1` / `MIRROR_COMMITS=1` / `TAG_REGEX=...` / `REPOS="..."`。

## TODO（未来）
- admin_api `/api/builds` endpoint + `/builds` UI
- buildkite/github-actions CI
