"use client"

import { useT } from "@/context/LocaleContext"

export default function SlaPage() {
  const t = useT()
  return (
    <article className="max-w-3xl mx-auto prose prose-sm text-gray-700">
      <h1 className="text-2xl font-semibold text-gray-800 mb-2">{t({ en: "Service Level Agreement", zh: "服务等级说明" })}</h1>
      <p className="text-xs text-gray-500 mb-6">{t({ en: "Last updated: 2026-04-24", zh: "最后更新：2026-04-24" })}</p>

      <section className="space-y-3">
        <p>
          {t({
            en: "Tianshu has two layers: the gateway layer (routing, billing, accounts) and the backend inference layer run by third-party providers. This page describes availability targets for each layer separately.",
            zh: "天枢平台由网关层（路由、计费、账户）和由第三方提供者运行的后端推理层构成。本页分别说明两层的可用性目标。",
          })}
        </p>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "1. Gateway layer", zh: "1. 网关层" })}</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "Monthly availability target: ≥ 99.5% (excluding scheduled maintenance).", zh: "月度目标可用性：≥ 99.5%（不含计划内维护）" })}</li>
          <li>{t({ en: "Scheduled maintenance is normally between 02:00–06:00 Beijing time and announced in-app or by email in advance.", zh: "计划内维护会尽量安排在北京时间 02:00–06:00 进行，并通过站内公告或邮件提前通知" })}</li>
          <li>{t({ en: "The gateway sets no aggregate timeout per WebSocket frame — streaming generation can be arbitrarily long — but idle connections may be closed defensively.", zh: "网关对单个 WebSocket 帧不设总超时，流式生成可任意长；对空闲连接有保护性断开" })}</li>
          <li>{t({ en: "The gateway never caches request bodies or response content.", zh: "网关不缓存请求体与响应内容" })}</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "2. Backend inference layer", zh: "2. 后端推理层" })}</h2>
        <p>
          {t({
            en: "Backends are run independently by providers; their availability, context length, throughput, latency, and concurrency depend on the provider. The Platform does not offer a unified availability guarantee for any specific backend. To reduce the impact of single-point failures we apply the following mechanisms:",
            zh: "后端由各提供者独立运行，其可用性、上下文长度、吞吐、延迟、并发能力由对应提供者决定，平台不对具体后端的可用性提供统一承诺。平台采取以下机制降低单点故障影响：",
          })}
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "Periodic health probing of online backends (", zh: "定期对在线后端执行健康探测（" })}<code>/v1/models</code>{t({ en: " checks); offline backends are automatically removed from routing.", zh: " 检查），离线后端自动从路由中剔除" })}</li>
          <li>{t({ en: "Users can activate multiple subscriptions with priorities: when the request ", zh: "用户可激活多条订阅并设置优先级：请求体 " })}<code>model</code>{t({ en: " is ", zh: " 为 " })}<code>Auto</code>{t({ en: ", failover spans subscriptions; when it is ", zh: " 时跨订阅回退；为 " })}<code>&lt;model&gt;</code>{t({ en: ", failover happens only between backends of that model; when it is ", zh: " 时仅在该 model 的多个后端间回退；为 " })}<code>&lt;model&gt;/&lt;backend_name&gt;</code>{t({ en: ", a single backend is locked with no failover.", zh: " 时锁定单一后端不回退" })}</li>
          <li>{t({ en: "Tunnel-based backends go offline automatically when the connection drops and come back online when it recovers.", zh: "隧道后端连接断开自动下线，恢复后自动上线" })}</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "3. Billing fairness", zh: "3. 计费公平性" })}</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "The upstream-returned ", zh: "上游返回的 " })}<code>usage</code>{t({ en: " is the billing source of truth; if upstream returns no usage (e.g. the connection is broken mid-flight), the request is not billed.", zh: " 是计费依据；若上游未返回 usage（如连接中途断开），该请求不计费" })}</li>
          <li>{t({ en: "Requests with ", zh: "请求 " })}<code>model</code>{t({ en: " set to ", zh: " 为 " })}<code>Auto</code>{t({ en: " or ", zh: " 或 " })}<code>&lt;model&gt;</code>{t({ en: " may trigger failover; if the preferred backend does not produce a full response, it is not billed — only the hop that successfully produced usage is billed.", zh: " 会触发回退；若首选后端无完整响应，则不按首选计费，只对最终成功产生 usage 的那一跳计费" })}</li>
          <li>{t({ en: "Invoices and per-call usage details are always available on the Usage and Invoices pages.", zh: "账单和用量明细可随时在「用量」「账单」页查询" })}</li>
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
            en: "The following types of disruption do not count toward availability: force majeure, third-party network or cloud-vendor outages, user or provider operational errors, compliance-driven takedowns, and pre-announced maintenance.",
            zh: "以下情形造成的服务中断不计入可用性计算：不可抗力、第三方网络/云厂商故障、用户自身或提供者自身的误操作、合规原因下架、已提前公告的维护。",
          })}
        </p>
      </section>
    </article>
  )
}
