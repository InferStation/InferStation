# InferStation

**Independent reference station for LLM inference performance on desktop & workstation hardware.**

Training has had its decade. The next several years belong to inference — half in data centers,
half on private hardware: APU mini-PCs (Strix Halo), workbench compute (DGX Spark), and
workstation towers (W7900, R9700, RTX 4090/5090). InferStation publishes reproducible,
vendor-neutral measurements for that hardware, with the exact commands and raw logs needed to
verify every data point.

## Scope (v0)

| Axis | v0 |
|---|---|
| Hardware | AMD Strix Halo · NVIDIA DGX Spark · NVIDIA RTX 4090 · Radeon AI PRO R9700 |
| Engines | llama.cpp (HIP/CUDA/Vulkan) · vLLM |
| Performance metrics | TTFT · TPOT · prefill/decode/total throughput |
| Accuracy evaluations | Versioned suites across local servers and online APIs |
| Not yet | PD-disaggregated serving · standardized power methodology |

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind v4
- Performance data as plain JSON under `data/runs/<YYYY-MM-DD>/...`
- Accuracy data as plain JSON under `data/evaluations/<YYYY-MM-DD>/...`
- Schemas: [`data/runs/SCHEMA.md`](data/runs/SCHEMA.md) and
  [`data/evaluations/SCHEMA.md`](data/evaluations/SCHEMA.md)

## Container Images

- Validated image versions, immutable digests, and withdrawn releases:
   [`IMAGE_RELEASES.md`](IMAGE_RELEASES.md)

## Architecture and methodology

- Methodology: [`docs/methodology.md`](docs/methodology.md)
- Performance pipeline:
   [`docs/benchmark-pipeline-design.md`](docs/benchmark-pipeline-design.md)
- Accuracy design:
   [`docs/accuracy-benchmark-design.md`](docs/accuracy-benchmark-design.md)
- Frontend and backend deployment:
   [`docs/deployment.md`](docs/deployment.md)
- Accuracy backend:
   [`services/llm-eval-hub/`](services/llm-eval-hub/)
- GitHub runner workflow: [`.github/workflows/bench-batch.yml`](.github/workflows/bench-batch.yml)
- Batch entrypoint: [`scripts/run-all.sh`](scripts/run-all.sh)
- Result records and raw evidence are exposed through the site under `/runs`.

## Develop locally

```bash
pnpm install
pnpm dev
# open http://localhost:3000
```

## Contributing a run

1. Capture a raw log on the target host.
2. Add a JSON file under `data/runs/<date>/` following
   [`data/runs/SCHEMA.md`](data/runs/SCHEMA.md).
3. Open a PR. The site rebuilds from the JSON tree at deploy time.

## Contributing an accuracy evaluation

1. Start from the local-server or online-API examples under
   [`data/evaluations/examples/`](data/evaluations/examples/).
2. Record the exact model identity, target, suite version, protocol spec,
   dataset revisions, generation settings, task metrics and evidence links.
3. Set `publication_status` to `published` and add the JSON below
   `data/evaluations/<YYYY-MM-DD>/`.
4. Run `pnpm manifest:evaluations`. Invalid records fail validation; examples
   and drafts are validated but never published.

The website exposes reviewed accuracy results at `/benchmark` and an internal
Eval Hub launcher at `/benchmark/run`, without changing the existing
Performance manifest or routes. `/accuracy` is retained as a compatibility
alias for the summary.

## Independence

The maintainer is employed by AMD. The data, methods, and conclusions on this site do not
represent AMD&rsquo;s position. Every result ships with the exact reproduction command and raw
log so anyone can verify it on their own hardware.

## License

MIT (see [`LICENSE`](LICENSE)).
