# syntax=docker/dockerfile:1.7
# vLLM wheel builder for the AMD Radeon AI PRO R9700 (gfx1201, RDNA4).
#
# Compiles vLLM's C++/HIP extensions ONCE, INCREMENTALLY (a persistent ccache
# lives in a BuildKit cache mount, so it survives across builds) on the TheRock
# gfx1201 torch 2.10 / rocm7.13 base, and emits a single arch-locked wheel
# packaged into a FROM-scratch image (artefacts only, no OS). The
# `vllm-rocm-r9700-main` assembler then installs that wheel into a clean runtime
# image in ~2 min with no compiler / no rust toolchain.
#
# Why source-compile: the only gfx1201 torch stack we have is the TheRock-based
# image (vllm-rocm-r9700:commit-gfx1201-20260619). Its bundled *prerelease* vLLM
# 0.19.1 has broken gfx1201 attention/MoE kernels -> the server runs but emits
# garbage (" is is is..."). There is no official rocm/vllm gfx1201 base to pull,
# so we keep that image's proven torch 2.10 / rocm7.13 / triton stack as the
# base and rebuild vLLM from upstream (v0.22.0), compiling the HIP kernels
# specifically for gfx1201 (the same thing vllm-rocm-halo-wheel does for gfx1151).
#
# ROCm here is the TheRock `_rocm_sdk_devel` pip package (NOT /opt/rocm), so we
# point ROCM_PATH/HIP_PATH at it for vLLM's CMake/HIP build.
#
# The wheel is ABI-locked to (VLLM_TAG, VLLM_BASE, gfx1201, py3.13). Rebuild it
# only when bumping vLLM or the TheRock base image. Same base + only-changed
# sources => ccache makes a rebuild fast instead of a full cold compile.
#
# Build (via dockerfiles/build.sh):
#   ./build.sh vllm-rocm-r9700-main-wheel              # release v0.22.0

ARG VLLM_BASE=ghcr.io/inferstation/vllm-rocm-r9700:commit-gfx1201-20260619
ARG VLLM_REPO=https://github.com/vllm-project/vllm.git
ARG VLLM_TAG=v0.22.0
ARG PYTORCH_ROCM_ARCH=gfx1201

FROM ${VLLM_BASE} AS builder
ARG VLLM_REPO
ARG VLLM_TAG
ARG PYTORCH_ROCM_ARCH
# Cache-bust for the git clone layer (matters only when VLLM_TAG is a moving
# branch; daily.sh passes the resolved HEAD sha). Harmless for release tags.
ARG CACHEBUST=v0.22.0

ENV DEBIAN_FRONTEND=noninteractive
# TheRock SDK layout: ROCm lives inside the _rocm_sdk_devel pip package.
ENV ROCM_PATH=/opt/python/lib/python3.13/site-packages/_rocm_sdk_devel
ENV HIP_PATH=/opt/python/lib/python3.13/site-packages/_rocm_sdk_devel
ENV PYTORCH_ROCM_ARCH=${PYTORCH_ROCM_ARCH}
ENV VLLM_TARGET_DEVICE=rocm
ENV MAX_JOBS=8
ENV CMAKE_BUILD_PARALLEL_LEVEL=8
# Route every C / C++ / HIP compile through ccache. The cache itself lives in
# the BuildKit cache mount on the wheel RUN below (id=vllm-r9700-ccache, the SAME
# id the legacy in-place build used), so it persists across builds and only
# changed translation units recompile.
ENV CMAKE_C_COMPILER_LAUNCHER=ccache
ENV CMAKE_CXX_COMPILER_LAUNCHER=ccache
ENV CMAKE_HIP_COMPILER_LAUNCHER=ccache
ENV CCACHE_DIR=/root/.cache/ccache

# Host toolchain for the build (gcc/g++ for non-HIP TUs, git, ccache, curl for
# rustup). cmake + ninja already ship in /opt/python/bin; HIP compiler comes
# from _rocm_sdk_devel.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates build-essential ccache curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/vllm-src
RUN echo "cache-bust: ${CACHEBUST}" \
 && (git clone --depth=1 --branch "${VLLM_TAG}" "${VLLM_REPO}" . 2>/dev/null \
     || (git clone "${VLLM_REPO}" . && git fetch --depth=1 origin "${VLLM_TAG}" && git checkout FETCH_HEAD)) \
 && git rev-parse HEAD > /commit.txt

# Build-time python toolchain. vLLM v0.22 needs setuptools-rust + a real Rust
# toolchain to build its Rust extension (the rocm/vllm base ships these; the
# TheRock base does NOT). --no-build-isolation means we must supply every build
# requirement ourselves, so install rustup here and put cargo on PATH.
RUN pip install --upgrade setuptools_scm setuptools wheel build 'numpy<2' setuptools-rust \
 && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal
ENV PATH=/root/.cargo/bin:${PATH}

# Build the wheel for gfx1201. --no-build-isolation reuses the base's torch (ABI
# match); --no-deps keeps the base's AMD-tuned torch/triton/etc out of the wheel.
# ccache mount (same id as the legacy in-place build) makes rebuilds incremental.
# Pin a PEP440 version only for a real release tag (vX.Y.Z); for a branch ref
# (e.g. main) leave it to setuptools_scm ("main" is not a valid version).
RUN --mount=type=cache,target=/root/.cache/ccache,id=vllm-r9700-ccache,sharing=locked \
    VER="${VLLM_TAG#v}"; \
    case "$VER" in \
      [0-9]*) PIN="SETUPTOOLS_SCM_PRETEND_VERSION=$VER"; \
              echo ">>> pinning vllm wheel version to $VER (release tag ${VLLM_TAG})" ;; \
      *)      PIN=""; \
              echo ">>> VLLM_TAG='${VLLM_TAG}' not a release tag; setuptools_scm derives version from git" ;; \
    esac; \
    env VLLM_TARGET_DEVICE=rocm \
        PYTORCH_ROCM_ARCH="${PYTORCH_ROCM_ARCH}" \
        ROCM_PATH="${ROCM_PATH}" HIP_PATH="${HIP_PATH}" \
        $PIN \
        pip wheel . \
            --no-build-isolation \
            --no-deps \
            -w /wheels \
            --verbose \
 && ls -lh /wheels/*.whl \
 && ccache -s

# ---------------- pkg stage: artefacts only (FROM scratch) ----------------
# The whole image is just the vLLM wheel. Pulled by the assembler via
# `COPY --from=<this image>`.
FROM scratch
COPY --from=builder /wheels/ /
