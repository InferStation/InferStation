# syntax=docker/dockerfile:1.7
# Runtime image for AMD Radeon W7900 / RDNA3 (gfx1100 family), assembled from a
# vLLM wheel built by vllm-rocm-w7900-main-wheel.

ARG VLLM_BASE=ghcr.io/inferstation/pytorch-rocm-w7900:v2-staging-gfx110x-all
ARG WHEEL_IMAGE=ghcr.io/inferstation/vllm-wheel-w7900:main-gfx1100-v2-staging
ARG VLLM_TAG=main
ARG PYTORCH_ROCM_ARCH=gfx1100
ARG ROCM_INDEX_URL=https://rocm.nightlies.amd.com/v2-staging/gfx110X-all/

FROM ${WHEEL_IMAGE} AS wheel

FROM ${VLLM_BASE}
ARG VLLM_TAG
ARG PYTORCH_ROCM_ARCH
ARG ROCM_INDEX_URL

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTORCH_ROCM_ARCH=${PYTORCH_ROCM_ARCH}
ENV VLLM_TARGET_DEVICE=rocm
ENV ROCM_PATH=/usr/local/lib/python3.12/site-packages/_rocm_sdk_devel
ENV HIP_PATH=/usr/local/lib/python3.12/site-packages/_rocm_sdk_devel

LABEL org.opencontainers.image.source="https://github.com/vllm-project/vllm" \
      org.opencontainers.image.version="${VLLM_TAG}" \
      org.opencontainers.image.description="vLLM ${VLLM_TAG} for AMD Radeon W7900 (${PYTORCH_ROCM_ARCH}), assembled from a prebuilt wheel" \
      org.opencontainers.image.licenses="Apache-2.0" \
      io.amd.rocm.arch="${PYTORCH_ROCM_ARCH}"

COPY --from=wheel / /tmp/wheels/

RUN --mount=type=cache,target=/root/.cache/uv,id=vllm-w7900-runtime-uv,sharing=locked \
    grep -E '^(amd-[A-Za-z0-9_.+-]+|rocm[A-Za-z0-9_.+-]*|torch|torchvision|triton)==' \
      /tmp/wheels/constraints.txt > /tmp/wheels/runtime-constraints.txt \
 && printf 'numpy<2.5\nsetuptools>=77.0.3,<80.0.0\n' >> /tmp/wheels/runtime-constraints.txt \
 && uv -v pip install --system --python python \
      --constraint /tmp/wheels/runtime-constraints.txt \
        --index-url "${ROCM_INDEX_URL}" \
        --extra-index-url https://pypi.org/simple/ \
        --index-strategy unsafe-best-match \
        --prerelease allow \
        /tmp/wheels/vllm-*.whl \
 && rm -rf /tmp/wheels /root/.cache/pip \
 && python -c "import torch, vllm; print('OK vllm', vllm.__version__, 'torch', torch.__version__, 'hip', torch.version.hip)"

WORKDIR /
EXPOSE 8000
ENTRYPOINT ["python", "-m", "vllm.entrypoints.openai.api_server"]
CMD ["--host", "0.0.0.0", "--port", "8000"]
