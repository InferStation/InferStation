# Image Release Log

This ledger records validated InferStation container releases. A release is
identified by its immutable manifest digest. Mutable tags such as `latest` are
convenience pointers and are never sufficient to identify a release.

## Policy

- Release ID format: `<track>-YYYY.MM.DD.N`.
- Record the runtime, base, and wheel digests before promotion.
- Keep at least one candidate or release tag for every recommended release,
  but treat only the manifest digest as immutable identity.
- Promote `latest` only after a real-device smoke test.
- Mark a broken release `WITHDRAWN`; do not silently remove its history.
- Never reuse a release ID. A future named release tag must be created with an
  exists-check and must never be moved.

## Release Index

| Release ID | Status | Track | Runtime digest | Published tag | Validation |
|---|---|---|---|---|---|
| `halo-vllm-2026.07.21.1` | **RECOMMENDED** | Strix Halo vLLM gfx11 | `sha256:b206a4a83d28398b5d0b13969d6cb66969a058009c06afb9d75f9e02e198235c` | `runtime-9d97f29fe96a` | Halo BF16 16/16 |
| `halo-vllm-2026.07.17.1` | **WITHDRAWN** | Strix Halo vLLM gfx11 | `sha256:e378a9e1102711874fd8cb36a1d6ae11cdeeaa50e566ab99e449b7a68174380f` | `commit-79bb388e987c` | ROCr crashes during HSA initialization |

## `halo-vllm-2026.07.21.1`

Status: **RECOMMENDED**

### Pull

```bash
docker pull ghcr.io/inferstation/vllm-rocm-halo@sha256:b206a4a83d28398b5d0b13969d6cb66969a058009c06afb9d75f9e02e198235c
```

Tags at publication:

- `ghcr.io/inferstation/vllm-rocm-halo:latest`
- `ghcr.io/inferstation/vllm-rocm-halo:runtime-9d97f29fe96a`

### Supply Chain

| Component | Version or digest |
|---|---|
| InferStation source | `9d97f29fe96a2cc2bd74ee3874b94f50e443310c` |
| vLLM source | ROCm/vllm `gfx11` at `965d21822d144724d95fa5fdbe51baf41e42e05d` |
| Runtime image | `sha256:b206a4a83d28398b5d0b13969d6cb66969a058009c06afb9d75f9e02e198235c` |
| Wheel image | `sha256:eae68b65bc69c465c32d89bae098253ff9f1e0cfcbb59855f5b49538fa96c904` |
| PyTorch/ROCm base | `sha256:af61a0c924ac74cf060b82ef55b7cbc0c9bc452dffbc856b9bc50dad7797a0f6` |
| ROCm SDK | `7.15.0a20260719` |
| PyTorch | `2.14.0a0+rocm7.15.0a20260719` |
| PyTorch gfx1151 device package | `2.14.0a0+rocm7.15.0a20260719` |
| torchvision | `0.29.0a0+rocm7.15.0a20260719` |
| Triton | `3.8.0+git43422b04.rocm7.15.0a20260719` |
| transformers | `5.10.2` |
| vLLM runtime version | `0.1.dev1+g965d21822.d20260721` |

Local backports:

- vLLM PR `#38824`: allow ROCm attention head size 512.
- vLLM PR `#39018`: use a 16-wide Triton attention tile for large padded
  heads on 64 KiB shared-memory devices.
- Large Qwen BF16 models use `ROCM_ATTN`; Gemma4 uses the patched
  `TRITON_ATTN` path.

### Validation

- Runtime-only build: [Actions run 29806179299](https://github.com/InferStation/InferStation/actions/runs/29806179299), success.
- Final Gemma recovery: [Actions run 29806707299](https://github.com/InferStation/InferStation/actions/runs/29806707299), success.
- Bare `hsa_init()` and shutdown succeeded on a Ryzen AI Max+ 395 (`gfx1151`).
- PyTorch device discovery, elementwise kernels, and BF16 matrix multiplication succeeded.
- A real Gemma4 BF16 service loaded 48.51 GiB of weights, allocated 46.22 GiB
  of KV cache, became healthy, and returned a 32-token completion over HTTP 200.
- The `2026-07-17` Halo BF16 recovery set is complete: 16/16 records, all with
  vLLM engine version `g965d21822.d20260721` and `failed=0`. The records were
  accumulated across scoped recovery runs: runs `29791723005` and `29797169628`
  had overall failures while preserving successful per-model records; final
  Gemma run `29806707299` completed successfully.
- These historical records store `image: ...:latest` and engine version but
  predate the `image_digest` field. The release digest was separately verified
  during candidate promotion. New benchmark records capture `image_digest`
  directly.

Known limitations:

- The separate llama.cpp/Vulkan prompt-token and c32 context-accounting issue is
  not fixed by this image release.
- `latest` is mutable. Reproducible deployments must pin the digest above.

## `halo-vllm-2026.07.17.1`

Status: **WITHDRAWN**

Affected tags still present for forensic reproducibility:

- `ghcr.io/inferstation/vllm-rocm-halo:nightly-20260717`
- `ghcr.io/inferstation/vllm-rocm-halo:commit-79bb388e987c`

Both tags resolve to:

`sha256:e378a9e1102711874fd8cb36a1d6ae11cdeeaa50e566ab99e449b7a68174380f`

Do not deploy this digest. Its ROCm `7.14.0a20260612` ROCr runtime contains an
unsigned-underflow bug in SDMA engine selection on Strix Halo. The failure can
corrupt the blit table during `hsa_init()` and crash before model loading.

Replacement: `halo-vllm-2026.07.21.1`.

## Entry Template

Copy this section for future releases:

```markdown
## `<release-id>`

Status: **CANDIDATE | RECOMMENDED | WITHDRAWN**

- Runtime digest:
- Published tag:
- InferStation source:
- Upstream source/ref:
- Base digest:
- Wheel digest:
- Component versions:
- Local patches:
- Hardware validation:
- Actions runs:
- Known limitations:
- Replaces:
```