# syntax=docker/dockerfile:1.7

ARG BASE_IMAGE
FROM ${BASE_IMAGE}

USER root

ARG HUGGINGFACE_HUB_VERSION=0.36.0
ARG HF_TRANSFER_VERSION=0.1.9
ARG MODELSCOPE_VERSION=1.35.2

LABEL org.inferstation.model-tools="true" \
      org.inferstation.huggingface-hub.version="${HUGGINGFACE_HUB_VERSION}" \
      org.inferstation.hf-transfer.version="${HF_TRANSFER_VERSION}" \
      org.inferstation.modelscope.version="${MODELSCOPE_VERSION}"

# Keep download tooling isolated from the runtime's Python environment. In
# particular, vLLM images must continue to resolve their original python binary.
RUN export DEBIAN_FRONTEND=noninteractive \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates python3 python3-venv \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /opt/inferstation/model-tools \
 && /usr/bin/python3 -m venv /opt/inferstation/model-tools \
 && /opt/inferstation/model-tools/bin/pip install --no-cache-dir \
      "huggingface-hub[cli,hf_transfer]==${HUGGINGFACE_HUB_VERSION}" \
      "hf-transfer==${HF_TRANSFER_VERSION}" \
      "modelscope==${MODELSCOPE_VERSION}" \
 && ln -sf /opt/inferstation/model-tools/bin/hf /usr/local/bin/hf \
 && ln -sf /opt/inferstation/model-tools/bin/huggingface-cli /usr/local/bin/huggingface-cli \
 && ln -sf /opt/inferstation/model-tools/bin/modelscope /usr/local/bin/modelscope \
 && /opt/inferstation/model-tools/bin/python -c \
      "import huggingface_hub, modelscope; print(huggingface_hub.__version__, modelscope.__version__)" \
 && hf download --help >/dev/null \
 && huggingface-cli download --help >/dev/null \
 && modelscope download --help >/dev/null

ENV INFERSTATION_MODEL_TOOLS=/opt/inferstation/model-tools \
     HF_XET_HIGH_PERFORMANCE=1
