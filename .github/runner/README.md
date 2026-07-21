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
  -e REPO_URL=https://github.com/InferStation/InferStation \
  -e RUNNER_NAME=<host> \
  -e RUNNER_LABELS=inferstation-bench,<pool-label>,<host-label> \
  -e RUNNER_TOKEN=<one-time-registration-token> \
  inferstation/runner:2.334.0
```

Fresh registration tokens at:
`https://github.com/InferStation/InferStation/settings/actions/runners/new`

The workflow matrices are the source of truth for labels. For example, a Halo
runner uses `inferstation-bench,inferstation-halo,inferstation-halo3` or
`inferstation-bench,inferstation-halo,inferstation-halo4`.

## Stop / remove

```bash
docker stop inferstation-runner-<host>     # runner entrypoint deregisters
docker rm inferstation-runner-<host>
```

## Security

- Both scheduled and `workflow_dispatch` workflows run on self-hosted runners.
- Mounting `/var/run/docker.sock` gives workflow code host-root-equivalent
  access. Restrict workflow and repository write access accordingly.
- Do not add pull-request triggers for untrusted forks to jobs using these
  labels.
