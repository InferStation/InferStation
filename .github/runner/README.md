# Self-hosted GitHub Actions runner (minimal image)

Minimal Ubuntu 24.04 + pinned `actions/runner` v2.334.0 (arm64 SHA verified).

## Build

```bash
cd .github/runner
docker build -t inferstation/runner:2.334.0 .
```

## Run

```bash
docker run -d \
  --name inferstation-runner-<host> \
  --restart unless-stopped \
  --network host \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e REPO_URL=https://github.com/JoursBleu/InferStation \
  -e RUNNER_NAME=<host> \
  -e RUNNER_LABELS=<host>,<chip-tag> \
  -e RUNNER_TOKEN=<one-time-registration-token> \
  inferstation/runner:2.334.0
```

Fresh registration tokens at:
`https://github.com/JoursBleu/InferStation/settings/actions/runners/new`

## Stop / remove

```bash
docker stop inferstation-runner-<host>     # cleanly deregisters
```

## Security

- Only `workflow_dispatch` triggers are configured in this repo.
- Mounting `/var/run/docker.sock` grants host-root via escape; acceptable
  because only repo maintainers can dispatch workflows.
