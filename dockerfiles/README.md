# InferStation Image Profiles

This directory contains the build and mirror profiles used by InferStation.
GitHub Container Registry (GHCR) is the active registry. Harbor and the old
Gitea build flow are retired.

Deployment versions are documented in [`../IMAGE_RELEASES.md`](../IMAGE_RELEASES.md).
That ledger, together with immutable image digests, is the deployment source of
truth. `latest` and `nightly-*` are mutable build outputs, not reproducible
release identifiers.

## Layout

Each profile directory contains:

- `meta.json`: profile name, kind, registry, default tag, platform, build host,
  upstream reference, and build arguments.
- `Dockerfile`: present for `kind=build` profiles.

There are no profile-local build scripts. The single dispatcher is
[`build.sh`](build.sh), and [`daily.sh`](daily.sh) orchestrates device-family
tracks.

List the current profiles and destinations instead of relying on a duplicated
table in this document:

```bash
cd dockerfiles
./build.sh list
```

## Build A Profile

Run commands from `dockerfiles/`:

```bash
# Build or mirror one profile and push its configured tag plus latest.
./build.sh llama-rocm-halo

# Build an isolated candidate without moving latest.
./build.sh vllm-rocm-halo \
  --ref=gfx11 \
  --tag=runtime-<source-sha> \
  --no-latest

# Build locally without pushing.
./build.sh vllm-rocm-halo --tag=dev --no-latest --no-push

# Show all supported flags.
./build.sh --help
```

`build.sh` reads the selected profile's `meta.json`, copies that profile's
context to its build or mirror host, and pushes to its configured GHCR
repository. In GitHub Actions, `INFERSTATION_FORCE_LOCAL_BUILD=1` keeps the
build on the CICD runner.

Important tag behavior:

- The default behavior moves `latest` after a successful push.
- `--no-latest` is required for candidates and manual experiments.
- `--also-tag=<tag>` adds another tag to the same built artifact.
- A tag is not immutable merely because its name contains a date or source SHA.
  Record and deploy the manifest digest from `IMAGE_RELEASES.md`.

### Model Tools Packaging

Profiles with `"model_tools": true` are wrapped after their initial image push
with the shared Hugging Face and ModelScope toolchain from
[`model-tools/Dockerfile`](model-tools/Dockerfile). The wrapped image is tested
and pushed back to the requested tag and aliases.

Each `package_model_tools` invocation stages its context in a unique directory
matching `/tmp/inferstation-model-tools-package.<profile>.*` on the packaging
host and removes it on exit. This isolation is required: `daily.sh` runs several
profiles concurrently, including the three PyTorch/ROCm bases in the
`radeon-base` track. Do not replace the unique directory with a shared fixed
path or separate context upload from script execution; either change can let
one build remove another build's `model-tools/Dockerfile`.

An image tag can exist even when packaging failed because the unwrapped image
is pushed first. Treat the job result, not tag presence alone, as the publication
gate. For an additional check, the final image must have this label:

```bash
docker image inspect ghcr.io/inferstation/<profile>:<tag> \
  --format '{{ index .Config.Labels "org.inferstation.model-tools" }}'
# expected: true
```

## vLLM Wheel And Runtime Images

Radeon vLLM profiles use three layers:

```text
PyTorch/ROCm base -> architecture-specific vLLM wheel -> runtime assembler
```

For the default Strix Halo line:

- `pytorch-rocm-halo` provides the pinned ROCm, PyTorch, Triton, and gfx1151
  device packages.
- `vllm-rocm-halo-wheel` compiles the ROCm/vLLM `gfx11` branch for gfx1151 and
  packages the wheel plus resolved requirements into a `FROM scratch` image.
- `vllm-rocm-halo` installs that wheel into the matching base and applies any
  runtime-only Python backports.

Rebuild the wheel whenever the vLLM source, compiler ABI, PyTorch/ROCm base, or
target architecture changes. Runtime-only dependency or Python patch changes
can use the `halo-runtime` workflow track and reuse the existing wheel.

The active profile metadata is authoritative for base and wheel references:

```bash
jq .build_args vllm-rocm-halo/meta.json
jq .build_args vllm-rocm-halo-wheel/meta.json
```

## GitHub Actions

The active build workflow is
[`../.github/workflows/nightly-build.yml`](../.github/workflows/nightly-build.yml).

- Schedule: Friday 15:00 UTC (Beijing Friday 23:00).
- Manual tracks: `all`, `radeon-base`, `halo`, `halo-runtime`, `nv4090`,
  `r9700`, `spark`, and `spark-vllm`.
- Scheduled runs build the complete matrix and publish `nightly-YYYYMMDD` plus
  `latest` where applicable.
- Manual runs produce isolated tags and intentionally do not move nightly tags.
- `halo-runtime` assembles only `vllm-rocm-halo` and always uses `--no-latest`;
  promote its digest only after real-device validation.

GitHub schedules can start late, and a complete build can cross UTC midnight.
Use the workflow's release date when checking dated tags; the wall-clock date at
the end of the job may be different. Before starting a benchmark, verify that no
image job is still moving `latest`. The benchmark runner refreshes mutable tags
between units, so overlapping image publication can mix digests in one result
date.

The benchmark workflow is separate:
[`../.github/workflows/bench-batch.yml`](../.github/workflows/bench-batch.yml).
Building an image does not prove that it works on the target GPU.

### Radeon Base Recovery

If `build-radeon-base` fails during `package HF + ModelScope tools`, inspect the
first profile-specific error rather than the final track summary. The historical
signature of a shared staging-directory collision is:

```text
failed to read dockerfile: open Dockerfile: no such file or directory
```

Run `nightly-build` manually from `main` with `tracks=radeon-base` and leave
`nightly_date` empty. This exercises only the Radeon base track, does not wait
for Spark, and manual mode does not move `nightly-*` or `latest` tags. A recovery
is complete only when all four track results are `OK`:

```text
pytorch-rocm-halo
pytorch-rocm-r9700
pytorch-rocm-w7900
vllm-rocm-w7900-main
```

After the run, inspect the `org.inferstation.model-tools=true` label on each
published rolling tag. If a dated nightly tag from an earlier failed run must be
repaired, do not assume the existing tag is wrapped; rebuild that date through
an explicitly reviewed recovery path before using it.

## Release Procedure

1. Build an isolated candidate with `--no-latest`.
2. Record runtime, base, and wheel manifest digests.
3. Validate HSA/device initialization and representative GPU kernels.
4. Run model-level health and completion checks on the target hardware.
5. Run the scoped GitHub benchmark recovery or validation workflow.
6. Promote the validated runtime digest to `latest` if appropriate.
7. Append the release and evidence to `IMAGE_RELEASES.md`.

Do not use a successful Docker build as the release gate. The Strix Halo
release process specifically requires real gfx1151 validation.

## Add A Profile

1. Create `dockerfiles/<name>/`.
2. Add `meta.json` using a neighboring profile as the schema reference.
3. Add a Dockerfile for `kind=build`, or `source_image` for `kind=mirror`.
4. Verify `./build.sh list` includes the profile.
5. Add the profile to the relevant `daily.sh` track and GitHub workflow only if
   it belongs in scheduled builds.
6. Build with an isolated tag and validate on its target hardware.

## Historical Files

[`prune.sh`](prune.sh) and `sync-ghcr.sh` are retained only as historical Harbor
utilities. They are not part of current GHCR retention or publication. GHCR
retention must not be inferred from those scripts.
