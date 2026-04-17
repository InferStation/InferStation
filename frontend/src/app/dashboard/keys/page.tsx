"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"

interface ApiKey {
  id: number
  key_prefix: string
  name: string
  is_active: number
  created_at: string
}

export default function KeysPage() {
  const { user } = useAuth()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [newKeyName, setNewKeyName] = useState("")
  const [newKey, setNewKey] = useState("")

  useEffect(() => {
    if (user) loadKeys()
  }, [user])

  const loadKeys = () => apiFetch("/api/keys").then(setKeys).catch(() => {})

  const createKey = async () => {
    try {
      const data = await apiFetch("/api/keys", {
        method: "POST",
        body: JSON.stringify({ name: newKeyName }),
      })
      setNewKey(data.key)
      setNewKeyName("")
      loadKeys()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "创建失败")
    }
  }

  const deleteKey = async (id: number) => {
    if (!confirm("确定要删除这个 Key 吗？")) return
    await apiFetch(`/api/keys/${id}`, { method: "DELETE" })
    loadKeys()
  }

  if (!user) return null

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">API Key</h1>

      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="font-semibold mb-4">创建新 Key</h2>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Key 名称（可选）"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />
          <button onClick={createKey} className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700">创建</button>
        </div>
        {newKey && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800 mb-1">Key 创建成功！请立即复制，此后不再显示：</p>
            <code className="text-sm font-mono bg-white px-2 py-1 rounded border break-all">{newKey}</code>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">前缀</th>
              <th className="text-left px-4 py-3 font-medium">名称</th>
              <th className="text-left px-4 py-3 font-medium">创建时间</th>
              <th className="text-right px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {keys.map((k) => (
              <tr key={k.id}>
                <td className="px-4 py-3 font-mono">{k.key_prefix}...</td>
                <td className="px-4 py-3">{k.name || "-"}</td>
                <td className="px-4 py-3 text-gray-500">{k.created_at}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => deleteKey(k.id)} className="text-red-500 hover:text-red-700 text-sm">删除</button>
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">暂无 API Key</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
