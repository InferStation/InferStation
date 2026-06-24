# syntax=docker/dockerfile:1.7
# llama.cpp CUDA backend on amd64, targeted at NVIDIA RTX 4090 (sm_89).
# Multi-stage minimal build.
#
# NOTE: the 4090 host driver is 590.48.01 (= CUDA 13.1). The CUDA 13.2 base
# image (used by llama-cuda-spark) REFUSES to run here:
#   nvidia-container-cli: requirement error: unsatisfied condition: cuda>=13.2
# so this profile pins the CUDA 13.0.1 base (<= host 13.1). Do NOT bump to 13.2
# unless the 4090 box driver is upgraded to >= 13.2 first.

ARG LLAMA_REPO=https://github.com/ggml-org/llama.cpp
ARG LLAMA_TAG=master
ARG CUDA_ARCH=89

# ---------- builder ----------
FROM nvcr.io/nvidia/cuda:13.0.1-cudnn-devel-ubuntu24.04 AS builder
ARG LLAMA_REPO
ARG LLAMA_TAG
ARG CUDA_ARCH

RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates cmake ninja-build pkg-config build-essential \
        libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
# Clone the requested ref. `--depth=1` only works for branch/tag names; for
# arbitrary commit SHAs we fall back to a full fetch + checkout.
RUN git clone --depth=1 --branch "${LLAMA_TAG}" "${LLAMA_REPO}" . 2>/dev/null \
 || (git clone "${LLAMA_REPO}" . && git checkout "${LLAMA_TAG}") \
 && git rev-parse HEAD > /commit.txt

# Note: --allow-shlib-undefined needed because libcuda.so.1 is provided by the
# NVIDIA runtime mount, not the CUDA SDK image.
RUN cmake -B build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/out \
      -DGGML_CUDA=ON \
      -DGGML_CUDA_FA=ON \
      -DCMAKE_CUDA_ARCHITECTURES=${CUDA_ARCH} \
      -DLLAMA_CURL=ON \
      -DLLAMA_BUILD_TESTS=OFF \
      -DLLAMA_BUILD_EXAMPLES=ON \
      -DBUILD_SHARED_LIBS=OFF \
      -DCMAKE_EXE_LINKER_FLAGS="-Wl,--allow-shlib-undefined" \
      -DCMAKE_SHARED_LINKER_FLAGS="-Wl,--allow-shlib-undefined" \
 && cmake --build build -j --target install \
 && find /out -name '*.a' -delete \
 && strip --strip-unneeded /out/bin/* 2>/dev/null || true \
 && (find /out -name '*.so*' -exec strip --strip-unneeded {} \; 2>/dev/null || true)

# ---------- runtime ----------
FROM nvcr.io/nvidia/cuda:13.0.1-runtime-ubuntu24.04
ARG LLAMA_TAG
ARG CUDA_ARCH
LABEL org.inferstation.profile="llama-cuda-4090" \
      org.inferstation.llama_tag="${LLAMA_TAG}" \
      org.inferstation.cuda_arch="${CUDA_ARCH}" \
      org.opencontainers.image.title="llama.cpp" \
      org.opencontainers.image.description="LLM inference in C/C++ (CUDA, sm_89 / RTX 4090)" \
      org.opencontainers.image.source="https://github.com/ggml-org/llama.cpp"

RUN apt-get update && apt-get install -y --no-install-recommends \
        libcurl4 libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Match the dispatcher launch_cmd / hb-llama layout: binaries on PATH at /app.
# CUDA build is static (BUILD_SHARED_LIBS=OFF) -> binaries only, no /out/lib.
COPY --from=builder /out/bin /app
COPY --from=builder /commit.txt /app/commit.txt

ENV NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility \
    PATH="/app:${PATH}" \
    LD_LIBRARY_PATH="/app:/usr/local/lib"

WORKDIR /work
# Generic entrypoint: callers (hb-llama wrapper, unit launch_cmd) pass
# `--entrypoint /app/llama-bench` (or similar) at `docker run` time.
ENTRYPOINT ["/bin/bash"]
CMD ["-l"]
