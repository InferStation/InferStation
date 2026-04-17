"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"
import { useRouter } from "next/navigation"

interface UsageStat {
  model: string
  total_input: number
  total_output: number
  total_cost: number
  requests: number
}

export default function DashboardPage() {
  const { user, loading, refreshUser } = useAuth()
  const router = useRouter()
  const [usage, setUsage] = useState<UsageStat[]>([])
  const [upgrading, setUpgrading] = useState(false)

  useEffect(() => {
    if (!loading && !user) router.push("/login")
  }, [loading, user, router])

  useEffect(() => {
    if (user) {
      apiFetch("/api/usage?days=30").then(setUsage).catch(() => {})
    }
  }, [user])

  const handleUpgrade = async (role: string) => {
    setUpgrading(true)
    try {
      await apiFetch("/api/user/upgrade-role", {
        method: "POST",
        body: JSON.stringify({ target_role: role }),
      })
      await refreshUser()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "操作失败")
    } finally {
      setUpgrading(false)
    }
  }

  if (loading || !user) return <div className="text-center py-20 text-gray-500">加载中...</div>

  const totalCost = usage.reduce((s, u) => s + u.total_cost, 0)
  const totalRequests = usage.reduce((s, u) => s + u.requests, 0)

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">控制台</h1>

      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <div className="bg-white rounded-lg border p-4">
          <div className="text-sm text-gray-500">余额</div>
          <div className="text-2xl font-bold text-green-600">¥{user.balance.toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-sm text-gray-500">30天请求数</div>
          <div className="text-2xl font-bold">{totalRequests}</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-sm text-gray-500">30天花费</div>
          <div className="text-2xl font-bold text-orange-600">¥{totalCost.toFixed(4)}</div>
        </div>
      </div>

      {user.role === "consumer" && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
          <p className="text-sm text-blue-800 mb-2">成为模型服务提供者？激活提供者即可注册后端。</p>
          <button
            onClick={() => handleUpgrade("both")}
            disabled={upgrading}
            className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            激活 消费者+提供者
          </button>
        </div>
      )}

      <h2 className="text-lg font-semibold mb-4">近30天用量</h2>
      {usage.length === 0 ? (
        <p className="text-gray-500">暂无使用记录</p>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">模型</th>
                <th className="text-right px-4 py-3 font-medium">请求数</th>
                <th className="text-right px-4 py-3 font-medium">输入 tokens</th>
                <th className="text-right px-4 py-3 font-medium">输出 tokens</th>
                <th className="text-right px-4 py-3 font-medium">花费</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {usage.map((u, i) => (
                <tr key={i}>
                  <td className="px-4 py-3 font-mono">{u.model}</td>
                  <td className="px-4 py-3 text-right">{u.requests}</td>
                  <td className="px-4 py-3 text-right">{u.total_input.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">{u.total_output.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-green-600">¥{u.total_cost.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
