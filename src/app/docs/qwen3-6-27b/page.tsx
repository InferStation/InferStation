/* AUTO-GENERATED — edit scripts/gen-model-docs.py and re-run, do not hand-edit. */
import { ModelDocPage } from "@/components/ModelDocPage";

export default function Doc() {
  return <ModelDocPage
  slug="qwen3-6-27b"
  name="Qwen3.6-27B"
  vendor="Alibaba Qwen"
  kicker="Model · Dense · Alibaba Qwen"
  tagline={`27B-parameter dense Qwen3.6 (next-generation Qwen architecture). 22 GGUF quant tiers; vLLM BF16 on both hosts.`}
  badges={[{label:"Dense 27B",tone:"violet"}, {label:"256K ctx"}, {label:"BF16 native",tone:"emerald"}]}
  links={[{label:"BF16 weights",href:"https://huggingface.co/Qwen/Qwen3.6-27B",primary:true,external:true}, {label:"GGUF quants",href:"https://huggingface.co/unsloth/Qwen3.6-27B-GGUF",external:true}]}
  atGlance={[
    {label:"Total quants",value:"22"},
    {label:"Units in registry",value:"90"},
    {label:"Hosts",value:"2"},
    {label:"Engines",value:"4"}
  ]}
  overview={[
    ["Family","Qwen3.6"],
    ["Repo (BF16)","Qwen/Qwen3.6-27B"],
    ["Repo (GGUF)","unsloth/Qwen3.6-27B-GGUF"],
    ["Total params","27B"],
    ["Architecture","Dense Qwen3.6 (next-gen)"]
  ]}
  weightsBF16={{repo:"Qwen/Qwen3.6-27B", note:"Used by vLLM. Download from the public model repository before running the benchmark."}}
  quants={[
    { name:"BF16", family:"Standard" },
    { name:"IQ4_NL", family:"Standard" },
    { name:"IQ4_XS", family:"Standard" },
    { name:"Q3_K_M", family:"Standard" },
    { name:"Q3_K_S", family:"Standard" },
    { name:"Q4_0", family:"Standard" },
    { name:"Q4_1", family:"Standard" },
    { name:"Q4_K_M", family:"Standard" },
    { name:"Q4_K_S", family:"Standard" },
    { name:"Q5_K_M", family:"Standard" },
    { name:"Q5_K_S", family:"Standard" },
    { name:"Q6_K", family:"Standard" },
    { name:"Q8_0", family:"Standard" },
    { name:"UD-IQ2_M", family:"UD" },
    { name:"UD-IQ2_XXS", family:"UD" },
    { name:"UD-IQ3_XXS", family:"UD" },
    { name:"UD-Q2_K_XL", family:"UD" },
    { name:"UD-Q3_K_XL", family:"UD" },
    { name:"UD-Q4_K_XL", family:"UD" },
    { name:"UD-Q5_K_XL", family:"UD" },
    { name:"UD-Q6_K_XL", family:"UD" },
    { name:"UD-Q8_K_XL", family:"UD" }
  ]}
  ggufRepo="unsloth/Qwen3.6-27B-GGUF"
  hosts={["halo", "spark"]}
  engineRows={[
    {engine:"llama.cpp",badge:{label:"CUDA",tone:"emerald"},host:"NVIDIA DGX Spark",imageHtml:<span dangerouslySetInnerHTML={{__html:`container image and immutable digest recorded in each run`}}/>,versionHtml:<span dangerouslySetInnerHTML={{__html:`cfe9838d (2026-04-21)<br/>-DGGML_CUDA=ON -DGGML_NATIVE=ON`}}/>},
    {engine:"llama.cpp",badge:{label:"Vulkan"},host:"NVIDIA DGX Spark / AMD Strix Halo",imageHtml:<span dangerouslySetInnerHTML={{__html:`container image and immutable digest recorded in each run`}}/>,versionHtml:<span dangerouslySetInnerHTML={{__html:`cfe9838d (2026-04-21)<br/>-DGGML_VULKAN=ON`}}/>},
    {engine:"llama.cpp",badge:{label:"HIP/ROCm",tone:"amber"},host:"AMD Strix Halo",imageHtml:<span dangerouslySetInnerHTML={{__html:`container image and immutable digest recorded in each run`}}/>,versionHtml:<span dangerouslySetInnerHTML={{__html:`bbeb89d (2026-05-05)<br/>-DGGML_HIP=ON -DAMDGPU_TARGETS=gfx1151<br/>-DGGML_HIP_GRAPHS=ON -DGGML_CUDA_FA=ON`}}/>},
    {engine:"vLLM",badge:{label:"ROCm",tone:"amber"},host:"AMD Strix Halo",imageHtml:<span dangerouslySetInnerHTML={{__html:`container image and immutable digest recorded in each run`}}/>,versionHtml:<span dangerouslySetInnerHTML={{__html:`vllm 0.16.1.dev10+g11515110f.d20260323<br/>torch 2.9.1+rocm7.12.0rc1<br/>ROCm 7.12.60610-2bd1678d3d`}}/>},
    {engine:"vLLM",badge:{label:"CUDA",tone:"emerald"},host:"NVIDIA DGX Spark",imageHtml:<span dangerouslySetInnerHTML={{__html:`container image and immutable digest recorded in each run`}}/>,versionHtml:<span dangerouslySetInnerHTML={{__html:`CUDA 13.x · driver 580.82.09`}}/>}
  ]}
  reproduce={[
    {title:`Repository planner`,
     code:`# Preview the exact scenarios before dispatching a runner.
python3 scripts/bench-batch.py \\
  --filter='<host-profile>:qwen3-6-27b:<quantization>' \\
  --scope=all --dry-run

# Execute the reviewed plan through the bench-batch GitHub Actions workflow.
# Each published JSON records the exact command, image digest, and Actions log.`}
  ]}
  caveats={[
    <>Exotic quants (<span className="font-mono">UD-IQ*</span>, <span className="font-mono">MXFP4_MOE</span>) require recent llama.cpp builds — verified against the commits shown above.</>,
    <>Halo vLLM uses <span className="font-mono">--max-num-seqs 1 --num-prompts 32 --max-model-len 2304</span>; the iGPU shares 128 GB system RAM, so default vLLM KV-cache reservation OOMs at higher concurrency for large BF16 models. Sweep concurrency by re-running with larger <span className="font-mono">--max-num-seqs</span> as memory allows.</>
  ]}
  />;
}
