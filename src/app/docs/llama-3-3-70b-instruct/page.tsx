/* AUTO-GENERATED — edit scripts/gen-model-docs.py and re-run, do not hand-edit. */
import { ModelDocPage } from "@/components/ModelDocPage";

export default function Doc() {
  return <ModelDocPage
  slug="llama-3-3-70b-instruct"
  name="Llama-3.3-70B-Instruct"
  vendor="Meta Llama"
  kicker="Model · Dense · Meta Llama"
  tagline={`70B-parameter dense Llama 3.3 instruction-tuned. Benchmarked at Q4_K_M and Q8_0 across CUDA / Vulkan / HIP on both hosts.`}
  badges={[{label:"Dense 70B",tone:"violet"}, {label:"Instruct"}, {label:"128K ctx"}]}
  links={[{label:"BF16 weights",href:"https://huggingface.co/meta-llama/Llama-3.3-70B-Instruct",primary:true,external:true}, {label:"GGUF quants",href:"https://huggingface.co/unsloth/Llama-3.3-70B-Instruct-GGUF",external:true}]}
  atGlance={[
    {label:"Total quants",value:"2"},
    {label:"Units in registry",value:"7"},
    {label:"Hosts",value:"2"},
    {label:"Engines",value:"3"}
  ]}
  overview={[
    ["Family","Llama"],
    ["Repo (BF16)","meta-llama/Llama-3.3-70B-Instruct"],
    ["Repo (GGUF)","unsloth/Llama-3.3-70B-Instruct-GGUF"],
    ["Total params","70B"],
    ["Architecture","Dense decoder, GQA"]
  ]}
  quants={[
    { name:"Q4_K_M", family:"Standard" },
    { name:"Q8_0", family:"Standard" }
  ]}
  ggufRepo="unsloth/Llama-3.3-70B-Instruct-GGUF"
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
  --filter='<host-profile>:llama-3-3-70b-instruct:<quantization>' \\
  --scope=all --dry-run

# Execute the reviewed plan through the bench-batch GitHub Actions workflow.
# Each published JSON records the exact command, image digest, and Actions log.`}
  ]}
  caveats={[
    <>Halo vLLM uses <span className="font-mono">--max-num-seqs 1 --num-prompts 32 --max-model-len 2304</span>; the iGPU shares 128 GB system RAM, so default vLLM KV-cache reservation OOMs at higher concurrency for large BF16 models. Sweep concurrency by re-running with larger <span className="font-mono">--max-num-seqs</span> as memory allows.</>
  ]}
  />;
}
