import { useQuery } from "@tanstack/react-query";
import { Activity, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { StatusBadge } from "../components/StatusBadge";
import type { Run } from "../types";

const statuses = ["ALL", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"];

export function Runs() {
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const runs = useQuery({ queryKey: ["runs", filter], queryFn: () => api<Run[]>(`/runs?limit=100${filter === "ALL" ? "" : `&status=${filter}`}`), refetchInterval: 5000 });
  const visible = runs.data?.filter((run) => run.name.toLowerCase().includes(search.toLowerCase())) || [];
  return (
    <div className="page">
      <div className="page-heading"><div><p className="eyebrow">History</p><h1>运行记录</h1><p>冻结配置、执行状态与协议指纹。</p></div><Link className="primary-button" to="/evaluations/new">新建测评</Link></div>
      <div className="filterbar"><div className="segmented">{statuses.map((status) => <button key={status} className={filter === status ? "active" : ""} onClick={() => setFilter(status)}>{status === "ALL" ? "全部" : status}</button>)}</div><label className="search-field"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索运行名称" /></label></div>
      <section className="section-block">{visible.length ? <div className="table-wrap"><table><thead><tr><th>运行</th><th>模型</th><th>数据集</th><th>进度</th><th>状态</th><th>创建者</th><th>时间</th></tr></thead><tbody>{visible.map((run) => { const total = run.datasets.reduce((sum, item) => sum + item.total_samples, 0); const completed = run.datasets.reduce((sum, item) => sum + item.completed_samples, 0); return <tr key={run.id}><td><Link className="strong-link" to={`/runs/${run.id}`}>{run.name}</Link><small className="table-sub mono">{run.protocol_fingerprint.slice(0, 12)}</small></td><td>{run.run_spec_json.model_name}</td><td>{run.datasets.length}</td><td><div className="progress-cell"><div className="progress-track"><span style={{ width: `${total ? completed / total * 100 : 0}%` }} /></div><small>{completed}/{total}</small></div></td><td><StatusBadge status={run.status} /></td><td>{run.created_by}</td><td>{new Date(run.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td></tr>; })}</tbody></table></div> : <EmptyState icon={Activity} title="没有匹配的运行" detail="调整筛选条件或创建一个新测评。" />}</section>
    </div>
  );
}
