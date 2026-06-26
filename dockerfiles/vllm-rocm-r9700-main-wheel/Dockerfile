# syntax=docker/dockerfile:1.7
# vLLM wheel builder for AMD Radeon AI PRO R9700 (gfx1201).
#
# ROCm/vllm-style flow: start from the daily PyTorch/ROCm base for gfx1201,
# compile vLLM into a wheel, then export only the wheel artifacts from a scratch
# stage.

ARG VLLM_BASE=ghcr.io/inferstation/pytorch-rocm-r9700:v2-staging-gfx120x-all
ARG VLLM_REPO=https://github.com/vllm-project/vllm.git
ARG VLLM_TAG=main
ARG PYTORCH_ROCM_ARCH=gfx1201

FROM ${VLLM_BASE} AS builder
ARG VLLM_REPO
ARG VLLM_TAG
ARG PYTORCH_ROCM_ARCH
ARG CACHEBUST=main

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTORCH_ROCM_ARCH=${PYTORCH_ROCM_ARCH}
ENV VLLM_TARGET_DEVICE=rocm
ENV MAX_JOBS=8
ENV CMAKE_BUILD_PARALLEL_LEVEL=8
ENV ROCM_PATH=/usr/local/lib/python3.12/site-packages/_rocm_sdk_devel
ENV HIP_PATH=/usr/local/lib/python3.12/site-packages/_rocm_sdk_devel
ENV CMAKE_C_COMPILER_LAUNCHER=ccache
ENV CMAKE_CXX_COMPILER_LAUNCHER=ccache
ENV CMAKE_HIP_COMPILER_LAUNCHER=ccache
ENV CCACHE_DIR=/root/.cache/ccache

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential ca-certificates ccache curl git protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

RUN uv pip install --system --python python -U \
        packaging 'cmake<4' ninja wheel build 'setuptools>=77.0.3,<80.0.0' setuptools_scm \
        setuptools-rust pybind11 Cython scikit-build-core

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
        | sh -s -- -y --default-toolchain stable --profile minimal
ENV PATH=/root/.cargo/bin:${PATH}

WORKDIR /opt/vllm-src
RUN echo "cache-bust: ${CACHEBUST}" \
 && (git clone --depth=1 --branch "${VLLM_TAG}" "${VLLM_REPO}" . 2>/dev/null \
     || (git clone "${VLLM_REPO}" . && git fetch --depth=1 origin "${VLLM_TAG}" && git checkout FETCH_HEAD)) \
 && git rev-parse HEAD > /commit.txt

RUN --mount=type=cache,target=/root/.cache/ccache,id=vllm-r9700-ci-ccache,sharing=locked \
    VER="${VLLM_TAG#v}"; \
    case "$VER" in \
      [0-9]*) export SETUPTOOLS_SCM_PRETEND_VERSION="$VER"; \
              echo ">>> pinning vllm wheel version to $VER" ;; \
      *)      echo ">>> VLLM_TAG='${VLLM_TAG}' is moving/non-release; setuptools_scm derives version from git" ;; \
    esac; \
    VLLM_TARGET_DEVICE=rocm \
    PYTORCH_ROCM_ARCH="${PYTORCH_ROCM_ARCH}" \
    ROCM_PATH="${ROCM_PATH}" HIP_PATH="${HIP_PATH}" \
    pip wheel . --no-build-isolation --no-deps -w /wheels --verbose \
 && cp /opt/rocm-pytorch-constraints.txt /constraints.txt \
 && ls -lh /wheels/*.whl /constraints.txt \
 && ccache -s

FROM scratch
COPY --from=builder /wheels/ /
COPY --from=builder /constraints.txt /constraints.txt
