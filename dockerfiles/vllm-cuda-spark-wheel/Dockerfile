# syntax=docker/dockerfile:1.7
# vLLM wheel builder for NVIDIA DGX Spark (GB10, sm_121) on aarch64.
#
# Builds vLLM's C/CUDA extensions ONCE, INCREMENTALLY (a persistent ccache lives
# in a BuildKit cache mount, so it survives across builds and only changed
# translation units recompile), and emits a single arch-locked wheel packaged
# into a FROM-scratch image (artefact only, no OS). The `vllm-cuda-spark`
# assembler then installs that wheel into a clean runtime image in ~2 min with
# no compiler.
#
# CRITICAL — toolkit must match the Spark host driver's CUDA version. The host
# driver 580.x is CUDA 13.0 and the base torch is cu130. cuda-nvcc-13-2 would
# make nvcc emit PTX ISA 9.2, which the 13.0 driver cannot JIT, so every kernel
# that lacks a native sm_121 cubin (Marlin/AWQ W4A16 repack, flash-attn) dies at
# runtime with cudaErrorUnsupportedPtxVersion ("PTX compiled with an unsupported
# toolchain"). Pin to cuda-*-13-0 so PTX is 9.0 (JIT-able) and arch=12.1 yields
# native sm_121 SASS.
#
# The wheel is ABI-locked to (VLLM_TAG, VLLM_BASE, sm_121, py3.12, CUDA 13.0).
# Rebuild it only when bumping vLLM or the vllm-openai base image. Same base +
# only-changed sources => ccache makes a rebuild far cheaper than a cold one.
#
# Build (via dockerfiles/build.sh):
#   ./build.sh vllm-cuda-spark-wheel                 # release v0.22.0
#   ./build.sh vllm-cuda-spark-wheel --ref=main --tag=nightly-$(date +%Y%m%d)

ARG VLLM_BASE=vllm/vllm-openai:nightly-aarch64
ARG VLLM_REPO=https://github.com/vllm-project/vllm.git
ARG VLLM_TAG=v0.22.0
ARG TORCH_CUDA_ARCH_LIST=12.1

FROM ${VLLM_BASE} AS builder
ARG VLLM_REPO
ARG VLLM_TAG
ARG TORCH_CUDA_ARCH_LIST
# Cache-bust token for the `git clone` layer below. When VLLM_TAG is a moving
# branch (e.g. main) the clone RUN's command text is identical every night, so
# BuildKit caches the FIRST clone forever and the wheel freezes at that commit
# while commit-<sha> tags keep advancing (the freeze bug). daily.sh passes the
# resolved upstream HEAD sha here so the layer re-runs whenever main moves.
ARG CACHEBUST=main

# vllm-openai base ships only cuda-runtime; install nvcc + cmake + ccache.
# Toolkit pinned to CUDA 13.0 to match the host driver (see header) so PTX is
# 9.0 and arch=12.1 yields native sm_121 SASS.
RUN apt-get update && apt-get install -y --no-install-recommends \
        cuda-nvcc-13-0 cuda-cudart-dev-13-0 cuda-nvtx-13-0 \
        cuda-libraries-dev-13-0 \
        build-essential ninja-build git ca-certificates ccache \
    && rm -rf /var/lib/apt/lists/*

# vLLM v0.22 needs cmake>=3.26; jammy apt only ships 3.22. setuptools_rust is
# imported unconditionally by vLLM's setup.py (we build --no-build-isolation, so
# the build env == this layer's site-packages).
RUN pip install --no-cache-dir "cmake>=3.26" setuptools_rust setuptools wheel

# Route every C / C++ / CUDA compile through ccache. The cache lives in the
# BuildKit cache mount on the wheel RUN below, so it persists across builds.
ENV CUDA_HOME=/usr/local/cuda \
    PATH=/usr/local/cuda/bin:${PATH} \
    TORCH_CUDA_ARCH_LIST=${TORCH_CUDA_ARCH_LIST} \
    VLLM_TARGET_DEVICE=cuda \
    MAX_JOBS=8 \
    CMAKE_BUILD_PARALLEL_LEVEL=8 \
    CMAKE_C_COMPILER_LAUNCHER=ccache \
    CMAKE_CXX_COMPILER_LAUNCHER=ccache \
    CMAKE_CUDA_COMPILER_LAUNCHER=ccache \
    CCACHE_DIR=/root/.cache/ccache

WORKDIR /src
RUN echo "cache-bust: ${CACHEBUST}" \
 && { git clone --depth=1 --branch "${VLLM_TAG}" "${VLLM_REPO}" . 2>/dev/null \
      || (git clone "${VLLM_REPO}" . && git fetch --depth=1 origin "${VLLM_TAG}" && git checkout FETCH_HEAD); } \
 && git rev-parse HEAD > /commit.txt

# Build the vLLM wheel. ccache cache mount = incremental across builds. Pin a
# PEP440 version only for a real release tag (vX.Y.Z); a branch ref (e.g. main)
# is not a valid version -> let setuptools_scm derive it from git.
RUN --mount=type=cache,target=/root/.cache/ccache,id=vllm-spark-ccache,sharing=locked \
    VER="${VLLM_TAG#v}"; \
    case "$VER" in \
      [0-9]*) PIN="SETUPTOOLS_SCM_PRETEND_VERSION=$VER"; \
              echo ">>> pinning vllm wheel version to $VER (release tag ${VLLM_TAG})" ;; \
      *)      PIN=""; \
              echo ">>> VLLM_TAG='${VLLM_TAG}' not a release tag; setuptools_scm derives version from git" ;; \
    esac; \
    mkdir -p /wheels; \
    env VLLM_TARGET_DEVICE=cuda \
        TORCH_CUDA_ARCH_LIST=${TORCH_CUDA_ARCH_LIST} \
        $PIN \
        pip wheel . \
            --no-build-isolation \
            --no-deps \
            -w /wheels \
            --verbose \
 && cp /commit.txt /wheels/commit.txt \
 && ls -lh /wheels/*.whl \
 && ccache -s

# ---------------- pkg stage: artefact only (FROM scratch) ----------------
# The whole image is just: the vLLM wheel + the build commit marker. Pulled by
# the assembler via `COPY --from=<this image>`.
FROM scratch
COPY --from=builder /wheels/ /
