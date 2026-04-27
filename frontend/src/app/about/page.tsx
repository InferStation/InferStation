import Link from "next/link"

export const metadata = { title: "关于天枢" }

export default function AboutPage() {
  return (
    <article className="max-w-3xl mx-auto prose prose-sm text-gray-700">
      <h1 className="text-2xl font-semibold text-gray-800 mb-2">关于天枢</h1>
      <p className="text-xs text-gray-500 mb-6">Tianshu Gateway</p>

      <section className="space-y-4">
        <p>
          <strong>天枢</strong> 是一个轻量级的 LLM 聚合平台。它做的事情只有一件：
          把分散在不同机器、甚至 NAT 后面的模型推理服务，统一成一个 OpenAI 兼容的 API，
          让消费者可以像调 OpenAI 一样调它们。
        </p>

        <h2 className="text-lg font-semibold text-gray-800">名字由来</h2>
        <p>
          北斗七星之首为天枢，居于众星环绕之中。取名「天枢」，意在做 AI 算力与应用之间的那颗<strong>枢纽星</strong> —
          自己不发光，却把散落的光聚合起来指明方向。
        </p>

        <h2 className="text-lg font-semibold text-gray-800">设计原则</h2>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>薄网关</strong>：只做路由、鉴权、计费、健康检查；推理与业务逻辑完全留给后端</li>
          <li><strong>零内容留存</strong>：请求和回复不落盘，平台只记录元数据用于计费和诊断</li>
          <li><strong>多活与失败转移</strong>：用户可订阅多个同模型的后端，按优先级自动切换</li>
          <li><strong>NAT 友好</strong>：内网 GPU 也能通过 WebSocket 隧道对外提供服务</li>
          <li><strong>透明定价</strong>：提供者自行设定每百万 token 单价，平台不加价</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">技术栈</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>后端：Python · FastAPI · httpx · SQLite · WebSocket tunnel</li>
          <li>前端：Next.js 15 · React · TailwindCSS</li>
          <li>协议兼容：OpenAI <code>/v1/chat/completions</code>、<code>/v1/completions</code>、<code>/v1/responses</code></li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">下一步</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>查看 <Link href="/docs" className="text-fg hover:underline">开发者文档</Link></li>
          <li>浏览 <Link href="/models" className="text-fg hover:underline">模型广场</Link></li>
          <li>问题反馈：<a className="text-fg" href="mailto:support@tianshu-gateway.cloud">support@tianshu-gateway.cloud</a></li>
        </ul>
      </section>
    </article>
  )
}
