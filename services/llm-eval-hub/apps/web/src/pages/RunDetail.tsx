import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, Download, ExternalLink, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, downloadExport, streamRunEvents } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import type { Run, RunMetrics, SampleExecution } from "../types";

const terminal = ["SUCCEEDED", "FAILED", "CANCELLED"];
const percent = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const number = (value: number | null | undefined, suffix = "") => value == null ? "—" : `${value.toFixed(value >= 100 ? 0 : 1)}${suffix}`;

export function RunDetail() {
  const { runId = "" } = useParams();
  const client = useQueryClient();
  const [tab, setTab] = useState<"overview" | "samples" | "protocol">("overview");
  const [sampleFilter, setSampleFilter] = useState("ALL");
  const [selectedSample, setSelectedSample] = useState<SampleExecution | null>(null);
  const run = useQuery({ queryKey: ["run", runId], queryFn: () => api<Run>(`/runs/${runId}`), refetchInterval: (query) => terminal.includes(query.state.data?.status || "") ? false : 1500 });
  const metrics = useQuery({ queryKey: ["run-metrics", runId], queryFn: () => api<RunMetrics>(`/runs/${runId}/metrics`), enabled: run.data?.status === "SUCCEEDED" });
  const samples = useQuery({ queryKey: ["run-samples", runId, sampleFilter], queryFn: () => api<SampleExecution[]>(`/runs/${runId}/samples?limit=200${sampleFilter === "ALL" ? "" : sampleFilter === "FAILED" ? "&passed=false" : `&status=${sampleFilter}`}`), enabled: tab === "samples" || run.data?.status === "SUCCEEDED" });
  const cancel = useMutation({ mutationFn: () => api<Run>(`/runs/${runId}/cancel`, { method: "POST" }), onSuccess: () => client.invalidateQueries({ queryKey: ["run", runId] }) });
  const retryFailures = useMutation({ mutationFn: () => api<Run>(`/runs/${runId}/retry-failures`, { method: "POST" }), onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: ["run", runId] }), client.invalidateQueries({ queryKey: ["run-metrics", runId] }), client.invalidateQueries({ queryKey: ["run-samples", runId] })]); } });
  const total = run.data?.datasets.reduce((sum, item) => sum + item.total_samples, 0) || 0;
  const completed = run.data?.datasets.reduce((sum, item) => sum + item.completed_samples, 0) || 0;
  const runStatus = run.data?.status;
  const primary = useMemo(() => metrics.data?.datasets[0]?.metrics || {}, [metrics.data]);
  const grouped = metrics.data?.datasets.flatMap((dataset) => dataset.groups) || [];
  const latencyChart = useMemo(() => ({ grid: { left: 45, right: 16, top: 12, bottom: 28 }, xAxis: { type: "category", data: ["P50", "P95", "P99"], axisLine: { lineStyle: { color: "#cbd0cc" } } }, yAxis: { type: "value", name: "ms", splitLine: { lineStyle: { color: "#e8ebe8" } } }, tooltip: { trigger: "axis" }, series: [{ type: "bar", data: [primary.latency_success_p50_ms || 0, primary.latency_success_p95_ms || 0, primary.latency_success_p99_ms || 0], itemStyle: { color: "#24786d", borderRadius: [3, 3, 0, 0] }, barMaxWidth: 44 }] }), [primary]);

  useEffect(() => {
    if (!runStatus || terminal.includes(runStatus)) return;
    const controller = new AbortController();
    void streamRunEvents(
      runId,
      () => client.invalidateQueries({ queryKey: ["run", runId] }),
      controller.signal,
    ).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        void client.invalidateQueries({ queryKey: ["run", runId] });
      }
    });
    return () => controller.abort();
  }, [client, runId, runStatus]);

  if (run.isLoading) return <div className="page loading-page"><Loader2 className="spin" size={24} />加载运行...</div>;
  if (!run.data) return <div className="page"><EmptyState icon={AlertTriangle} title="运行不存在" detail="该运行可能已被删除或无权访问。" /></div>;

  return (
    <div className="page run-detail-page">
      <Link className="back-link" to="/runs"><ArrowLeft size={15} />返回运行记录</Link>
      <div className="run-heading"><div><div className="title-line"><h1>{run.data.name}</h1><StatusBadge status={run.data.status} /></div><p>{run.data.run_spec_json.model_name} · {run.data.datasets.length} 个数据集 · 创建于 {new Date(run.data.created_at).toLocaleString("zh-CN")}</p></div><div className="heading-actions"><button className="quiet-button" onClick={() => run.refetch()}><RefreshCw size={15} />刷新</button>{terminal.includes(run.data.status) && Number(primary.api_errors || 0) > 0 && <button className="quiet-button" onClick={() => retryFailures.mutate()} disabled={retryFailures.isPending}><RotateCcw size={15} />重试失败项</button>}{!terminal.includes(run.data.status) && <button className="danger-button" onClick={() => cancel.mutate()} disabled={cancel.isPending}><Ban size={15} />取消</button>}<button className="icon-button" title="导出 JSONL" onClick={() => downloadExport(runId, "jsonl")}><Download size={17} /></button></div></div>
      {!terminal.includes(run.data.status) && <div className="live-progress"><div className="live-progress-head"><span>任务进度</span><strong>{completed} / {total}</strong></div><div className="progress-track large"><span style={{ width: `${total ? completed / total * 100 : 0}%` }} /></div><small>{run.data.status === "QUEUED" ? "等待 worker 接收" : "逐样本结果正在持久化"}</small></div>}
      {run.data.error_message && <div className="error-banner"><AlertTriangle size={17} /><span>{run.data.error_message}</span></div>}
      {retryFailures.isError && <div className="error-banner"><AlertTriangle size={17} /><span>没有可重试的暂时性失败，或运行状态已变化。</span></div>}
      <div className="tabs"><button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>概览</button><button className={tab === "samples" ? "active" : ""} onClick={() => setTab("samples")}>样本</button><button className={tab === "protocol" ? "active" : ""} onClick={() => setTab("protocol")}>协议</button></div>
      {tab === "overview" && <div className="tab-content"><section className="metric-grid results"><article className="metric-card primary-metric"><div><span>Accuracy</span><strong>{percent(primary.accuracy)}</strong><small>{primary.accuracy_numerator ?? 0} / {primary.accuracy_denominator ?? total}</small></div></article><article className="metric-card"><div><span>Macro F1</span><strong>{percent(primary.macro_f1)}</strong><small>分类标签等权</small></div></article><article className="metric-card"><div><span>API Error</span><strong>{percent(primary.api_error_rate)}</strong><small>{primary.api_errors ?? 0} requests</small></div></article><article className="metric-card"><div><span>Parse Error</span><strong>{percent(primary.parse_error_rate)}</strong><small>{primary.parse_errors ?? 0} outputs</small></div></article></section><div className="results-grid"><section className="section-block"><div className="section-heading"><div><h2>Latency</h2><p>成功 HTTP 响应统计口径</p></div></div><ReactECharts option={latencyChart} style={{ height: 260 }} /></section><section className="section-block"><div className="section-heading"><div><h2>执行摘要</h2><p>冻结参数与 token usage</p></div></div><dl className="summary-list"><div><dt>总样本</dt><dd>{primary.total_samples ?? total}</dd></div><div><dt>有效响应</dt><dd>{primary.valid_responses ?? "—"}</dd></div><div><dt>评分成功</dt><dd>{primary.scored_samples ?? "—"}</dd></div><div><dt>Prompt tokens</dt><dd>{primary.prompt_tokens ?? "—"}</dd></div><div><dt>Completion tokens</dt><dd>{primary.completion_tokens ?? "—"}</dd></div><div><dt>P95 latency</dt><dd>{number(primary.latency_success_p95_ms, " ms")}</dd></div></dl></section></div>{grouped.length > 0 && <section className="section-block"><div className="section-heading"><div><h2>分组指标</h2><p>按数据集 manifest 中声明的字段聚合</p></div></div><div className="table-wrap"><table><thead><tr><th>字段</th><th>值</th><th>Accuracy</th><th>Macro F1</th><th>样本</th><th>API Error</th></tr></thead><tbody>{grouped.map((group) => <tr key={`${group.group_key}:${group.group_value}`}><td><code>{group.group_key}</code></td><td>{group.group_value}</td><td>{percent(group.metrics.accuracy)}</td><td>{percent(group.metrics.macro_f1)}</td><td>{group.metrics.total_samples ?? "—"}</td><td>{group.metrics.api_errors ?? 0}</td></tr>)}</tbody></table></div></section>}<section className="section-block"><div className="section-heading"><div><h2>失败样本</h2><p>模型错误、解析失败和 API 异常分开显示</p></div><button className="text-link button-link" onClick={() => { setTab("samples"); setSampleFilter("FAILED"); }}>查看全部 <ExternalLink size={14} /></button></div><SampleTable samples={samples.data?.filter((sample) => sample.passed === false || sample.error_type || sample.status === "PARSE_ERROR").slice(0, 8) || []} onSelect={setSelectedSample} /></section></div>}
      {tab === "samples" && <div className="tab-content"><div className="filterbar"><div className="segmented">{["ALL", "SUCCEEDED", "FAILED", "API_ERROR", "PARSE_ERROR"].map((value) => <button key={value} className={sampleFilter === value ? "active" : ""} onClick={() => setSampleFilter(value)}>{value}</button>)}</div><button className="quiet-button" onClick={() => downloadExport(runId, "csv")}><Download size={15} />CSV</button></div><section className="section-block"><SampleTable samples={samples.data || []} onSelect={setSelectedSample} /></section></div>}
      {tab === "protocol" && <div className="tab-content protocol-layout"><section className="section-block"><div className="section-heading"><div><h2>协议指纹</h2><p>仅 fingerprint 一致的运行默认可比较</p></div></div><code className="fingerprint">{run.data.protocol_fingerprint}</code><pre>{JSON.stringify(run.data.run_spec_json, null, 2)}</pre></section></div>}
      {selectedSample && <div className="sample-panel-backdrop" onClick={() => setSelectedSample(null)}><aside className="sample-panel" onClick={(event) => event.stopPropagation()}><header><div><small>Sample</small><h2>{selectedSample.sample_id}</h2></div><button className="quiet-button" onClick={() => setSelectedSample(null)}>关闭</button></header><dl className="summary-list"><div><dt>状态</dt><dd><StatusBadge status={selectedSample.status} /></dd></div><div><dt>Reference</dt><dd>{String(selectedSample.reference_json)}</dd></div><div><dt>Prediction</dt><dd>{String(selectedSample.parsed_value_json ?? "—")}</dd></div><div><dt>Latency</dt><dd>{number(selectedSample.latency_ms, " ms")}</dd></div><div><dt>Error</dt><dd>{selectedSample.error_type || selectedSample.score_reason || "—"}</dd></div></dl><h3>输入</h3><pre>{JSON.stringify(selectedSample.inputs_json, null, 2)}</pre><h3>原始输出</h3><pre>{selectedSample.output_text || "—"}</pre><h3>渲染请求</h3><pre>{JSON.stringify(selectedSample.rendered_request_json, null, 2)}</pre></aside></div>}
    </div>
  );
}

function SampleTable({ samples, onSelect }: { samples: SampleExecution[]; onSelect: (sample: SampleExecution) => void }) {
  if (!samples.length) return <EmptyState icon={CheckCircle2} title="暂无匹配样本" detail="当前筛选条件下没有逐样本记录。" />;
  return <div className="table-wrap"><table><thead><tr><th>Sample ID</th><th>Reference</th><th>Prediction</th><th>Score</th><th>Latency</th><th>状态</th></tr></thead><tbody>{samples.map((sample) => <tr key={sample.id} className="clickable-row" onClick={() => onSelect(sample)}><td><code>{sample.sample_id}</code></td><td>{String(sample.reference_json)}</td><td className="output-cell">{sample.output_text || "—"}</td><td>{sample.primary_score == null ? "—" : sample.primary_score.toFixed(0)}</td><td>{number(sample.latency_ms, " ms")}</td><td><StatusBadge status={sample.status} /></td></tr>)}</tbody></table></div>;
}
