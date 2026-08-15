FROM python:3.12.11-slim-bookworm AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /workspace

COPY requirements.txt requirements-test.txt ./
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

COPY pyproject.toml README.md alembic.ini ./
COPY apps ./apps
COPY packages ./packages
COPY workers ./workers
COPY tests ./tests
COPY datasets ./datasets
COPY scripts ./scripts

RUN pip install --no-deps . && \
    groupadd --gid 1024 evalhub && \
    useradd --uid 1024 --gid 1024 --create-home evalhub && \
    chown -R evalhub:evalhub /workspace

FROM base AS runtime
USER evalhub

EXPOSE 8000

FROM base AS test
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements-test.txt
USER evalhub
