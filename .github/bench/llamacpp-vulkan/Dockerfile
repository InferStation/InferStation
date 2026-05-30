# llama.cpp built with the Vulkan backend. Works on any GPU that exposes a
# Vulkan ICD — including NVIDIA (via the driver) and AMD/Intel. On NVIDIA
# you must run the container with `NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics`
# so the ICD is mounted.
ARG BASE=ubuntu:24.04
ARG LLAMA_CPP_REPO=https://github.com/ggml-org/llama.cpp
ARG LLAMA_CPP_REF=master

FROM ${BASE} AS build
ARG LLAMA_CPP_REPO
ARG LLAMA_CPP_REF

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        git cmake ninja-build build-essential ca-certificates curl \
        libvulkan-dev vulkan-tools glslang-tools glslc \
        spirv-headers spirv-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --filter=blob:none ${LLAMA_CPP_REPO} llama.cpp \
    && cd llama.cpp && git checkout ${LLAMA_CPP_REF} && git rev-parse HEAD > /src/llama_cpp.commit

RUN cd llama.cpp && cmake -S . -B build \
        -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DGGML_VULKAN=ON \
        -DGGML_NATIVE=OFF \
        -DLLAMA_CURL=OFF \
        -DBUILD_SHARED_LIBS=OFF \
    && cmake --build build -j

FROM ${BASE} AS runtime
ENV DEBIAN_FRONTEND=noninteractive
# GLVND stack is required so the NVIDIA libGLX_nvidia.so.0 (injected via
# nvidia-container-toolkit) can dlopen its dependencies. The official
# ggml-org/llama.cpp Vulkan Dockerfile uses the same set.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl libgomp1 \
        libvulkan1 vulkan-tools mesa-vulkan-drivers \
        libglvnd0 libgl1 libglx0 libegl1 libgles2 \
        libxext6 libx11-6 \
    && rm -rf /var/lib/apt/lists/*

# Allow NVIDIA Container Toolkit to mount the NVIDIA Vulkan ICD here.
ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics
ENV NVIDIA_VISIBLE_DEVICES=all

WORKDIR /opt/llama.cpp
COPY --from=build /src/llama.cpp/build/bin/ ./bin/
COPY --from=build /src/llama_cpp.commit ./commit.txt
ENV PATH=/opt/llama.cpp/bin:${PATH}
