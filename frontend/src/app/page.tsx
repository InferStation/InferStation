import Link from "next/link"

export default function Home() {
  return (
    <div>
      <section className="text-center py-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-3">天枢</h1>
        <p className="text-lg text-gray-600 mb-2">模型服务聚合平台</p>
        <p className="text-sm text-gray-500 mb-8">把分散的 LLM 后端，统一成一个 OpenAI 兼容 API</p>

        <div className="flex justify-center gap-3 flex-wrap">
          <Link href="/models" className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700">
            浏览模型广场
          </Link>
          <Link href="/docs" className="bg-white border border-gray-300 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-50">
            开发者文档
          </Link>
          <Link href="/register" className="bg-white border border-gray-300 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-50">
            注册账号
          </Link>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-3 max-w-4xl mx-auto mb-16">
        <div className="bg-white rounded-lg p-6 border">
          <div className="text-3xl mb-3">🔌</div>
          <h3 className="font-semibold text-lg mb-2">OpenAI 兼容</h3>
          <p className="text-sm text-gray-600">统一 <code>/v1</code> 入口，可直接使用 OpenAI SDK 调用，迁移几乎零成本。</p>
        </div>
        <div className="bg-white rounded-lg p-6 border">
          <div className="text-3xl mb-3">🌐</div>
          <h3 className="font-semibold text-lg mb-2">NAT 穿透</h3>
          <p className="text-sm text-gray-600">内网 GPU 通过 WebSocket 隧道即可对外提供服务，无需公网 IP。</p>
        </div>
        <div className="bg-white rounded-lg p-6 border">
          <div className="text-3xl mb-3">⚖️</div>
          <h3 className="font-semibold text-lg mb-2">优先级 & 失败转移</h3>
          <p className="text-sm text-gray-600">订阅同模型的多个后端，按你的优先级自动切换，单点故障不影响调用。</p>
        </div>
        <div className="bg-white rounded-lg p-6 border">
          <div className="text-3xl mb-3">💰</div>
          <h3 className="font-semibold text-lg mb-2">按量计费</h3>
          <p className="text-sm text-gray-600">按上游返回的真实 token 计费，平台不加价，后付费月结。</p>
        </div>
        <div className="bg-white rounded-lg p-6 border">
          <div className="text-3xl mb-3">🔒</div>
          <h3 className="font-semibold text-lg mb-2">内容不留存</h3>
          <p className="text-sm text-gray-600">请求体与响应内容仅在转发期间驻留内存，不写入磁盘，不做画像。</p>
        </div>
        <div className="bg-white rounded-lg p-6 border">
          <div className="text-3xl mb-3">📊</div>
          <h3 className="font-semibold text-lg mb-2">实时用量</h3>
          <p className="text-sm text-gray-600">调用明细、本月累计、月度账单一目了然。</p>
        </div>
      </section>

      <section className="max-w-4xl mx-auto mb-16">
        <h2 className="text-2xl font-semibold text-gray-800 text-center mb-6">如何开始</h2>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg p-6 border">
            <h3 className="font-semibold text-gray-800 mb-3">我是调用者</h3>
            <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1.5">
              <li>注册账号</li>
              <li>在「模型广场」订阅感兴趣的模型</li>
              <li>激活订阅并按优先级排序</li>
              <li>创建 API Key，调用 <code>/v1</code> 即可</li>
            </ol>
          </div>
          <div className="bg-white rounded-lg p-6 border">
            <h3 className="font-semibold text-gray-800 mb-3">我是算力提供者</h3>
            <ol className="list-decimal list-inside text-sm text-gray-700 space-y-1.5">
              <li>注册账号，在「我的服务」激活提供者身份</li>
              <li>注册后端服务：直连或隧道，填写模型与单价</li>
              <li>如果是隧道模式，本地运行 <code>tunnel_client.py</code></li>
              <li>点击「上架」，即可出现在广场</li>
            </ol>
          </div>
        </div>
      </section>
    </div>
  )
}
