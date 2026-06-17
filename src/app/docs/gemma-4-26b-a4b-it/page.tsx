/* AUTO-GENERATED — edit scripts/gen-model-docs.py and re-run, do not hand-edit. */
import { ModelDocPage } from "@/components/ModelDocPage";

export default function Doc() {
  return <ModelDocPage
  slug="gemma-4-26b-a4b-it"
  name="Gemma-4-26B-A4B-it"
  vendor="Google Gemma"
  kicker="Model · MoE · Google Gemma"
  tagline={`26B-total / ~4B-active Gemma-4 MoE (instruction-tuned). 21 GGUF quants; vLLM BF16 on both hosts.`}
  badges={[{label:"MoE 26B / 4B",tone:"violet"}, {label:"Instruct"}, {label:"BF16 native",tone:"emerald"}]}
  links={[{label:"BF16 weights",href:"https://huggingface.co/google/gemma-4-26b-a4b-it",primary:true,external:true}, {label:"GGUF quants",href:"https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF",external:true}]}
  atGlance={[
    {label:"Total quants",value:"21"},
    {label:"Units in registry",value:"85"},
    {label:"Hosts",value:"2"},
    {label:"Engines",value:"6"}
  ]}
  overview={[
    ["Family","Gemma"],
    ["Repo (BF16)","google/gemma-4-26b-a4b-it"],
    ["Repo (GGUF)","unsloth/gemma-4-26B-A4B-it-GGUF"],
    ["Total / Active params","26B / ~4B"],
    ["Architecture","MoE decoder"]
  ]}
  weightsBF16={{repo:"google/gemma-4-26b-a4b-it", note:"Used by vLLM. Pre-downloaded on each host into /opt/inferstation/models (Spark) or /home/amd/models (Halo)."}}
  quants={[
    { name:"BF16", family:"Standard" },
    { name:"MXFP4_MOE", family:"MXFP4" },
    { name:"Q8_0", family:"Standard" },
    { name:"UD-IQ2_M", family:"UD" },
    { name:"UD-IQ2_XXS", family:"UD" },
    { name:"UD-IQ3_S", family:"UD" },
    { name:"UD-IQ3_XXS", family:"UD" },
    { name:"UD-IQ4_NL", family:"UD" },
    { name:"UD-IQ4_XS", family:"UD" },
    { name:"UD-Q2_K_XL", family:"UD" },
    { name:"UD-Q3_K_M", family:"UD" },
    { name:"UD-Q3_K_XL", family:"UD" },
    { name:"UD-Q4_K_M", family:"UD" },
    { name:"UD-Q4_K_S", family:"UD" },
    { name:"UD-Q4_K_XL", family:"UD" },
    { name:"UD-Q5_K_M", family:"UD" },
    { name:"UD-Q5_K_S", family:"UD" },
    { name:"UD-Q5_K_XL", family:"UD" },
    { name:"UD-Q6_K", family:"UD" },
    { name:"UD-Q6_K_XL", family:"UD" },
    { name:"UD-Q8_K_XL", family:"UD" }
  ]}
  ggufRepo="unsloth/gemma-4-26B-A4B-it-GGUF"
  hosts={["halo", "spark"]}
  engineRows={[
    {engine:"llama.cpp",badge:{label:"CUDA",tone:"emerald"},host:"dgx-spark-01",imageHtml:<span dangerouslySetInnerHTML={{__html:`host binary @ <span className="whitespace-nowrap">/home/amd/llama-cuda-bench/llama.cpp/build/bin/</span><br/>wrapper: <span className="whitespace-nowrap">/usr/local/bin/hb-llama-batched-bench</span>`}}/>,versionHtml:<span dangerouslySetInnerHTML={{__html:`cfe9838d (2026-04-21)<br/>-DGGML_CUDA=ON -DGGML_NATIVE=ON`}}/>},
    {engine:"llama.cpp",badge:{label:"Vulkan"},host:"dgx-spark-01",imageHtml:<span dangerouslySetInnerHTML={{__html:`host binary @ <span className="whitespace-nowrap">/home/amd/llama-vk-bench/llama.cpp/build-vk/bin/</span><br/>via <span className="whitespace-nowrap">hb-llama-batched-bench</span> + VK_DRIVER_FILES override`}}/>,versionHtml:<span dangerouslySetInnerHTML={{__html:`cfe9838d (2026-04-21)<br/>-DGGML_VULKAN=ON`}}/>},
    {engine:"llama.cpp",badge:{label:"HIP/ROCm",tone:"amber"},host:"ryzen-ai-max-395-03",imageHtml:<span dangerouslySetInnerHTML={{__html:`docker <span className="whitespace-nowrap">rocm/vllm:rocm7.12.0_gfx1151_minimax_m25_patched</span><br/>binary <span className="whitespace-nowrap">/work/llama.cpp/build-hip-fa/bin/</span>`}}/>,versionHtml:<span dangerouslySetInnerHTML={{__html:`bbeb89d (2026-05-05)<br/>-DGGML_HIP=ON -DAMDGPU_TARGETS=gfx1151<br/>-DGGML_HIP_GRAPHS=ON -DGGML_CUDA_FA=ON`}}/>},
    {engine:"llama.cpp",badge:{label:"Vulkan"},host:"ryzen-ai-max-395-03",imageHtml:<span dangerouslySetInnerHTML={{__html:`docker <span className="whitespace-nowrap">rocm/vllm:rocm7.12.0_gfx1151_vulkan</span><br/>binary <span className="whitespace-nowrap">/work/llama.cpp/build-vk/bin/</span>`}}/>,versionHtml:<span dangerouslySetInnerHTML={{__html:`bbeb89d (2026-05-05)<br/>-DGGML_VULKAN=ON`}}/>},
    {engine:"vLLM",badge:{label:"ROCm",tone:"amber"},host:"ryzen-ai-max-395-03",imageHtml:<span dangerouslySetInnerHTML={{__html:`docker <span className="whitespace-nowrap">rocm/vllm:rocm7.12.0_gfx1151_minimax_m25_patched</span>`}}/>,versionHtml:<span dangerouslySetInnerHTML={{__html:`vllm 0.16.1.dev10+g11515110f.d20260323<br/>torch 2.9.1+rocm7.12.0rc1<br/>ROCm 7.12.60610-2bd1678d3d`}}/>},
    {engine:"vLLM",badge:{label:"CUDA",tone:"emerald"},host:"dgx-spark-01",imageHtml:<span dangerouslySetInnerHTML={{__html:`host-installed <span className="font-mono">/usr/local/bin/vllm</span><br/>(reference image: nvcr.io/nvidia/vllm:26.03-py3)`}}/>,versionHtml:<span dangerouslySetInnerHTML={{__html:`CUDA 13.x · driver 580.82.09`}}/>}
  ]}
  reproduce={[
    {title:`llama.cpp · CUDA — host dgx-spark-01 (ssh alias: spark2)`,
     code:`# binary: /home/amd/llama-cuda-bench/llama.cpp/build/bin/llama-batched-bench  (commit cfe9838d)
# wrapper: /usr/local/bin/hb-llama-batched-bench  (resolves PATH)
# example quant from the live unit registry: UD-Q5_K_M

ssh spark2 'HB_LLAMA_BIN_DIRS=/home/amd/llama-cuda-bench/llama.cpp/build/bin \\\\
  llama-batched-bench \\\\
    -m /models/gemma-4-26B-A4B-it-UD-Q5_K_M.gguf \\\\
    -ngl 999 -npp 512 -ntg 128 -npl 1,4,16,32 \\\\
    --output-format jsonl'`},
    {title:`llama.cpp · Vulkan — host dgx-spark-01`,
     code:`# binary: /home/amd/llama-vk-bench/llama.cpp/build-vk/bin/llama-batched-bench  (commit cfe9838d)
# Critical: VK_DRIVER_FILES must point at NVIDIA ICD; the default loader picks mesa
# freedreno ICD on aarch64 and selects the wrong device.

ssh spark2 'VK_DRIVER_FILES=/usr/share/vulkan/icd.d/nvidia_icd.json \\\\
  HB_LLAMA_BIN_DIRS=/home/amd/llama-vk-bench/llama.cpp/build-vk/bin \\\\
  llama-batched-bench \\\\
    -m /models/gemma-4-26B-A4B-it-UD-Q4_K_XL.gguf \\\\
    -ngl 999 -npp 512 -ntg 128 -npl 1,4,16,32 \\\\
    --output-format jsonl'`},
    {title:`llama.cpp · HIP/ROCm — host ryzen-ai-max-395-03 (ssh alias: halo6)`,
     code:`# image: rocm/vllm:rocm7.12.0_gfx1151_minimax_m25_patched
# binary inside image: /work/llama.cpp/build-hip-fa/bin/llama-batched-bench  (commit bbeb89d)
# /work bind-mounted from /home/amd/qwen36-bench on the host
# example quant: UD-IQ4_NL

ssh halo6 'sudo docker run --rm \\\\
  --device=/dev/kfd --device=/dev/dri \\\\
  --group-add 44 --group-add 992 \\\\
  --security-opt seccomp=unconfined --ipc=host --net host \\\\
  -v /home/amd/qwen36-bench:/work:ro \\\\
  -v /home/amd/models:/models:ro \\\\
  -v /tmp:/tmp \\\\
  -e HSA_OVERRIDE_GFX_VERSION=11.5.1 \\\\
  --entrypoint /work/llama.cpp/build-hip-fa/bin/llama-batched-bench \\\\
  rocm/vllm:rocm7.12.0_gfx1151_minimax_m25_patched \\\\
    -m /models/Gemma-4-26B-A4B-it-smoke/gemma-4-26B-A4B-it-UD-IQ4_NL.gguf \\\\
    -ngl 999 -npp 512 -ntg 128 -npl 1,4,16,32 \\\\
    --output-format jsonl'`},
    {title:`llama.cpp · Vulkan — host ryzen-ai-max-395-03`,
     code:`# image: rocm/vllm:rocm7.12.0_gfx1151_vulkan  (base image + libvulkan1 + mesa-vulkan-drivers)
# binary: /work/llama.cpp/build-vk/bin/llama-batched-bench  (commit bbeb89d)
# RADV picks Radeon 8060S (gfx1151) automatically; no VK_DRIVER_FILES needed.

ssh halo6 'sudo docker run --rm \\\\
  --device=/dev/kfd --device=/dev/dri \\\\
  --group-add 44 --group-add 992 \\\\
  --security-opt seccomp=unconfined --ipc=host --net host \\\\
  -v /home/amd/qwen36-bench:/work:ro \\\\
  -v /home/amd/models:/models:ro \\\\
  -v /tmp:/tmp \\\\
  -e HSA_OVERRIDE_GFX_VERSION=11.5.1 \\\\
  --entrypoint /work/llama.cpp/build-vk/bin/llama-batched-bench \\\\
  rocm/vllm:rocm7.12.0_gfx1151_vulkan \\\\
    -m /models/Gemma-4-26B-A4B-it-smoke/gemma-4-26B-A4B-it-UD-IQ4_XS.gguf \\\\
    -ngl 999 -npp 512 -ntg 128 -npl 1,4,16,32 \\\\
    --output-format jsonl'`},
    {title:`vLLM · BF16 safetensors (google/gemma-4-26b-a4b-it)`,
     code:`# Halo (ROCm 7.12.0):
ssh halo6 'sudo docker run --rm \\\\
  --device=/dev/kfd --device=/dev/dri \\\\
  --group-add 44 --group-add 992 \\\\
  --security-opt seccomp=unconfined --ipc=host --net host \\\\
  -v /home/amd/models/gemma-4-26B-A4B-it-BF16:/model:ro \\\\
  -v /tmp:/tmp \\\\
  -e HSA_OVERRIDE_GFX_VERSION=11.5.1 \\\\
  rocm/vllm:rocm7.12.0_gfx1151_minimax_m25_patched \\\\
  vllm bench throughput \\\\
    --model /model --dtype bfloat16 \\\\
    --max-model-len 2304 --max-num-seqs 1 \\\\
    --gpu-memory-utilization 0.85 \\\\
    --dataset-name random --input-len 512 --output-len 128 \\\\
    --num-prompts 32 \\\\
    --output-json /tmp/vllm-bench-gemma-4-26b-a4b-it-BF16.json'

# Spark (CUDA 13, host-installed vllm — image: nvcr.io/nvidia/vllm:26.03-py3):
ssh spark2 'vllm bench throughput \\\\
  --model /opt/inferstation/models/gemma-4-26B-A4B-it-BF16 --dtype bfloat16 \\\\
  --max-model-len 2304 --max-num-seqs 1 \\\\
  --gpu-memory-utilization 0.85 \\\\
  --dataset-name random --input-len 512 --output-len 128 \\\\
  --num-prompts 32'`}
  ]}
  caveats={[
    <>Exotic quants (<span className="font-mono">UD-IQ*</span>, <span className="font-mono">MXFP4_MOE</span>) require recent llama.cpp builds — verified against the commits shown above.</>,
    <>Halo vLLM uses <span className="font-mono">--max-num-seqs 1 --num-prompts 32 --max-model-len 2304</span>; the iGPU shares 128 GB system RAM, so default vLLM KV-cache reservation OOMs at higher concurrency for large BF16 models. Sweep concurrency by re-running with larger <span className="font-mono">--max-num-seqs</span> as memory allows.</>
  ]}
  />;
}
