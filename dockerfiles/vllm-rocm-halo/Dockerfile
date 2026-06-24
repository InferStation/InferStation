# syntax=docker/dockerfile:1.7
# vllm-rocm-halo: clean runtime image for AMD Strix Halo (gfx1151).
#
# This is now a thin ASSEMBLER. It installs a PREBUILT vLLM wheel (produced by
# the `vllm-rocm-halo-wheel` profile and stored as a FROM-scratch pkg image in
# Harbor) into the rocm/vllm base, restores the runtime deps, and upgrades
# transformers. No source checkout, no compiler, ~2 min. To change the vLLM
# version, rebuild the wheel pkg first (build.sh vllm-rocm-halo-wheel).
#
# Build (via dockerfiles/build.sh):
#   ./build.sh vllm-rocm-halo-wheel        # 1) compile the wheel (slow, incremental)
#   ./build.sh vllm-rocm-halo              # 2) assemble runtime from the wheel (~2 min)
#
# The legacy one-shot Dockerfile (compile-in-place + COPY /opt/python) is kept
# at Dockerfile.legacy for reference / fallback.

ARG VLLM_BASE=rocm/vllm:rocm7.13.0_gfx1151_ubuntu24.04_py3.13_pytorch_2.10.0_vllm_0.19.1
ARG WHEEL_IMAGE=10.161.176.38:8443/inferstation/vllm-wheel-halo:v0.22.0-gfx1151
ARG VLLM_TAG=v0.22.0
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
ENV HSA_OVERRIDE_GFX_VERSION=11.5.1
ENV PYTHONUNBUFFERED=1

COPY --from=wheel / /tmp/wheels/

# Install our prebuilt wheel with --no-deps and rely on the rocm/vllm base for
# torch/triton/numba/outlines/etc -- exactly what the legacy compile-in-place
# build did (`pip install . --no-deps`). The base ships AMD-tuned versions of
# vLLM's deps; force-installing vLLM's upstream requirements/rocm.txt pins would
# clobber them, so we do NOT. We only add what the base lacks: numpy<2 (build
# pin) + hf_transfer, then upgrade transformers to 5.10.2 -- the base ships
# 5.8.1, which mishandles the deprecated Qwen2VLImageProcessorFast name when
# vLLM loads the Qwen3-VL / Qwen3.5-MoE processor directly, crashing multimodal
# serve with "Can't load image processor". Keep full multimodal support.
# (/tmp/wheels/requirements/ is carried for reference but intentionally unused.)
RUN pip uninstall -y vllm vllm-flash-attn flashinfer flashinfer-python 2>/dev/null || true \
 && pip install --no-deps /tmp/wheels/vllm-*.whl \
 && pip install 'numpy<2' 'huggingface-hub[cli,hf_transfer]' \
 && pip install --upgrade 'transformers==5.10.2' \
 && rm -rf /tmp/wheels /root/.cache/pip \
 && python3 -c "import vllm, transformers, torch; print('vllm', vllm.__version__, 'transformers', transformers.__version__, 'torch', torch.__version__, 'hip', torch.version.hip)"

EXPOSE 8000
ENTRYPOINT ["python3", "-m", "vllm.entrypoints.openai.api_server"]
CMD ["--host", "0.0.0.0", "--port", "8000"]
