# InferStation methodology (mirror of /methodology)

Scope v0: Strix Halo and DGX Spark. Engines: llama.cpp (HIP), llama.cpp (Vulkan), vLLM.

Metrics: pp (prefill toks/s), tg (decode toks/s), ttft (ms), VRAM peak (GB).

Every run record carries: engine version + commit + build flags, model source URL + quant tag,
exact command line, raw log link, host hardware + driver versions, and a usability tag
(✅ / ⚠️ / ❌).

Not in v0: PD-disagg, power, multi-GPU sharding.
