# syntax=docker/dockerfile:1.7
# PyTorch/ROCm base for AMD Strix Halo (RDNA3.5 / gfx1151).

ARG ROCM_CI_BASE=ghcr.io/rocm/vllm/gfx11-ci:latest
ARG ROCM_INDEX_URL=https://rocm.nightlies.amd.com/whl-multi-arch/
ARG ROCM_VERSION=7.15.0a20260719
ARG TORCH_VERSION=2.14.0a0+rocm7.15.0a20260719
ARG TORCHVISION_VERSION=0.29.0a0+rocm7.15.0a20260719
ARG PYTORCH_ROCM_ARCH=gfx1151

FROM ${ROCM_CI_BASE}
ARG ROCM_INDEX_URL
ARG ROCM_VERSION
ARG TORCH_VERSION
ARG TORCHVISION_VERSION
ARG PYTORCH_ROCM_ARCH

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTORCH_ROCM_ARCH=${PYTORCH_ROCM_ARCH}
ENV ROCM_PATH=/usr/local/lib/python3.12/site-packages/_rocm_sdk_devel
ENV HIP_PATH=/usr/local/lib/python3.12/site-packages/_rocm_sdk_devel
ENV HSA_OVERRIDE_GFX_VERSION=11.5.1
ENV UV_LINK_MODE=copy

LABEL org.opencontainers.image.source="https://rocm.nightlies.amd.com/whl-multi-arch/" \
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
        "rocm-sdk-core==${ROCM_VERSION}" \
        "rocm-sdk-devel==${ROCM_VERSION}" \
        "rocm-sdk-libraries==${ROCM_VERSION}" \
        "rocm-sdk-device-${PYTORCH_ROCM_ARCH}==${ROCM_VERSION}" \
        "torch[device-${PYTORCH_ROCM_ARCH}]==${TORCH_VERSION}" \
        "torchvision==${TORCHVISION_VERSION}" \
 && rocm-sdk init \
 && python -m pip freeze | grep -E '^(amd-torch-device-[A-Za-z0-9_.+-]*|rocm[A-Za-z0-9_.+-]*|torch|torchvision|triton)==' > /opt/rocm-pytorch-constraints.txt \
 && python - <<'PY'
import os
import torch
import importlib.metadata as metadata

arch = os.environ['PYTORCH_ROCM_ARCH']
print(
    'OK pytorch-rocm-base',
    'rocm', metadata.version('rocm-sdk-core'),
    'torch', torch.__version__,
    'torch_device', metadata.version(f'amd-torch-device-{arch}'),
    'hip', torch.version.hip,
    'cuda_available', torch.cuda.is_available(),
)
PY
