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
  input_price: number | null
  output_price: number | null
  is_public: number
  owner_name: string
  updated_at: string
  created_at: string
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

  // Edit state
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editForm, setEditForm] = useState({
    url: "",
    models: "",
    tag_hardware: "",
    tag_framework: "",
    tag_quantization: "",
    input_price: "",
    output_price: "",
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
    apiFetch("/api/model-families").then((data: { families: string[] }) => setFamilies(data.families)).catch(() => {})
  }, [name])

  const populateForm = (b: Backend) => {
    setEditForm({
      url: b.url || "",
      models: b.models.join(", "),
      tag_hardware: b.tags?.hardware || "",
      tag_framework: b.tags?.framework || "",
      tag_quantization: b.tags?.quantization || "",
      input_price: b.input_price != null ? String(b.input_price) : "",
      output_price: b.output_price != null ? String(b.output_price) : "",
      is_public: !!b.is_public,
    })
  }

  const handleSave = async () => {
    if (!backend) return
    setSaving(true)
    try {
      const tags: Record<string, string> = {}
      if (editForm.tag_hardware.trim()) tags.hardware = editForm.tag_hardware.trim()
      if (editForm.tag_framework.trim()) tags.framework = editForm.tag_framework.trim()
      if (editForm.tag_quantization.trim()) tags.quantization = editForm.tag_quantization.trim()

      const models = editForm.models.split(",").map((s) => s.trim()).filter(Boolean)

      await apiFetch(`/api/backends/${encodeURIComponent(name)}`, {
        method: "PUT",
        body: JSON.stringify({
          url: backend.mode === "direct" ? editForm.url : undefined,
          models,
          tags,
          input_price: editForm.input_price ? parseFloat(editForm.input_price) : undefined,
          output_price: editForm.output_price ? parseFloat(editForm.output_price) : undefined,
          is_public: editForm.is_public,
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

      <div className="bg-white rounded-lg border border-gray-200 p-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{backend.name}</h1>
            <div className="flex items-center gap-2 mt-2">
              <span className={`px-2 py-0.5 rounded text-xs ${backend.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                {backend.enabled ? "已上架" : "已下架"}
              </span>
              <span className={`px-2 py-0.5 rounded text-xs ${backend.status === "online" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                {backend.status}
              </span>
              <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                {backend.mode === "tunnel" ? "隧道" : "直连"}
              </span>
              {!backend.is_public && <span className="px-2 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700">私有</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggle}
              className={`text-sm px-3 py-1.5 rounded ${backend.enabled ? "bg-gray-100 text-gray-600 hover:bg-gray-200" : "bg-green-100 text-green-700 hover:bg-green-200"}`}
            >
              {backend.enabled ? "下架" : "上架"}
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">模型列表（逗号分隔）</label>
              <input type="text" value={editForm.models} onChange={(e) => setEditForm({ ...editForm, models: e.target.value })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">标签</label>
              <div className="grid gap-3 md:grid-cols-3">
                <input type="text" value={editForm.tag_hardware} onChange={(e) => setEditForm({ ...editForm, tag_hardware: e.target.value })} placeholder="硬件，如 MI300X" className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm" />
                <input type="text" value={editForm.tag_framework} onChange={(e) => setEditForm({ ...editForm, tag_framework: e.target.value })} placeholder="框架，如 vLLM" className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm" />
                <input type="text" value={editForm.tag_quantization} onChange={(e) => setEditForm({ ...editForm, tag_quantization: e.target.value })} placeholder="量化，如 AWQ / FP16" className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm" />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">输入定价（元/百万token）</label>
                <input type="number" step="0.01" value={editForm.input_price} onChange={(e) => setEditForm({ ...editForm, input_price: e.target.value })} placeholder="留空为免费" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">输出定价（元/百万token）</label>
                <input type="number" step="0.01" value={editForm.output_price} onChange={(e) => setEditForm({ ...editForm, output_price: e.target.value })} placeholder="留空为免费" className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
            </div>
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
                    <>¥{backend.input_price}/M 输入 / ¥{backend.output_price}/M 输出</>
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
