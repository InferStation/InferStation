# syntax=docker/dockerfile:1.7
# vLLM wheel builder for AMD Strix Halo (gfx1151).
#
# Builds the vLLM C++/HIP extensions ONCE, INCREMENTALLY (a persistent ccache
# lives in a BuildKit cache mount, so it survives across builds), and emits a
# single arch-locked wheel + the resolved runtime requirements, packaged into a
# FROM-scratch image (artefacts only, no OS). The `vllm-rocm-halo` assembler
# then installs that wheel into a clean runtime image in ~2 min with no
# compiler.
#
# The wheel is ABI-locked to (VLLM_TAG, VLLM_BASE, gfx1151, py3.13). Rebuild it
# only when bumping vLLM or the rocm/vllm base image. Same base + only-changed
# sources => ccache makes a rebuild ~5-10 min instead of 30-60 min.
#
# Build (via dockerfiles/build.sh):
#   ./build.sh vllm-rocm-halo-wheel                 # release v0.22.0
#   ./build.sh vllm-rocm-halo-wheel --ref=main --tag=nightly-$(date +%Y%m%d)-gfx1151

ARG VLLM_BASE=rocm/vllm:rocm7.13.0_gfx1151_ubuntu24.04_py3.13_pytorch_2.10.0_vllm_0.19.1
ARG VLLM_REPO=https://github.com/vllm-project/vllm.git
ARG VLLM_TAG=v0.22.0
ARG PYTORCH_ROCM_ARCH=gfx1151

FROM ${VLLM_BASE} AS builder
ARG VLLM_REPO
ARG VLLM_TAG
ARG PYTORCH_ROCM_ARCH
# Cache-bust token for the `git clone` layer below. When VLLM_TAG is a moving
# branch (e.g. main) the clone RUN's command text is identical every night, so
# BuildKit caches the FIRST clone forever and the wheel freezes at that commit
# while commit-<sha> tags keep advancing (the freeze bug). daily.sh passes the
# resolved upstream HEAD sha here so the layer re-runs whenever main moves.
ARG CACHEBUST=main

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTORCH_ROCM_ARCH=${PYTORCH_ROCM_ARCH}
ENV MAX_JOBS=8
ENV CMAKE_BUILD_PARALLEL_LEVEL=8
# Route every C / C++ / HIP compile through ccache. The cache itself lives in
# the BuildKit cache mount on the RUN below, so it persists across builds and
# only changed translation units recompile.
ENV CMAKE_C_COMPILER_LAUNCHER=ccache
ENV CMAKE_CXX_COMPILER_LAUNCHER=ccache
ENV CMAKE_HIP_COMPILER_LAUNCHER=ccache
ENV CCACHE_DIR=/root/.cache/ccache

RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates build-essential cmake ninja-build ccache \
        python3-dev python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/vllm-src
RUN echo "cache-bust: ${CACHEBUST}" \
 && git clone --depth=1 --branch "${VLLM_TAG}" "${VLLM_REPO}" . 2>/dev/null \
 || (git clone "${VLLM_REPO}" . && git fetch --depth=1 origin "${VLLM_TAG}" && git checkout FETCH_HEAD)

# Build-time toolchain + numpy pin (same as the old one-shot Dockerfile).
RUN pip install --upgrade \
        numba scipy 'huggingface-hub[cli,hf_transfer]' setuptools_scm \
        setuptools wheel build cmake ninja \
 && pip install 'numpy<2'

# requirements/rocm.txt path moved between vllm versions; resolve it and stash a
# copy into /wheels so the assembler can install the exact same runtime deps.
# rocm.txt usually starts with `-r common.txt`, so we copy the WHOLE requirements/
# tree (preserving the relative -r includes) and record which file to use. An
# empty marker if this tag has none, so the assembler's check never fails.
RUN mkdir -p /wheels/requirements; \
    if [ -d requirements ]; then cp -r requirements/. /wheels/requirements/; fi; \
    if   [ -f requirements/rocm.txt ];       then REQ=rocm.txt; \
    elif [ -f requirements/rocm-build.txt ]; then REQ=rocm-build.txt; \
    elif [ -f requirements-rocm.txt ];       then cp requirements-rocm.txt /wheels/requirements/rocm.txt; REQ=rocm.txt; \
    else REQ=""; fi; \
    if [ -n "$REQ" ]; then echo ">>> rocm reqs: requirements/$REQ" && pip install -r "requirements/$REQ" && echo "$REQ" > /wheels/rocm-req-name.txt; \
    else echo ">>> no rocm requirements file in this tag" && : > /wheels/rocm-req-name.txt; fi

# Build the wheel. ccache cache mount = incremental across builds. Pin a PEP440
# version only for a real release tag (vX.Y.Z); for a branch ref (e.g. main)
# leave it to setuptools_scm ("main" is not a valid version -> InvalidVersion).
RUN --mount=type=cache,target=/root/.cache/ccache,id=vllm-halo-ccache,sharing=locked \
    VER="${VLLM_TAG#v}"; \
    case "$VER" in \
      [0-9]*) PIN="SETUPTOOLS_SCM_PRETEND_VERSION=$VER"; \
              echo ">>> pinning vllm wheel version to $VER (release tag ${VLLM_TAG})" ;; \
      *)      PIN=""; \
              echo ">>> VLLM_TAG='${VLLM_TAG}' not a release tag; setuptools_scm derives version from git" ;; \
    esac; \
    env VLLM_TARGET_DEVICE=rocm \
        PYTORCH_ROCM_ARCH=${PYTORCH_ROCM_ARCH} \
        $PIN \
        pip wheel . \
            --no-build-isolation \
            --no-deps \
            -w /wheels \
            --verbose \
 && ls -lh /wheels/*.whl \
 && ccache -s

# ---------------- pkg stage: artefacts only (FROM scratch) ----------------
# The whole image is just: the vLLM wheel + the resolved rocm requirements.
# Pulled by the assembler via `COPY --from=<this image>`.
FROM scratch
COPY --from=builder /wheels/ /
