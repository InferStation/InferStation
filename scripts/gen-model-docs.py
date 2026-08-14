#!/usr/bin/env python3
"""Generate per-model docs pages from harvested unit data."""
import json, os, re, sys
from pathlib import Path

HARVEST = json.load(open("/tmp/harvest.json"))
OUT_DIR = Path(__file__).resolve().parents[1] / "src/app/docs"

# Per-model curated metadata (kicker/tagline/badges/links/atGlance/overview only)
META = {
  "Qwen3-4B": {
    "slug": "qwen3-4b",
    "kicker": "Model · Dense · Alibaba Qwen",
    "tagline": "Compact 4B-parameter dense Qwen3 model. Used as a wide-coverage sweep target: 26 GGUF quant tiers from UD-IQ1_S to BF16 on both Spark and Halo.",
    "badges": [("Dense 4B","violet"),("128K ctx",None),("GGUF only",None)],
    "bf16_repo": "Qwen/Qwen3-4B",
    "gguf_repo": "unsloth/Qwen3-4B-GGUF",
    "model_dir_spark": "/models/Qwen3-4B",
    "model_dir_halo": "/models/Qwen3-4B",
    "model_prefix": "Qwen3-4B",
    "vllm_bf16_tag": "qwen3-4b-BF16",
    "overview_extra": [("Total params","4B"),("Architecture","Dense decoder, GQA")],
  },
  "Qwen3-8B": {
    "slug": "qwen3-8b",
    "kicker": "Model · Dense · Alibaba Qwen",
    "tagline": "8B-parameter dense Qwen3 model benchmarked at Q4_K_M on all four llama.cpp backends across both hosts.",
    "badges": [("Dense 8B","violet"),("128K ctx",None)],
    "bf16_repo": "Qwen/Qwen3-8B",
    "gguf_repo": "unsloth/Qwen3-8B-GGUF",
    "model_dir_spark": "/models/Qwen3-8B",
    "model_dir_halo": "/models/Qwen3-8B",
    "model_prefix": "Qwen3-8B",
    "vllm_bf16_tag": "qwen3-8b-BF16",
    "overview_extra": [("Total params","8B"),("Architecture","Dense decoder, GQA")],
  },
  "Qwen3-14B": {
    "slug": "qwen3-14b",
    "kicker": "Model · Dense · Alibaba Qwen",
    "tagline": "14B-parameter dense Qwen3, Q4_K_M sweep across CUDA / Vulkan / HIP on both Spark and Halo.",
    "badges": [("Dense 14B","violet"),("128K ctx",None)],
    "bf16_repo": "Qwen/Qwen3-14B",
    "gguf_repo": "unsloth/Qwen3-14B-GGUF",
    "model_dir_spark": "/models/Qwen3-14B",
    "model_dir_halo": "/models/Qwen3-14B",
    "model_prefix": "Qwen3-14B",
    "vllm_bf16_tag": "qwen3-14b-BF16",
    "overview_extra": [("Total params","14B"),("Architecture","Dense decoder, GQA")],
  },
  "Qwen3-32B": {
    "slug": "qwen3-32b",
    "kicker": "Model · Dense · Alibaba Qwen",
    "tagline": "32B-parameter dense Qwen3, Q4_K_M sweep. Largest dense Qwen3 fully resident on the 128 GB Halo iGPU at Q4.",
    "badges": [("Dense 32B","violet"),("128K ctx",None)],
    "bf16_repo": "Qwen/Qwen3-32B",
    "gguf_repo": "unsloth/Qwen3-32B-GGUF",
    "model_dir_spark": "/models/Qwen3-32B",
    "model_dir_halo": "/models/Qwen3-32B",
    "model_prefix": "Qwen3-32B",
    "vllm_bf16_tag": "qwen3-32b-BF16",
    "overview_extra": [("Total params","32B"),("Architecture","Dense decoder, GQA")],
  },
  "Qwen3-30B-A3B": {
    "slug": "qwen3-30b-a3b",
    "kicker": "Model · MoE · Alibaba Qwen",
    "tagline": "30B-total / ~3B-active Qwen3 MoE. Q4_K_M sweep across CUDA / Vulkan / HIP on both hosts.",
    "badges": [("MoE 30B / 3B","violet"),("128K ctx",None)],
    "bf16_repo": "Qwen/Qwen3-30B-A3B",
    "gguf_repo": "unsloth/Qwen3-30B-A3B-GGUF",
    "model_dir_spark": "/models/Qwen3-30B-A3B",
    "model_dir_halo": "/models/Qwen3-30B-A3B",
    "model_prefix": "Qwen3-30B-A3B",
    "vllm_bf16_tag": "qwen3-30b-a3b-BF16",
    "overview_extra": [("Total / Active params","30B / ~3B"),("Architecture","MoE decoder")],
  },
  "Qwen3.6-27B": {
    "slug": "qwen3-6-27b",
    "kicker": "Model · Dense · Alibaba Qwen",
    "tagline": "27B-parameter dense Qwen3.6 (next-generation Qwen architecture). 22 GGUF quant tiers; vLLM BF16 on both hosts.",
    "badges": [("Dense 27B","violet"),("256K ctx",None),("BF16 native","emerald")],
    "bf16_repo": "Qwen/Qwen3.6-27B",
    "gguf_repo": "unsloth/Qwen3.6-27B-GGUF",
    "model_dir_spark": "/models",            # note: spark files are flat /models/Qwen3.6-27B-*.gguf
    "model_dir_halo": "/models/Qwen3.6-27B",
    "model_prefix": "Qwen3.6-27B",
    "spark_flat": True,
    "vllm_bf16_tag": "qwen3.6-27b-BF16",
    "overview_extra": [("Total params","27B"),("Architecture","Dense Qwen3.6 (next-gen)")],
  },
  "Gemma-4-26B-A4B-it": {
    "slug": "gemma-4-26b-a4b-it",
    "kicker": "Model · MoE · Google Gemma",
    "tagline": "26B-total / ~4B-active Gemma-4 MoE (instruction-tuned). 21 GGUF quants; vLLM BF16 on both hosts.",
    "badges": [("MoE 26B / 4B","violet"),("Instruct",None),("BF16 native","emerald")],
    "bf16_repo": "google/gemma-4-26b-a4b-it",
    "gguf_repo": "unsloth/gemma-4-26B-A4B-it-GGUF",
    "model_dir_spark": "/models",            # spark flat: /models/gemma-4-26B-A4B-it-*.gguf
    "model_dir_halo": "/models/Gemma-4-26B-A4B-it-smoke",
    "model_prefix": "gemma-4-26B-A4B-it",
    "spark_flat": True,
    "halo_prefix_lower": True,
    "vllm_bf16_tag": "gemma-4-26b-a4b-it-BF16",
    "overview_extra": [("Total / Active params","26B / ~4B"),("Architecture","MoE decoder")],
  },
  "Llama-3.3-70B-Instruct": {
    "slug": "llama-3-3-70b-instruct",
    "kicker": "Model · Dense · Meta Llama",
    "tagline": "70B-parameter dense Llama 3.3 instruction-tuned. Benchmarked at Q4_K_M and Q8_0 across CUDA / Vulkan / HIP on both hosts.",
    "badges": [("Dense 70B","violet"),("Instruct",None),("128K ctx",None)],
    "bf16_repo": "meta-llama/Llama-3.3-70B-Instruct",
    "gguf_repo": "unsloth/Llama-3.3-70B-Instruct-GGUF",
    "model_dir_spark": "/models/Llama-3.3-70B-Instruct",
    "model_dir_halo": "/models/Llama-3.3-70B-Instruct",
    "model_prefix": "Llama-3.3-70B-Instruct",
    "vllm_bf16_tag": None,  # 70B BF16 = 140 GB, won't fit; skip vLLM block
    "overview_extra": [("Total params","70B"),("Architecture","Dense decoder, GQA")],
  },
}

