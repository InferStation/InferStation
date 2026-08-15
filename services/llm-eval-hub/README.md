# LLM Eval Hub service

LLM Eval Hub is InferStation's repository-owned accuracy backend. It evaluates
network-reachable OpenAI-compatible model APIs; it does not load models or use
the host GPU.

Production architecture and operations are documented in
[`../../docs/deployment.md`](../../docs/deployment.md). Product and data-flow
decisions are documented in
[`../../docs/accuracy-benchmark-design.md`](../../docs/accuracy-benchmark-design.md).

## Components

```text
apps/api/       FastAPI control plane and Alembic migrations
apps/web/       React/Vite administrative UI
packages/       dataset, prompt, parser, scorer, and metric engine
workers/        Celery execution and Redis scheduling limits
datasets/       immutable benchmark, smoke, and test fixtures
scripts/        dataset registration, deploy, backup, and restore tools
tests/          unit, contract, integration, browser, and fault tests
```

The production Compose stack contains web, API, worker, PostgreSQL, Redis, and
artifact initialization services. PostgreSQL and artifacts are operational
state and must be backed up; they are not replaced by public aggregate JSON.

## Dataset packs

| Name | Rows | Purpose |
| --- | ---: | --- |
| `inferstation-accuracy-pipeline-smoke-10` | 10 | pipeline test only; never report accuracy |
| `mmlu-lite-native` | 570 | low-cost native-chat evaluation |
| `gsm8k-native` | 1,319 | numeric-answer evaluation |
| `mmlu-full-native` | 14,042 | full native-chat MMLU evaluation |

MMLU Lite is a subset of MMLU Full. Do not select both in one run.

The smoke pack intentionally uses trivial synthetic questions. Its directory
name, display label, description, and tags identify it as non-reportable test
data.

## Local development

Requirements are Python 3.12, Docker Compose, and Node.js for the administrative
UI.

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
cd apps/web && npm ci
```

Run backend tests and lint from this directory:

```bash
.venv/bin/pytest
.venv/bin/ruff check apps packages workers scripts tests
```

Run the development stack only with a local `.env`:

```bash
docker compose up -d --build
```

Default development endpoints are web `:18080`, API `:18000`, and deterministic
mock model API `:18001`.

`scripts/generate_deploy_env.sh TARGET ORIGIN [TEMPLATE]` creates a mode-0600
production environment without printing secrets and refuses to overwrite an
existing one.

## Dataset registration

`scripts/register_benchmarks.py` idempotently registers all production
benchmark packs and the smoke pack. Existing immutable versions must have the
same checksum and manifest or registration fails.

## Endpoint policy

- `REQUIRE_ADMIN_API_KEY=false` is permitted only for the current trusted
  internal deployment; the default remains authenticated.
- Private HTTP endpoints require `ALLOW_INSECURE_HTTP=true` and an allowed CIDR.
- Arbitrary public HTTPS endpoints require
  `ALLOW_PUBLIC_HTTPS_ENDPOINTS=true`.
- Exact public host allowlists remain available through
  `ALLOWED_ENDPOINT_HOSTS`.
- Loopback, link-local, cloud metadata, multicast, redirects, URL credentials,
  query strings, and fragments are always rejected.

## Secrets and data safety

- Never commit `.env`, `.env.deploy`, API keys, endpoint credentials, or
  backups.
- Never change `SECRET_ENCRYPTION_KEY` for an existing database.
- Never run `docker compose down -v` during normal development or deployment.
- Never edit an immutable dataset version in place; create a new version.
- Never use the smoke pack for published model comparisons.
