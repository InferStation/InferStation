"use client"

import Link from "next/link"
import { useT } from "@/context/LocaleContext"

export default function AboutPage() {
  const t = useT()
  return (
    <article className="max-w-3xl mx-auto prose prose-sm text-gray-700">
      <h1 className="text-2xl font-semibold text-gray-800 mb-2">{t({ en: "About Tianshu", zh: "关于天枢" })}</h1>
      <p className="text-xs text-gray-500 mb-6">Tianshu Gateway</p>

      <section className="space-y-4">
        <p>
          {t({
            en: "Tianshu is a lightweight LLM aggregation platform. It does exactly one thing: unify model inference services scattered across different machines — even ones behind NAT — into a single OpenAI-compatible API, so consumers can call them just like they call OpenAI.",
            zh: "天枢 是一个轻量级的 LLM 聚合平台。它做的事情只有一件：把分散在不同机器、甚至 NAT 后面的模型推理服务，统一成一个 OpenAI 兼容的 API，让消费者可以像调 OpenAI 一样调它们。",
          })}
        </p>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "Why the name", zh: "名字由来" })}</h2>
        <p>
          {t({
            en: "Tianshu (天枢) is the lead star of the Big Dipper, sitting at the center of the constellation. We chose the name to evoke the idea of a hub star between AI compute and AI applications — it doesn't emit its own light, but pulls scattered light together and points the way.",
            zh: "北斗七星之首为天枢，居于众星环绕之中。取名「天枢」，意在做 AI 算力与应用之间的那颗枢纽星 —— 自己不发光，却把散落的光聚合起来指明方向。",
          })}
        </p>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "Design principles", zh: "设计原则" })}</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "Thin gateway: routing, auth, billing, and health checks only — inference and business logic stay on the backends.", zh: "薄网关：只做路由、鉴权、计费、健康检查；推理与业务逻辑完全留给后端" })}</li>
          <li>{t({ en: "No content retention: requests and responses are never persisted; the platform only records metadata for billing and diagnostics.", zh: "零内容留存：请求和回复不落盘，平台只记录元数据用于计费和诊断" })}</li>
          <li>{t({ en: "Multi-active and failover: subscribe to multiple backends for the same model and switch by priority automatically.", zh: "多活与失败转移：用户可订阅多个同模型的后端，按优先级自动切换" })}</li>
          <li>{t({ en: "NAT-friendly: private-network GPUs can serve traffic over a WebSocket tunnel.", zh: "NAT 友好：内网 GPU 也能通过 WebSocket 隧道对外提供服务" })}</li>
          <li>{t({ en: "Transparent pricing: providers set their own per-million-token price; the platform takes no markup.", zh: "透明定价：提供者自行设定每百万 token 单价，平台不加价" })}</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "Tech stack", zh: "技术栈" })}</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "Backend: Python · FastAPI · httpx · SQLite · WebSocket tunnel", zh: "后端：Python · FastAPI · httpx · SQLite · WebSocket tunnel" })}</li>
          <li>{t({ en: "Frontend: Next.js 15 · React · TailwindCSS", zh: "前端：Next.js 15 · React · TailwindCSS" })}</li>
          <li>{t({ en: "Protocol compatibility: OpenAI ", zh: "协议兼容：OpenAI " })}<code>/v1/chat/completions</code>, <code>/v1/completions</code>, <code>/v1/responses</code></li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "Next steps", zh: "下一步" })}</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "Read the ", zh: "查看 " })}<Link href="/docs" className="text-fg hover:underline">{t({ en: "developer docs", zh: "开发者文档" })}</Link></li>
          <li>{t({ en: "Browse the ", zh: "浏览 " })}<Link href="/models" className="text-fg hover:underline">{t({ en: "model catalog", zh: "模型广场" })}</Link></li>
          <li>{t({ en: "Feedback: ", zh: "问题反馈：" })}<a className="text-fg" href="mailto:support@tianshu-gateway.cloud">support@tianshu-gateway.cloud</a></li>
        </ul>
      </section>
    </article>
  )
}
