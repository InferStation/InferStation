import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Server, TimerReset } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import type { Endpoint, Run } from "../types";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function Dashboard() {
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api<Run[]>("/runs?limit=8"), refetchInterval: 5000 });
  const endpoints = useQuery({ queryKey: ["endpoints"], queryFn: () => api<Endpoint[]>("/endpoints") });
  const running = runs.data?.filter((run) => ["QUEUED", "PREPARING", "RUNNING", "AGGREGATING"].includes(run.status)).length || 0;
  const healthy = endpoints.data?.filter((endpoint) => endpoint.status === "healthy").length || 0;
  const failed = runs.data?.filter((run) => run.status === "FAILED").length || 0;

  return (
    <div className="page">
      <div className="page-heading">
        <div><p className="eyebrow">工作台</p><h1>质量测评概览</h1><p>Endpoint 健康、任务进度和近期结果。</p></div>
        <Link className="primary-button" to="/evaluations/new">新建测评 <ArrowRight size={16} /></Link>
      </div>
      <section className="metric-grid">
        <article className="metric-card"><span className="metric-icon green"><CheckCircle2 size={18} /></span><div><span>健康 Endpoints</span><strong>{healthy}<small> / {endpoints.data?.length || 0}</small></strong></div></article>
        <article className="metric-card"><span className="metric-icon blue"><TimerReset size={18} /></span><div><span>正在运行</span><strong>{running}</strong></div></article>
        <article className="metric-card"><span className="metric-icon red"><AlertTriangle size={18} /></span><div><span>近期失败</span><strong>{failed}</strong></div></article>
        <article className="metric-card"><span className="metric-icon amber"><Clock3 size={18} /></span><div><span>近期 Runs</span><strong>{runs.data?.length || 0}</strong></div></article>
      </section>
      <section className="section-block">
        <div className="section-heading"><div><h2>近期运行</h2><p>状态每 5 秒刷新</p></div><Link className="text-link" to="/runs">查看全部 <ArrowRight size={14} /></Link></div>
        {runs.data?.length ? (
          <div className="table-wrap"><table><thead><tr><th>运行</th><th>模型</th><th>进度</th><th>状态</th><th>创建时间</th></tr></thead><tbody>
            {runs.data.map((run) => { const total = run.datasets.reduce((sum, item) => sum + item.total_samples, 0); const completed = run.datasets.reduce((sum, item) => sum + item.completed_samples, 0); return (
              <tr key={run.id}><td><Link className="strong-link" to={`/runs/${run.id}`}>{run.name}</Link><small className="table-sub">{run.protocol_fingerprint.slice(0, 10)}</small></td><td>{run.run_spec_json.model_name}</td><td><div className="progress-cell"><div className="progress-track"><span style={{ width: `${total ? (completed / total) * 100 : 0}%` }} /></div><small>{completed}/{total}</small></div></td><td><StatusBadge status={run.status} /></td><td>{formatDate(run.created_at)}</td></tr>
            ); })}
          </tbody></table></div>
        ) : <EmptyState icon={TimerReset} title="暂无运行记录" detail="创建首个测评后，进度和结果会显示在这里。" action={<Link className="primary-button" to="/evaluations/new">新建测评</Link>} />}
      </section>
      <section className="section-block">
        <div className="section-heading"><div><h2>Endpoint 状态</h2><p>最新能力探测结果</p></div><Link className="text-link" to="/endpoints">管理 <ArrowRight size={14} /></Link></div>
        <div className="endpoint-strip">
          {endpoints.data?.map((endpoint) => <article key={endpoint.id}><span className={`health-light ${endpoint.status}`} /><div><strong>{endpoint.name}</strong><small>{endpoint.base_url}</small></div><StatusBadge status={endpoint.status} /></article>)}
          {!endpoints.data?.length && <EmptyState icon={Server} title="尚未登记 Endpoint" detail="登记模型 API 后即可进行能力探测。" />}
        </div>
      </section>
    </div>
  );
}
