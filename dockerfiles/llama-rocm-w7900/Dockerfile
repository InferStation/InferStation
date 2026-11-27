# syntax=docker/dockerfile:1.7
# llama.cpp HIP/ROCm backend on amd64, targeted at AMD Radeon PRO W7900
# (gfx1100, RDNA3). Build from upstream master (rolling); compiled on the 9700x8 box.
#
# Base: ROCm 7.2-complete, the same userspace as llama-rocm-r9700. A llama.cpp
# build on a ROCm 7.2 userspace has run the W7900 benchmarks on hosts with the
# amdgpu 7.1.x driver.

ARG LLAMA_REPO=https://github.com/ggml-org/llama.cpp
ARG LLAMA_TAG=master
ARG ROCM_VERSION=7.2
ARG UBUNTU_VERSION=24.04
ARG BASE_ROCM_DEV_CONTAINER=rocm/dev-ubuntu-${UBUNTU_VERSION}:${ROCM_VERSION}-complete
# Radeon PRO W7900 only (gfx1100) -> small + fast build.
ARG ROCM_DOCKER_ARCH=gfx1100

# ---------- builder ----------
FROM ${BASE_ROCM_DEV_CONTAINER} AS builder
ARG LLAMA_REPO
ARG LLAMA_TAG
ARG CACHEBUST
ARG ROCM_DOCKER_ARCH

ENV AMDGPU_TARGETS=${ROCM_DOCKER_ARCH}
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates cmake ninja-build pkg-config build-essential \
        libcurl4-openssl-dev libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN if [ -n "${CACHEBUST}" ]; then \
            git init . && git remote add origin "${LLAMA_REPO}" \
            && git fetch --depth=1 origin "${CACHEBUST}" \
            && git checkout --detach FETCH_HEAD; \
        else \
            git clone --depth=1 --branch "${LLAMA_TAG}" "${LLAMA_REPO}" . 2>/dev/null \
            || (git clone "${LLAMA_REPO}" . && git checkout "${LLAMA_TAG}"); \
        fi \
 && if [ -n "${CACHEBUST}" ]; then test "$(git rev-parse HEAD)" = "${CACHEBUST}"; fi \
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
ARG CACHEBUST
LABEL org.inferstation.profile="llama-rocm-w7900" \
      org.inferstation.llama_tag="${LLAMA_TAG}" \
    org.opencontainers.image.revision="${CACHEBUST}" \
      org.opencontainers.image.title="llama.cpp" \
      org.opencontainers.image.description="LLM inference in C/C++ (HIP, gfx1100 / Radeon PRO W7900)" \
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
