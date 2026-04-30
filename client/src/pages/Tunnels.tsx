import { useEffect, useState } from 'react';
import { api, TunnelStatus, Backend } from '../api';

export default function Tunnels() {
  const [list, setList] = useState<TunnelStatus[]>([]);
  const [backends, setBackends] = useState<Backend[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [logTail, setLogTail] = useState<{ name: string; text: string } | null>(null);

  // form
  const [bname, setBname] = useState('');
  const [token, setToken] = useState('');
  const [localUrl, setLocalUrl] = useState('http://localhost:8000');

  const load = async () => {
    try {
      setList(await api.tunnelsList());
      setBackends(await api.backendsList(true));
      setErr(null);
    } catch (e: any) { setErr(String(e)); }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const start = async () => {
    try {
      await api.tunnelsStart({
        backend_name: bname,
        token,
        local_url: localUrl,
        gateway: null,
        tunnel_client_py: null,
        stall_secs: null,
      });
      setShowForm(false);
      load();
    } catch (e: any) { setErr(String(e)); }
  };

  const stop = async (name: string) => {
    if (!confirm(`停止通道 ${name}?`)) return;
    try { await api.tunnelsStop(name); load(); }
    catch (e: any) { setErr(String(e)); }
  };

  const tail = async (name: string) => {
    try {
      const text = await api.tunnelsTailLog(name, 200);
      setLogTail({ name, text });
    } catch (e: any) { setErr(String(e)); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>通道</h2>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ 启动新通道</button>
      </div>
      {err && <p className="err">{err}</p>}
      <table className="table">
        <thead><tr>
          <th>后端</th><th>状态</th><th>PID</th><th>启动时间</th><th>重启次数</th><th>最近日志</th><th>操作</th>
        </tr></thead>
        <tbody>
          {list.map((t) => (
            <tr key={t.backend_name}>
              <td>{t.backend_name}</td>
              <td>{t.running ? <span className="badge badge-online">运行中</span> : <span className="badge badge-offline">已停止</span>}</td>
              <td>{t.pid ?? '-'}</td>
              <td>{t.last_started_at ?? '-'}</td>
              <td>{t.restart_count}</td>
              <td className="mono small">{t.last_progress_log ?? '-'}</td>
              <td className="actions">
                <button className="btn" onClick={() => tail(t.backend_name)}>查看日志</button>
                <button className="btn btn-danger" onClick={() => stop(t.backend_name)}>停止</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showForm && (
        <div className="modal-bg" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>启动新通道</h3>
            <div className="form">
              <label>后端名</label>
              <select value={bname} onChange={(e) => setBname(e.target.value)}>
                <option value="">请选择…</option>
                {backends.filter((b) => b.mode === 'tunnel').map((b) => (
                  <option key={b.id} value={b.name}>{b.name}</option>
                ))}
              </select>
              <label>API Key (Bearer token)</label>
              <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="sk-..." />
              <label>本地后端 URL</label>
              <input value={localUrl} onChange={(e) => setLocalUrl(e.target.value)} />
              <div className="modal-actions">
                <button className="btn" onClick={() => setShowForm(false)}>取消</button>
                <button className="btn btn-primary" onClick={start} disabled={!bname || !token}>启动</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {logTail && (
        <div className="modal-bg" onClick={() => setLogTail(null)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>日志: {logTail.name}</h3>
            <pre className="logbox">{logTail.text || '(空)'}</pre>
            <div className="modal-actions">
              <button className="btn" onClick={() => setLogTail(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
