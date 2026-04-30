import { useEffect, useState } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { api, LocalModel, DownloadProgress, DownloadRequest } from '../api';

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(2)} ${u[i]}`;
}

export default function Models() {
  const [root, setRoot] = useState<string>('');
  const [items, setItems] = useState<LocalModel[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [repoId, setRepoId] = useState('');
  const [revision, setRevision] = useState('main');
  const [filesText, setFilesText] = useState('');
  const [source, setSource] = useState<'HuggingFace' | 'ModelScope'>('HuggingFace');
  const [token, setToken] = useState('');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

  const loadRoot = async () => {
    try {
      const s = await api.getSettings();
      if (s.models_dir) {
        setRoot(s.models_dir);
        setItems(await api.localModelsList(s.models_dir));
      }
    } catch (e: any) { setErr(String(e)); }
  };

  useEffect(() => {
    loadRoot();
    let un: UnlistenFn | null = null;
    listen<DownloadProgress>('model-download', (e) => setProgress(e.payload)).then((u) => (un = u));
    return () => { if (un) un(); };
  }, []);

  const pickRoot = async () => {
    const sel = await openDialog({ directory: true, multiple: false });
    if (typeof sel === 'string') {
      await api.updateSettings({ models_dir: sel });
      setRoot(sel);
      setItems(await api.localModelsList(sel));
    }
  };

  const refresh = async () => {
    if (!root) return;
    setItems(await api.localModelsList(root));
  };

  const remove = async (m: LocalModel) => {
    if (!confirm(`删除 ${m.repo}? 路径: ${m.abs_path}`)) return;
    try { await api.localModelsDelete(m.abs_path); refresh(); }
    catch (e: any) { setErr(String(e)); }
  };

  const startDownload = async () => {
    if (!root) { setErr('请先选择模型根目录'); return; }
    const files = filesText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (files.length === 0) { setErr('至少填一个文件名'); return; }
    const req: DownloadRequest = {
      repo_id: repoId,
      revision,
      files,
      dest_root: root,
      source,
      token: token || null,
    };
    setProgress(null);
    setShowForm(false);
    try {
      await api.modelsDownload(req);
      refresh();
    } catch (e: any) { setErr(String(e)); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>本地模型</h2>
        <div className="actions">
          <button className="btn" onClick={pickRoot}>选择根目录</button>
          <button className="btn" onClick={refresh} disabled={!root}>刷新</button>
          <button className="btn btn-primary" onClick={() => setShowForm(true)} disabled={!root}>+ 下载模型</button>
        </div>
      </div>
      {err && <p className="err">{err}</p>}
      <p className="hint">根目录: <span className="mono">{root || '(未设置)'}</span></p>

      {progress && (
        <div className="progress-box">
          <div>{progress.repo_id} → {progress.file}</div>
          <div className="mono small">
            {fmtBytes(progress.downloaded)}{progress.total ? ` / ${fmtBytes(progress.total)}` : ''}
            {progress.done ? ' ✔' : ''}
            {progress.error ? ` ✗ ${progress.error}` : ''}
          </div>
        </div>
      )}

      <table className="table">
        <thead><tr><th>仓库</th><th>路径</th><th>大小</th><th>文件数</th><th>操作</th></tr></thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.abs_path}>
              <td>{m.repo}</td>
              <td className="mono small">{m.abs_path}</td>
              <td>{fmtBytes(m.size_bytes)}</td>
              <td>{m.file_count}</td>
              <td><button className="btn btn-danger" onClick={() => remove(m)}>删除</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      {showForm && (
        <div className="modal-bg" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>下载模型</h3>
            <div className="form">
              <label>来源</label>
              <select value={source} onChange={(e) => setSource(e.target.value as any)}>
                <option value="HuggingFace">Hugging Face</option>
                <option value="ModelScope">ModelScope</option>
              </select>
              <label>仓库 ID</label>
              <input value={repoId} onChange={(e) => setRepoId(e.target.value)} placeholder="Qwen/Qwen3-8B" />
              <label>Revision</label>
              <input value={revision} onChange={(e) => setRevision(e.target.value)} />
              <label>文件列表 (一行一个)</label>
              <textarea rows={5} value={filesText} onChange={(e) => setFilesText(e.target.value)}
                placeholder="config.json&#10;tokenizer.json&#10;model.safetensors" />
              <label>访问 Token (可选)</label>
              <input value={token} onChange={(e) => setToken(e.target.value)} type="password" />
              <div className="modal-actions">
                <button className="btn" onClick={() => setShowForm(false)}>取消</button>
                <button className="btn btn-primary" onClick={startDownload} disabled={!repoId}>开始下载</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
