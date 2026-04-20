"use client"

import { useAuth } from "@/context/AuthContext"

export default function OtherPage() {
  const { user } = useAuth()

  if (!user) return null

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">其他</h1>

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
