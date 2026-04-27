"use client"

import Link from "next/link"
import { useT, type Bilingual } from "@/context/LocaleContext"

const FEATURES: { title: Bilingual; desc: Bilingual }[] = [
  {
    title: { en: "OpenAI compatible", zh: "OpenAI 兼容" },
    desc: {
      en: "Unified /v1 endpoint that drops into the OpenAI SDK with near-zero migration cost.",
      zh: "统一 /v1 入口，可直接使用 OpenAI SDK 调用，迁移几乎零成本。",
    },
  },
  {
    title: { en: "NAT traversal", zh: "NAT 穿透" },
    desc: {
      en: "Expose private-network GPUs over a WebSocket tunnel — no public IP required.",
      zh: "内网 GPU 通过 WebSocket 隧道即可对外提供服务，无需公网 IP。",
    },
  },
  {
    title: { en: "Priority & failover", zh: "优先级 & 失败转移" },
    desc: {
      en: "Subscribe to multiple backends for the same model and switch by priority — no single point of failure.",
      zh: "订阅同模型的多个后端，按你的优先级自动切换，单点故障不影响调用。",
    },
  },
  {
    title: { en: "Pay-as-you-go", zh: "按量计费" },
    desc: {
      en: "Billed on real upstream tokens with no markup, settled monthly post-paid.",
      zh: "按上游返回的真实 token 计费，平台不加价，后付费月结。",
    },
  },
  {
    title: { en: "No content retention", zh: "内容不留存" },
    desc: {
      en: "Request and response payloads only live in memory during forwarding — never persisted, never profiled.",
      zh: "请求体与响应内容仅在转发期间驻留内存，不写入磁盘，不做画像。",
    },
  },
  {
    title: { en: "Real-time usage", zh: "实时用量" },
    desc: {
      en: "Call-level details, month-to-date totals, and monthly invoices at a glance.",
      zh: "调用明细、本月累计、月度账单一目了然。",
    },
  },
]

export default function Home() {
  const t = useT()
  return (
    <div className="space-y-20">
      <section className="text-center pt-20 pb-8">
        <div className="inline-flex items-center gap-2 px-3 h-7 rounded-full border border-line bg-surface text-xs text-fg-muted mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-success" />
          {t({ en: "OpenAI compatible · Post-paid · No content retention", zh: "OpenAI 兼容 · 后付费 · 内容不留存" })}
        </div>
        <h1 className="text-[44px] leading-[1.05] font-semibold tracking-tight text-fg mb-4">
          {t({ en: "One API,", zh: "一个 API，" })}<br className="md:hidden" />{t({ en: "every LLM backend", zh: "接入所有大模型" })}
        </h1>
        <p className="text-base text-fg-muted max-w-xl mx-auto mb-8">
          {t({
            en: "Tianshu aggregates fragmented LLM backends behind a single OpenAI-compatible interface — priority routing, automatic failover, and billing on real tokens.",
            zh: "天枢把分散的 LLM 后端聚合为统一的 OpenAI 兼容接口，按优先级自动调度、失败转移、按 token 真实计费。",
          })}
        </p>
        <div className="flex justify-center gap-2 flex-wrap">
          <Link href="/models" className="h-10 px-5 inline-flex items-center rounded-lg bg-fg text-accent-fg text-sm font-medium hover:bg-fg/90">
            {t({ en: "Browse Models", zh: "浏览模型广场" })}
          </Link>
          <Link href="/docs" className="h-10 px-5 inline-flex items-center rounded-lg bg-surface border border-line text-fg text-sm font-medium hover:bg-accent-soft">
            {t({ en: "Developer Docs", zh: "开发者文档" })}
          </Link>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-2">
        <div className="grid gap-px bg-line rounded-xl overflow-hidden border border-line md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title.en} className="bg-surface p-6">
              <div className="text-[15px] font-semibold text-fg mb-1.5">{t(f.title)}</div>
              <div className="text-[13px] text-fg-muted leading-relaxed">{t(f.desc)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-2 pb-16">
        <h2 className="text-[22px] font-semibold text-center mb-8">{t({ en: "Get started", zh: "如何开始" })}</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-surface rounded-xl p-6 border border-line">
            <div className="text-xs font-medium uppercase tracking-wider text-fg-subtle mb-2">{t({ en: "Consumer", zh: "调用者" })}</div>
            <h3 className="font-semibold text-fg mb-3">{t({ en: "Integrate in minutes", zh: "几分钟接入" })}</h3>
            <ol className="list-decimal list-inside text-[13px] text-fg-muted space-y-1.5 marker:text-fg-subtle">
              <li>{t({ en: "Sign up", zh: "注册账号" })}</li>
              <li>{t({ en: "Subscribe to models from the catalog", zh: "在「模型广场」订阅感兴趣的模型" })}</li>
              <li>{t({ en: "Activate subscriptions and order them by priority", zh: "激活订阅并按优先级排序" })}</li>
              <li>{t({ en: "Create an API key and call ", zh: "创建 API Key，调用 " })}<code className="px-1 py-0.5 rounded bg-accent-soft text-fg font-mono text-[12px]">/v1</code></li>
            </ol>
          </div>
          <div className="bg-surface rounded-xl p-6 border border-line">
            <div className="text-xs font-medium uppercase tracking-wider text-fg-subtle mb-2">{t({ en: "Provider", zh: "提供者" })}</div>
            <h3 className="font-semibold text-fg mb-3">{t({ en: "Monetize idle compute", zh: "把闲置算力变现" })}</h3>
            <ol className="list-decimal list-inside text-[13px] text-fg-muted space-y-1.5 marker:text-fg-subtle">
              <li>{t({ en: "Sign up and enable provider mode in My Services", zh: "注册账号，在「我的服务」激活提供者身份" })}</li>
              <li>{t({ en: "Register a backend: direct or tunnel mode, with model and unit price", zh: "注册后端服务：直连或隧道，填写模型与单价" })}</li>
              <li>{t({ en: "For tunnel mode, run ", zh: "如果是隧道模式，本地运行 " })}<code className="px-1 py-0.5 rounded bg-accent-soft text-fg font-mono text-[12px]">tunnel_client.py</code>{t({ en: " locally", zh: "" })}</li>
              <li>{t({ en: "Submit for listing review — once approved, your service appears in the catalog", zh: "提交「上架」审核，通过后即可出现在广场" })}</li>
            </ol>
          </div>
        </div>
      </section>
    </div>
  )
}
