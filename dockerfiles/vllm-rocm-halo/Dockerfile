# syntax=docker/dockerfile:1.7
# vllm-rocm-halo: clean runtime image for AMD Strix Halo (gfx1151).
#
# This is now a thin ASSEMBLER. It installs a PREBUILT vLLM wheel (produced by
# the `vllm-rocm-halo-wheel` profile and stored as a FROM-scratch pkg image)
# into the InferStation PyTorch/ROCm Halo base and restores ABI-pinned runtime
# deps from the wheel constraints. No source checkout, no compiler. To change the vLLM
# version, rebuild the wheel pkg first (build.sh vllm-rocm-halo-wheel).
#
# Build (via dockerfiles/build.sh):
#   ./build.sh vllm-rocm-halo-wheel        # 1) compile the wheel (slow, incremental)
#   ./build.sh vllm-rocm-halo              # 2) assemble runtime from the wheel (~2 min)
#
ARG VLLM_BASE=ghcr.io/inferstation/pytorch-rocm-halo:multiarch-7.15.0a20260719-gfx1151
ARG WHEEL_IMAGE=ghcr.io/inferstation/vllm-wheel-halo-gfx11:gfx11-gfx1151
ARG VLLM_TAG=gfx11
ARG VLLM_REVISION=unknown
ARG PYTORCH_ROCM_ARCH=gfx1151

# The prebuilt-wheel pkg (FROM scratch: vllm-*.whl + rocm-requirements.txt).
FROM ${WHEEL_IMAGE} AS wheel

FROM ${VLLM_BASE}
ARG VLLM_TAG
ARG VLLM_REVISION
ARG PYTORCH_ROCM_ARCH

LABEL org.opencontainers.image.source="https://github.com/ROCm/vllm" \
      org.opencontainers.image.version="${VLLM_REVISION}" \
      org.opencontainers.image.revision="${VLLM_REVISION}" \
      org.inferstation.vllm.ref="${VLLM_TAG}" \
      org.opencontainers.image.description="vLLM ${VLLM_TAG} for AMD Strix Halo (${PYTORCH_ROCM_ARCH}), assembled from a prebuilt wheel" \
      org.opencontainers.image.licenses="Apache-2.0" \
      io.amd.rocm.arch="${PYTORCH_ROCM_ARCH}"

ENV PYTORCH_ROCM_ARCH=${PYTORCH_ROCM_ARCH}
ENV VLLM_TARGET_DEVICE=rocm
ENV ROCM_PATH=/usr/local/lib/python3.12/site-packages/_rocm_sdk_devel
ENV HIP_PATH=/usr/local/lib/python3.12/site-packages/_rocm_sdk_devel
ENV HSA_OVERRIDE_GFX_VERSION=11.5.1
ENV PYTHONUNBUFFERED=1

COPY --from=wheel / /tmp/wheels/

# Install our prebuilt wheel against the same PyTorch/ROCm ABI constraints used
# by the wheel builder. Keep full multimodal support via transformers 5.10.2.
RUN --mount=type=cache,target=/root/.cache/uv,id=vllm-halo-runtime-uv,sharing=locked \
    grep -E '^(amd-[A-Za-z0-9_.+-]+|rocm[A-Za-z0-9_.+-]*|torch|torchvision|triton)==' \
       /tmp/wheels/constraints.txt > /tmp/wheels/runtime-constraints.txt \
 && printf 'numpy<2.5\nsetuptools>=77.0.3,<80.0.0\ntransformers==5.10.2\nhuggingface-hub[hf_transfer,cli]\n' >> /tmp/wheels/runtime-constraints.txt \
 && uv -v pip install --system --python python \
       --constraint /tmp/wheels/runtime-constraints.txt \
       --index-url "https://rocm.nightlies.amd.com/whl-multi-arch/" \
       --extra-index-url https://pypi.org/simple/ \
       --index-strategy unsafe-best-match \
       --prerelease allow \
       -r /tmp/wheels/requirements/rocm.txt \
 && uv -v pip install --system --python python --no-deps /tmp/wheels/vllm-*.whl \
 && test "${VLLM_REVISION}" != unknown \
 && if [ -f /tmp/wheels/commit.txt ]; then test "$(cat /tmp/wheels/commit.txt)" = "${VLLM_REVISION}"; else echo "legacy wheel has no commit.txt; using pinned VLLM_REVISION=${VLLM_REVISION}"; fi \
 && python - <<'PY'
from pathlib import Path

path = Path('/usr/local/lib/python3.12/site-packages/vllm/v1/attention/backends/rocm_attn.py')
old = 'return [32, 64, 80, 96, 128, 160, 192, 224, 256]'
new = 'return [32, 64, 80, 96, 128, 160, 192, 224, 256, 512]'
text = path.read_text()
if text.count(old) != 1:
      raise RuntimeError(f'expected exactly one ROCM_ATTN head-size list in {path}')
path.write_text(text.replace(old, new))

path = Path('/usr/local/lib/python3.12/site-packages/vllm/v1/attention/ops/triton_unified_attention.py')
lines = path.read_text().splitlines()
start = next(i for i, line in enumerate(lines) if line.startswith('def _get_tile_size('))
end = next(i for i, line in enumerate(lines[start + 1 :], start + 1) if line.startswith('def unified_attention('))
returns = [i for i in range(start, end) if lines[i].strip() == 'return tile_size']
if len(returns) != 1:
      raise RuntimeError(f'expected exactly one tile-size return in {path}, found {len(returns)}')
index = returns[0]
indent = lines[index][: len(lines[index]) - len(lines[index].lstrip())]
patch = [
      f'{indent}# Backport vLLM PR #39018 for 64 KiB shared-memory devices.',
      f'{indent}head_size_padded = triton.next_power_of_2(head_size)',
      f'{indent}if (',
      f'{indent}    tile_size == 32',
      f'{indent}    and head_size_padded >= 512',
      f'{indent}    and element_size >= 2',
      f'{indent}    and current_platform.is_navi()',
      f'{indent}):',
      f'{indent}    tile_size = 16',
      '',
]
lines[index:index] = patch
path.write_text('\n'.join(lines) + '\n')
PY
RUN rm -rf /tmp/wheels /root/.cache/pip \
 && python -c "import inspect, vllm, transformers, torch; from vllm.v1.attention.backends.rocm_attn import RocmAttentionBackend; from vllm.v1.attention.ops.triton_unified_attention import _get_tile_size; assert 512 in RocmAttentionBackend.get_supported_head_sizes(); assert 'head_size_padded >= 512' in inspect.getsource(_get_tile_size); print('vllm', vllm.__version__, 'transformers', transformers.__version__, 'torch', torch.__version__, 'hip', torch.version.hip, 'rocm_attn_head_512', True, 'triton_limited_smem_patch', True)"

EXPOSE 8000
ENTRYPOINT ["python", "-m", "vllm.entrypoints.openai.api_server"]
CMD ["--host", "0.0.0.0", "--port", "8000"]
