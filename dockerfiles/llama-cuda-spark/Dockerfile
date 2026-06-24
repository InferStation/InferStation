# syntax=docker/dockerfile:1.7
# llama.cpp on aarch64 Spark (sm_121)
# Multi-stage minimal build: ~2.5 GB final.

ARG LLAMA_REPO=https://github.com/ggml-org/llama.cpp
ARG LLAMA_TAG=b5350
ARG CUDA_ARCH=121

# ---------- builder ----------
FROM nvcr.io/nvidia/cuda:13.2.0-cudnn-devel-ubuntu24.04 AS builder
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
FROM nvcr.io/nvidia/cuda:13.2.0-runtime-ubuntu24.04
LABEL org.inferstation.profile="llama-cuda-spark" \
      org.inferstation.llama_tag="${LLAMA_TAG}" \
      org.inferstation.cuda_arch="${CUDA_ARCH}"

RUN apt-get update && apt-get install -y --no-install-recommends \
        libcurl4 libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /out /usr/local
COPY --from=builder /commit.txt /usr/local/share/llama.cpp/commit.txt

ENV NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility \
    LD_LIBRARY_PATH=/usr/local/lib

WORKDIR /work
ENTRYPOINT ["/usr/local/bin/llama-server"]
CMD ["--help"]
