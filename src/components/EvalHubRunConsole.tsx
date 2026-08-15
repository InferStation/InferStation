"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AccuracyNav from "@/components/AccuracyNav";
import {
  createEvalHubIdempotencyKey,
  EvalHubClient,
  isEvalHubRunTerminal,
  type EvalHubAuthType,
  type EvalHubDataset,
  type EvalHubEndpoint,
  type EvalHubModel,
  type EvalHubProbe,
  type EvalHubRun,
  type EvalHubRunCreate,
  type EvalHubRunMetrics,
  type EvalHubValidation,
} from "@/lib/evalHubClient";

const defaultApiBase =
  process.env.NEXT_PUBLIC_EVAL_HUB_API_BASE || "http://10.170.38.102:18080/api/v1";

type BusyAction = "connect" | "endpoint" | "validate" | "run" | "cancel" | null;

export default function EvalHubRunConsole() {
  const [apiBase, setApiBase] = useState(defaultApiBase);
  const adminKey = "";
  const [datasets, setDatasets] = useState<EvalHubDataset[]>([]);
  const [connectedBase, setConnectedBase] = useState("");
  const [endpointName, setEndpointName] = useState("inferstation-ad-hoc");
  const [targetUrl, setTargetUrl] = useState("");
  const [targetModel, setTargetModel] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [authType, setAuthType] = useState<EvalHubAuthType>("bearer");
  const [endpoint, setEndpoint] = useState<EvalHubEndpoint | null>(null);
  const [probe, setProbe] = useState<EvalHubProbe | null>(null);
  const [models, setModels] = useState<EvalHubModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const [runName, setRunName] = useState(`inferstation-${new Date().toISOString().slice(0, 10)}`);
  const [temperature, setTemperature] = useState(0);
  const [topP, setTopP] = useState(1);
  const [maxTokens, setMaxTokens] = useState(32);
  const [seed, setSeed] = useState(42);
  const [concurrency, setConcurrency] = useState(2);
  const [qps, setQps] = useState(2);
  const [timeoutSeconds, setTimeoutSeconds] = useState(60);
  const [maxRetries, setMaxRetries] = useState(2);
  const [validation, setValidation] = useState<EvalHubValidation | null>(null);
  const [run, setRun] = useState<EvalHubRun | null>(null);
  const [metrics, setMetrics] = useState<EvalHubRunMetrics | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState("");
  const idempotencyKey = useRef("");

  function invalidateValidation() {
    setValidation(null);
    idempotencyKey.current = "";
  }

  function clearRegisteredEndpoint() {
    setEndpoint(null);
    setProbe(null);
    setModels([]);
    setModelId("");
    invalidateValidation();
  }

  function disconnectEvalHub() {
    setConnectedBase("");
    setDatasets([]);
    setSelectedVersions([]);
    clearRegisteredEndpoint();
  }

  const versionMap = useMemo(() => {
    const map = new Map<string, EvalHubDataset["versions"][number]>();
    for (const dataset of datasets) for (const version of dataset.versions) map.set(version.id, version);
    return map;
  }, [datasets]);

  const client = () => new EvalHubClient(apiBase, adminKey);
  const payload = (): EvalHubRunCreate => ({
    name: runName,
    endpoint_id: endpoint?.id ?? "",
    model_id: modelId,
    datasets: selectedVersions.map((id) => ({
      dataset_version_id: id,
      protocol_id: versionMap.get(id)?.manifest_json.protocol.id,
    })),
    inference: { temperature, top_p: topP, max_tokens: maxTokens, seed, stop: [] },
    execution: {
      concurrency,
      qps,
      timeout_seconds: timeoutSeconds,
      max_retries: maxRetries,
      shard_size: 50,
    },
  });

  async function perform(action: BusyAction, operation: () => Promise<void>) {
    setBusy(action);
    setError("");
    try {
      await operation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  const connect = () =>
    perform("connect", async () => {
      const api = client();
      const nextDatasets = await api.listDatasets();
      setDatasets(nextDatasets);
      setConnectedBase(api.apiBase);
      setSelectedVersions([]);
      clearRegisteredEndpoint();
    });

  const registerEndpoint = () =>
    perform("endpoint", async () => {
      const api = client();
      const created = await api.createEndpoint({
        name: endpointName,
        base_url: targetUrl,
        model_name: targetModel,
        auth_type: authType,
        api_key: authType === "none" ? undefined : targetKey,
        extra_headers: {},
        concurrency_limit: Math.max(1, concurrency),
        qps_limit: Math.max(0.1, qps),
      });
      setEndpoint(created);
      setTargetKey("");
      const checked = await api.probeEndpoint(created.id, targetModel);
      setProbe(checked);
      const nextModels = await api.listModels(created.id);
      setModels(nextModels);
      setModelId(nextModels.find((model) => model.model_name === targetModel)?.id ?? nextModels[0]?.id ?? "");
      invalidateValidation();
    });

  const validate = () =>
    perform("validate", async () => {
      const result = await client().validateRun(payload());
      setValidation(result);
      idempotencyKey.current = "";
    });

  const startRun = () =>
    perform("run", async () => {
      if (!idempotencyKey.current) idempotencyKey.current = createEvalHubIdempotencyKey();
      const created = await client().createRun(payload(), idempotencyKey.current);
      setRun(created);
      setMetrics(null);
    });

  const cancelRun = () =>
    perform("cancel", async () => {
      if (!run) return;
      setRun(await client().cancelRun(run.id));
    });

  const runId = run?.id;
  const runStatus = run?.status;

  useEffect(() => {
    if (!runId || !runStatus || isEvalHubRunTerminal(runStatus)) return;
    let disposed = false;
    const poll = async () => {
      try {
        const next = await new EvalHubClient(apiBase, adminKey).getRun(runId);
        if (disposed) return;
        setRun(next);
        if (isEvalHubRunTerminal(next.status) && next.status === "SUCCEEDED") {
          setMetrics(await new EvalHubClient(apiBase, adminKey).getRunMetrics(next.id));
        }
      } catch (caught) {
        if (!disposed) setError(caught instanceof Error ? caught.message : String(caught));
      }
    };
    const timer = window.setInterval(poll, 2000);
    void poll();
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [adminKey, apiBase, runId, runStatus]);

  const totalSamples = run?.datasets.reduce((sum, item) => sum + item.total_samples, 0) ?? 0;
  const completedSamples = run?.datasets.reduce((sum, item) => sum + item.completed_samples, 0) ?? 0;
  const canRegister = Boolean(connectedBase && endpointName && targetUrl && targetModel && (authType === "none" || targetKey));
  const canValidate = Boolean(endpoint && modelId && selectedVersions.length && runName);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-9 sm:py-12">
      <AccuracyNav active="run" />
      <header className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700 dark:text-indigo-300">Live evaluation</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Run any OpenAI-compatible model through Eval Hub.</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Register a reachable model API, select immutable datasets, preflight the request, and follow the asynchronous run. Nothing is published to Git automatically.
        </p>
      </header>

      {error ? <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div> : null}

      <section className="mt-7 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800 sm:p-6">
        <StepHeading number="1" title="Connect to LLM Eval Hub" note="The internal RTX4090 deployment currently has control-plane authentication disabled." />
        <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <Field label="Eval Hub API URL"><input value={apiBase} onChange={(event) => { setApiBase(event.target.value); disconnectEvalHub(); }} className={inputClass} placeholder="http://host:18080/api/v1" /></Field>
          <ActionButton onClick={connect} disabled={!apiBase || busy !== null}>{busy === "connect" ? "Connecting…" : "Connect"}</ActionButton>
        </div>
        {connectedBase ? <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-400">Connected to {connectedBase} · {datasets.reduce((sum, item) => sum + item.versions.length, 0)} dataset versions</p> : null}
      </section>

      <section className="mt-5 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800 sm:p-6">
        <StepHeading number="2" title="Register the model service" note="The target API key is sent once to Eval Hub and cleared after registration." />
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label="Endpoint name"><input value={endpointName} onChange={(event) => { setEndpointName(event.target.value); clearRegisteredEndpoint(); }} className={inputClass} /></Field>
          <Field label="OpenAI-compatible URL"><input value={targetUrl} onChange={(event) => { setTargetUrl(event.target.value); clearRegisteredEndpoint(); }} className={inputClass} placeholder="http://model-host:8000/v1" /></Field>
          <Field label="API model name"><input value={targetModel} onChange={(event) => { setTargetModel(event.target.value); clearRegisteredEndpoint(); }} className={inputClass} placeholder="served-model-name" /></Field>
          <div className="grid grid-cols-[0.8fr_1.2fr] gap-3">
            <Field label="Authentication"><select value={authType} onChange={(event) => { setAuthType(event.target.value as EvalHubAuthType); clearRegisteredEndpoint(); }} className={inputClass}><option value="bearer">Bearer</option><option value="api-key-header">API-key header</option><option value="none">None</option></select></Field>
            <Field label="Target API key"><input type="password" autoComplete="off" disabled={authType === "none"} value={targetKey} onChange={(event) => { setTargetKey(event.target.value); clearRegisteredEndpoint(); }} className={inputClass} placeholder={authType === "none" ? "Not required" : "Cleared after registration"} /></Field>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ActionButton onClick={registerEndpoint} disabled={!canRegister || busy !== null}>{busy === "endpoint" ? "Registering and probing…" : "Register & probe"}</ActionButton>
          {endpoint ? <span className="text-xs text-zinc-500">Endpoint {endpoint.id.slice(0, 8)} · {probe?.status ?? endpoint.status}{probe?.latency_ms != null ? ` · ${Math.round(probe.latency_ms)} ms` : ""}</span> : null}
        </div>
        {models.length ? <div className="mt-4 max-w-xl"><Field label="Confirmed endpoint model"><select value={modelId} onChange={(event) => { setModelId(event.target.value); invalidateValidation(); }} className={inputClass}>{models.map((model) => <option key={model.id} value={model.id}>{model.model_name}</option>)}</select></Field></div> : null}
      </section>

      <section className="mt-5 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800 sm:p-6">
        <StepHeading number="3" title="Choose immutable datasets" note="MMLU Lite and Full overlap; select one, not both." />
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {datasets.flatMap((dataset) => dataset.versions.map((version) => {
            const checked = selectedVersions.includes(version.id);
            return <label key={version.id} className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${checked ? "border-indigo-400 bg-indigo-50/60 dark:border-indigo-700 dark:bg-indigo-950/20" : "border-zinc-200 dark:border-zinc-800"}`}><input type="checkbox" checked={checked} onChange={() => { setSelectedVersions((current) => current.includes(version.id) ? current.filter((id) => id !== version.id) : [...current, version.id]); invalidateValidation(); }} className="mt-1" /><span className="min-w-0"><strong className="block text-sm">{dataset.display_name} · {version.version}</strong><span className="mt-1 block text-xs text-zinc-500">{version.row_count.toLocaleString()} samples · {version.manifest_json.protocol.id}</span><code className="mt-2 block truncate text-[10px] text-zinc-400">{version.checksum}</code></span></label>;
          }))}
          {connectedBase && datasets.length === 0 ? <p className="text-sm text-zinc-500">No dataset versions are registered in Eval Hub.</p> : null}
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800 sm:p-6">
        <StepHeading number="4" title="Preflight and run" note="Conservative defaults protect the shared RTX4090 host; Eval Hub may lower effective concurrency further." />
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Run name"><input value={runName} onChange={(event) => { setRunName(event.target.value); invalidateValidation(); }} className={inputClass} /></Field>
          <NumberField label="Temperature" value={temperature} setValue={setTemperature} min={0} max={2} step={0.1} onChanged={invalidateValidation} />
          <NumberField label="Top P" value={topP} setValue={setTopP} min={0.01} max={1} step={0.01} onChanged={invalidateValidation} />
          <NumberField label="Max tokens" value={maxTokens} setValue={setMaxTokens} min={1} max={32768} onChanged={invalidateValidation} />
          <NumberField label="Seed" value={seed} setValue={setSeed} min={0} onChanged={invalidateValidation} />
          <NumberField label="Concurrency" value={concurrency} setValue={setConcurrency} min={1} max={4} onChanged={invalidateValidation} />
          <NumberField label="QPS" value={qps} setValue={setQps} min={0.1} max={10} step={0.1} onChanged={invalidateValidation} />
          <NumberField label="Timeout seconds" value={timeoutSeconds} setValue={setTimeoutSeconds} min={1} max={3600} onChanged={invalidateValidation} />
          <NumberField label="Max retries" value={maxRetries} setValue={setMaxRetries} min={0} max={10} onChanged={invalidateValidation} />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={validate} disabled={!canValidate || busy !== null} className={secondaryButtonClass}>{busy === "validate" ? "Validating…" : "Validate run"}</button>
          <ActionButton onClick={startRun} disabled={!validation?.valid || busy !== null || Boolean(run && !isEvalHubRunTerminal(run.status))}>{busy === "run" ? "Submitting…" : "Start evaluation"}</ActionButton>
          {validation ? <span className="text-xs text-zinc-500">{validation.sample_count.toLocaleString()} requests · effective concurrency {validation.effective_concurrency}</span> : null}
        </div>
        {validation?.warnings.map((warning) => <div key={warning} className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">{warning}</div>)}
      </section>

      {run ? (
        <section className="mt-5 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4"><StepHeading number="5" title="Run progress" note={`Eval Hub run ${run.id}`} /><span className="rounded-full bg-zinc-100 px-3 py-1 font-mono text-xs font-semibold dark:bg-zinc-900">{run.status}</span></div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900"><div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${totalSamples ? Math.min(100, completedSamples / totalSamples * 100) : 0}%` }} /></div>
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-zinc-500"><span>{completedSamples.toLocaleString()} / {totalSamples.toLocaleString()} samples</span><span className="font-mono">{run.protocol_fingerprint.slice(0, 20)}…</span></div>
          {!isEvalHubRunTerminal(run.status) ? <div className="mt-4"><button type="button" onClick={cancelRun} disabled={busy !== null} className={secondaryButtonClass}>{busy === "cancel" ? "Cancelling…" : "Cancel run"}</button></div> : null}
          {run.error_message ? <p className="mt-4 text-sm text-red-600">{run.error_message}</p> : null}
          {metrics ? <MetricsPanel metrics={metrics} datasets={datasets} /> : null}
        </section>
      ) : null}
    </div>
  );
}

function MetricsPanel({ metrics, datasets }: { metrics: EvalHubRunMetrics; datasets: EvalHubDataset[] }) {
  const versions = new Map(datasets.flatMap((dataset) => dataset.versions.map((version) => [version.id, { dataset, version }] as const)));
  return <div className="mt-6"><h2 className="text-sm font-semibold">Aggregate metrics</h2><div className="mt-3 grid gap-3 md:grid-cols-2">{metrics.datasets.map((result) => { const item = versions.get(result.dataset_version_id); return <article key={result.run_dataset_id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"><div className="text-sm font-semibold">{item?.dataset.display_name ?? result.protocol_id}</div><div className="mt-1 text-[11px] text-zinc-500">{result.protocol_id}</div><dl className="mt-4 space-y-2">{Object.entries(result.metrics).map(([name, value]) => <div key={name} className="flex items-center justify-between gap-3 text-sm"><dt className="text-zinc-500">{name}</dt><dd className="font-mono font-semibold tabular-nums">{value == null ? "—" : value.toFixed(4)}</dd></div>)}</dl></article>; })}</div></div>;
}

const inputClass = "h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none placeholder:text-zinc-400 focus:border-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:disabled:bg-zinc-900";
const secondaryButtonClass = "rounded-md border border-zinc-300 px-3.5 py-2 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

function StepHeading({ number, title, note }: { number: string; title: string; note: string }) {
  return <div className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 font-mono text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{number}</span><div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-zinc-500">{note}</p></div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</span>{children}</label>;
}

function NumberField({ label, value, setValue, onChanged, min, max, step = 1 }: { label: string; value: number; setValue: (value: number) => void; onChanged: () => void; min: number; max?: number; step?: number }) {
  return <Field label={label}><input type="number" value={value} min={min} max={max} step={step} onChange={(event) => { setValue(Number(event.target.value)); onChanged(); }} className={inputClass} /></Field>;
}

function ActionButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="rounded-md bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">{children}</button>;
}
