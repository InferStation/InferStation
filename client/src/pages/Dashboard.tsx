import { useEffect, useState } from 'react';
import { api, BackendStat } from '../api';

export default function Dashboard() {
  const [stats, setStats] = useState<BackendStat[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setStats(await api.backendsStats());
      setErr(null);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  const totalRevenue = stats.reduce((a, s) => a + (s.revenue_month || 0), 0);
  const totalReq = stats.reduce((a, s) => a + (s.requests_month || 0), 0);
  const onlineCount = stats.filter((s) => s.status === 'online').length;

  return (
    <div className="page">
      <h2>仪表盘</h2>
      {loading && <p>加载中…</p>}
      {err && <p className="err">{err}</p>}
      <div className="cards">
        <div className="card"><div className="card-label">本月收入</div><div className="card-value">¥ {totalRevenue.toFixed(2)}</div></div>
        <div className="card"><div className="card-label">本月请求</div><div className="card-value">{totalReq.toLocaleString()}</div></div>
        <div className="card"><div className="card-label">在线后端</div><div className="card-value">{onlineCount} / {stats.length}</div></div>
      </div>

      <h3>本月明细</h3>
      <table className="table">
        <thead><tr>
          <th>名称</th><th>状态</th><th>主模型</th><th>订阅</th>
          <th>请求</th><th>输入 token</th><th>输出 token</th><th>缓存命中</th><th>收入</th>
        </tr></thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.backend_id}>
              <td>{s.name}</td>
              <td>{s.status}</td>
              <td>{s.model}</td>
              <td>{s.subscriptions}</td>
              <td>{s.requests_month.toLocaleString()}</td>
              <td>{s.input_tokens_month.toLocaleString()}</td>
              <td>{s.output_tokens_month.toLocaleString()}</td>
              <td>{s.cached_tokens_month.toLocaleString()}</td>
              <td>{s.currency} {s.revenue_month.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
