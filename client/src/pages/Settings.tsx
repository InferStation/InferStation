import { useEffect, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { enable as enableAutostart, disable as disableAutostart, isEnabled as isAutostartEnabled }
  from '@tauri-apps/plugin-autostart';
import { api, Settings as S } from '../api';

export default function SettingsPage() {
  const [s, setS] = useState<S>({});
  const [err, setErr] = useState<string | null>(null);
  const [autostart, setAutostart] = useState(false);

  useEffect(() => {
    api.getSettings().then(setS).catch((e) => setErr(String(e)));
    isAutostartEnabled().then(setAutostart).catch(() => {});
  }, []);

  const save = async () => {
    try { setS(await api.updateSettings(s)); }
    catch (e: any) { setErr(String(e)); }
  };

  const pick = async (key: keyof S, dir: boolean) => {
    const sel = await openDialog({ directory: dir, multiple: false });
    if (typeof sel === 'string') setS({ ...s, [key]: sel });
  };

  const toggleAutostart = async () => {
    try {
      if (autostart) { await disableAutostart(); setAutostart(false); }
      else { await enableAutostart(); setAutostart(true); }
    } catch (e: any) { setErr(String(e)); }
  };

  return (
    <div className="page">
      <h2>设置</h2>
      {err && <p className="err">{err}</p>}
      <div className="form">
        <label>Gateway HTTP Base URL</label>
        <input value={s.gateway_http || ''} onChange={(e) => setS({ ...s, gateway_http: e.target.value })} placeholder="https://tianshu-gateway.cloud" />

        <label>Gateway WSS URL</label>
        <input value={s.gateway_wss || ''} onChange={(e) => setS({ ...s, gateway_wss: e.target.value })} placeholder="wss://tianshu-gateway.cloud/ws/tunnel" />

        <label>tunnel_client.py 路径</label>
        <div className="row">
          <input value={s.tunnel_client_py || ''} onChange={(e) => setS({ ...s, tunnel_client_py: e.target.value })} />
          <button className="btn" onClick={() => pick('tunnel_client_py', false)}>选择</button>
        </div>

        <label>vLLM 可执行</label>
        <div className="row">
          <input value={s.vllm_exe || ''} onChange={(e) => setS({ ...s, vllm_exe: e.target.value })} />
          <button className="btn" onClick={() => pick('vllm_exe', false)}>选择</button>
        </div>

        <label>llama.cpp server 可执行</label>
        <div className="row">
          <input value={s.llama_server_exe || ''} onChange={(e) => setS({ ...s, llama_server_exe: e.target.value })} />
          <button className="btn" onClick={() => pick('llama_server_exe', false)}>选择</button>
        </div>

        <label>模型根目录</label>
        <div className="row">
          <input value={s.models_dir || ''} onChange={(e) => setS({ ...s, models_dir: e.target.value })} />
          <button className="btn" onClick={() => pick('models_dir', true)}>选择</button>
        </div>

        <label>日志目录</label>
        <div className="row">
          <input value={s.logs_dir || ''} onChange={(e) => setS({ ...s, logs_dir: e.target.value })} />
          <button className="btn" onClick={() => pick('logs_dir', true)}>选择</button>
        </div>

        <label className="checkbox">
          <input type="checkbox" checked={autostart} onChange={toggleAutostart} /> 开机自启动 (最小化到托盘)
        </label>

        <div className="actions">
          <button className="btn btn-primary" onClick={save}>保存</button>
        </div>

        <hr />
        <p className="hint">已登录用户: <b>{s.username || '(未登录)'}</b> {s.role ? `(${s.role})` : ''}</p>
      </div>
    </div>
  );
}
