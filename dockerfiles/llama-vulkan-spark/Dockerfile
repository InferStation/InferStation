# syntax=docker/dockerfile:1.7
# llama.cpp Vulkan backend on aarch64
# Vulkan is GPU-agnostic at compile time (runtime driver picks device).
# Multi-stage minimal: ~600 MB final.

ARG LLAMA_REPO=https://github.com/ggml-org/llama.cpp
ARG LLAMA_TAG=b5350

# ---------- builder ----------
FROM ubuntu:24.04 AS builder
ARG LLAMA_REPO
ARG LLAMA_TAG

RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates cmake ninja-build pkg-config build-essential \
        libcurl4-openssl-dev \
        libvulkan-dev vulkan-tools glslang-tools glslc spirv-headers \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth=1 --branch "${LLAMA_TAG}" "${LLAMA_REPO}" . 2>/dev/null \
 || (git clone "${LLAMA_REPO}" . && git checkout "${LLAMA_TAG}") \
 && git rev-parse HEAD > /commit.txt

RUN cmake -B build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/out \
      -DGGML_VULKAN=ON \
      -DLLAMA_CURL=ON \
      -DLLAMA_BUILD_TESTS=OFF \
      -DLLAMA_BUILD_EXAMPLES=ON \
      -DBUILD_SHARED_LIBS=OFF \
 && cmake --build build -j --target install \
 && find /out -name '*.a' -delete \
 && strip --strip-unneeded /out/bin/* 2>/dev/null || true \
 && (find /out -name '*.so*' -exec strip --strip-unneeded {} \; 2>/dev/null || true)

# ---------- runtime ----------
FROM ubuntu:24.04
LABEL org.inferstation.profile="llama-vulkan-spark" \
      org.inferstation.llama_tag="${LLAMA_TAG}"

RUN apt-get update && apt-get install -y --no-install-recommends \
        libvulkan1 mesa-vulkan-drivers vulkan-tools \
        libcurl4 libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /out /usr/local
COPY --from=builder /commit.txt /usr/local/share/llama.cpp/commit.txt

ENV LD_LIBRARY_PATH=/usr/local/lib
WORKDIR /work
ENTRYPOINT ["/usr/local/bin/llama-server"]
CMD ["--help"]
