import Link from "next/link"

export default function Home() {
  return (
    <div className="text-center py-16">
      <h1 className="text-4xl font-bold text-gray-900 mb-4">LLM Gateway</h1>
      <p className="text-lg text-gray-600 mb-10">模型服务聚合平台 — 连接 AI 消费者与模型提供者</p>

      <div className="flex justify-center gap-4 mb-16">
        <Link href="/models" className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 text-lg">
          浏览模型广场
        </Link>
        <Link href="/register" className="border border-indigo-600 text-indigo-600 px-6 py-3 rounded-lg hover:bg-indigo-50 text-lg">
          注册账号
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-3 text-center max-w-4xl mx-auto">
        <div className="bg-white rounded-lg p-6 border">
          <div className="text-3xl mb-3">🔌</div>
          <h3 className="font-semibold text-lg mb-2">OpenAI 兼容</h3>
          <p className="text-sm text-gray-600">直接使用 OpenAI SDK 调用，无缝切换</p>
        </div>
        <div className="bg-white rounded-lg p-6 border">
          <div className="text-3xl mb-3">🌐</div>
          <h3 className="font-semibold text-lg mb-2">NAT 穿透</h3>
          <p className="text-sm text-gray-600">内网机器也能提供服务，WebSocket 隧道自动连接</p>
        </div>
        <div className="bg-white rounded-lg p-6 border">
          <div className="text-3xl mb-3">💰</div>
          <h3 className="font-semibold text-lg mb-2">按量计费</h3>
          <p className="text-sm text-gray-600">按 token 用量计费，灵活定价</p>
        </div>
      </div>
    </div>
  )
}
