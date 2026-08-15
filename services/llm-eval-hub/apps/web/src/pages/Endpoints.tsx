import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pencil, Plus, Radar, Server, Trash2, X } from "lucide-react";
import { useState } from "react";
import { api } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
import type { Endpoint, Model } from "../types";

interface EndpointConfigForm {
  name: string;
  base_url: string;
  auth_type: "bearer" | "api-key-header" | "none";
  api_key: string;
  concurrency_limit: number;
  qps_limit: number;
}

interface EndpointForm extends EndpointConfigForm {
  model_name: string;
}

interface ProbeResponse {
  status: string;
  error_type?: string | null;
  error_message?: string | null;
}

interface ProbeVariables {
  id: string;
  modelId?: string;
}

const initialForm: EndpointForm = {
  name: "",
  base_url: "",
  model_name: "",
  auth_type: "bearer",
  api_key: "",
  concurrency_limit: 8,
  qps_limit: 10,
};

const initialEditForm: EndpointConfigForm = {
  name: "",
  base_url: "",
  auth_type: "bearer",
  api_key: "",
  concurrency_limit: 8,
  qps_limit: 10,
};

export function Endpoints() {
  const client = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [addModelOpen, setAddModelOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Endpoint | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Endpoint | null>(null);
  const [form, setForm] = useState(initialForm);
  const [editForm, setEditForm] = useState(initialEditForm);
  const [modelName, setModelName] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [probeNotice, setProbeNotice] = useState<{ endpointId: string; message: string } | null>(null);
  const endpoints = useQuery({ queryKey: ["endpoints"], queryFn: () => api<Endpoint[]>("/endpoints") });
  const models = useQuery({ queryKey: ["endpoint-models", expanded], queryFn: () => api<Model[]>(`/endpoints/${expanded}/models`), enabled: Boolean(expanded) });

  const probe = useMutation({
    mutationFn: ({ id, modelId }: ProbeVariables) => api<ProbeResponse>(`/endpoints/${id}/probe`, { method: "POST", body: JSON.stringify({ model_id: modelId || null }) }),
    onSuccess: (result, variables) => {
      setExpanded(variables.id);
      setProbeNotice(result.status === "healthy" ? null : { endpointId: variables.id, message: result.error_message || result.error_type || "Endpoint 探测失败" });
      client.invalidateQueries({ queryKey: ["endpoints"] });
      client.invalidateQueries({ queryKey: ["endpoint-models", variables.id] });
    },
    onError: (error, variables) => {
      setExpanded(variables.id);
      setProbeNotice({ endpointId: variables.id, message: error.message });
    },
  });

  const create = useMutation({
    mutationFn: (payload: EndpointForm) => api<Endpoint>("/endpoints", { method: "POST", body: JSON.stringify({ ...payload, model_name: payload.model_name || null, api_key: payload.api_key || null }) }),
    onSuccess: (endpoint, payload) => {
      client.invalidateQueries({ queryKey: ["endpoints"] });
      setCreateOpen(false);
      setForm(initialForm);
      setExpanded(endpoint.id);
      probe.mutate({ id: endpoint.id, modelId: payload.model_name || undefined });
    },
  });

  const edit = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: EndpointConfigForm }) => {
      const { api_key, ...settings } = payload;
      return api<Endpoint>(`/endpoints/${id}`, {
        method: "PATCH",
        body: JSON.stringify(api_key ? { ...settings, api_key } : settings),
      });
    },
    onSuccess: (endpoint) => {
      client.invalidateQueries({ queryKey: ["endpoints"] });
      setEditTarget(null);
      setEditForm(initialEditForm);
      setExpanded(endpoint.id);
      probe.mutate({ id: endpoint.id });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/endpoints/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      client.invalidateQueries({ queryKey: ["endpoints"] });
      client.removeQueries({ queryKey: ["endpoint-models", id] });
      if (expanded === id) setExpanded(null);
      setDeleteTarget(null);
    },
  });

  const openEdit = (endpoint: Endpoint) => {
    edit.reset();
    setEditForm({
      name: endpoint.name,
      base_url: endpoint.base_url,
      auth_type: endpoint.auth_type as EndpointConfigForm["auth_type"],
      api_key: "",
      concurrency_limit: endpoint.concurrency_limit,
      qps_limit: endpoint.qps_limit,
    });
    setEditTarget(endpoint);
  };

  const openDelete = (endpoint: Endpoint) => {
    remove.reset();
    setDeleteTarget(endpoint);
  };

  const addModel = useMutation({
    mutationFn: () => {
      if (!expanded) throw new Error("请先选择 Endpoint");
      return api<Model>(`/endpoints/${expanded}/models`, { method: "POST", body: JSON.stringify({ model_name: modelName }) });
    },
    onSuccess: (model) => {
      client.invalidateQueries({ queryKey: ["endpoint-models", model.endpoint_id] });
      setAddModelOpen(false);
      setModelName("");
      probe.mutate({ id: model.endpoint_id, modelId: model.model_name });
    },
  });

  return (
    <div className="page">
      <div className="page-heading"><div><p className="eyebrow">Registry</p><h1>Endpoints</h1><p>登记、探测并管理 OpenAI-compatible 模型服务。</p></div><button className="primary-button" onClick={() => setCreateOpen(true)}><Plus size={16} />登记 Endpoint</button></div>
      <section className="section-block">
        {endpoints.data?.length ? <div className="table-wrap"><table><thead><tr><th>名称</th><th>Base URL</th><th>认证</th><th>能力</th><th>状态</th><th className="actions-column">操作</th></tr></thead><tbody>
          {endpoints.data.map((endpoint) => <tr key={endpoint.id} className={expanded === endpoint.id ? "selected-row" : ""}><td><button className="strong-link button-link" onClick={() => setExpanded(expanded === endpoint.id ? null : endpoint.id)}>{endpoint.name}</button><small className="table-sub">owner: {endpoint.owner}</small></td><td><code title={endpoint.base_url}>{endpoint.base_url}</code></td><td>{endpoint.auth_type}<small className="table-sub">{endpoint.api_key_configured ? `••••${endpoint.secret_hint}` : "无密钥"}</small></td><td><div className="capability-list"><span className={endpoint.capability?.chat_completions ? "cap-on" : "cap-off"}>{endpoint.capability?.chat_completions ? <Check size={12} /> : <X size={12} />} chat</span><span className={endpoint.capability?.usage ? "cap-on" : "cap-off"}>{endpoint.capability?.usage ? <Check size={12} /> : <X size={12} />} usage</span></div></td><td><StatusBadge status={endpoint.status} /></td><td className="actions-column"><div className="endpoint-actions"><button className="icon-button" title="编辑 Endpoint" aria-label={`编辑 ${endpoint.name}`} onClick={() => openEdit(endpoint)}><Pencil size={16} /></button><button className="icon-button" title="执行能力探测" aria-label={`探测 ${endpoint.name}`} onClick={() => probe.mutate({ id: endpoint.id })} disabled={probe.isPending}>{probe.isPending && probe.variables?.id === endpoint.id ? <Loader2 className="spin" size={17} /> : <Radar size={17} />}</button><button className="icon-button danger-icon" title="删除 Endpoint" aria-label={`删除 ${endpoint.name}`} onClick={() => openDelete(endpoint)}><Trash2 size={16} /></button></div></td></tr>)}
        </tbody></table></div> : <EmptyState icon={Server} title="尚未登记 Endpoint" detail="登记一个模型 API，并执行连通性与能力探测。" action={<button className="primary-button" onClick={() => setCreateOpen(true)}><Plus size={16} />登记 Endpoint</button>} />}
        {expanded && <div className="detail-drawer"><div className="section-heading"><div><h3>可用模型</h3><p>发现结果与手工登记模型</p></div><button className="quiet-button" onClick={() => setAddModelOpen(true)}><Plus size={15} />添加模型</button></div>{probeNotice?.endpointId === expanded && <div className="form-error endpoint-probe-error">{probeNotice.message}</div>}{models.isLoading ? <div className="loading-line"><Loader2 className="spin" size={16} />加载中</div> : <div className="model-list">{models.data?.map((model) => <span key={model.id}>{model.model_name}<small>{model.source}</small></span>)}{!models.data?.length && <span className="muted">尚无模型，请手工添加 Model ID 后执行探测。</span>}</div>}</div>}
      </section>
      <Modal title="登记 Endpoint" open={createOpen} onClose={() => setCreateOpen(false)}>
        <form className="form-stack" onSubmit={(event) => { event.preventDefault(); create.mutate(form); }}>
          <div className="form-grid"><label>名称<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="MiniCPM-V API" /></label><label>认证方式<select value={form.auth_type} onChange={(e) => setForm({ ...form, auth_type: e.target.value as EndpointForm["auth_type"] })}><option value="bearer">Bearer</option><option value="api-key-header">api-key header</option><option value="none">无认证</option></select></label></div>
          <label>Base URL<input required value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://provider.example/openai/v1" /></label>
          <label>Model ID<input required value={form.model_name} onChange={(e) => setForm({ ...form, model_name: e.target.value })} placeholder="minicpm-v" /></label>
          {form.auth_type !== "none" && <label>API Key<input required type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} autoComplete="new-password" /></label>}
          <div className="form-grid"><label>并发上限<input type="number" min="1" max="256" value={form.concurrency_limit} onChange={(e) => setForm({ ...form, concurrency_limit: Number(e.target.value) })} /></label><label>QPS 上限<input type="number" min="0.1" step="0.1" value={form.qps_limit} onChange={(e) => setForm({ ...form, qps_limit: Number(e.target.value) })} /></label></div>
          {create.error && <div className="form-error">{create.error.message}</div>}
          <div className="form-actions"><button className="quiet-button" type="button" onClick={() => setCreateOpen(false)}>取消</button><button className="primary-button" disabled={create.isPending}>{create.isPending && <Loader2 className="spin" size={15} />}保存并探测</button></div>
        </form>
      </Modal>
      <Modal title={`编辑 Endpoint · ${editTarget?.name || ""}`} open={Boolean(editTarget)} onClose={() => setEditTarget(null)}>
        <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (editTarget) edit.mutate({ id: editTarget.id, payload: editForm }); }}>
          <div className="form-grid"><label>名称<input required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></label><label>认证方式<select value={editForm.auth_type} onChange={(e) => setEditForm({ ...editForm, auth_type: e.target.value as EndpointConfigForm["auth_type"] })}><option value="bearer">Bearer</option><option value="api-key-header">api-key header</option><option value="none">无认证</option></select></label></div>
          <label>Base URL<input required value={editForm.base_url} onChange={(e) => setEditForm({ ...editForm, base_url: e.target.value })} /></label>
          {editForm.auth_type !== "none" && <label>新 API Key（留空则保持不变）<input type="password" value={editForm.api_key} onChange={(e) => setEditForm({ ...editForm, api_key: e.target.value })} autoComplete="new-password" placeholder={editTarget?.api_key_configured ? "已配置，留空保持不变" : "输入 API Key"} /></label>}
          <div className="form-grid"><label>并发上限<input type="number" min="1" max="256" value={editForm.concurrency_limit} onChange={(e) => setEditForm({ ...editForm, concurrency_limit: Number(e.target.value) })} /></label><label>QPS 上限<input type="number" min="0.1" max="1000" step="0.1" value={editForm.qps_limit} onChange={(e) => setEditForm({ ...editForm, qps_limit: Number(e.target.value) })} /></label></div>
          {edit.error && <div className="form-error">{edit.error.message}</div>}
          <div className="form-actions"><button className="quiet-button" type="button" onClick={() => setEditTarget(null)}>取消</button><button className="primary-button" disabled={edit.isPending}>{edit.isPending && <Loader2 className="spin" size={15} />}保存并重新探测</button></div>
        </form>
      </Modal>
      <Modal title="删除 Endpoint" open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}>
        <div className="form-stack">
          <p className="delete-copy">确定永久删除 <strong>{deleteTarget?.name}</strong>？其密钥、配置版本和模型登记会一起删除。已被历史评测引用时，系统会阻止此操作。</p>
          {remove.error && <div className="form-error">{remove.error.message}</div>}
          <div className="form-actions"><button className="quiet-button" type="button" onClick={() => setDeleteTarget(null)}>取消</button><button className="danger-button" type="button" disabled={remove.isPending} onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}>{remove.isPending && <Loader2 className="spin" size={15} />}永久删除</button></div>
        </div>
      </Modal>
      <Modal title="添加模型" open={addModelOpen} onClose={() => setAddModelOpen(false)}>
        <form className="form-stack" onSubmit={(event) => { event.preventDefault(); addModel.mutate(); }}>
          <label>Model ID<input required value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder="minicpm-v" /></label>
          {addModel.error && <div className="form-error">{addModel.error.message}</div>}
          <div className="form-actions"><button className="quiet-button" type="button" onClick={() => setAddModelOpen(false)}>取消</button><button className="primary-button" disabled={addModel.isPending}>{addModel.isPending && <Loader2 className="spin" size={15} />}添加并探测</button></div>
        </form>
      </Modal>
    </div>
  );
}
