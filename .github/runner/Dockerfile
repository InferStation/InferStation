# Minimal self-hosted GitHub Actions runner image
# Built from upstream actions/runner release tarball with SHA256 pinning.
#
# Runtime contract:
#   - REPO_URL        (e.g. https://github.com/JoursBleu/InferStation)
#   - RUNNER_TOKEN    (one-time registration token; obtain from repo Settings)
#   - RUNNER_NAME     (e.g. spark1-shanghai)
#   - RUNNER_LABELS   (comma-separated; appended to default self-hosted,linux,<arch>)
#   - RUNNER_WORKDIR  (default: _work)
#   - EPHEMERAL       (default: 0; set 1 for one-shot job-then-exit)

ARG RUNNER_VERSION=2.334.0
ARG TARGETARCH

FROM ubuntu:24.04

ARG RUNNER_VERSION
ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive \
    RUNNER_ALLOW_RUNASROOT=0 \
    RUNNER_VERSION=${RUNNER_VERSION}

# Pinned SHA256 for actions/runner v2.334.0 (arm64 only for now; add amd64 when MI355/W7900 onboarded)
ENV RUNNER_SHA_arm64=f44255bd3e80160eb25f71bc83d06ea025f6908748807a584687b3184759f7e4

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl git jq sudo gnupg lsb-release \
        libicu74 docker.io python3 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1100 -s /bin/bash runner \
    && usermod -aG docker runner \
    && echo "runner ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/runner

USER runner
WORKDIR /home/runner

RUN set -e; \
    case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
        arm64) GH_ARCH=arm64; SHA="${RUNNER_SHA_arm64}";; \
        amd64) echo "amd64 not yet provisioned (no SHA pinned)"; exit 1;; \
        *) echo "unsupported arch ${TARGETARCH}"; exit 1;; \
    esac; \
    curl -fsSL -o runner.tar.gz \
        "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${GH_ARCH}-${RUNNER_VERSION}.tar.gz"; \
    echo "${SHA}  runner.tar.gz" | sha256sum -c -; \
    tar xzf runner.tar.gz; \
    rm runner.tar.gz

COPY --chown=runner:runner entrypoint.sh /home/runner/entrypoint.sh
RUN sudo chmod +x /home/runner/entrypoint.sh

ENTRYPOINT ["/home/runner/entrypoint.sh"]