def js(s):
    """Escape for JS template literal (we use backtick strings)."""
    return s.replace("\\","\\\\").replace("`","\\`").replace("${","\\${")

def quant_family(q):
    if q.startswith("UD-"): return "UD"
    if q == "MXFP4_MOE": return "MXFP4"
    return "Standard"

def build_repro_blocks(m, meta):
    model_slug = meta["slug"]
    return [("Repository planner", f"""# Preview the exact scenarios before dispatching a runner.
python3 scripts/bench-batch.py \\
  --filter='<host-profile>:{model_slug}:<quantization>' \\
  --scope=all --dry-run

# Execute the reviewed plan through the bench-batch GitHub Actions workflow.
# Each published JSON records the exact command, image digest, and Actions log.""")]

def build_engine_rows(samples):
    rows = []
    backends = {key.split("@", 1)[0] for key in samples}
    if "llamacpp-cuda" in backends:
        rows.append(("llama.cpp", ("CUDA","emerald"), "NVIDIA DGX Spark",
            'container image and immutable digest recorded in each run',
            'cfe9838d (2026-04-21)<br/>-DGGML_CUDA=ON -DGGML_NATIVE=ON'))
    if "llamacpp-vulkan" in backends:
        rows.append(("llama.cpp", ("Vulkan",None), "NVIDIA DGX Spark / AMD Strix Halo",
            'container image and immutable digest recorded in each run',
            'cfe9838d (2026-04-21)<br/>-DGGML_VULKAN=ON'))
    if "llamacpp-hip" in backends:
        rows.append(("llama.cpp", ("HIP/ROCm","amber"), "AMD Strix Halo",
            'container image and immutable digest recorded in each run',
            'bbeb89d (2026-05-05)<br/>-DGGML_HIP=ON -DAMDGPU_TARGETS=gfx1151<br/>-DGGML_HIP_GRAPHS=ON -DGGML_CUDA_FA=ON'))
    if "vllm" in backends:
        rows.append(("vLLM", ("ROCm","amber"), "AMD Strix Halo",
            'container image and immutable digest recorded in each run',
            'vllm 0.16.1.dev10+g11515110f.d20260323<br/>torch 2.9.1+rocm7.12.0rc1<br/>ROCm 7.12.60610-2bd1678d3d'))
        rows.append(("vLLM", ("CUDA","emerald"), "NVIDIA DGX Spark",
            'container image and immutable digest recorded in each run',
            'CUDA 13.x · driver 580.82.09'))
    return rows

