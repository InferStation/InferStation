# syntax=docker/dockerfile:1.7
# PyTorch/ROCm base for AMD Strix Halo (RDNA3.5 / gfx1151).

ARG ROCM_CI_BASE=ghcr.io/rocm/vllm/gfx11-ci:latest
ARG ROCM_INDEX_URL=https://rocm.nightlies.amd.com/v2-staging/gfx1151/
ARG PYTORCH_ROCM_ARCH=gfx1151

FROM ${ROCM_CI_BASE}
ARG ROCM_INDEX_URL
ARG PYTORCH_ROCM_ARCH

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTORCH_ROCM_ARCH=${PYTORCH_ROCM_ARCH}
ENV ROCM_PATH=/usr/local/lib/python3.12/site-packages/_rocm_sdk_devel
ENV HIP_PATH=/usr/local/lib/python3.12/site-packages/_rocm_sdk_devel
ENV HSA_OVERRIDE_GFX_VERSION=11.5.1
ENV UV_LINK_MODE=copy

LABEL org.opencontainers.image.source="https://rocm.nightlies.amd.com/v2-staging/gfx1151/" \
      org.opencontainers.image.description="PyTorch ROCm nightly base for AMD Strix Halo (gfx1151)" \
      io.amd.rocm.arch="${PYTORCH_ROCM_ARCH}"

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates libnuma1 \
    && rm -rf /var/lib/apt/lists/*

RUN --mount=type=cache,target=/root/.cache/uv,id=pytorch-rocm-halo-uv,sharing=locked \
    uv pip install --system --python python \
        --index-url "${ROCM_INDEX_URL}" \
        --extra-index-url https://pypi.org/simple/ \
        --index-strategy unsafe-best-match \
        --prerelease allow \
        "rocm[devel,libraries]" torch torchvision \
 && rocm-sdk init \
 && python -m pip freeze | grep -E '^(rocm[A-Za-z0-9_.+-]*|torch|torchvision|triton)==' > /opt/rocm-pytorch-constraints.txt \
 && python - <<'PY'
import torch
print('OK pytorch-rocm-base', torch.__version__, 'hip', torch.version.hip, 'cuda_available', torch.cuda.is_available())
PY
