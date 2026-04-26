"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"

interface Backend {
  id: number
  name: string
  url: string | null
  mode: string
  models: string[]
  tags: Record<string, string>
  status: string
  enabled: number
  listing_status?: string | null
  review_note?: string | null
  input_price: number | null
  output_price: number | null
  cache_price: number | null
  currency: string
  is_public: number
  owner_name: string
  updated_at: string
  created_at: string
  client_info?: { model_map?: Record<string, string>; api_key?: string }
}

export default function ServiceDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const name = decodeURIComponent(params.name as string)

  const [backend, setBackend] = useState<Backend | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [families, setFamilies] = useState<string[]>([])
  const [catalog, setCatalog] = useState<Record<string, string[]>>({})

  // Edit state
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editForm, setEditForm] = useState({
    url: "",
    api_key: "",
    api_key_changed: false,
    family: "",
    model: "",
    served_as: "",
    tag_hardware: "",
    tag_framework: "",
    tag_quantization: "",
    input_price: "",
    output_price: "",
    cache_price: "",
    currency: "CNY",
    is_public: true,
  })

  useEffect(() => {
    apiFetch(`/api/backends/${encodeURIComponent(name)}`)
      .then((data: Backend) => {
        setBackend(data)
        populateForm(data)
      })
      .catch(() => setError("后端不存在或无权访问"))
      .finally(() => setLoading(false))
    apiFetch("/api/model-families").then((data: string[] | { families: string[] }) => {
      setFamilies(Array.isArray(data) ? data : data.families)
    }).catch(() => {})
    apiFetch("/api/model-catalog").then((data: Record<string, string[]>) => {
      setCatalog(data || {})
    }).catch(() => {})
  }, [name])

  const populateForm = (b: Backend) => {
    // Infer family from first model (everything before the first "/")
    const firstModel = b.models[0] || ""
    const inferredFamily = firstModel.includes("/") ? firstModel.split("/")[0] : ""
    // Display bare names (strip "family/" prefix) so the user can edit just the names
    const bareNames = b.models.map((m) => m.includes("/") ? m.split("/").slice(1).join("/") : m)
    setEditForm({
      url: b.url || "",
      api_key: "",
      api_key_changed: false,
      family: inferredFamily,
      model: bareNames[0] || "",
      served_as: b.client_info?.model_map?.[b.models[0]] || "",
      tag_hardware: b.tags?.hardware || "",
      tag_framework: b.tags?.framework || "",
      tag_quantization: b.tags?.quantization || "",
      input_price: b.input_price != null ? String(b.input_price) : "",
      output_price: b.output_price != null ? String(b.output_price) : "",
      cache_price: b.cache_price != null ? String(b.cache_price) : "",
      currency: b.currency || "CNY",
      is_public: !!b.is_public,
    })
  }

  const handleSave = async () => {
    if (!backend) return
    if (!editForm.family) {
      alert("请选择模型系列")
      return
    }
    if (!editForm.model) {
      alert("请选择一个模型")
      return
    }
    setSaving(true)
    try {
      const tags: Record<string, string> = {}
      if (editForm.tag_hardware.trim()) tags.hardware = editForm.tag_hardware.trim()
      if (editForm.tag_framework.trim()) tags.framework = editForm.tag_framework.trim()
      if (editForm.tag_quantization.trim()) tags.quantization = editForm.tag_quantization.trim()

      const models = [`${editForm.family}/${editForm.model}`]
      const existingCi = (backend.client_info || {}) as Record<string, unknown>
      const client_info: Record<string, unknown> = { ...existingCi }
      if (editForm.served_as.trim()) {
        client_info.model_map = { [models[0]]: editForm.served_as.trim() }
      } else {
        delete client_info.model_map
      }
      // Only touch api_key if user actually edited the field; otherwise keep existing.
      if (editForm.api_key_changed) {
        const k = editForm.api_key.trim()
        if (k) client_info.api_key = k
        else delete client_info.api_key
      }

      await apiFetch(`/api/backends/${encodeURIComponent(name)}`, {
        method: "PUT",
        body: JSON.stringify({
          url: backend.mode === "direct" ? editForm.url : undefined,
          models,
          tags,
          input_price: editForm.input_price ? parseFloat(editForm.input_price) : undefined,
          output_price: editForm.output_price ? parseFloat(editForm.output_price) : undefined,
          cache_price: editForm.cache_price ? parseFloat(editForm.cache_price) : undefined,
          clear_cache_price: !editForm.cache_price,
          currency: editForm.currency,
          is_public: editForm.is_public,
          client_info,
          clear_price: !editForm.input_price && !editForm.output_price,
        }),
      })
      // Reload
      const data: Backend = await apiFetch(`/api/backends/${encodeURIComponent(name)}`)
      setBackend(data)
      populateForm(data)
      setEditing(false)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async () => {
    if (!backend) return
    try {
      await apiFetch(`/api/backends/${encodeURIComponent(name)}/toggle`, { method: "PUT" })
      const data: Backend = await apiFetch(`/api/backends/${encodeURIComponent(name)}`)
      setBackend(data)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "操作失败")
    }
  }

  const handleDelete = async () => {
    if (!confirm(`确定要删除后端 "${name}" 吗？`)) return
    await apiFetch(`/api/backends/${encodeURIComponent(name)}`, { method: "DELETE" })
    router.push("/dashboard/services")
  }

  if (loading) return <div className="text-center py-20 text-gray-500">加载中...</div>
  if (error || !backend) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 mb-4">{error || "后端不存在"}</p>
        <button onClick={() => router.push("/dashboard/services")} className="text-indigo-600 hover:underline">返回我的服务</button>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={() => router.push("/dashboard/services")} className="text-sm text-gray-500 hover:text-gray-700 mb-6 inline-flex items-center gap-1">
        ← 返回我的服务
      </button>

      {backend.listing_status === "offline" && backend.review_note && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <b>审核驳回：</b>{backend.review_note}
        </div>
      )}
      {backend.listing_status === "pending" && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          上架申请已提交，等待管理员审核。审核通过后自动上架。
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{backend.name}</h1>
            <div className="flex items-center gap-2 mt-2">
              {(() => {
                const st = backend.listing_status || (backend.enabled ? "listed" : "offline")
                const badge = st === "listed"
                  ? { cls: "bg-green-100 text-green-700", label: "已上架" }
                  : st === "pending"
                  ? { cls: "bg-amber-100 text-amber-700", label: "上架审核中" }
                  : { cls: "bg-sky-100 text-sky-700", label: "仅私有" }
                return (
                  <span className={`px-2 py-0.5 rounded text-xs ${badge.cls}`}>{badge.label}</span>
                )
              })()}
              <span className={`px-2 py-0.5 rounded text-xs ${backend.status === "online" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                {backend.status}
              </span>
              <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                {backend.mode === "tunnel" ? "隧道" : "直连"}
              </span>

            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggle}
              className={(() => {
                const st = backend.listing_status || (backend.enabled ? "listed" : "offline")
                if (st === "listed") return "text-sm px-3 py-1.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
                if (st === "pending") return "text-sm px-3 py-1.5 rounded bg-amber-100 text-amber-800 hover:bg-amber-200"
                return "text-sm px-3 py-1.5 rounded bg-green-100 text-green-700 hover:bg-green-200"
              })()}
            >
              {(() => {
                const st = backend.listing_status || (backend.enabled ? "listed" : "offline")
                if (st === "listed") return "下架"
                if (st === "pending") return "撤回申请"
                return "申请上架"
              })()}
            </button>
            {!editing && (
              <button onClick={() => setEditing(true)} className="text-sm px-3 py-1.5 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200">
                编辑
              </button>
            )}
            <button onClick={handleDelete} className="text-sm px-3 py-1.5 rounded text-red-500 hover:bg-red-50">删除</button>
          </div>
        </div>

        {editing ? (
          /* Edit Form */
          <div className="space-y-4">
            {backend.mode === "direct" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">后端 URL</label>
                <input type="url" value={editForm.url} onChange={(e) => setEditForm({ ...editForm, url: e.target.value })} placeholder="http://IP:PORT" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
            )}
            {backend.mode === "direct" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  上游 API Key（可选）
                  <span className="ml-2 text-xs text-gray-500 font-normal">
                    {backend.client_info?.api_key ? "当前状态：已设置" : "当前状态：未设置"}
                  </span>
                </label>
                <input
                  type="password"
                  value={editForm.api_key}
                  onChange={(e) => setEditForm({ ...editForm, api_key: e.target.value, api_key_changed: true })}
                  placeholder={backend.client_info?.api_key ? "保留原值请不要修改；填入新值会覆盖原值" : "如上游需要认证则填入"}
                  autoComplete="new-password"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono"
                />
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-xs text-gray-500">转发时以 <code>Authorization: Bearer &lt;key&gt;</code> 带上。</p>
                  {backend.client_info?.api_key && (
                    <button
                      type="button"
                      onClick={() => setEditForm({ ...editForm, api_key: "", api_key_changed: true })}
                      className="text-xs text-red-600 hover:underline"
                    >清除 API Key</button>
                  )}
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">模型系列</label>
              <select value={editForm.family} onChange={(e) => setEditForm({ ...editForm, family: e.target.value, model: "" })} required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                <option value="">请选择模型系列</option>
                {families.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">模型</label>
              <select
                value={editForm.model}
                onChange={(e) => setEditForm({ ...editForm, model: e.target.value })}
                required
                disabled={!editForm.family}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">{editForm.family ? "请选择模型" : "请先选择模型系列"}</option>
                {(catalog[editForm.family] || []).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              {editForm.family && editForm.model && (
                <p className="mt-1 text-xs text-gray-500">将保存为：{editForm.family}/{editForm.model}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">你的 URL 上的模型名（可选）</label>
              <input
                type="text"
                value={editForm.served_as}
                onChange={(e) => setEditForm({ ...editForm, served_as: e.target.value })}
                placeholder={editForm.model ? `默认用 ${editForm.model}` : "例如 qwen3-8b-awq"}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-500">
                网关转发请求时，会把 OpenAI 请求的 model 字段改为此值再传给你的服务。同一 URL 可用不同后端名注册多个模型。
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">标签</label>
              <div className="grid gap-3 md:grid-cols-3">
                <input type="text" value={editForm.tag_hardware} onChange={(e) => setEditForm({ ...editForm, tag_hardware: e.target.value })} placeholder="硬件，如 MI300X" className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm" />
                <input type="text" value={editForm.tag_framework} onChange={(e) => setEditForm({ ...editForm, tag_framework: e.target.value })} placeholder="框架，如 vLLM" className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm" />
                <input type="text" value={editForm.tag_quantization} onChange={(e) => setEditForm({ ...editForm, tag_quantization: e.target.value })} placeholder="量化，如 AWQ / FP16" className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm" />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">货币</label>
                <select value={editForm.currency} onChange={(e) => setEditForm({ ...editForm, currency: e.target.value })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                  <option value="CNY">CNY (¥)</option>
                  <option value="USD">USD ($)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">输入定价（{editForm.currency === "USD" ? "$" : "¥"}/百万token）</label>
                <input type="number" step="0.01" value={editForm.input_price} onChange={(e) => setEditForm({ ...editForm, input_price: e.target.value })} placeholder="留空为免费" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">输出定价（{editForm.currency === "USD" ? "$" : "¥"}/百万token）</label>
                <input type="number" step="0.01" value={editForm.output_price} onChange={(e) => setEditForm({ ...editForm, output_price: e.target.value })} placeholder="留空为免费" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">缓存命中定价（{editForm.currency === "USD" ? "$" : "¥"}/百万token）</label>
                <input type="number" step="0.01" value={editForm.cache_price} onChange={(e) => setEditForm({ ...editForm, cache_price: e.target.value })} placeholder="留空=输入价×10%" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
            </div>
            <p className="text-xs text-gray-500 -mt-2">缓存命中部分按缓存价计费；留空时按输入价×10%（行业通行折扣）计费。</p>
            <div className="flex items-center">
              <input type="checkbox" checked={editForm.is_public} onChange={(e) => setEditForm({ ...editForm, is_public: e.target.checked })} className="mr-2" />
              <span className="text-sm text-gray-600">公开可见（所有用户可调用）</span>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving} className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? "保存中..." : "保存"}
              </button>
              <button onClick={() => { setEditing(false); populateForm(backend) }} className="px-6 py-2 rounded-lg border hover:bg-gray-50">取消</button>
            </div>
          </div>
        ) : (
          /* Detail View */
          <div className="space-y-6">
            {/* Info Grid */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              {backend.mode === "direct" && backend.url && (
                <div className="bg-gray-50 rounded-lg p-4 col-span-2">
                  <p className="text-gray-500 mb-1">后端 URL</p>
                  <p className="font-medium text-gray-900 font-mono">{backend.url}</p>
                </div>
              )}
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-gray-500 mb-1">创建时间</p>
                <p className="font-medium text-gray-900">{backend.created_at}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-gray-500 mb-1">更新时间</p>
                <p className="font-medium text-gray-900">{backend.updated_at}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-gray-500 mb-1">公开</p>
                <p className="font-medium text-gray-900">{backend.is_public ? "是" : "否"}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-gray-500 mb-1">定价</p>
                <p className="font-medium text-gray-900">
                  {backend.input_price == null && backend.output_price == null ? (
                    "未设置"
                  ) : backend.input_price === 0 && backend.output_price === 0 ? (
                    <span className="text-green-600">Free</span>
                  ) : (
                    <>{backend.currency === "USD" ? "$" : "¥"}{backend.input_price}/M 输入 / {backend.currency === "USD" ? "$" : "¥"}{backend.output_price}/M 输出 / {backend.cache_price != null ? `${backend.currency === "USD" ? "$" : "¥"}${backend.cache_price}/M 缓存` : `缓存默认按输入价×10%`} <span className="text-xs text-gray-500">({backend.currency || "CNY"})</span></>
                  )}
                </p>
              </div>
            </div>

            {/* Tags */}
            {Object.keys(backend.tags || {}).length > 0 && (
              <div>
                <p className="text-sm text-gray-500 mb-2">标签</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(backend.tags).map(([k, v]) => (
                    <span key={k} className="inline-flex items-center px-2.5 py-1 rounded text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Models */}
            <div>
              <p className="text-sm text-gray-500 mb-2">模型列表</p>
              <div className="space-y-2">
                {backend.models.length > 0 ? backend.models.map((m) => (
                  <Link
                    key={m}
                    href={`/models/${encodeURIComponent(m)}?backend_id=${backend.id}`}
                    className="block bg-gray-50 rounded-lg p-3 hover:bg-indigo-50 transition-colors text-sm font-medium text-indigo-700 hover:text-indigo-800"
                  >
                    {m} →
                  </Link>
                )) : (
                  <p className="text-sm text-gray-400">暂无模型</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
