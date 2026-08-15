/* AUTO-GENERATED — edit scripts/gen-model-docs.py and re-run, do not hand-edit. */
import { ModelDocPage } from "@/components/ModelDocPage";

export default function Doc() {
  return <ModelDocPage
  slug="qwen3-14b"
  name="Qwen3-14B"
  vendor="Alibaba Qwen"
  kicker="Model · Dense · Alibaba Qwen"
  tagline={`14B-parameter dense Qwen3, Q4_K_M sweep across CUDA / Vulkan / HIP on both Spark and Halo.`}
  badges={[{label:"Dense 14B",tone:"violet"}, {label:"128K ctx"}]}
  links={[{label:"BF16 weights",href:"https://huggingface.co/Qwen/Qwen3-14B",primary:true,external:true}, {label:"GGUF quants",href:"https://huggingface.co/unsloth/Qwen3-14B-GGUF",external:true}]}
  atGlance={[
    {label:"Total quants",value:"1"},
    {label:"Units in registry",value:"4"},
    {label:"Hosts",value:"2"},
    {label:"Engines",value:"3"}
  ]}
  overview={[
    ["Family","Qwen3"],
    ["Repo (BF16)","Qwen/Qwen3-14B"],
    ["Repo (GGUF)","unsloth/Qwen3-14B-GGUF"],
    ["Total params","14B"],
    ["Architecture","Dense decoder, GQA"]
  ]}
  weightsBF16={{repo:"Qwen/Qwen3-14B", note:"Used by vLLM. Download from the public model repository before running the benchmark."}}
  quants={[
    { name:"Q4_K_M", family:"Standard" }
  ]}
  ggufRepo="unsloth/Qwen3-14B-GGUF"
  hosts={["halo", "spark"]}
  engineRows={[
    {engine:"llama.cpp",badge:{label:"CUDA",tone:"emerald"},host:"NVIDIA DGX Spark",imageHtml:<span dangerouslySetInnerHTML={{__html:`container image and immutable digest recorded in each run`}}/>,versionHtml:<span dangerouslySetInnerHTML={{__html:`cfe9838d (2026-04-21)<br/>-DGGML_CUDA=ON -DGGML_NATIVE=ON`}}/>},
    {engine:"llama.cpp",badge:{label:"Vulkan"},host:"NVIDIA DGX Spark / AMD Strix Halo",imageHtml:<span dangerouslySetInnerHTML={{__html:`container image and immutable digest recorded in each run`}}/>,versionHtml:<span dangerouslySetInnerHTML={{__html:`cfe9838d (2026-04-21)<br/>-DGGML_VULKAN=ON`}}/>},
    {engine:"llama.cpp",badge:{label:"HIP/ROCm",tone:"amber"},host:"AMD Strix Halo",imageHtml:<span dangerouslySetInnerHTML={{__html:`container image and immutable digest recorded in each run`}}/>,versionHtml:<span dangerouslySetInnerHTML={{__html:`bbeb89d (2026-05-05)<br/>-DGGML_HIP=ON -DAMDGPU_TARGETS=gfx1151<br/>-DGGML_HIP_GRAPHS=ON -DGGML_CUDA_FA=ON`}}/>}
  ]}
  reproduce={[
    {title:`Repository planner`,
     code:`# Preview the exact scenarios before dispatching a runner.
python3 scripts/bench-batch.py \\
  --filter='<host-profile>:qwen3-14b:<quantization>' \\
  --scope=all --dry-run

# Execute the reviewed plan through the bench-batch GitHub Actions workflow.
# Each published JSON records the exact command, image digest, and Actions log.`}
  ]}
  caveats={[
    <>All llama-batched-bench runs use <span className="font-mono">-ngl 999</span> (offload every layer) and <span className="font-mono">-npp 512 -ntg 128 -npl 1,4,16,32</span> (single sweep yields four concurrency points).</>
  ]}
  />;
}
