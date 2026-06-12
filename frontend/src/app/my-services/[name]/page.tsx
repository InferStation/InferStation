"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"
import { useT } from "@/context/LocaleContext"
import { tagLabel } from "@/lib/labels"

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
  // Model-card metadata (added 2026-04-28).
  context_length?: number | null
  capabilities?: string[]
  description?: string | null
  // Soft-delete state. Owner sees the backend in My Services until it is
  // archived at the next billing settlement; archived state is admin-only and
  // intentionally not exposed to non-admin clients here.
  deletion_status?: string | null
  deleted_at?: string | null
}

const CAPABILITY_KEYS = ["streaming", "tools", "reasoning", "json_output"] as const
type CapabilityKey = typeof CAPABILITY_KEYS[number]

export default function ServiceDetailPage() {
  const t = useT()
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
    currency: "USD",
    is_public: true,
    context_length: "",
    capabilities: [] as CapabilityKey[],
    description: "",
  })

  useEffect(() => {
    apiFetch(`/api/backends/${encodeURIComponent(name)}`)
      .then((data: Backend) => {
        setBackend(data)
        try {
          populateForm(data)
        } catch (e) {
          console.error("[my-services] populateForm threw:", e, "data=", data)
          setError(
            t({
              en: `Page render error: ${e instanceof Error ? e.message : String(e)}`,
              zh: `页面渲染出错：${e instanceof Error ? e.message : String(e)}`,
            })
          )
        }
      })
      .catch((e) => {
        console.error("[my-services] fetch failed:", e)
        const msg = e instanceof Error ? e.message : String(e)
        setError(
          t({
            en: `Backend not found or access denied (${msg})`,
            zh: `后端不存在或无权访问（${msg}）`,
          })
        )
      })
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
      currency: b.currency || "USD",
      is_public: !!b.is_public,
      context_length: b.context_length != null ? String(b.context_length) : "",
      capabilities: (b.capabilities || []).filter((c): c is CapabilityKey =>
        (CAPABILITY_KEYS as readonly string[]).includes(c)
      ),
      description: b.description || "",
    })
  }

  const handleSave = async () => {
    if (!backend) return
    if (!editForm.family) {
      alert(t({ en: "Please select a model family", zh: "请选择模型系列" }))
      return
    }
    if (!editForm.model) {
      alert(t({ en: "Please select a model", zh: "请选择一个模型" }))
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

      const ctxLen = editForm.context_length.trim()
      const desc = editForm.description.trim()
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
          context_length: ctxLen ? parseInt(ctxLen, 10) : undefined,
          clear_context_length: !ctxLen,
          capabilities: editForm.capabilities,
          description: desc || undefined,
          clear_description: !desc,
        }),
      })
      // Reload
      const data: Backend = await apiFetch(`/api/backends/${encodeURIComponent(name)}`)
      setBackend(data)
      populateForm(data)
      setEditing(false)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : t({ en: "Save failed", zh: "保存失败" }))
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
      alert(err instanceof Error ? err.message : t({ en: "Operation failed", zh: "操作失败" }))
    }
  }

  const handleDelete = async () => {
    if (!confirm(t({ en: `Delete backend "${name}"?`, zh: `确定要删除后端 "${name}" 吗？` }))) return
    await apiFetch(`/api/backends/${encodeURIComponent(name)}`, { method: "DELETE" })
    router.push("/my-services")
  }

  if (loading) return <div className="text-center py-20 text-gray-500">{t({ en: "Loading...", zh: "加载中..." })}</div>
  if (error || !backend) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 mb-4">{error || t({ en: "Backend not found", zh: "后端不存在" })}</p>
        <button onClick={() => router.push("/my-services")} className="text-fg hover:underline">{t({ en: "Back to My Services", zh: "返回我的服务" })}</button>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={() => router.push("/my-services")} className="text-sm text-gray-500 hover:text-gray-700 mb-6 inline-flex items-center gap-1">
        ← {t({ en: "Back to My Services", zh: "返回我的服务" })}
      </button>

      {backend.deletion_status === "deleted" && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <b>{t({ en: "Deleted: ", zh: "已删除：" })}</b>
          {t({
            en: "this backend has been removed from the marketplace. It will be cleared from My Services after the next billing settlement.",
            zh: "该后端已从市场下架，下次结账后将从“我的服务”中移除。",
          })}
        </div>
      )}
      {backend.listing_status === "offline" && backend.review_note && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <b>{t({ en: "Review rejected: ", zh: "审核驳回：" })}</b>{backend.review_note}
        </div>
      )}
      {backend.listing_status === "pending" && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t({ en: "Listing request submitted; waiting for admin review. It will be listed automatically once approved.", zh: "上架申请已提交，等待管理员审核。审核通过后自动上架。" })}
        </div>
      )}

      <div className="bg-white rounded-lg border border-line p-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{backend.name}</h1>
            <div className="flex items-center gap-2 mt-2">
              {(() => {
                const st = backend.listing_status || (backend.enabled ? "listed" : "offline")
                const badge = st === "listed"
                  ? { cls: "bg-green-100 text-green-700", label: t({ en: "Listed", zh: "已上架" }) }
                  : st === "pending"
                  ? { cls: "bg-amber-100 text-amber-700", label: t({ en: "Listing under review", zh: "上架审核中" }) }
                  : { cls: "bg-sky-100 text-sky-700", label: t({ en: "Private only", zh: "仅私有" }) }
                return (
                  <span className={`px-2 py-0.5 rounded text-xs ${badge.cls}`}>{badge.label}</span>
                )
              })()}
              <span className={`px-2 py-0.5 rounded text-xs ${backend.status === "online" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                {backend.status}
              </span>
              <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                {backend.mode === "tunnel" ? t({ en: "Tunnel", zh: "隧道" }) : t({ en: "Direct", zh: "直连" })}
              </span>

            </div>
          </div>
          <div className="flex items-center gap-2">
            {!backend.deletion_status && (
              <>
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
                if (st === "listed") return t({ en: "Take down", zh: "下架" })
                if (st === "pending") return t({ en: "Withdraw request", zh: "撤回申请" })
                return t({ en: "Request listing", zh: "申请上架" })
              })()}
            </button>
            {!editing && (
              <button onClick={() => setEditing(true)} className="text-sm px-3 py-1.5 rounded bg-accent-soft text-fg hover:bg-fg/15">
                {t({ en: "Edit", zh: "编辑" })}
              </button>
            )}
            {(() => {
              const st = backend.listing_status || (backend.enabled ? "listed" : "offline")
              const canDelete = st === "offline"
              return (
                <button
                  onClick={handleDelete}
                  disabled={!canDelete}
                  className={`text-sm px-3 py-1.5 rounded ${canDelete ? "text-red-500 hover:bg-red-50" : "text-gray-300 bg-gray-50 cursor-not-allowed"}`}
                  title={!canDelete ? t({ en: "Take down before deleting", zh: "请先下架后再删除" }) : undefined}
                >
                  {t({ en: "Delete", zh: "删除" })}
                </button>
              )
            })()}
              </>
            )}
          </div>
        </div>

        {editing ? (
          /* Edit Form */
          <div className="space-y-4">
            {backend.mode === "direct" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t({ en: "Backend URL", zh: "后端 URL" })}</label>
                <input type="url" value={editForm.url} onChange={(e) => setEditForm({ ...editForm, url: e.target.value })} placeholder="http://IP:PORT" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none" />
              </div>
            )}
            {backend.mode === "direct" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t({ en: "Upstream API key (optional)", zh: "上游 API Key（可选）" })}
                  <span className="ml-2 text-xs text-gray-500 font-normal">
                    {backend.client_info?.api_key ? t({ en: "Current: set", zh: "当前状态：已设置" }) : t({ en: "Current: unset", zh: "当前状态：未设置" })}
                  </span>
                </label>
                <input
                  type="password"
                  value={editForm.api_key}
                  onChange={(e) => setEditForm({ ...editForm, api_key: e.target.value, api_key_changed: true })}
                  placeholder={backend.client_info?.api_key ? t({ en: "Leave unchanged to keep; enter new value to overwrite", zh: "保留原值请不要修改；填入新值会覆盖原值" }) : t({ en: "Fill in if upstream requires auth", zh: "如上游需要认证则填入" })}
                  autoComplete="new-password"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none font-mono"
                />
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-xs text-gray-500">{t({ en: "Forwarded as ", zh: "转发时以 " })}<code>Authorization: Bearer &lt;key&gt;</code>{t({ en: ".", zh: " 带上。" })}</p>
                  {backend.client_info?.api_key && (
                    <button
                      type="button"
                      onClick={() => setEditForm({ ...editForm, api_key: "", api_key_changed: true })}
                      className="text-xs text-red-600 hover:underline"
                    >{t({ en: "Clear API Key", zh: "清除 API Key" })}</button>
                  )}
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t({ en: "Model family", zh: "模型系列" })}</label>
              <select value={editForm.family} onChange={(e) => setEditForm({ ...editForm, family: e.target.value, model: "" })} required className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none">
                <option value="">{t({ en: "Please select a model family", zh: "请选择模型系列" })}</option>
                {families.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t({ en: "Model", zh: "模型" })}</label>
              <select
                value={editForm.model}
                onChange={(e) => setEditForm({ ...editForm, model: e.target.value })}
                required
                disabled={!editForm.family}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">{editForm.family ? t({ en: "Please select a model", zh: "请选择模型" }) : t({ en: "Please select a family first", zh: "请先选择模型系列" })}</option>
                {(catalog[editForm.family] || []).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              {editForm.family && editForm.model && (
                <p className="mt-1 text-xs text-gray-500">{t({ en: `Will be saved as: ${editForm.family}/${editForm.model}`, zh: `将保存为：${editForm.family}/${editForm.model}` })}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t({ en: "Model name on your URL (optional)", zh: "你的 URL 上的模型名（可选）" })}</label>
              <input
                type="text"
                value={editForm.served_as}
                onChange={(e) => setEditForm({ ...editForm, served_as: e.target.value })}
                placeholder={editForm.model ? t({ en: `Defaults to ${editForm.model}`, zh: `默认用 ${editForm.model}` }) : t({ en: "e.g. qwen3-8b-awq", zh: "例如 qwen3-8b-awq" })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-500">
                {t({ en: "The gateway rewrites the OpenAI request's model field to this value before forwarding. The same URL can be registered with different backend names for multiple models.", zh: "网关转发请求时，会把 OpenAI 请求的 model 字段改为此值再传给你的服务。同一 URL 可用不同后端名注册多个模型。" })}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t({ en: "Tags", zh: "标签" })}</label>
              <div className="grid gap-3 md:grid-cols-3">
                <input type="text" value={editForm.tag_hardware} onChange={(e) => setEditForm({ ...editForm, tag_hardware: e.target.value })} placeholder={t({ en: "Hardware, e.g. MI300X", zh: "硬件，如 MI300X" })} className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none text-sm" />
                <input type="text" value={editForm.tag_framework} onChange={(e) => setEditForm({ ...editForm, tag_framework: e.target.value })} placeholder={t({ en: "Framework, e.g. vLLM", zh: "框架，如 vLLM" })} className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none text-sm" />
                <input type="text" value={editForm.tag_quantization} onChange={(e) => setEditForm({ ...editForm, tag_quantization: e.target.value })} placeholder={t({ en: "Quantization, e.g. AWQ / FP16", zh: "量化，如 AWQ / FP16" })} className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none text-sm" />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t({ en: "Currency", zh: "货币" })}</label>
                <select value={editForm.currency} onChange={(e) => setEditForm({ ...editForm, currency: e.target.value })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none">
                  <option value="USD">USD ($)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t({ en: `Input price (${"$"}/M tokens)`, zh: `输入定价（${"$"}/百万token）` })}</label>
                <input type="number" step="0.01" value={editForm.input_price} onChange={(e) => setEditForm({ ...editForm, input_price: e.target.value })} placeholder={t({ en: "Leave blank for free", zh: "留空为免费" })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t({ en: `Output price (${"$"}/M tokens)`, zh: `输出定价（${"$"}/百万token）` })}</label>
                <input type="number" step="0.01" value={editForm.output_price} onChange={(e) => setEditForm({ ...editForm, output_price: e.target.value })} placeholder={t({ en: "Leave blank for free", zh: "留空为免费" })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t({ en: `Cache-hit price (${"$"}/M tokens)`, zh: `缓存命中定价（${"$"}/百万token）` })}</label>
                <input type="number" step="0.01" value={editForm.cache_price} onChange={(e) => setEditForm({ ...editForm, cache_price: e.target.value })} placeholder={t({ en: "defaults to input × 0.1", zh: "默认为输入×0.1" })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none" />
              </div>
            </div>
            <p className="text-xs text-gray-500 -mt-2">{t({ en: "Cache-hit tokens are billed at the cache price; if blank, charged at input price × 0.1 (industry-standard discount).", zh: "缓存命中部分按缓存价计费；留空时按输入价×0.1（行业通行折扣）计费。" })}</p>

            {/* Model card metadata: context length, capabilities, description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t({ en: "Context length (tokens)", zh: "上下文长度（tokens）" })}
              </label>
              <input
                type="number"
                step="1024"
                min="0"
                value={editForm.context_length}
                onChange={(e) => setEditForm({ ...editForm, context_length: e.target.value })}
                placeholder={t({ en: "e.g. 131072 — leave blank if unknown", zh: "例如 131072，未知请留空" })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-500">{t({ en: "Shown on the model detail page next to the price row.", zh: "显示在模型详情页价格行旁边。" })}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t({ en: "Capabilities", zh: "能力标签" })}
              </label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {CAPABILITY_KEYS.map((cap) => {
                  const checked = editForm.capabilities.includes(cap)
                  const labelEn: Record<CapabilityKey, string> = {
                    streaming: "Streaming",
                    tools: "Tools",
                    reasoning: "Reasoning",
                    json_output: "JSON Output",
                  }
                  const labelZh: Record<CapabilityKey, string> = {
                    streaming: "流式",
                    tools: "工具调用",
                    reasoning: "推理",
                    json_output: "JSON 输出",
                  }
                  return (
                    <label
                      key={cap}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm ${
                        checked ? "border-fg bg-accent-soft text-fg" : "border-line text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...editForm.capabilities, cap]
                            : editForm.capabilities.filter((c) => c !== cap)
                          setEditForm({ ...editForm, capabilities: next })
                        }}
                      />
                      {t({ en: labelEn[cap], zh: labelZh[cap] })}
                    </label>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t({ en: "Description (optional)", zh: "描述（可选）" })}
              </label>
              <textarea
                rows={3}
                maxLength={500}
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                placeholder={t({ en: "Short description shown under the model name on the detail page.", zh: "在详情页模型名下方展示的简短介绍。" })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-fg/40 focus:outline-none"
              />
            </div>

            <div className="flex gap-2">
              <button onClick={handleSave} disabled={saving} className="bg-fg text-white px-6 py-2 rounded-lg hover:bg-fg/90 disabled:opacity-50">
                {saving ? t({ en: "Saving...", zh: "保存中..." }) : t({ en: "Save", zh: "保存" })}
              </button>
              <button onClick={() => { setEditing(false); populateForm(backend) }} className="px-6 py-2 rounded-lg border hover:bg-gray-50">{t({ en: "Cancel", zh: "取消" })}</button>
            </div>
          </div>
        ) : (
          /* Detail View */
          <div className="space-y-6">
            {/* Info Grid */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              {backend.mode === "direct" && backend.url && (
                <div className="bg-gray-50 rounded-lg p-4 col-span-2">
                  <p className="text-gray-500 mb-1">{t({ en: "Backend URL", zh: "后端 URL" })}</p>
                  <p className="font-medium text-gray-900 font-mono">{backend.url}</p>
                </div>
              )}
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-gray-500 mb-1">{t({ en: "Created at", zh: "创建时间" })}</p>
                <p className="font-medium text-gray-900">{backend.created_at}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-gray-500 mb-1">{t({ en: "Updated at", zh: "更新时间" })}</p>
                <p className="font-medium text-gray-900">{backend.updated_at}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-gray-500 mb-1">{t({ en: "Public", zh: "公开" })}</p>
                <p className="font-medium text-gray-900">{backend.is_public ? t({ en: "Yes", zh: "是" }) : t({ en: "No", zh: "否" })}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-gray-500 mb-1">{t({ en: "Pricing", zh: "定价" })}</p>
                <p className="font-medium text-gray-900">
                  {backend.input_price == null && backend.output_price == null ? (
                    t({ en: "Not set", zh: "未设置" })
                  ) : backend.input_price === 0 && backend.output_price === 0 ? (
                    <span className="text-green-600">Free</span>
                  ) : (
                    <>{"$"}{backend.input_price}/M {t({ en: "input", zh: "输入" })} / {"$"}{backend.output_price}/M {t({ en: "output", zh: "输出" })} / {backend.cache_price != null ? `${"$"}${backend.cache_price}/M ${t({ en: "cache", zh: "缓存" })}` : t({ en: "cache defaults to input × 0.1", zh: "缓存默认按输入价×0.1" })} <span className="text-xs text-gray-500">({backend.currency || "USD"})</span></>
                  )}
                </p>
              </div>
            </div>

            {/* Tags */}
            {Object.keys(backend.tags || {}).length > 0 && (
              <div>
                <p className="text-sm text-gray-500 mb-2">{t({ en: "Tags", zh: "标签" })}</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(backend.tags).map(([k, v]) => (
                    <span key={k} className="inline-flex items-center px-2.5 py-1 rounded text-xs font-medium bg-accent-soft text-fg border border-line">
                      {t(tagLabel(v))}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Models */}
            <div>
              <p className="text-sm text-gray-500 mb-2">{t({ en: "Models", zh: "模型列表" })}</p>
              <div className="space-y-2">
                {backend.models.length > 0 ? backend.models.map((m) => (
                  <Link
                    key={m}
                    href={`/models/${encodeURIComponent(m)}?backend_id=${backend.id}`}
                    className="block bg-gray-50 rounded-lg p-3 hover:bg-accent-soft transition-colors text-sm font-medium text-fg hover:text-fg"
                  >
                    {m} →
                  </Link>
                )) : (
                  <p className="text-sm text-gray-400">{t({ en: "No models", zh: "暂无模型" })}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
