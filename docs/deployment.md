# InferStation deployment

This document is the production runbook for the static InferStation frontend
and the LLM Eval Hub backend on the RTX4090 host.

## 1. Production layout

```text
/home/lkang/codes/InferStation/              Git source checkout
├── out/                                     generated frontend export
├── services/llm-eval-hub/                  backend source
└── deploy/llm-eval-hub/                    production override/example

/home/lkang/inferstation/site/              Nginx static content only
/home/lkang/inferstation/eval-hub.env       backend secrets/config, mode 0600

Docker project inferstation-eval-hub
├── web          0.0.0.0:18080
├── api          127.0.0.1:18000
├── worker       no host port
├── postgres     persistent named volume
├── redis        persistent named volume
└── artifacts    persistent named volume
```

The Nginx container continues to serve only
`/home/lkang/inferstation/site`. Backend code and state must never be placed in
that directory because frontend deployment uses `rsync --delete`.

## 2. Required preflight

Run as `lkang` in `/home/lkang/codes/InferStation`:

```bash
git status --short
git rev-parse HEAD
docker compose version
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
docker volume ls
df -h /home/lkang /var/lib/docker
```

Stop before changing anything when:

- the Git worktree is not clean;
- an unknown service already owns ports 18000 or 18080;
- an Eval Hub run is active;
- existing Eval Hub volumes are present but their ownership is unclear; or
- free disk is insufficient for an image build and retained results.

Do not reset the worktree, delete containers, or delete volumes to resolve a
preflight failure.

## 3. First backend deployment

Generate the environment outside the source checkout. The script refuses to
overwrite an existing environment and generates all three secrets locally:

```bash
./services/llm-eval-hub/scripts/generate_deploy_env.sh \
  /home/lkang/inferstation/eval-hub.env \
  http://10.170.38.102:8200 \
  deploy/llm-eval-hub/rtx4090.env.example
```

Preserve this file and `SECRET_ENCRYPTION_KEY` across every upgrade. The
committed template enables arbitrary public HTTPS targets, trusted private
CIDRs, worker concurrency 2, global concurrency 4, and QPS 2. It also sets
`REQUIRE_ADMIN_API_KEY=false` for the current trusted internal network. Set it
to `true` before exposing the service outside that boundary.

Validate the merged Compose configuration before starting it:

```bash
docker compose \
  --env-file /home/lkang/inferstation/eval-hub.env \
  -f services/llm-eval-hub/compose.deploy.yml \
  -f deploy/llm-eval-hub/compose.rtx4090.yml \
  config --quiet
```

Start and wait for health checks:

```bash
docker compose \
  --env-file /home/lkang/inferstation/eval-hub.env \
  -f services/llm-eval-hub/compose.deploy.yml \
  -f deploy/llm-eval-hub/compose.rtx4090.yml \
  up -d --build --wait
```

Register the immutable benchmark and smoke datasets idempotently:

```bash
docker compose \
  --env-file /home/lkang/inferstation/eval-hub.env \
  -f services/llm-eval-hub/compose.deploy.yml \
  -f deploy/llm-eval-hub/compose.rtx4090.yml \
  run --rm benchmark-register
```

## 4. Frontend deployment

The existing manual chain remains authoritative:

```bash
git pull --ff-only origin main
export PATH=/home/lkang/.local/node20/bin:$PATH
pnpm install --frozen-lockfile
pnpm build
rsync -a --delete out/ /home/lkang/inferstation/site/
```

Before `rsync`, record the Git SHA and verify that `out/benchmark/index.html`
and `out/benchmark/run/index.html` exist. On the first deployment of a new
revision, retain one copy of the current static site under
`/home/lkang/inferstation/site-backups/` before replacement. Do not copy the
repository root or backend directories into `site/`.

## 5. Verification

```bash
curl -fsS http://127.0.0.1:8200/ >/dev/null
curl -fsS http://127.0.0.1:18000/healthz
curl -fsS http://127.0.0.1:18080/ >/dev/null
```

Also verify:

- Performance Overview, Summary, Charts, Compare, Runs, and History still load;
- Benchmark Summary shows Preview or reviewed results as expected;
- Run benchmark connects to `http://10.170.38.102:18080/api/v1`;
- the dataset list includes the clearly labeled ten-row smoke pack;
- `data/runs` and Performance manifest counts are unchanged by the feature;
- the backend containers respect CPU/memory limits; and
- `out/` and the production static site are identical.

The first functional run must use the smoke pack and a non-production model
endpoint. It validates the chain only and must not be published as accuracy.

## 6. Routine upgrade

1. Confirm the worktree is clean and no Eval Hub run is active.
2. Back up Eval Hub when it already contains state.
3. Pull with `git pull --ff-only` and record the new SHA.
4. Validate the merged Compose configuration.
5. Rebuild/start the backend with `up -d --build --wait`.
6. Register datasets idempotently.
7. Build and deploy the static frontend.
8. Run all verification checks.

Alembic migrations run when the API starts. A code rollback may be unsafe after
a forward-only database migration; use the pre-upgrade backup and review the
migration before reverting.

## 7. Backup and recovery

From `services/llm-eval-hub`, create a backup during a quiet period:

```bash
./scripts/backup.sh \
  --env-file /home/lkang/inferstation/eval-hub.env
```

Store the complete backup outside the Docker host when practical. It includes
database state, artifacts, checksums, and a protected environment copy.

Restore is destructive and requires a separately reviewed command. Never use
`docker compose down -v`, never delete named volumes to fix startup problems,
and never replace an existing encryption key.

## 8. Monitoring and capacity

```bash
docker compose \
  --env-file /home/lkang/inferstation/eval-hub.env \
  -f services/llm-eval-hub/compose.deploy.yml \
  -f deploy/llm-eval-hub/compose.rtx4090.yml \
  ps
docker stats --no-stream
```

Monitor CPU, memory, free disk, PostgreSQL growth, worker errors, and GPU-serving
latency while an evaluation runs. Lower submission concurrency first if GPU
performance regresses. Do not terminate containers that hold an active run.
