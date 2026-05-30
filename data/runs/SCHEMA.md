# Run JSON schema (v0)

One JSON file per run, under `data/runs/<YYYY-MM-DD>/<host>-<model-slug>-<engine-slug>.json`.

```jsonc
{
  "schema_version": 0,
  "run_date": "2026-05-14",
  "host": {
    "slug": "halo3-shanghai",
    "name": "GMKtec EVO-X2 (Strix Halo)",
    "vendor": "AMD",
    "chip": "Ryzen AI Max+ 395",
    "vram_gb": 128,
    "deployment_form": "apu_minipc"
  },
  "model": {
    "slug": "qwen3-30b-a3b",
    "name": "Qwen3-30B-A3B",
    "params_b": 30,
    "quantization": "Q4_K_M",
    "source_url": "https://huggingface.co/Qwen/Qwen3-30B-A3B-Instruct-2507-GGUF"
  },
  "engine": {
    "slug": "llamacpp-hip",
    "name": "llama.cpp",
    "version": "b6789",
    "commit": "abcdef1",
    "backend": "HIP",
    "build_flags": "-DGGML_HIP=ON -DAMDGPU_TARGETS=gfx1151"
  },
  "command": "llama-bench -m /models/Qwen3-30B-A3B-Q4_K_M.gguf -p 512 -n 128 -ngl 99",
  "pp_toks_per_s": 215.4,
  "tg_toks_per_s": 28.1,
  "ttft_ms": null,
  "ctx": 4096,
  "batch": 1,
  "concurrency": 1,
  "vram_used_gb": 19.2,
  "scenario": "single-user-chat",
  "usability_tag": "ok",
  "log_url": "https://example.com/path/to/raw.log",
  "source_url": "https://github.com/JoursBleu/InferStation/blob/main/data/runs/2026-05-14/halo3-shanghai-qwen3-30b-a3b-llamacpp-hip.json",
  "notes": ""
}
```

`usability_tag` ∈ `"ok"` (✅), `"slow"` / `"fragile"` (⚠️), `"broken"` (❌).
