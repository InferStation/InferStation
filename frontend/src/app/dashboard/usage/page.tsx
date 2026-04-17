"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"

interface UsageStat {
  model: string
  total_input: number
  total_output: number
  total_cost: number
  requests: number
}

export default function UsagePage() {
  const { user } = useAuth()
  const [usage, setUsage] = useState<UsageStat[]>([])
  const [days, setDays] = useState(30)

  useEffect(() => {
    if (user) apiFetch(`/api/usage?days=${days}`).then(setUsage).catch(() => {})
  }, [user, days])

  if (!user) return null

  const totalCost = usage.reduce((s, u) => s + u.total_cost, 0)
  const totalRequests = usage.reduce((s, u) => s + u.requests, 0)
  const totalInput = usage.reduce((s, u) => s + u.total_input, 0)
  const totalOutput = usage.reduce((s, u) => s + u.total_output, 0)

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">使用明细</h1>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
        >
          <option value={7}>近 7 天</option>
          <option value={30}>近 30 天</option>
          <option value={90}>近 90 天</option>
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <div className="bg-white rounded-lg border p-4">
          <div className="text-sm text-gray-500">请求数</div>
          <div className="text-2xl font-bold">{totalRequests}</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-sm text-gray-500">输入 tokens</div>
          <div className="text-2xl font-bold">{totalInput.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-sm text-gray-500">输出 tokens</div>
          <div className="text-2xl font-bold">{totalOutput.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-sm text-gray-500">总花费</div>
          <div className="text-2xl font-bold text-orange-600">¥{totalCost.toFixed(4)}</div>
        </div>
      </div>

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
