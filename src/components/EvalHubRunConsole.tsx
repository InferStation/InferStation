"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AccuracyNav from "@/components/AccuracyNav";
import {
  createEvalHubIdempotencyKey,
  EvalHubApiError,
  EvalHubClient,
  isEvalHubRunTerminal,
  type EvalHubAuthType,
  type EvalHubDataset,
  type EvalHubEndpoint,
  type EvalHubProbe,
  type EvalHubRun,
  type EvalHubRunCreate,
  type EvalHubRunMetrics,
  type EvalHubValidation,
} from "@/lib/evalHubClient";
import {
  formatEvalMetric as formatMetric,
  formatEvalPolicy as formatPolicy,
  formatProtocolComponent,
  humanMetricName,
} from "@/lib/evalHubMetrics";
import {
  evalHubProgressPercent,
  formatEvalHubProgressPercent,
  getEvalHubDatasetProgress,
} from "@/lib/evalHubRunProgress";

const defaultApiBase =
  process.env.NEXT_PUBLIC_EVAL_HUB_API_BASE || "http://10.170.38.102:18080/api/v1";

type BusyAction = "connect" | "endpoint" | "probe" | "validate" | "run" | "cancel" | "history" | null;

const liveRunHistoryLimit = 50;

async function readStoredRun(api: EvalHubClient, summary: EvalHubRun) {
  const storedRun = await api.getRun(summary.id);
  const storedMetrics = storedRun.status === "SUCCEEDED"
    ? await api.getRunMetrics(storedRun.id)
    : null;
  return { storedRun, storedMetrics };
}

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
  const [modelId, setModelId] = useState("");
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const [runName, setRunName] = useState(`inferstation-${new Date().toISOString().slice(0, 10)}`);
  const [temperature, setTemperature] = useState(0);
  const [topP, setTopP] = useState(1);
  const [maxTokens, setMaxTokens] = useState(32);
  const [seed, setSeed] = useState(42);
  const [concurrency, setConcurrency] = useState(1);
  const [qps, setQps] = useState(1);
  const [timeoutSeconds, setTimeoutSeconds] = useState(300);
  const [maxRetries, setMaxRetries] = useState(2);
  const [validation, setValidation] = useState<EvalHubValidation | null>(null);
  const [run, setRun] = useState<EvalHubRun | null>(null);
  const [metrics, setMetrics] = useState<EvalHubRunMetrics | null>(null);
  const [recentRuns, setRecentRuns] = useState<EvalHubRun[]>([]);
  const [historyRun, setHistoryRun] = useState<EvalHubRun | null>(null);
  const [historyMetrics, setHistoryMetrics] = useState<EvalHubRunMetrics | null>(null);
  const [historyLoadingId, setHistoryLoadingId] = useState("");
  const [busy, setBusy] = useState<BusyAction>("connect");
  const [error, setError] = useState("");
  const idempotencyKey = useRef("");

  useEffect(() => {
    let disposed = false;
    const api = new EvalHubClient(defaultApiBase, "");
    Promise.all([
      api.listDatasets(),
      api.listRuns({ activeOnly: true, limit: 1 }),
      api.listRuns({ liveOnly: true, limit: liveRunHistoryLimit }),
    ])
      .then(async ([nextDatasets, activeRuns, storedRuns]) => {
        if (disposed) return;
        setDatasets(nextDatasets);
        setRun(activeRuns[0] ?? null);
        setRecentRuns(storedRuns);
        setConnectedBase(api.apiBase);
        if (storedRuns[0]) {
          const stored = await readStoredRun(api, storedRuns[0]);
          if (disposed) return;
          setHistoryRun(stored.storedRun);
          setHistoryMetrics(stored.storedMetrics);
        }
      })
      .catch((caught) => {
        if (!disposed) setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!disposed) setBusy(null);
      });
    return () => {
      disposed = true;
    };
  }, []);

  function invalidateValidation() {
    setValidation(null);
    idempotencyKey.current = "";
  }

  function clearRegisteredEndpoint() {
    setEndpoint(null);
    setProbe(null);
    setModelId("");
    invalidateValidation();
  }

  function disconnectEvalHub() {
    setConnectedBase("");
    setDatasets([]);
    setSelectedVersions([]);
    setRun(null);
    setMetrics(null);
    setRecentRuns([]);
    setHistoryRun(null);
    setHistoryMetrics(null);
    setHistoryLoadingId("");
    clearRegisteredEndpoint();
  }

  const versionMap = useMemo(() => {
    const map = new Map<string, EvalHubDataset["versions"][number]>();
    for (const dataset of datasets) for (const version of dataset.versions) map.set(version.id, version);
    return map;
  }, [datasets]);
  const datasetVersionCount = datasets.reduce((sum, item) => sum + item.versions.length, 0);
  const smokeVersionIds = datasets
    .filter((dataset) => dataset.name === "inferstation-accuracy-pipeline-smoke-10")
    .flatMap((dataset) => dataset.versions.map((version) => version.id));

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
      const [nextDatasets, activeRuns, storedRuns] = await Promise.all([
        api.listDatasets(),
        api.listRuns({ activeOnly: true, limit: 1 }),
        api.listRuns({ liveOnly: true, limit: liveRunHistoryLimit }),
      ]);
      setDatasets(nextDatasets);
      setRun(activeRuns[0] ?? null);
      setMetrics(null);
      setRecentRuns(storedRuns);
      if (storedRuns[0]) {
        const stored = await readStoredRun(api, storedRuns[0]);
        setHistoryRun(stored.storedRun);
        setHistoryMetrics(stored.storedMetrics);
      } else {
        setHistoryRun(null);
        setHistoryMetrics(null);
      }
      setConnectedBase(api.apiBase);
      setSelectedVersions([]);
      clearRegisteredEndpoint();
    });

  async function probeTargetModel(api: EvalHubClient, configured: EvalHubEndpoint) {
    const checked = await api.probeEndpoint(configured.id, targetModel, timeoutSeconds);
    setProbe(checked);
    const registeredModel = (await api.listModels(configured.id))
      .find((model) => model.model_name === targetModel);
    if (!registeredModel) {
      setModelId("");
      throw new Error(`Eval Hub did not retain the target model ${targetModel}.`);
    }
    setModelId(registeredModel.id);
    invalidateValidation();
  }

  const registerEndpoint = () =>
    perform("endpoint", async () => {
      const api = client();
      const endpointConfig = {
        name: endpointName,
        base_url: targetUrl,
        auth_type: authType,
        api_key: authType === "none" ? undefined : targetKey,
        extra_headers: {},
        concurrency_limit: Math.max(1, concurrency),
        qps_limit: Math.max(0.1, qps),
      };
      const existing = (await api.listEndpoints()).find((item) => item.name === endpointName);
      let configured: EvalHubEndpoint;
      if (existing) {
        configured = await api.updateEndpoint(existing.id, endpointConfig);
        const existingModels = await api.listModels(existing.id);
        if (!existingModels.some((model) => model.model_name === targetModel)) {
          await api.addModel(existing.id, targetModel);
        }
      } else {
        configured = await api.createEndpoint({ ...endpointConfig, model_name: targetModel });
      }
      setEndpoint(configured);
      setTargetUrl(configured.base_url);
      setTargetKey("");
      await probeTargetModel(api, configured);
    });

  const reprobeEndpoint = () =>
    perform("probe", async () => {
      if (!endpoint) return;
      await probeTargetModel(client(), endpoint);
    });

  function selectSmokeDataset() {
    setSelectedVersions(smokeVersionIds);
    invalidateValidation();
  }

  function clearDatasets() {
    setSelectedVersions([]);
    invalidateValidation();
  }

  const validate = () =>
    perform("validate", async () => {
      const result = await client().validateRun(payload());
      setValidation(result);
      idempotencyKey.current = "";
    });

  const startRun = () =>
    perform("run", async () => {
      if (!idempotencyKey.current) idempotencyKey.current = createEvalHubIdempotencyKey();
      const api = client();
      try {
        const created = await api.createRun(payload(), idempotencyKey.current);
        setRun(created);
        setMetrics(null);
        setRecentRuns((current) => [created, ...current.filter((item) => item.id !== created.id)].slice(0, liveRunHistoryLimit));
      } catch (caught) {
        if (caught instanceof EvalHubApiError && caught.status === 409) {
          const activeRuns = await api.listRuns({ activeOnly: true, limit: 1 });
          if (activeRuns[0]) {
            setRun(activeRuns[0]);
            setMetrics(null);
          }
        }
        throw caught;
      }
    });

  const openHistoryRun = async (summary: EvalHubRun) => {
    setHistoryRun(summary);
    setHistoryMetrics(null);
    setHistoryLoadingId(summary.id);
    try {
      await perform("history", async () => {
        const stored = await readStoredRun(client(), summary);
        setHistoryRun(stored.storedRun);
        setHistoryMetrics(stored.storedMetrics);
      });
    } finally {
      setHistoryLoadingId("");
    }
  };

  const cancelRun = () =>
    perform("cancel", async () => {
      if (!run) return;
      const api = client();
      const cancelled = await api.cancelRun(run.id);
      setRun(cancelled);
      setRecentRuns((current) => current.map((item) => item.id === cancelled.id ? cancelled : item));
      if (isEvalHubRunTerminal(cancelled.status)) {
        setHistoryRun(cancelled);
        setHistoryMetrics(null);
      }
    });

  const runId = run?.id;
  const runStatus = run?.status;

  useEffect(() => {
    if (!connectedBase) return;
    let disposed = false;
    const api = new EvalHubClient(connectedBase, adminKey);
    const poll = async () => {
      try {
        if (!runId || !runStatus || isEvalHubRunTerminal(runStatus)) {
          const activeRuns = await api.listRuns({ activeOnly: true, limit: 1 });
          if (!disposed && activeRuns[0]) {
            setRun(activeRuns[0]);
            setMetrics(null);
          }
          return;
        }
        const next = await api.getRun(runId);
        if (disposed) return;
        setRun(next);
        setRecentRuns((current) => current.map((item) => item.id === next.id ? next : item));
        let completedMetrics: EvalHubRunMetrics | null = null;
        if (isEvalHubRunTerminal(next.status) && next.status === "SUCCEEDED") {
          completedMetrics = await api.getRunMetrics(next.id);
          if (disposed) return;
          setMetrics(completedMetrics);
        }
        if (isEvalHubRunTerminal(next.status)) {
          const storedRuns = await api.listRuns({ liveOnly: true, limit: liveRunHistoryLimit });
          if (disposed) return;
          setRecentRuns(storedRuns);
          setHistoryRun(next);
          setHistoryMetrics(completedMetrics);
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
  }, [adminKey, connectedBase, runId, runStatus]);

  const totalSamples = run?.datasets.reduce((sum, item) => sum + item.total_samples, 0) ?? 0;
  const completedSamples = run?.datasets.reduce((sum, item) => sum + item.completed_samples, 0) ?? 0;
  const runIsActive = Boolean(run && !isEvalHubRunTerminal(run.status));
  const progressPercent = evalHubProgressPercent(completedSamples, totalSamples);
  const datasetProgress = run ? getEvalHubDatasetProgress(run) : [];
  const canRegister = Boolean(connectedBase && endpointName && targetUrl && targetModel && (authType === "none" || targetKey));
  const canValidate = Boolean(
    endpoint
      && probe?.status === "healthy"
      && modelId
      && selectedVersions.length
      && runName,
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-9 sm:py-12">
      <AccuracyNav active="run" />
      <header className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">Live evaluation</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Run any OpenAI-compatible model through Eval Hub.</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Register a reachable model API, select immutable datasets, preflight the request, and follow the asynchronous run. Nothing is published to Git automatically.
        </p>
      </header>

      {error ? <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div> : null}

      <section className="mt-7 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800 sm:p-6">
        <StepHeading number="1" title="Connect to LLM Eval Hub" note="The production service connects automatically. Change this URL only when testing another Eval Hub deployment." />
        <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <Field label="Eval Hub API URL"><input value={apiBase} onChange={(event) => { setApiBase(event.target.value); disconnectEvalHub(); }} className={inputClass} placeholder="http://host:18080/api/v1" /></Field>
          <ActionButton onClick={connect} disabled={!apiBase || busy !== null}>{busy === "connect" ? "Loading datasets…" : connectedBase ? "Reload datasets" : "Connect"}</ActionButton>
        </div>
        {connectedBase ? <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-400">Connected to {connectedBase} · {datasets.length} datasets · {datasetVersionCount} versions</p> : null}
      </section>

      <section className="mt-5 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800 sm:p-6">
        <StepHeading number="2" title="Configure the model service" note="Paste either an OpenAI API base URL or the full /chat/completions URL. Reusing an endpoint name safely updates its configuration." />
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label="Endpoint name"><input value={endpointName} onChange={(event) => { setEndpointName(event.target.value); clearRegisteredEndpoint(); }} className={inputClass} /></Field>
          <Field label="OpenAI-compatible API URL"><input type="url" value={targetUrl} onChange={(event) => { setTargetUrl(event.target.value); clearRegisteredEndpoint(); }} className={inputClass} placeholder="https://provider.example/v1 or …/chat/completions" spellCheck={false} /></Field>
          <Field label="API model name"><input value={targetModel} onChange={(event) => { setTargetModel(event.target.value); clearRegisteredEndpoint(); }} className={inputClass} placeholder="served-model-name" /></Field>
          <div className="grid grid-cols-[0.8fr_1.2fr] gap-3">
            <Field label="Authentication"><select value={authType} onChange={(event) => { setAuthType(event.target.value as EvalHubAuthType); clearRegisteredEndpoint(); }} className={inputClass}><option value="bearer">Bearer</option><option value="api-key-header">API-key header</option><option value="none">None</option></select></Field>
            <Field label="Target API key"><input type="password" autoComplete="off" disabled={authType === "none"} value={targetKey} onChange={(event) => { setTargetKey(event.target.value); clearRegisteredEndpoint(); }} className={inputClass} placeholder={authType === "none" ? "Not required" : "Cleared after registration"} /></Field>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-zinc-500">The target credential is encrypted by Eval Hub, never written to InferStation JSON, and cleared from this browser form immediately after the endpoint is saved.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ActionButton onClick={registerEndpoint} disabled={!canRegister || busy !== null}>{busy === "endpoint" ? "Saving and probing…" : "Save & probe"}</ActionButton>
          {endpoint && probe?.status !== "healthy" ? <button type="button" onClick={reprobeEndpoint} disabled={busy !== null} className={secondaryButtonClass}>{busy === "probe" ? "Probing…" : "Retry probe"}</button> : null}
          {endpoint ? <span className="text-xs text-zinc-500">Endpoint {endpoint.id.slice(0, 8)} · {probe?.status ?? endpoint.status}{probe?.latency_ms != null ? ` · ${Math.round(probe.latency_ms)} ms` : ""}</span> : null}
        </div>
        {probe?.status === "failed" ? <p className="mt-3 text-xs text-red-600 dark:text-red-400">Probe failed: {probe.error_message ?? probe.error_type ?? "the endpoint did not return a compatible chat completion"}.</p> : null}
        {probe?.status === "healthy" && modelId ? <div role="status" className="mt-4 max-w-xl rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"><strong className="font-semibold">Verified target model</strong><span className="mx-2 text-emerald-400">·</span><code>{targetModel}</code><span className="mt-1 block text-emerald-700/80 dark:text-emerald-300/80">Eval Hub sent one minimal Chat Completions request for this exact model. It did not discover or select other models from the provider.</span></div> : null}
      </section>

      <section className="mt-5 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <StepHeading number="3" title="Choose immutable datasets" note="Start with the 10-row smoke pack for connectivity. MMLU Lite and Full overlap; select one, not both." />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={selectSmokeDataset} disabled={!smokeVersionIds.length || busy !== null} className={secondaryButtonClass}>Select 10-row smoke test</button>
            <button type="button" onClick={clearDatasets} disabled={!selectedVersions.length || busy !== null} className={secondaryButtonClass}>Clear</button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {!connectedBase && busy === "connect" ? <DatasetMessage>Loading registered datasets from Eval Hub…</DatasetMessage> : null}
          {!connectedBase && busy !== "connect" ? <DatasetMessage>Connect to Eval Hub to load its registered dataset versions.</DatasetMessage> : null}
          {datasets.flatMap((dataset) => dataset.versions.map((version) => {
            const checked = selectedVersions.includes(version.id);
            const isSmoke = dataset.name === "inferstation-accuracy-pipeline-smoke-10";
            return (
              <label key={version.id} className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${checked ? "border-sky-400 bg-sky-50/60 dark:border-sky-700 dark:bg-sky-950/20" : "border-zinc-200 dark:border-zinc-800"}`}>
                <input type="checkbox" checked={checked} onChange={() => { setSelectedVersions((current) => current.includes(version.id) ? current.filter((id) => id !== version.id) : [...current, version.id]); invalidateValidation(); }} className="mt-1" />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">{dataset.display_name} · {version.version}</strong>
                    {isSmoke ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Test only</span> : null}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-zinc-500">{dataset.description}</span>
                  <span className="mt-2 block text-xs text-zinc-500">{version.row_count.toLocaleString()} samples · {version.manifest_json.protocol.id}</span>
                  <code className="mt-2 block truncate text-[10px] text-zinc-400">{version.checksum}</code>
                </span>
              </label>
            );
          }))}
          {connectedBase && datasets.length === 0 ? <p className="text-sm text-zinc-500">No dataset versions are registered in Eval Hub.</p> : null}
        </div>
        {selectedVersions.length ? <p className="mt-3 text-xs text-zinc-500">{selectedVersions.length} dataset version{selectedVersions.length === 1 ? "" : "s"} selected.</p> : null}
      </section>

      <section className="mt-5 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800 sm:p-6">
        <StepHeading number="4" title="Preflight and run" note="These fields map directly to Eval Hub's RunCreate contract. Accuracy defaults favor deterministic answers and complete requests while keeping the shared host lightly loaded." />
        <div className="mt-5 max-w-xl">
          <Field label="Run name"><input value={runName} onChange={(event) => { setRunName(event.target.value); invalidateValidation(); }} className={inputClass} /></Field>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <fieldset className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <legend className="px-1 text-sm font-semibold">Answer generation</legend>
            <p className="mt-1 text-xs leading-5 text-zinc-500">A zero temperature, unrestricted Top P, and fixed seed make repeated accuracy runs as deterministic as the model API allows.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <NumberField label="Temperature" value={temperature} setValue={setTemperature} min={0} max={2} step={0.1} onChanged={invalidateValidation} />
              <NumberField label="Top P" value={topP} setValue={setTopP} min={0.01} max={1} step={0.01} onChanged={invalidateValidation} />
              <NumberField label="Max output tokens" value={maxTokens} setValue={setMaxTokens} min={1} max={32768} onChanged={invalidateValidation} />
              <NumberField label="Seed" value={seed} setValue={setSeed} min={0} onChanged={invalidateValidation} />
            </div>
          </fieldset>
          <fieldset className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <legend className="px-1 text-sm font-semibold">Execution reliability</legend>
            <p className="mt-1 text-xs leading-5 text-zinc-500">One request per second protects the host. A 300-second timeout and two transient retries reduce missing samples without changing scoring.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <NumberField label="Concurrency" value={concurrency} setValue={setConcurrency} min={1} max={4} onChanged={invalidateValidation} />
              <NumberField label="QPS" value={qps} setValue={setQps} min={0.1} max={10} step={0.1} onChanged={invalidateValidation} />
              <NumberField label="Timeout seconds" value={timeoutSeconds} setValue={setTimeoutSeconds} min={1} max={3600} onChanged={invalidateValidation} />
              <NumberField label="Max retries" value={maxRetries} setValue={setMaxRetries} min={0} max={10} onChanged={invalidateValidation} />
            </div>
          </fieldset>
        </div>
        <p className="mt-3 text-xs leading-5 text-zinc-500">Eval Hub currently sends all answer-generation fields to the target API as configured. Provider-specific fallback for unsupported fields belongs in Eval Hub and is intentionally outside this first working path.</p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={validate} disabled={!canValidate || busy !== null} className={secondaryButtonClass}>{busy === "validate" ? "Validating…" : "Validate run"}</button>
          <ActionButton onClick={startRun} disabled={!validation?.valid || busy !== null || runIsActive}>{busy === "run" ? "Submitting…" : runIsActive ? "Queue occupied" : "Start evaluation"}</ActionButton>
          {validation ? <span className="text-xs text-zinc-500">{validation.sample_count.toLocaleString()} requests · effective concurrency {validation.effective_concurrency}</span> : null}
        </div>
        {endpoint && probe?.status !== "healthy" ? <p className="mt-3 text-xs text-zinc-500">A healthy endpoint probe is required before run validation.</p> : null}
        {validation?.warnings.map((warning) => <div key={warning} className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">{warning}</div>)}
      </section>

      <section className="mt-5 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800 sm:p-6" aria-live="polite">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <StepHeading number="5" title="Single-run queue and progress" note="Eval Hub exposes one global task slot. A task may contain several datasets, but another task cannot enter the queue until this one is terminal." />
          <span className={`rounded-full px-3 py-1 font-mono text-xs font-semibold ${runIsActive ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"}`}>
            {runIsActive ? "1 / 1 occupied" : "0 / 1 available"}
          </span>
        </div>
        {!run ? <p className="mt-5 rounded-xl border border-dashed border-zinc-300 px-4 py-5 text-sm text-zinc-500 dark:border-zinc-700">{connectedBase ? "Queue empty. One evaluation may be submitted." : "Connect to Eval Hub to load its queue."}</p> : null}
        {run ? (
          <div className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><strong className="text-sm">{run.name}</strong><p className="mt-1 text-xs text-zinc-500">{run.status === "QUEUED" ? "Queued · position 1 of 1 · waiting for the worker" : runIsActive ? "Running in the only task slot" : "Last observed run · task slot released"}</p></div>
              <span className="rounded-full bg-zinc-100 px-3 py-1 font-mono text-xs font-semibold dark:bg-zinc-900">{run.status}</span>
            </div>
            <div className="mt-5 flex items-center justify-between gap-3 text-xs text-zinc-500"><span className="font-medium text-zinc-700 dark:text-zinc-300">Overall progress</span><span>{datasetProgress.length} dataset{datasetProgress.length === 1 ? "" : "s"}</span></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900"><div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${progressPercent}%` }} /></div>
            <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-zinc-500"><span>{completedSamples.toLocaleString()} / {totalSamples.toLocaleString()} samples · {formatEvalHubProgressPercent(progressPercent)}</span><span className="font-mono">{run.protocol_fingerprint.slice(0, 20)}…</span></div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {datasetProgress.map((dataset, index) => (
                <div key={dataset.id} className="rounded-xl border border-zinc-200 p-3.5 dark:border-zinc-800">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Dataset {index + 1} of {datasetProgress.length}</p>
                      <p className="mt-1 truncate text-xs font-semibold" title={dataset.displayName}>{dataset.displayName}</p>
                      <p className="mt-1 text-[11px] text-zinc-500">{dataset.version}</p>
                    </div>
                    <RunStatus status={dataset.status} />
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900"><div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${dataset.percent}%` }} /></div>
                  <p className="mt-2 text-[11px] text-zinc-500"><span className="font-mono tabular-nums">{dataset.completedSamples.toLocaleString()} / {dataset.totalSamples.toLocaleString()}</span> samples · {formatEvalHubProgressPercent(dataset.percent)}</p>
                </div>
              ))}
            </div>
            {datasetProgress.length > 1 ? <p className="mt-3 text-xs leading-5 text-zinc-500">Each dataset is tracked and scored independently. Eval Hub persists the separate scores after every dataset in this run finishes; InferStation does not calculate a combined score.</p> : null}
            {runIsActive ? <div className="mt-4"><button type="button" onClick={cancelRun} disabled={busy !== null} className={secondaryButtonClass}>{busy === "cancel" ? "Cancelling…" : "Cancel run"}</button></div> : null}
            {run.error_message ? <p className="mt-4 text-sm text-red-600">{run.error_message}</p> : null}
            {metrics ? <MetricsPanel metrics={metrics} datasets={datasets} run={run} /> : null}
          </div>
        ) : null}
      </section>

      <section className="mt-5 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800 sm:p-6">
        <StepHeading
          number="6"
          title="Recent Live Runs"
          note="Reload a completed result after refresh and compare it with the exact model, dataset protocol, and error counts used for that run."
        />
        <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/60 px-4 py-3 text-xs leading-5 text-sky-900 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-200">
          This page lists its {liveRunHistoryLimit} most recent submissions. When a newer run pushes the oldest entry out of this list, Eval Hub keeps the underlying run, samples, and metrics; only the page history index is bounded.
        </div>
        {!connectedBase ? <p className="mt-5 text-sm text-zinc-500">Connect to Eval Hub to load Live Run history.</p> : null}
        {connectedBase && recentRuns.length === 0 ? <p className="mt-5 rounded-xl border border-dashed border-zinc-300 px-4 py-5 text-sm text-zinc-500 dark:border-zinc-700">No run has been submitted from this page yet.</p> : null}
        {recentRuns.length ? (
          <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.65fr)] lg:gap-6">
            <div className="min-w-0">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Run history</h3>
                <span className="text-xs text-zinc-500">{recentRuns.length} / {liveRunHistoryLimit}</span>
              </div>
              <ul className="max-h-[360px] space-y-2 overflow-y-auto pr-1 lg:max-h-[760px]" aria-label="Recent Live Runs">
                {recentRuns.map((item) => {
                  const total = item.datasets.reduce((sum, dataset) => sum + dataset.total_samples, 0);
                  const completed = item.datasets.reduce((sum, dataset) => sum + dataset.completed_samples, 0);
                  const selected = historyRun?.id === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => void openHistoryRun(item)}
                        disabled={busy !== null}
                        className={`w-full rounded-xl border px-3.5 py-3 text-left transition-colors disabled:cursor-wait disabled:opacity-70 ${selected ? "border-sky-400 bg-sky-50/70 ring-1 ring-sky-200 dark:border-sky-700 dark:bg-sky-950/20 dark:ring-sky-900" : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/50"}`}
                      >
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0 truncate text-sm font-medium">{item.name}</span>
                          <RunStatus status={item.status} />
                        </span>
                        <span className="mt-2 block truncate font-mono text-[11px] text-zinc-600 dark:text-zinc-400">{item.run_spec_json.model_name}</span>
                        <span className="mt-1 block truncate text-xs text-zinc-500">{datasetNames(item).join(", ")}</span>
                        <span className="mt-2 flex items-center justify-between gap-3 text-[11px] text-zinc-500">
                          <span className="font-mono tabular-nums">{completed.toLocaleString()} / {total.toLocaleString()}</span>
                          <span>{historyLoadingId === item.id ? "Loading…" : formatRunDate(item.created_at)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="min-w-0" aria-live="polite">
              {historyRun ? <HistoryResult run={historyRun} metrics={historyMetrics} datasets={datasets} loading={historyLoadingId === historyRun.id} /> : <p className="rounded-xl border border-dashed border-zinc-300 px-5 py-12 text-center text-sm text-zinc-500 dark:border-zinc-700">Select a run to inspect its persisted result.</p>}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function HistoryResult({ run, metrics, datasets, loading }: { run: EvalHubRun; metrics: EvalHubRunMetrics | null; datasets: EvalHubDataset[]; loading: boolean }) {
  const completed = run.datasets.reduce((sum, dataset) => sum + dataset.completed_samples, 0);
  const total = run.datasets.reduce((sum, dataset) => sum + dataset.total_samples, 0);
  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Selected stored result</p><h2 className="mt-1 text-lg font-semibold">{run.name}</h2><p className="mt-1 font-mono text-xs text-zinc-500">{run.id}</p></div>
        <RunStatus status={run.status} />
      </div>
      <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ResultFact label="Model" value={run.run_spec_json.model_name} mono />
        <ResultFact label="Samples" value={`${completed.toLocaleString()} / ${total.toLocaleString()}`} />
        <ResultFact label="Created" value={formatRunDate(run.created_at)} />
        <ResultFact label="Completed" value={formatRunDate(run.completed_at)} />
      </dl>
      <div className="mt-4 rounded-xl bg-zinc-50 px-4 py-3 text-xs leading-5 text-zinc-600 dark:bg-zinc-900/60 dark:text-zinc-400"><strong className="text-zinc-900 dark:text-zinc-100">Dataset protocol:</strong> {run.run_spec_json.datasets.map((dataset) => `${dataset.manifest.metadata.display_name} · ${dataset.manifest.metadata.version} · ${dataset.manifest.protocol.id}`).join("; ")}</div>
      {run.error_message ? <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{run.error_message}</p> : null}
      {loading ? <p className="mt-5 rounded-xl bg-zinc-50 px-4 py-5 text-sm text-zinc-500 dark:bg-zinc-900/60">Loading persisted run details and aggregate metrics…</p> : null}
      {!loading && metrics ? <MetricsPanel metrics={metrics} datasets={datasets} run={run} /> : null}
      {!loading && run.status === "SUCCEEDED" && !metrics ? <p className="mt-5 text-sm text-zinc-500">This run succeeded, but no aggregate metrics were returned.</p> : null}
      {!loading && run.status !== "SUCCEEDED" ? <p className="mt-5 text-sm text-zinc-500">Aggregate scores are available only after a run succeeds. Progress and any terminal error remain visible above.</p> : null}
      <div className="mt-6 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <h3 className="text-sm font-semibold">How to read this result</h3>
        <ul className="mt-3 space-y-2 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
          <li><strong className="text-zinc-900 dark:text-zinc-100">Primary score</strong> is the dataset protocol&apos;s quality metric. Read its numerator and denominator together; a score without its evaluated population is incomplete.</li>
          <li><strong className="text-zinc-900 dark:text-zinc-100">API and parse errors</strong> show delivery or formatting failures. Compare them with the denominator policy before interpreting model quality.</li>
          <li><strong className="text-zinc-900 dark:text-zinc-100">Latency</strong> describes service behavior during this run; it is context, not an accuracy metric.</li>
        </ul>
      </div>
    </div>
  );
}

function MetricsPanel({ metrics, datasets, run }: { metrics: EvalHubRunMetrics; datasets: EvalHubDataset[]; run: EvalHubRun }) {
  const versions = new Map(datasets.flatMap((dataset) => dataset.versions.map((version) => [version.id, { dataset, version }] as const)));
  const storedVersions = new Map(run.run_spec_json.datasets.map((dataset) => [dataset.dataset_version_id, dataset] as const));
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-sm font-semibold">Eval Hub scoring results</h2><p className="mt-1 text-xs text-zinc-500">Each dataset has its own protocol and score. InferStation displays the persisted aggregates separately and never calculates a cross-dataset average.</p></div>
        <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-sky-700 ring-1 ring-inset ring-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-900">{metrics.datasets.length} dataset result{metrics.datasets.length === 1 ? "" : "s"}</span>
      </div>
      <div className="mt-3 space-y-4">
        {metrics.datasets.map((result, resultIndex) => {
          const item = versions.get(result.dataset_version_id);
          const stored = storedVersions.get(result.dataset_version_id);
          const manifest = stored?.manifest ?? item?.version.manifest_json;
          const protocol = manifest?.protocol;
          const isSmoke = manifest?.metadata.name === "inferstation-accuracy-pipeline-smoke-10";
          const primaryMetric = protocol?.scorer.primary_metric ?? "accuracy";
          const primaryValue = result.metrics[primaryMetric];
          const numerator = result.metrics[`${primaryMetric}_numerator`];
          const denominator = result.metrics[`${primaryMetric}_denominator`] ?? result.denominators[primaryMetric];
          const apiErrors = result.metrics.api_errors;
          const parseErrors = result.metrics.parse_errors;
          const secondaryQualityMetrics = ["macro_f1", "micro_f1", "weighted_f1"]
            .filter((name) => result.metrics[name] != null);
          return (
            <article key={result.run_dataset_id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Dataset result {resultIndex + 1} of {metrics.datasets.length}</p><div className="mt-1 text-sm font-semibold">{stored?.manifest.metadata.display_name ?? item?.dataset.display_name ?? result.protocol_id}</div><div className="mt-1 text-[11px] text-zinc-500">{manifest?.metadata.version ?? "Stored version"} · {result.protocol_id}</div></div>
                <code className="rounded-md bg-zinc-100 px-2 py-1 text-[10px] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">{primaryMetric}</code>
              </div>

              {isSmoke ? <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><strong>Pipeline score — not model accuracy.</strong> This synthetic ten-sample pack verifies request, parsing, scoring, persistence, and UI wiring only; it must not be used to compare models.</div> : null}

              <div className="mt-4 grid gap-3 rounded-xl border border-sky-200 bg-sky-50/50 p-3 dark:border-sky-900 dark:bg-sky-950/20 sm:grid-cols-[1.15fr_1fr]">
                <MetricFact label={`Primary metric · ${humanMetricName(primaryMetric)}`} value={formatMetric(primaryMetric, primaryValue)} prominent />
                <MetricFact label="Numerator / denominator" value={numerator == null && denominator == null ? "—" : `${formatCount(numerator)} / ${formatCount(denominator)}`} />
              </div>

              <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <ProtocolFact label="Scorer" value={formatProtocolComponent(protocol?.scorer)} />
                <ProtocolFact label="Parser" value={formatProtocolComponent(protocol?.parser)} />
                <ProtocolFact label="Task type" value={protocol?.task_type ?? "—"} mono />
                <ProtocolFact label="Denominator policy" value={formatPolicy(protocol?.denominator_policy)} />
                <ProtocolFact label="API error policy" value={formatPolicy(protocol?.on_api_error)} />
                <ProtocolFact label="Parse error policy" value={formatPolicy(protocol?.on_parse_error)} />
              </dl>

              <div className="mt-4">
                <h3 className="text-xs font-semibold">Quality population and errors</h3>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  <MetricFact label="Total samples" value={formatCount(result.metrics.total_samples)} />
                  <MetricFact label="Valid responses" value={formatCount(result.metrics.valid_responses)} />
                  <MetricFact label="Scored samples" value={formatCount(result.metrics.scored_samples)} />
                  <MetricFact label="Score errors" value={formatCount(result.metrics.score_errors)} warning={Boolean(result.metrics.score_errors)} />
                  <MetricFact label="API errors" value={`${formatCount(apiErrors)} · ${formatMetric("api_error_rate", result.metrics.api_error_rate)}`} warning={Boolean(apiErrors)} />
                  <MetricFact label="Parse errors" value={`${formatCount(parseErrors)} · ${formatMetric("parse_error_rate", result.metrics.parse_error_rate)}`} warning={Boolean(parseErrors)} />
                  {secondaryQualityMetrics.map((name) => <MetricFact key={name} label={humanMetricName(name)} value={formatMetric(name, result.metrics[name])} />)}
                </div>
              </div>

              {result.groups.length ? <details className="mt-4 rounded-xl border border-zinc-200 text-xs dark:border-zinc-800"><summary className="cursor-pointer px-4 py-3 font-medium">Grouped quality metrics · {result.groups.length} groups</summary><div className="max-h-[420px] overflow-auto border-t border-zinc-200 dark:border-zinc-800"><table className="min-w-full text-left"><thead className="sticky top-0 bg-zinc-50 text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-900"><tr><th className="px-3 py-2">Group</th><th className="px-3 py-2">Value</th><th className="px-3 py-2">{humanMetricName(primaryMetric)}</th><th className="px-3 py-2">Numerator / denominator</th><th className="px-3 py-2">API / parse errors</th></tr></thead><tbody>{result.groups.map((group) => {
                const groupNumerator = group.metrics[`${primaryMetric}_numerator`];
                const groupDenominator = group.metrics[`${primaryMetric}_denominator`] ?? group.denominators[primaryMetric];
                return <tr key={`${group.group_key}:${group.group_value}`} className="border-t border-zinc-100 dark:border-zinc-900"><td className="px-3 py-2 font-mono text-[11px]">{group.group_key}</td><td className="px-3 py-2">{group.group_value}</td><td className="px-3 py-2 font-mono font-semibold tabular-nums">{formatMetric(primaryMetric, group.metrics[primaryMetric])}</td><td className="px-3 py-2 font-mono tabular-nums">{formatCount(groupNumerator)} / {formatCount(groupDenominator)}</td><td className="px-3 py-2 font-mono tabular-nums">{formatCount(group.metrics.api_errors)} / {formatCount(group.metrics.parse_errors)}</td></tr>;
              })}</tbody></table></div></details> : null}

              <div className="mt-4">
                <h3 className="text-xs font-semibold">Execution diagnostics <span className="font-normal text-zinc-500">· not quality metrics</span></h3>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <MetricFact label="Success latency p50" value={formatMilliseconds(result.metrics.latency_success_p50_ms)} />
                  <MetricFact label="Success latency p95" value={formatMilliseconds(result.metrics.latency_success_p95_ms)} />
                  <MetricFact label="Prompt tokens" value={formatCount(result.metrics.prompt_tokens)} />
                  <MetricFact label="Completion tokens" value={formatCount(result.metrics.completion_tokens)} />
                </div>
              </div>

              <p className="mt-4 text-[11px] leading-5 text-zinc-500">Source: Eval Hub persisted <code>/runs/{run.id}/metrics</code>. Metric identity and scoring policies are read from this run&apos;s frozen dataset manifest, not inferred by InferStation.</p>
              <details className="mt-3 text-xs text-zinc-500"><summary className="cursor-pointer font-medium">All raw aggregate fields</summary><dl className="mt-3 space-y-2">{Object.entries(result.metrics).map(([name, value]) => <div key={name} className="flex items-center justify-between gap-3"><dt>{name}</dt><dd className="font-mono tabular-nums">{value == null ? "—" : value.toFixed(4)}</dd></div>)}</dl></details>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function ProtocolFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="rounded-lg bg-zinc-50 px-3 py-2.5 dark:bg-zinc-900/60"><dt className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</dt><dd className={`mt-1 text-xs font-medium ${mono ? "font-mono" : ""}`}>{value}</dd></div>;
}

function RunStatus({ status }: { status: string }) {
  const terminalClass = status === "SUCCEEDED"
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
    : status === "FAILED" || status === "CANCELLED"
      ? "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
      : status === "SAMPLES COMPLETE"
        ? "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
      : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
  return <span className={`mt-1 inline-flex whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${terminalClass}`}>{status}</span>;
}

function ResultFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-900/60"><dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{label}</dt><dd className={`mt-1 truncate text-sm font-medium ${mono ? "font-mono" : ""}`}>{value}</dd></div>;
}

function MetricFact({ label, value, prominent = false, warning = false }: { label: string; value: string; prominent?: boolean; warning?: boolean }) {
  return <div className="rounded-lg bg-zinc-50 px-3 py-2.5 dark:bg-zinc-900/60"><div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div><div className={`mt-1 font-mono font-semibold tabular-nums ${prominent ? "text-xl text-sky-700 dark:text-sky-300" : warning ? "text-amber-700 dark:text-amber-300" : "text-sm"}`}>{value}</div></div>;
}

function datasetNames(run: EvalHubRun): string[] {
  return run.run_spec_json.datasets.map((dataset) => dataset.manifest.metadata.display_name);
}

function formatRunDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatCount(value: number | null | undefined): string {
  return value == null ? "—" : Math.round(value).toLocaleString();
}

function formatMilliseconds(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value).toLocaleString()} ms`;
}

function DatasetMessage({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500 dark:border-zinc-700">
      {children}
    </p>
  );
}

const inputClass = "h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none placeholder:text-zinc-400 focus:border-sky-500 disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:disabled:bg-zinc-900";
const secondaryButtonClass = "rounded-md border border-zinc-300 px-3.5 py-2 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

function StepHeading({ number, title, note }: { number: string; title: string; note: string }) {
  return <div className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-50 font-mono text-xs font-semibold text-sky-700 ring-1 ring-inset ring-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:ring-sky-900">{number}</span><div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-zinc-500">{note}</p></div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</span>{children}</label>;
}

function NumberField({ label, value, setValue, onChanged, min, max, step = 1 }: { label: string; value: number; setValue: (value: number) => void; onChanged: () => void; min: number; max?: number; step?: number }) {
  return <Field label={label}><input type="number" value={value} min={min} max={max} step={step} onChange={(event) => { setValue(Number(event.target.value)); onChanged(); }} className={inputClass} /></Field>;
}

function ActionButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="rounded-md bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">{children}</button>;
}
