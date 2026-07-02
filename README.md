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
| Hardware | AMD Strix Halo · NVIDIA DGX Spark |
| Engines | llama.cpp (HIP) · llama.cpp (Vulkan) · vLLM |
| Metrics | pp · tg · ttft · VRAM peak |
| Not yet | PD-disagg · power · multi-GPU sharding |

Tower workstations and more engines come once v0 is stable.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind v4
- Run data as plain JSON under `data/runs/<YYYY-MM-DD>/...`
- Schema: see [`data/runs/SCHEMA.md`](data/runs/SCHEMA.md)

## Benchmark Methodology

- Methodology: [`docs/methodology.md`](docs/methodology.md)
- Result records and raw evidence are exposed through the site under `/runs`.

## Develop locally

```bash
pnpm install
pnpm dev
# open http://localhost:3000
```

## Contributing a run

1. Capture a raw log on the target host.
2. Add a JSON file under `data/runs/<date>/<host>-<model>-<engine>.json` following
   [`data/runs/SCHEMA.md`](data/runs/SCHEMA.md).
3. Open a PR. The site rebuilds from the JSON tree at deploy time.

## Independence

The maintainer is employed by AMD. The data, methods, and conclusions on this site do not
represent AMD&rsquo;s position. Every result ships with the exact reproduction command and raw
log so anyone can verify it on their own hardware.

## License

MIT (see [`LICENSE`](LICENSE)).
