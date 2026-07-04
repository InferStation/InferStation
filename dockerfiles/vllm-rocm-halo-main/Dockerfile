# syntax=docker/dockerfile:1.7
# vllm-rocm-halo: clean runtime image for AMD Strix Halo (gfx1151).
#
# This is now a thin ASSEMBLER. It installs a PREBUILT vLLM wheel (produced by
# the `vllm-rocm-halo-main-wheel` profile and stored as a FROM-scratch pkg image)
# into the InferStation PyTorch/ROCm Halo base and restores ABI-pinned runtime
# deps from the wheel constraints. No source checkout, no compiler. To change the vLLM
# version, rebuild the wheel pkg first (build.sh vllm-rocm-halo-wheel).
#
# Build (via dockerfiles/build.sh):
#   ./build.sh vllm-rocm-halo-wheel        # 1) compile the wheel (slow, incremental)
#   ./build.sh vllm-rocm-halo              # 2) assemble runtime from the wheel (~2 min)
#
# The legacy one-shot Dockerfile (compile-in-place + COPY /opt/python) is kept
# at Dockerfile.legacy for reference / fallback.

ARG VLLM_BASE=ghcr.io/inferstation/pytorch-rocm-halo:v2-staging-gfx1151
ARG WHEEL_IMAGE=ghcr.io/inferstation/vllm-wheel-halo:main-gfx1151
ARG VLLM_TAG=main
ARG PYTORCH_ROCM_ARCH=gfx1151

# The prebuilt-wheel pkg (FROM scratch: vllm-*.whl + rocm-requirements.txt).
FROM ${WHEEL_IMAGE} AS wheel

FROM ${VLLM_BASE}
ARG VLLM_TAG
ARG PYTORCH_ROCM_ARCH

LABEL org.opencontainers.image.source="https://github.com/vllm-project/vllm" \
      org.opencontainers.image.version="${VLLM_TAG}" \
      org.opencontainers.image.description="vLLM ${VLLM_TAG} for AMD Strix Halo (${PYTORCH_ROCM_ARCH}), assembled from a prebuilt wheel" \
      org.opencontainers.image.licenses="Apache-2.0" \
      io.amd.rocm.arch="${PYTORCH_ROCM_ARCH}"

ENV PYTORCH_ROCM_ARCH=${PYTORCH_ROCM_ARCH}
ENV VLLM_TARGET_DEVICE=rocm
ENV ROCM_PATH=/usr/local/lib/python3.12/site-packages/_rocm_sdk_devel
ENV HIP_PATH=/usr/local/lib/python3.12/site-packages/_rocm_sdk_devel
ENV HSA_OVERRIDE_GFX_VERSION=11.5.1
ENV PYTHONUNBUFFERED=1

COPY --from=wheel / /tmp/wheels/

# Install our prebuilt wheel against the same PyTorch/ROCm ABI constraints used
# by the wheel builder. Keep full multimodal support via transformers 5.10.2.
RUN --mount=type=cache,target=/root/.cache/uv,id=vllm-halo-main-runtime-uv,sharing=locked \
    grep -E '^(amd-[A-Za-z0-9_.+-]+|rocm[A-Za-z0-9_.+-]*|torch|torchvision|triton)==' \
       /tmp/wheels/constraints.txt > /tmp/wheels/runtime-constraints.txt \
 && printf 'numpy<2.5\nsetuptools>=77.0.3,<80.0.0\ntransformers==5.10.2\nhuggingface-hub[hf_transfer,cli]\n' >> /tmp/wheels/runtime-constraints.txt \
 && uv -v pip install --system --python python \
       --constraint /tmp/wheels/runtime-constraints.txt \
       --index-url "https://rocm.nightlies.amd.com/v2-staging/gfx1151/" \
       --extra-index-url https://pypi.org/simple/ \
       --index-strategy unsafe-best-match \
       --prerelease allow \
       /tmp/wheels/vllm-*.whl \
 && rm -rf /tmp/wheels /root/.cache/pip \
 && python -c "import vllm, transformers, torch; print('vllm', vllm.__version__, 'transformers', transformers.__version__, 'torch', torch.__version__, 'hip', torch.version.hip)"

EXPOSE 8000
ENTRYPOINT ["python", "-m", "vllm.entrypoints.openai.api_server"]
CMD ["--host", "0.0.0.0", "--port", "8000"]
