"use client"

import { useT } from "@/context/LocaleContext"

export default function SlaPage() {
  const t = useT()
  return (
    <article className="max-w-3xl mx-auto prose prose-sm text-gray-700">
      <h1 className="text-2xl font-semibold text-gray-800 mb-2">{t({ en: "Service Level Agreement", zh: "服务等级说明" })}</h1>
      <p className="text-xs text-gray-500 mb-6">{t({ en: "Last updated: 2026-04-24", zh: "最后更新：2026-04-24" })}</p>

      <section className="space-y-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 not-prose">
          <p className="text-sm text-gray-800 leading-relaxed">
            <strong>{t({ en: "In short:", zh: "一句话说完：" })}</strong>{" "}
            {t({
              en: "Tianshu commits to keeping the gateway website / API endpoint reachable. We do NOT commit to the availability, latency, or quality of any individual third-party LLM backend. You are responsible for configuring your own fallback by activating multiple subscriptions for the same model (and ordering them by priority) in My Subscriptions.",
              zh: "天枢只对「网关网站 / API 端点可达」作出承诺，不对任何单个第三方 LLM 后端的可用性、延迟或质量作出承诺。请你自己在「我的订阅」中为同一模型激活多条订阅并按优先级排序，作为你的兑底方案。"
            })}
          </p>
        </div>

        <p>
          {t({
            en: "Tianshu has two layers: the gateway layer (routing, billing, accounts) and the backend inference layer run by third-party providers. This page describes availability targets for each layer separately.",
            zh: "天枢平台由网关层（路由、计费、账户）和由第三方提供者运行的后端推理层构成。本页分别说明两层的可用性目标。",
          })}
        </p>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "1. Gateway layer (operated by Tianshu) — we commit", zh: "1. 网关层（天枢运营）— 我们承诺" })}</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "Monthly availability target: ≥ 99.5% for the gateway website and /v1 endpoint (excluding scheduled maintenance).", zh: "网关网站与 /v1 端点的月度可用性目标：≥ 99.5%（不含计划内维护）" })}</li>
          <li>{t({ en: "Scheduled maintenance is normally between 02:00–06:00 Beijing time and announced in-app or by email in advance.", zh: "计划内维护会尽量安排在北京时间 02:00–06:00 进行，并通过站内公告或邮件提前通知" })}</li>
          <li>{t({ en: "The gateway sets no aggregate timeout per WebSocket frame — streaming generation can be arbitrarily long — but idle connections may be closed defensively.", zh: "网关对单个 WebSocket 帧不设总超时，流式生成可任意长；对空闲连接有保护性断开" })}</li>
          <li>{t({ en: "The gateway never caches request bodies or response content.", zh: "网关不缓存请求体与响应内容" })}</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "2. Backend inference layer (third-party) — no platform guarantee", zh: "2. 后端推理层（第三方）— 平台不作可用性承诺" })}</h2>
        <p>
          {t({
            en: "Every model backend you see in the catalog is operated independently by a third-party provider. Their availability, context length, throughput, latency, concurrency, and quality depend on that provider. The Platform does NOT offer any availability, latency, or quality guarantee for any specific backend. The platform provides the following fallback tooling, but whether you use it is your responsibility:",
            zh: "模型广场中的每一个后端都由独立的第三方提供者运营，其可用性、上下文长度、吞吐、延迟、并发与质量均由提供者决定，平台对任何具体后端不提供可用性、延迟或质量承诺。平台提供以下兜底机制供你使用，但是否启用是你的责任：",
          })}
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "Periodic health probing of online backends (", zh: "定期对在线后端执行健康探测（" })}<code>/v1/models</code>{t({ en: " checks); offline backends are automatically removed from routing.", zh: " 检查），离线后端自动从路由中剔除" })}</li>
          <li><strong>{t({ en: "You should activate multiple subscriptions for the same model and order them by priority in My Subscriptions — this is your fallback plan.", zh: "请在「我的订阅」中为同一模型激活多条订阅并按优先级排序 — 这就是你的兜底方案。" })}</strong>{" "}{t({ en: "When the request ", zh: "当请求体 " })}<code>model</code>{t({ en: " is ", zh: " 为 " })}<code>Auto</code>{t({ en: ", failover spans subscriptions; when it is ", zh: " 时跨订阅回退；为 " })}<code>&lt;model&gt;</code>{t({ en: ", failover happens only between backends of that model; when it is ", zh: " 时仅在该 model 的多个后端间回退；为 " })}<code>&lt;model&gt;/&lt;backend_name&gt;</code>{t({ en: ", a single backend is locked with no failover.", zh: " 时锁定单一后端不回退" })}</li>
          <li>{t({ en: "If you only activate a single backend, an outage of that single backend will fail your requests — the platform cannot route to something you did not subscribe to.", zh: "如果你只激活了单个后端，该后端故障时你的请求会失败 — 平台无法跳到你未订阅的后端" })}</li>
          <li>{t({ en: "For mission-critical workloads we recommend activating at least one BYOK upstream (your own commercial API key) as a last-resort fallback alongside community-GPU backends.", zh: "生产环境建议除社区 GPU 后端外，至少激活一条 BYOK（你自己的商业 API Key）作为最后兜底" })}</li>
          <li>{t({ en: "Tunnel-based backends go offline automatically when the connection drops and come back online when it recovers.", zh: "隧道后端连接断开自动下线，恢复后自动上线" })}</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "3. Billing fairness", zh: "3. 计费公平性" })}</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "The upstream-returned ", zh: "上游返回的 " })}<code>usage</code>{t({ en: " is the billing source of truth; if upstream returns no usage (e.g. the connection is broken mid-flight), the request is not billed.", zh: " 是计费依据；若上游未返回 usage（如连接中途断开），该请求不计费" })}</li>
          <li>{t({ en: "Requests with ", zh: "请求 " })}<code>model</code>{t({ en: " set to ", zh: " 为 " })}<code>Auto</code>{t({ en: " or ", zh: " 或 " })}<code>&lt;model&gt;</code>{t({ en: " may trigger failover; if the preferred backend does not produce a full response, it is not billed — only the hop that successfully produced usage is billed.", zh: " 会触发回退；若首选后端无完整响应，则不按首选计费，只对最终成功产生 usage 的那一跳计费" })}</li>
          <li>{t({ en: "Invoices and per-call usage details are always available on the Usage and Invoices pages.", zh: "账单和用量明细可随时在「用量」「账单」页查询" })}</li>
          <li>{t({ en: "Top ups are non-refundable; please see the Terms of Service.", zh: "充值不接受退款，详见《服务条款》" })}</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "4. Incident reporting", zh: "4. 故障报告" })}</h2>
        <p>
          {t({ en: "If you encounter a platform issue or unexpected billing, email ", zh: "如果您遇到平台故障或异常计费，请发送邮件至 " })}
          <a className="text-fg ml-1" href="mailto:bleu_jours@outlook.com">bleu_jours@outlook.com</a>
          {t({ en: " — please include the timestamp, API key prefix, and the rough request parameters so we can investigate. After verification, abnormal charges can be credited to your invoice.", zh: "，建议附上时间、API Key 前缀、请求的大致参数以便定位。核实后可对异常扣费进行账单抵扣。" })}
        </p>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "5. Disclaimer", zh: "5. 免责" })}</h2>
        <p>
          {t({
            en: "The following types of disruption do not count toward gateway availability: force majeure, third-party network or cloud-vendor outages, third-party backend outages, user or provider operational errors, compliance-driven takedowns, and pre-announced maintenance.",
            zh: "以下情形造成的服务中断不计入网关可用性计算：不可抗力、第三方网络/云厂商故障、第三方后端故障、用户自身或提供者自身的误操作、合规原因下架、已提前公告的维护。",
          })}
        </p>
      </section>
    </article>
  )
}
