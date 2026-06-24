# syntax=docker/dockerfile:1.7
# llama.cpp HIP/ROCm backend on amd64, targeted at AMD Radeon AI PRO R9700
# (gfx1201, RDNA4). Build from upstream master (rolling). Runs on the 9700x8 box.
#
# Base ROCm must match the run host's KFD driver. 9700x8 ships ROCm 7.2.3; the
# 7.2-complete base (ROCm 7.2.0 userspace) is proven to run there (the validated
# nightly-20260619 image used it). Do NOT drop to the 7.0 base — gfx12xx on 7.0
# segfaults inside libhsa-runtime64 during tensor upload.

ARG LLAMA_REPO=https://github.com/ggml-org/llama.cpp
ARG LLAMA_TAG=master
ARG ROCM_VERSION=7.2
ARG UBUNTU_VERSION=24.04
ARG BASE_ROCM_DEV_CONTAINER=rocm/dev-ubuntu-${UBUNTU_VERSION}:${ROCM_VERSION}-complete
# Radeon AI PRO R9700 only -> small + fast build. Add more arches here if needed.
ARG ROCM_DOCKER_ARCH=gfx1201

# ---------- builder ----------
FROM ${BASE_ROCM_DEV_CONTAINER} AS builder
ARG LLAMA_REPO
ARG LLAMA_TAG
ARG ROCM_DOCKER_ARCH

ENV AMDGPU_TARGETS=${ROCM_DOCKER_ARCH}
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates cmake ninja-build pkg-config build-essential \
        libcurl4-openssl-dev libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth=1 --branch "${LLAMA_TAG}" "${LLAMA_REPO}" . 2>/dev/null \
 || (git clone "${LLAMA_REPO}" . && git checkout "${LLAMA_TAG}") \
 && git rev-parse HEAD > /commit.txt

RUN HIPCXX="$(hipconfig -l)/clang" HIP_PATH="$(hipconfig -R)" \
    cmake -B build -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=/out \
        -DGGML_HIP=ON \
        -DGGML_HIP_ROCWMMA_FATTN=ON \
        -DAMDGPU_TARGETS="${ROCM_DOCKER_ARCH}" \
        -DGGML_BACKEND_DL=ON -DGGML_CPU_ALL_VARIANTS=ON \
        -DLLAMA_CURL=ON \
        -DLLAMA_BUILD_TESTS=OFF \
        -DLLAMA_BUILD_EXAMPLES=ON \
 && cmake --build build -j --target install \
 && find /out -name '*.a' -delete \
 && (find /out -name '*.so*' -exec strip --strip-unneeded {} \; 2>/dev/null || true) \
 && (strip --strip-unneeded /out/bin/* 2>/dev/null || true)

# ---------- runtime ----------
FROM ${BASE_ROCM_DEV_CONTAINER}
ARG LLAMA_TAG
LABEL org.inferstation.profile="llama-rocm-r9700" \
      org.inferstation.llama_tag="${LLAMA_TAG}" \
      org.opencontainers.image.title="llama.cpp" \
      org.opencontainers.image.description="LLM inference in C/C++ (HIP, gfx1201 / Radeon AI PRO R9700)" \
      org.opencontainers.image.source="https://github.com/ggml-org/llama.cpp"

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        libcurl4 libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy llama.cpp install tree into /app to match the directory layout the
# existing dispatcher launch_cmd / hb-llama wrapper expects (binaries at /app/*,
# .so at /app/*.so).
COPY --from=builder /out/bin /app
COPY --from=builder /out/lib /app
COPY --from=builder /commit.txt /app/commit.txt

ENV PATH="/app:${PATH}"
ENV LD_LIBRARY_PATH="/app:/opt/rocm/lib:${LD_LIBRARY_PATH}"
WORKDIR /work
# Generic entrypoint: callers (hb-llama wrapper, unit launch_cmd) pass
# `--entrypoint /app/llama-bench` (or similar) at `docker run` time.
ENTRYPOINT ["/bin/bash"]
CMD ["-l"]
