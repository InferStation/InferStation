# syntax=docker/dockerfile:1.7
# vllm-cuda-spark: clean runtime image for NVIDIA DGX Spark (GB10, sm_121).
#
# This is now a thin ASSEMBLER. It installs a PREBUILT vLLM wheel (produced by
# the `vllm-cuda-spark-wheel` profile and stored as a FROM-scratch pkg image in
# Harbor) into the vllm-openai aarch64 base, ~2 min, no compiler. The wheel
# carries vLLM's sm_121-native C/CUDA extensions built with the CUDA-13.0
# toolkit (PTX 9.0, JIT-able by the 580 host driver) -- this is what fixes the
# cudaErrorUnsupportedPtxVersion crash on Marlin/AWQ. To change the vLLM
# version, rebuild the wheel pkg first (build.sh vllm-cuda-spark-wheel).
#
# Build (via dockerfiles/build.sh):
#   ./build.sh vllm-cuda-spark-wheel       # 1) compile the wheel (slow, incremental)
#   ./build.sh vllm-cuda-spark             # 2) assemble runtime from the wheel (~2 min)
#
# The legacy one-shot Dockerfile (compile-in-place + COPY) is kept at
# Dockerfile.legacy for reference / fallback.

ARG VLLM_BASE=vllm/vllm-openai:nightly-aarch64
ARG WHEEL_IMAGE=10.161.176.38:8443/inferstation/vllm-wheel-spark:v0.22.0-sm121
ARG VLLM_TAG=v0.22.0
ARG TORCH_CUDA_ARCH_LIST=12.1

# The prebuilt-wheel pkg (FROM scratch: vllm-*.whl + commit.txt).
FROM ${WHEEL_IMAGE} AS wheel

FROM ${VLLM_BASE}
ARG VLLM_TAG
ARG TORCH_CUDA_ARCH_LIST
LABEL org.inferstation.profile="vllm-cuda-spark" \
      org.inferstation.vllm_tag="${VLLM_TAG}" \
      org.inferstation.cuda_arch="${TORCH_CUDA_ARCH_LIST}"

COPY --from=wheel / /tmp/wheels/

# Install our prebuilt sm_121 wheel with --no-deps and rely on the vllm-openai
# base for torch/triton/etc -- exactly what the legacy compile-in-place build
# did (`pip install . --no-deps`). The base ships the matching PyTorch/CUDA
# stack; we only replace vLLM itself with our sm_121-native build. flash-attn
# stays as the base ships it: the production path uses TRITON_ATTN +
# TORCH_SDPA (not FA2), and the FLASH backend on sm_121 is a separate dead-end
# tracked elsewhere -- so there is nothing to gain from shipping a custom
# flash-attn here.
RUN pip install --no-deps /tmp/wheels/vllm-*.whl \
 && mkdir -p /opt/vllm && cp /tmp/wheels/commit.txt /opt/vllm/commit.txt \
 && rm -rf /tmp/wheels /root/.cache/pip \
 && python3 -c "import vllm, torch; print('vllm', vllm.__version__, 'torch', torch.__version__, 'cuda', torch.version.cuda)"

ENV NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility \
    TORCH_CUDA_ARCH_LIST=${TORCH_CUDA_ARCH_LIST}

ENTRYPOINT ["python3", "-m", "vllm.entrypoints.openai.api_server"]