def emit_page(model_name, m, meta):
    samples = m["cmd_samples"]
    hosts = set()
    for k in samples:
        backend = k.split("@", 1)[0]
        if backend in {"llamacpp-cuda", "vllm"}: hosts.add("spark")
        if backend in {"llamacpp-hip", "vllm"}: hosts.add("halo")

    badges_js = ", ".join(
        f'{{label:"{lbl}"' + (f',tone:"{t}"' if t else '') + '}'
        for lbl, t in meta["badges"]
    )

    quants = sorted(m["quants"])
    quants_js = ",\n    ".join(
        f'{{ name:"{q}", family:"{quant_family(q)}" }}'
        for q in quants
    )

    overview = [
      ("Family", model_name.split("-")[0]),
      ("Repo (BF16)", meta["bf16_repo"]),
    ]
    if meta.get("gguf_repo"):
        overview.append(("Repo (GGUF)", meta["gguf_repo"]))
    overview.extend(meta.get("overview_extra", []))
    overview_js = ",\n    ".join(f'["{k}","{v}"]' for k,v in overview)

    at_glance = []
    at_glance.append(("Total quants", str(len(quants))))
    at_glance.append(("Units in registry", str(m["unit_count"])))
    at_glance.append(("Hosts", str(len(m["hosts"]))))
    at_glance.append(("Engines", str(len(samples))))
    at_glance_js = ",\n    ".join(
        f'{{label:"{l}",value:"{v}"}}' for l,v in at_glance
    )

    hosts_js = ", ".join(f'"{h}"' for h in sorted(hosts))

    rows = build_engine_rows(samples)
    rows_js_parts = []
    for engine, (badge_label, badge_tone), host, image_html, version_html in rows:
        badge_js = f'{{label:"{badge_label}"' + (f',tone:"{badge_tone}"' if badge_tone else '') + '}'
        rows_js_parts.append(
            f'    {{engine:"{engine}",badge:{badge_js},host:"{host}",'
            f'imageHtml:<span dangerouslySetInnerHTML={{{{__html:`{image_html}`}}}}/>,'
            f'versionHtml:<span dangerouslySetInnerHTML={{{{__html:`{version_html}`}}}}/>}}'
        )
    rows_js = ",\n".join(rows_js_parts)

    repro = build_repro_blocks(m, meta)
    repro_js = ",\n    ".join(
        '{title:`' + js(t) + '`,\n     code:`' + js(c) + '`}'
        for t, c in repro
    )

    caveats = []
    if any(q.startswith("UD-IQ") or q == "MXFP4_MOE" for q in quants):
        caveats.append('<>Exotic quants (<span className="font-mono">UD-IQ*</span>, <span className="font-mono">MXFP4_MOE</span>) require recent llama.cpp builds — verified against the commits shown above.</>')
    if "30B" in model_name or "26B" in model_name or "27B" in model_name or "35B" in model_name or "70B" in model_name:
        caveats.append('<>Halo vLLM uses <span className="font-mono">--max-num-seqs 1 --num-prompts 32 --max-model-len 2304</span>; the iGPU shares 128 GB system RAM, so default vLLM KV-cache reservation OOMs at higher concurrency for large BF16 models. Sweep concurrency by re-running with larger <span className="font-mono">--max-num-seqs</span> as memory allows.</>')
    if not caveats:
        caveats.append('<>All llama-batched-bench runs use <span className="font-mono">-ngl 999</span> (offload every layer) and <span className="font-mono">-npp 512 -ntg 128 -npl 1,4,16,32</span> (single sweep yields four concurrency points).</>')
    caveats_js = ",\n    ".join(caveats)

    bf16_link = f'{{label:"BF16 weights",href:"https://huggingface.co/{meta["bf16_repo"]}",primary:true,external:true}}'
    gguf_link = f'{{label:"GGUF quants",href:"https://huggingface.co/{meta["gguf_repo"]}",external:true}}'
    links_js = bf16_link + (", " + gguf_link if meta.get("gguf_repo") else "")

    bf16_size = ""
    weights_bf16_js = ""
    if meta.get("vllm_bf16_tag"):
        weights_bf16_js = (
            'weightsBF16={{repo:"' + meta["bf16_repo"] +
        '", note:"Used by vLLM. Download from the public model repository before running the benchmark."}}\n  '
        )

    tsx = f'''/* AUTO-GENERATED — edit scripts/gen-model-docs.py and re-run, do not hand-edit. */
import {{ ModelDocPage }} from "@/components/ModelDocPage";

export default function Doc() {{
  return <ModelDocPage
  slug="{meta['slug']}"
  name="{model_name}"
  vendor="{meta['kicker'].split('·')[-1].strip()}"
  kicker="{meta['kicker']}"
  tagline={{`{js(meta['tagline'])}`}}
  badges={{[{badges_js}]}}
  links={{[{links_js}]}}
  atGlance={{[
    {at_glance_js}
  ]}}
  overview={{[
    {overview_js}
  ]}}
  {weights_bf16_js}quants={{[
    {quants_js}
  ]}}
  ggufRepo="{meta.get('gguf_repo','')}"
  hosts={{[{hosts_js}]}}
  engineRows={{[
{rows_js}
  ]}}
  reproduce={{[
    {repro_js}
  ]}}
  caveats={{[
    {caveats_js}
  ]}}
  />;
}}
'''
    return tsx

for model_name, m in HARVEST.items():
    meta = META[model_name]
    page_dir = os.path.join(OUT_DIR, meta["slug"])
    os.makedirs(page_dir, exist_ok=True)
    page = os.path.join(page_dir, "page.tsx")
    tsx = emit_page(model_name, m, meta)
    open(page, "w").write(tsx)
    print(f"wrote {page} ({len(tsx)} bytes)")
