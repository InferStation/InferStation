import { useEffect, useState } from 'react';
import { api, EngineConfig, EngineStatus, EngineKind } from '../api';

export default function Engines() {
  const [list, setList] = useState<EngineStatus[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [logTail, setLogTail] = useState<{ name: string; text: string } | null>(null);

  // form
  const [name, setName] = useState('');
  const [kind, setKind] = useState<EngineKind>('Vllm');
  const [program, setProgram] = useState('');
  const [argLine, setArgLine] = useState('');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState(8000);

  const load = async () => {
    try { setList(await api.enginesList()); setErr(null); }
    catch (e: any) { setErr(String(e)); }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const start = async () => {
    try {
      const cfg: EngineConfig = {
        name,
        kind,
        program,
        args: argLine.split(/\s+/).filter(Boolean),
        cwd: null,
        env: [],
        host,
        port,
      };
      await api.enginesStart(cfg);
      setShowForm(false);
      load();
    } catch (e: any) { setErr(String(e)); }
  };

  const stop = async (n: string) => {
    if (!confirm(`停止引擎 ${n}?`)) return;
    try { await api.enginesStop(n); load(); }
    catch (e: any) { setErr(String(e)); }
  };

  const tail = async (n: string) => {
    try {
      const text = await api.enginesTailLog(n, 200);
      setLogTail({ name: n, text });
    } catch (e: any) { setErr(String(e)); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>推理引擎</h2>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ 启动引擎</button>
      </div>
      {err && <p className="err">{err}</p>}
      <table className="table">
        <thead><tr><th>名称</th><th>状态</th><th>PID</th><th>启动时间</th><th>操作</th></tr></thead>
        <tbody>
          {list.map((e) => (
            <tr key={e.name}>
              <td>{e.name}</td>
              <td>{e.running ? <span className="badge badge-online">运行中</span> : <span className="badge badge-offline">已停止</span>}</td>
              <td>{e.pid ?? '-'}</td>
              <td>{e.last_started_at ?? '-'}</td>
              <td className="actions">
                <button className="btn" onClick={() => tail(e.name)}>查看日志</button>
                <button className="btn btn-danger" onClick={() => stop(e.name)}>停止</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showForm && (
        <div className="modal-bg" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>启动新引擎</h3>
            <div className="form">
              <label>名称</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="qwen36-awq-6-7" />
              <label>类型</label>
              <select value={kind} onChange={(e) => setKind(e.target.value as EngineKind)}>
                <option value="Vllm">vLLM</option>
                <option value="LlamaCpp">llama.cpp</option>
                <option value="Custom">Custom</option>
              </select>
              <label>可执行文件路径</label>
              <input value={program} onChange={(e) => setProgram(e.target.value)} placeholder="/usr/bin/vllm 或 C:\\path\\llama-server.exe" />
              <label>启动参数 (空格分隔)</label>
              <textarea rows={3} value={argLine} onChange={(e) => setArgLine(e.target.value)}
                placeholder="serve /models/Qwen/Qwen3-8B --host 0.0.0.0 --port 8000 --tensor-parallel-size 1" />
              <div className="row3">
                <div><label>Host</label><input value={host} onChange={(e) => setHost(e.target.value)} /></div>
                <div><label>Port</label><input type="number" value={port} onChange={(e) => setPort(parseInt(e.target.value))} /></div>
                <div></div>
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={() => setShowForm(false)}>取消</button>
                <button className="btn btn-primary" onClick={start} disabled={!name || !program}>启动</button>
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
