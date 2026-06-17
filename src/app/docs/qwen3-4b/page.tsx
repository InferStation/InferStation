/* AUTO-GENERATED — edit scripts/gen-model-docs.py and re-run, do not hand-edit. */
import { ModelDocPage } from "@/components/ModelDocPage";

export default function Doc() {
  return <ModelDocPage
  slug="qwen3-4b"
  name="Qwen3-4B"
  vendor="Alibaba Qwen"
  kicker="Model · Dense · Alibaba Qwen"
  tagline={`Compact 4B-parameter dense Qwen3 model. Used as a wide-coverage sweep target: 26 GGUF quant tiers from UD-IQ1_S to BF16 on both Spark and Halo.`}
  badges={[{label:"Dense 4B",tone:"violet"}, {label:"128K ctx"}, {label:"GGUF only"}]}
  links={[{label:"BF16 weights",href:"https://huggingface.co/Qwen/Qwen3-4B",primary:true,external:true}, {label:"GGUF quants",href:"https://huggingface.co/unsloth/Qwen3-4B-GGUF",external:true}]}
  atGlance={[
    {label:"Total quants",value:"26"},
    {label:"Units in registry",value:"104"},
    {label:"Hosts",value:"2"},
    {label:"Engines",value:"4"}
  ]}
  overview={[
    ["Family","Qwen3"],
    ["Repo (BF16)","Qwen/Qwen3-4B"],
    ["Repo (GGUF)","unsloth/Qwen3-4B-GGUF"],
    ["Total params","4B"],
    ["Architecture","Dense decoder, GQA"]
  ]}
  weightsBF16={{repo:"Qwen/Qwen3-4B", note:"Used by vLLM. Pre-downloaded on each host into /opt/inferstation/models (Spark) or /home/amd/models (Halo)."}}
  quants={[
    { name:"BF16", family:"Standard" },
    { name:"IQ4_NL", family:"Standard" },
    { name:"IQ4_XS", family:"Standard" },
    { name:"Q2_K", family:"Standard" },
    { name:"Q2_K_L", family:"Standard" },
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
    { name:"UD-IQ1_M", family:"UD" },
    { name:"UD-IQ1_S", family:"UD" },
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
  ggufRepo="unsloth/Qwen3-4B-GGUF"
  hosts={["halo", "spark"]}
  engineRows={[
    {engine:"llama.cpp",badge:{label:"CUDA",tone:"emerald"},host:"dgx-spark-01",imageHtml:<span dangerouslySetInnerHTML={{__html:`host binary @ <span className="whitespace-nowrap">/home/amd/llama-cuda-bench/llama.cpp/build/bin/</span><br/>wrapper: <span className="whitespace-nowrap">/usr/local/bin/hb-llama-batched-bench</span>`}}/>,versionHtml:<span dangerouslySetInnerHTML={{__html:`cfe9838d (2026-04-21)<br/>-DGGML_CUDA=ON -DGGML_NATIVE=ON`}}/>},
    {engine:"llama.cpp",badge:{label:"Vulkan"},host:"dgx-spark-01",imageHtml:<span dangerouslySetInnerHTML={{__html:`host binary @ <span className="whitespace-nowrap">/home/amd/llama-vk-bench/llama.cpp/build-vk/bin/</span><br/>via <span className="whitespace-nowrap">hb-llama-batched-bench</span> + VK_DRIVER_FILES override`}}/>,versionHtml:<span dangerouslySetInnerHTML={{__html:`cfe9838d (2026-04-21)<br/>-DGGML_VULKAN=ON`}}/>},
    {engine:"llama.cpp",badge:{label:"HIP/ROCm",tone:"amber"},host:"ryzen-ai-max-395-03",imageHtml:<span dangerouslySetInnerHTML={{__html:`docker <span className="whitespace-nowrap">rocm/vllm:rocm7.12.0_gfx1151_minimax_m25_patched</span><br/>binary <span className="whitespace-nowrap">/work/llama.cpp/build-hip-fa/bin/</span>`}}/>,versionHtml:<span dangerouslySetInnerHTML={{__html:`bbeb89d (2026-05-05)<br/>-DGGML_HIP=ON -DAMDGPU_TARGETS=gfx1151<br/>-DGGML_HIP_GRAPHS=ON -DGGML_CUDA_FA=ON`}}/>},
    {engine:"llama.cpp",badge:{label:"Vulkan"},host:"ryzen-ai-max-395-03",imageHtml:<span dangerouslySetInnerHTML={{__html:`docker <span className="whitespace-nowrap">rocm/vllm:rocm7.12.0_gfx1151_vulkan</span><br/>binary <span className="whitespace-nowrap">/work/llama.cpp/build-vk/bin/</span>`}}/>,versionHtml:<span dangerouslySetInnerHTML={{__html:`bbeb89d (2026-05-05)<br/>-DGGML_VULKAN=ON`}}/>}
  ]}
  reproduce={[
    {title:`llama.cpp · CUDA — host dgx-spark-01 (ssh alias: spark2)`,
     code:`# binary: /home/amd/llama-cuda-bench/llama.cpp/build/bin/llama-batched-bench  (commit cfe9838d)
# wrapper: /usr/local/bin/hb-llama-batched-bench  (resolves PATH)
# example quant from the live unit registry: Q2_K

ssh spark2 'HB_LLAMA_BIN_DIRS=/home/amd/llama-cuda-bench/llama.cpp/build/bin \\\\
  llama-batched-bench \\\\
    -m /models/Qwen3-4B/Qwen3-4B-Q2_K.gguf \\\\
    -ngl 999 -npp 512 -ntg 128 -npl 1,4,16,32 \\\\
    --output-format jsonl'`},
    {title:`llama.cpp · Vulkan — host dgx-spark-01`,
     code:`# binary: /home/amd/llama-vk-bench/llama.cpp/build-vk/bin/llama-batched-bench  (commit cfe9838d)
# Critical: VK_DRIVER_FILES must point at NVIDIA ICD; the default loader picks mesa
# freedreno ICD on aarch64 and selects the wrong device.

ssh spark2 'VK_DRIVER_FILES=/usr/share/vulkan/icd.d/nvidia_icd.json \\\\
  HB_LLAMA_BIN_DIRS=/home/amd/llama-vk-bench/llama.cpp/build-vk/bin \\\\
  llama-batched-bench \\\\
    -m /models/Qwen3-4B/Qwen3-4B-Q5_K_S.gguf \\\\
    -ngl 999 -npp 512 -ntg 128 -npl 1,4,16,32 \\\\
    --output-format jsonl'`},
    {title:`llama.cpp · HIP/ROCm — host ryzen-ai-max-395-03 (ssh alias: halo6)`,
     code:`# image: rocm/vllm:rocm7.12.0_gfx1151_minimax_m25_patched
# binary inside image: /work/llama.cpp/build-hip-fa/bin/llama-batched-bench  (commit bbeb89d)
# /work bind-mounted from /home/amd/qwen36-bench on the host
# example quant: Q6_K

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
    -m /models/Qwen3-4B/Qwen3-4B-Q6_K.gguf \\\\
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
    -m /models/Qwen3-4B/Qwen3-4B-Q5_K_S.gguf \\\\
    -ngl 999 -npp 512 -ntg 128 -npl 1,4,16,32 \\\\
    --output-format jsonl'`}
  ]}
  caveats={[
    <>Exotic quants (<span className="font-mono">UD-IQ*</span>, <span className="font-mono">MXFP4_MOE</span>) require recent llama.cpp builds — verified against the commits shown above.</>
  ]}
  />;
}
