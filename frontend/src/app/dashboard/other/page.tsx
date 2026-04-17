"use client"

import { useState } from "react"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"

export default function OtherPage() {
  const { user, refreshUser } = useAuth()
  const [upgrading, setUpgrading] = useState(false)

  if (!user) return null

  const handleUpgrade = async () => {
    setUpgrading(true)
    try {
      await apiFetch("/api/user/upgrade-role", {
        method: "POST",
        body: JSON.stringify({ target_role: "both" }),
      })
      await refreshUser()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "操作失败")
    } finally {
      setUpgrading(false)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">其他</h1>

      {user.role === "consumer" && (
        <div className="bg-white rounded-lg border p-6 mb-6">
          <h2 className="font-semibold mb-2">成为模型服务提供者</h2>
          <p className="text-sm text-gray-600 mb-4">激活提供者身份后，你可以注册自己的模型后端，将模型服务分享给其他用户。</p>
          <button
            onClick={handleUpgrade}
            disabled={upgrading}
            className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {upgrading ? "激活中..." : "激活 消费者+提供者"}
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg border p-6">
        <h2 className="font-semibold mb-4">平台信息</h2>
        <div className="text-sm text-gray-600 space-y-2">
          <p>LLM Gateway — 模型服务聚合平台</p>
          <p>支持 OpenAI 兼容 API、NAT 穿透隧道、按量计费</p>
        </div>
      </div>
    </div>
  )
}
