# syntax=docker/dockerfile:1.7
# vllm-rocm-r9700-main: clean runtime image for the AMD Radeon AI PRO R9700
# (gfx1201, RDNA4).
#
# This is now a thin ASSEMBLER. It installs a PREBUILT vLLM wheel (produced by
# the `vllm-rocm-r9700-main-wheel` profile and stored as a FROM-scratch pkg
# image) into the TheRock gfx1201 torch 2.10 / rocm7.13 base, with --no-deps so
# the base's AMD-tuned torch/triton/etc are kept. No source checkout, no
# compiler, no rust toolchain, ~2 min. To change the vLLM version, rebuild the
# wheel pkg first (build.sh vllm-rocm-r9700-main-wheel).
#
# Why a wheel at all: the only gfx1201 torch stack we have is the TheRock-based
# image. Its bundled *prerelease* vLLM 0.19.1 has broken gfx1201 attention/MoE
# kernels (garbage output) and there is no official rocm/vllm gfx1201 base, so we
# replace it with our own upstream vLLM compiled for gfx1201 (carried in the
# wheel).
#
# The legacy single-stage Dockerfile (compile-in-place) is kept at
# Dockerfile.legacy for reference / fallback.
#
# Build (via dockerfiles/build.sh):
#   ./build.sh vllm-rocm-r9700-main-wheel   # 1) compile the wheel (incremental)
#   ./build.sh vllm-rocm-r9700-main         # 2) assemble runtime from the wheel (~2 min)

ARG VLLM_BASE=ghcr.io/inferstation/vllm-rocm-r9700:commit-gfx1201-20260619
ARG WHEEL_IMAGE=ghcr.io/inferstation/vllm-wheel-r9700:v0.22.0-gfx1201
ARG VLLM_TAG=v0.22.0
ARG PYTORCH_ROCM_ARCH=gfx1201

# The prebuilt-wheel pkg (FROM scratch: vllm-*.whl).
FROM ${WHEEL_IMAGE} AS wheel

FROM ${VLLM_BASE}
ARG VLLM_TAG
ARG PYTORCH_ROCM_ARCH

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTORCH_ROCM_ARCH=${PYTORCH_ROCM_ARCH}
ENV VLLM_TARGET_DEVICE=rocm
# TheRock SDK layout: ROCm lives inside the _rocm_sdk_devel pip package.
ENV ROCM_PATH=/opt/python/lib/python3.13/site-packages/_rocm_sdk_devel
ENV HIP_PATH=/opt/python/lib/python3.13/site-packages/_rocm_sdk_devel

LABEL org.opencontainers.image.source="https://github.com/vllm-project/vllm" \
      org.opencontainers.image.version="${VLLM_TAG}" \
      org.opencontainers.image.description="vLLM ${VLLM_TAG} for AMD Radeon AI PRO R9700 (${PYTORCH_ROCM_ARCH}), assembled from a prebuilt wheel" \
      org.opencontainers.image.licenses="Apache-2.0" \
      io.amd.rocm.arch="${PYTORCH_ROCM_ARCH}"

COPY --from=wheel / /tmp/wheels/

# Remove the broken prerelease vLLM, then install our prebuilt gfx1201 wheel with
# --no-deps (keep the base's AMD-tuned torch/triton/etc) + pin numpy<2 (what the
# wheel was built against), exactly like the legacy compile-in-place did.
RUN pip uninstall -y vllm vllm-flash-attn flashinfer flashinfer-python 2>/dev/null || true \
 && pip install --no-deps /tmp/wheels/vllm-*.whl \
 && pip install 'numpy<2' \
 && rm -rf /tmp/wheels /root/.cache/pip \
 && python3 -c "import vllm, vllm._rocm_C, vllm._C, vllm._moe_C, torch; print('OK vllm', vllm.__version__, '_rocm_C+_C+_moe_C loaded', 'torch', torch.__version__, 'hip', torch.version.hip)"

# WORKDIR must NOT be a dir containing a vllm/ source tree: with CWD on sys.path,
# a pure-python vllm/ source (no compiled .so) would shadow the installed
# site-packages vllm (which has _rocm_C/_C/_moe_C), breaking `import vllm._rocm_C`
# at engine init. The assembler has no source checkout, but pin WORKDIR to / so
# nothing can shadow the install.
WORKDIR /

EXPOSE 8000
ENTRYPOINT ["python3", "-m", "vllm.entrypoints.openai.api_server"]
CMD ["--host", "0.0.0.0", "--port", "8000"]
