import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, createIdempotencyKey } from "../api/client";
import type { Dataset, Endpoint, Model, Run } from "../types";

const steps = ["模型", "数据集", "执行参数", "预检确认"];

export function NewEvaluation() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [endpointId, setEndpointId] = useState("");
  const [modelId, setModelId] = useState("");
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const [name, setName] = useState(`regression-${new Date().toISOString().slice(0, 10)}`);
  const [params, setParams] = useState({ temperature: 0, max_tokens: 32, seed: 42, concurrency: 8, qps: 10, timeout_seconds: 60, max_retries: 2 });
  const endpoints = useQuery({ queryKey: ["endpoints"], queryFn: () => api<Endpoint[]>("/endpoints") });
  const models = useQuery({ queryKey: ["endpoint-models", endpointId], queryFn: () => api<Model[]>(`/endpoints/${endpointId}/models`), enabled: Boolean(endpointId) });
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: () => api<Dataset[]>("/datasets") });
  const versionMap = useMemo(() => new Map(datasets.data?.flatMap((dataset) => dataset.versions.map((version) => [version.id, version]))), [datasets.data]);
  const payload = { name, endpoint_id: endpointId, model_id: modelId, datasets: selectedVersions.map((id) => ({ dataset_version_id: id, protocol_id: versionMap.get(id)?.manifest_json.protocol.id })), inference: { temperature: params.temperature, top_p: 1, max_tokens: params.max_tokens, seed: params.seed, stop: [] }, execution: { concurrency: params.concurrency, qps: params.qps, timeout_seconds: params.timeout_seconds, max_retries: params.max_retries } };
  const validate = useMutation({ mutationFn: () => api<{ valid: boolean; sample_count: number; effective_concurrency: number; warnings: string[] }>("/runs/validate", { method: "POST", body: JSON.stringify(payload) }) });
  const create = useMutation({ mutationFn: () => api<Run>("/runs", { method: "POST", body: JSON.stringify(payload), headers: { "Idempotency-Key": createIdempotencyKey() } }), onSuccess: (run) => navigate(`/runs/${run.id}`) });
  const canNext = [Boolean(endpointId && modelId), selectedVersions.length > 0, Boolean(name && params.concurrency > 0), validate.data?.valid === true][step];
  const next = () => { if (step === 2) { validate.mutate(undefined, { onSuccess: () => setStep(3) }); } else setStep((value) => Math.min(3, value + 1)); };

  return (
    <div className="page evaluation-page">
      <div className="page-heading"><div><p className="eyebrow">Evaluation</p><h1>新建测评</h1><p>运行配置提交后将被冻结并生成协议指纹。</p></div></div>
      <div className="stepper">{steps.map((label, index) => <div key={label} className={index === step ? "active" : index < step ? "done" : ""}><span>{index < step ? <CheckCircle2 size={15} /> : index + 1}</span><strong>{label}</strong></div>)}</div>
      <section className="wizard-panel">
        {step === 0 && <div className="wizard-content"><div className="section-heading"><div><h2>选择模型服务</h2><p>只展示已登记的 endpoint 与模型。</p></div></div><div className="selection-grid">{endpoints.data?.map((endpoint) => <button key={endpoint.id} className={endpointId === endpoint.id ? "selection-option selected" : "selection-option"} onClick={() => { setEndpointId(endpoint.id); setModelId(""); }}><span className={`health-light ${endpoint.status}`} /><strong>{endpoint.name}</strong><small>{endpoint.base_url}</small><em>{endpoint.status}</em></button>)}</div>{endpointId && <label className="wide-field">Model ID<select value={modelId} onChange={(e) => setModelId(e.target.value)}><option value="">选择模型</option>{models.data?.map((model) => <option key={model.id} value={model.id}>{model.model_name}</option>)}</select></label>}</div>}
        {step === 1 && <div className="wizard-content"><div className="section-heading"><div><h2>选择数据集版本</h2><p>可在一次运行中选择多个冻结版本。</p></div></div><div className="check-list">{datasets.data?.flatMap((dataset) => dataset.versions.map((version) => <label key={version.id}><input type="checkbox" checked={selectedVersions.includes(version.id)} onChange={() => setSelectedVersions((current) => current.includes(version.id) ? current.filter((id) => id !== version.id) : [...current, version.id])} /><span><strong>{dataset.display_name} · {version.version}</strong><small>{version.row_count} samples · {version.manifest_json.protocol.id}</small></span><code>{version.checksum.slice(0, 10)}</code></label>))}</div></div>}
        {step === 2 && <div className="wizard-content"><div className="section-heading"><div><h2>推理与执行参数</h2><p>实际并发还会受 endpoint 与平台上限约束。</p></div></div><label className="wide-field">运行名称<input value={name} onChange={(e) => setName(e.target.value)} /></label><div className="parameter-grid"><label>Temperature<input type="number" min="0" max="2" step="0.1" value={params.temperature} onChange={(e) => setParams({ ...params, temperature: Number(e.target.value) })} /></label><label>Max tokens<input type="number" min="1" value={params.max_tokens} onChange={(e) => setParams({ ...params, max_tokens: Number(e.target.value) })} /></label><label>Seed<input type="number" value={params.seed} onChange={(e) => setParams({ ...params, seed: Number(e.target.value) })} /></label><label>并发<input type="number" min="1" max="256" value={params.concurrency} onChange={(e) => setParams({ ...params, concurrency: Number(e.target.value) })} /></label><label>QPS<input type="number" min="0.1" step="0.1" value={params.qps} onChange={(e) => setParams({ ...params, qps: Number(e.target.value) })} /></label><label>超时（秒）<input type="number" min="1" value={params.timeout_seconds} onChange={(e) => setParams({ ...params, timeout_seconds: Number(e.target.value) })} /></label><label>最大重试<input type="number" min="0" max="10" value={params.max_retries} onChange={(e) => setParams({ ...params, max_retries: Number(e.target.value) })} /></label></div>{validate.error && <div className="form-error">{validate.error.message}</div>}</div>}
        {step === 3 && validate.data && <div className="wizard-content"><div className="preflight-status"><CheckCircle2 size={26} /><div><strong>预检通过</strong><span>{validate.data.sample_count} 个样本，实际并发 {validate.data.effective_concurrency}</span></div></div>{validate.data.warnings.map((warning) => <div className="warning-banner" key={warning}><AlertTriangle size={16} />{warning}</div>)}<dl className="review-grid"><div><dt>运行名称</dt><dd>{name}</dd></div><div><dt>模型</dt><dd>{models.data?.find((model) => model.id === modelId)?.model_name}</dd></div><div><dt>数据集版本</dt><dd>{selectedVersions.length}</dd></div><div><dt>Temperature</dt><dd>{params.temperature}</dd></div><div><dt>并发 / QPS</dt><dd>{params.concurrency} / {params.qps}</dd></div><div><dt>Timeout / Retry</dt><dd>{params.timeout_seconds}s / {params.max_retries}</dd></div></dl>{create.error && <div className="form-error">{create.error.message}</div>}</div>}
        <footer className="wizard-actions"><button className="quiet-button" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}><ChevronLeft size={16} />上一步</button>{step < 3 ? <button className="primary-button" disabled={!canNext || validate.isPending} onClick={next}>{validate.isPending && <Loader2 className="spin" size={15} />}下一步 <ChevronRight size={16} /></button> : <button className="primary-button" disabled={create.isPending} onClick={() => create.mutate()}>{create.isPending ? <Loader2 className="spin" size={15} /> : <Play size={15} />}创建并运行</button>}</footer>
      </section>
    </div>
  );
}
