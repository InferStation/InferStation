# llama.cpp built with CUDA backend, pinned to a known-good upstream commit.
# Designed for NVIDIA GB10 / Grace Blackwell (arm64) and other CUDA GPUs.
ARG CUDA_BASE=nvcr.io/nvidia/cuda:13.2.0-cudnn-devel-ubuntu24.04
ARG LLAMA_CPP_REPO=https://github.com/ggml-org/llama.cpp
ARG LLAMA_CPP_REF=master

FROM ${CUDA_BASE} AS build
ARG LLAMA_CPP_REPO
ARG LLAMA_CPP_REF

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        git cmake ninja-build build-essential ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --filter=blob:none ${LLAMA_CPP_REPO} llama.cpp \
    && cd llama.cpp && git checkout ${LLAMA_CPP_REF} && git rev-parse HEAD > /src/llama_cpp.commit

# Build with CUDA. Native architecture detection (works for GB10 sm_121 too).
RUN cd llama.cpp && cmake -S . -B build \
        -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DGGML_CUDA=ON \
        -DGGML_NATIVE=OFF \
        -DLLAMA_CURL=OFF \
        -DBUILD_SHARED_LIBS=OFF \
    && cmake --build build -j

FROM ${CUDA_BASE} AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/llama.cpp
COPY --from=build /src/llama.cpp/build/bin/ ./bin/
COPY --from=build /src/llama_cpp.commit ./commit.txt
ENV PATH=/opt/llama.cpp/bin:${PATH}
