import { useEffect, useState } from 'react';
import { api, Backend, BackendDraft } from '../api';
import StatusBadge from '../components/StatusBadge';

const DEFAULT_DRAFT: BackendDraft = {
  name: '',
  mode: 'tunnel',
  url: null,
  models: [],
  currency: 'CNY',
  input_price: 0,
  output_price: 0,
  cache_price: null,
  is_public: true,
};

export default function Services() {
  const [list, setList] = useState<Backend[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Backend | null>(null);
  const [draft, setDraft] = useState<BackendDraft>(DEFAULT_DRAFT);
  const [modelsText, setModelsText] = useState('');

  const load = async () => {
    try {
      setList(await api.backendsList(true));
      setErr(null);
    } catch (e: any) {
      setErr(String(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setDraft(DEFAULT_DRAFT);
    setModelsText('');
    setShowForm(true);
  };

  const openEdit = (b: Backend) => {
    setEditing(b);
    setDraft({
      name: b.name,
      mode: b.mode,
      url: b.url ?? null,
      models: b.models,
      currency: b.currency,
      input_price: b.input_price,
      output_price: b.output_price,
      cache_price: b.cache_price,
      is_public: !!b.is_public,
      client_info: b.client_info,
      tags: b.tags,
      capabilities: b.capabilities,
    });
    setModelsText(b.models.join('\n'));
    setShowForm(true);
  };

  const save = async () => {
    const payload: BackendDraft = {
      ...draft,
      models: modelsText.split('\n').map((s) => s.trim()).filter(Boolean),
    };
    try {
      if (editing) {
        await api.backendsUpdate(editing.name, payload);
      } else {
        await api.backendsCreate(payload);
      }
      setShowForm(false);
      load();
    } catch (e: any) {
      setErr(String(e));
    }
  };

  const remove = async (b: Backend) => {
    if (!confirm(`确认删除 ${b.name}?`)) return;
    try {
      await api.backendsDelete(b.name);
      load();
    } catch (e: any) {
      setErr(String(e));
    }
  };

  const check = async (b: Backend) => {
    try {
      const r = await api.backendsCheck(b.name);
      alert(JSON.stringify(r, null, 2));
      load();
    } catch (e: any) {
      setErr(String(e));
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>后端服务</h2>
        <button className="btn btn-primary" onClick={openCreate}>+ 注册新后端</button>
      </div>
      {err && <p className="err">{err}</p>}
      <table className="table">
        <thead><tr>
          <th>名称</th><th>模式</th><th>URL</th><th>模型</th><th>计费</th><th>状态</th><th>上架</th><th>操作</th>
        </tr></thead>
        <tbody>
          {list.map((b) => (
            <tr key={b.id}>
              <td>{b.name}</td>
              <td>{b.mode}</td>
              <td className="mono">{b.url || '-'}</td>
              <td className="mono">{b.models.join(', ')}</td>
              <td>{b.currency} {b.input_price}/{b.output_price}{b.cache_price != null ? `/${b.cache_price}` : ''}</td>
              <td><StatusBadge status={b.status} /></td>
              <td>{b.listing_status}</td>
              <td className="actions">
                <button className="btn" onClick={() => check(b)}>体检</button>
                <button className="btn" onClick={() => openEdit(b)}>编辑</button>
                <button className="btn btn-danger" onClick={() => remove(b)}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showForm && (
        <div className="modal-bg" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editing ? `编辑 ${editing.name}` : '注册新后端'}</h3>
            <div className="form">
              <label>名称 (唯一)</label>
              <input value={draft.name} disabled={!!editing} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <label>模式</label>
              <select value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value })}>
                <option value="tunnel">tunnel (内网穿透)</option>
                <option value="direct">direct (公网直连)</option>
              </select>
              {draft.mode === 'direct' && (
                <>
                  <label>后端 URL</label>
                  <input value={draft.url || ''} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="http://..." />
                </>
              )}
              <label>模型列表 (一行一个)</label>
              <textarea rows={4} value={modelsText} onChange={(e) => setModelsText(e.target.value)} />
              <div className="row3">
                <div>
                  <label>币种</label>
                  <select value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })}>
                    <option>CNY</option><option>USD</option>
                  </select>
                </div>
                <div>
                  <label>输入价 / Mtok</label>
                  <input type="number" step="0.001" value={draft.input_price} onChange={(e) => setDraft({ ...draft, input_price: parseFloat(e.target.value) })} />
                </div>
                <div>
                  <label>输出价 / Mtok</label>
                  <input type="number" step="0.001" value={draft.output_price} onChange={(e) => setDraft({ ...draft, output_price: parseFloat(e.target.value) })} />
                </div>
              </div>
              <label>缓存命中价 / Mtok (可空)</label>
              <input type="number" step="0.001" value={draft.cache_price ?? ''} onChange={(e) => setDraft({ ...draft, cache_price: e.target.value === '' ? null : parseFloat(e.target.value) })} />
              <label className="checkbox">
                <input type="checkbox" checked={!!draft.is_public} onChange={(e) => setDraft({ ...draft, is_public: e.target.checked })} /> 公开 (允许其他用户订阅)
              </label>
              <div className="modal-actions">
                <button className="btn" onClick={() => setShowForm(false)}>取消</button>
                <button className="btn btn-primary" onClick={save}>保存</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
