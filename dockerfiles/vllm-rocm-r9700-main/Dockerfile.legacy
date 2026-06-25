# syntax=docker/dockerfile:1.7
# vLLM compiled from OFFICIAL upstream source (vllm-project/vllm) for the AMD
# Radeon AI PRO R9700 (gfx1201, RDNA4).
#
# Why source-compile: the only gfx1201 torch stack we have is the TheRock-based
# image (vllm-rocm-r9700:commit-gfx1201-20260619). Its bundled *prerelease* vLLM
# 0.19.1 has broken gfx1201 attention/MoE kernels -> the server runs but emits
# garbage (" is is is..."). There is no official rocm/vllm gfx1201 base to pull,
# so we keep that image's proven torch 2.10 / rocm7.13 / triton stack as the
# base and rebuild vLLM from upstream v0.22.0, compiling the HIP kernels
# specifically for gfx1201 (the same thing vllm-rocm-halo-main does for gfx1151).
#
# ROCm here is the TheRock `_rocm_sdk_devel` pip package (NOT /opt/rocm), so we
# point ROCM_PATH/HIP_PATH at it for vLLM's CMake/HIP build.
#
# Build (via dockerfiles/build.sh):
#   ./build.sh vllm-rocm-r9700-main --no-push          # validate
#   ./build.sh vllm-rocm-r9700-main                    # build + push

ARG VLLM_BASE=10.161.176.38:8443/inferstation/vllm-rocm-r9700:commit-gfx1201-20260619
ARG VLLM_REPO=https://github.com/vllm-project/vllm.git
ARG VLLM_TAG=v0.22.0
ARG PYTORCH_ROCM_ARCH=gfx1201

FROM ${VLLM_BASE}
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

# Remove the broken prerelease vLLM, then compile + install v0.22.0 from source
# for gfx1201. --no-build-isolation reuses the base's torch (ABI match); --no-deps
# keeps the base's AMD-tuned torch/triton/etc. ccache mount makes rebuilds fast.
RUN --mount=type=cache,target=/root/.cache/ccache,id=vllm-r9700-ccache,sharing=locked \
    pip uninstall -y vllm vllm-flash-attn flashinfer flashinfer-python 2>/dev/null || true; \
    VER="${VLLM_TAG#v}"; \
    case "$VER" in \
      [0-9]*) PIN="SETUPTOOLS_SCM_PRETEND_VERSION=$VER" ;; \
      *)      PIN="" ;; \
    esac; \
    env VLLM_TARGET_DEVICE=rocm \
        PYTORCH_ROCM_ARCH="${PYTORCH_ROCM_ARCH}" \
        ROCM_PATH="${ROCM_PATH}" HIP_PATH="${HIP_PATH}" \
        $PIN \
        pip install . --no-build-isolation --no-deps --verbose \
 && ccache -s \
 && cd / && rm -rf /opt/vllm-src \
 && python3 -c "import vllm, vllm._rocm_C, vllm._C, vllm._moe_C, torch; print('OK vllm', vllm.__version__, '_rocm_C+_C+_moe_C loaded', 'torch', torch.__version__, 'hip', torch.version.hip)"

# WORKDIR must NOT be the source checkout: with CWD on sys.path, /opt/vllm-src/vllm
# (pure-python source, no compiled .so) shadows the installed site-packages vllm
# (which has _rocm_C/_C/_moe_C), so `import vllm._rocm_C` fails at engine init.
# We deleted the source above; pin WORKDIR to / so nothing shadows the install.
WORKDIR /

LABEL org.opencontainers.image.source="https://github.com/vllm-project/vllm" \
      org.opencontainers.image.version="${VLLM_TAG}" \
      org.opencontainers.image.description="vLLM ${VLLM_TAG} compiled from upstream source for AMD Radeon AI PRO R9700 (${PYTORCH_ROCM_ARCH})" \
      org.opencontainers.image.licenses="Apache-2.0" \
      io.amd.rocm.arch="${PYTORCH_ROCM_ARCH}"

EXPOSE 8000
ENTRYPOINT ["python3", "-m", "vllm.entrypoints.openai.api_server"]
CMD ["--host", "0.0.0.0", "--port", "8000"]
