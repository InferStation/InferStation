"use client"

import { useT } from "@/context/LocaleContext"

export default function PrivacyPage() {
  const t = useT()
  return (
    <article className="max-w-3xl mx-auto prose prose-sm text-gray-700">
      <h1 className="text-2xl font-semibold text-gray-800 mb-2">{t({ en: "Privacy Policy", zh: "隐私政策" })}</h1>
      <p className="text-xs text-gray-500 mb-6">{t({ en: "Last updated: 2026-04-24", zh: "最后更新：2026-04-24" })}</p>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "1. Information we collect", zh: "1. 我们收集的信息" })}</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "Account info: username, email, password hash.", zh: "账户信息：用户名、邮箱、密码哈希" })}</li>
          <li>{t({ en: "Subscriptions & API keys: subscription relationships, priority, key prefix and hash (plaintext keys are never stored).", zh: "订阅与 API Key：订阅关系、优先级、Key 前缀与哈希（我们不会保存明文 Key）" })}</li>
          <li>{t({ en: "Call metadata: timestamp, selected model, routed backend, token counts, HTTP status (used for billing and usage display).", zh: "调用元数据：时间戳、所选模型、路由到的后端、token 数量、HTTP 状态码（用于计费和用量展示）" })}</li>
          <li>{t({ en: "Operational logs: errors during forwarding and health-check results (for availability; no conversation content).", zh: "运行日志：转发过程中的错误、健康检查结果（用于保障可用性，不涉及对话内容）" })}</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "2. What we do not store", zh: "2. 我们不保存的内容" })}</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "Request bodies (prompts / messages) and the generated content returned by the model are never persisted by the Platform.", zh: "用户发送给模型的请求正文（prompts / messages）以及模型返回的生成内容不会被平台持久化存储" })}</li>
          <li>{t({ en: "They only live in memory during forwarding; streaming responses are passed through chunk-by-chunk without writing to disk.", zh: "仅在转发期间驻留内存；流式响应逐片透传，不写入磁盘" })}</li>
          <li>{t({ en: "If diagnostics require it, we may temporarily capture relevant requests only after explicit user consent.", zh: "如需诊断问题，平台可能在得到用户明确同意后才临时捕获相关请求" })}</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "3. Handling on the provider side", zh: "3. 提供者侧的处理" })}</h2>
        <p>
          {t({
            en: "When you call a backend through the Platform, your request body (including conversation content) is forwarded directly to the corresponding provider's backend. Providers have their own independent handling and logging policies, and the Platform cannot guarantee a provider's storage behavior. Before sending sensitive content, we recommend:",
            zh: "当您通过平台调用某个后端时，您的请求体（包含对话内容）会直接转发到对应模型提供者的后端。提供者对请求内容有独立的处理和日志策略，平台无法对提供者的存储行为做出保证。建议在调用敏感内容前：",
          })}
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "Read the model detail page to understand the provider's commitments.", zh: "查看模型详情页，了解提供者的承诺" })}</li>
          <li>{t({ en: "Prefer providers you already trust.", zh: "优先选择您信任的提供者" })}</li>
          <li>{t({ en: "Or subscribe via your own self-hosted backend (i.e. become a consumer of your own service).", zh: "或通过自建后端订阅使用（即成为自己服务的消费者）" })}</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "4. How we use information", zh: "4. 信息使用" })}</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "Provide the service, route requests, and generate invoices and usage reports.", zh: "提供服务、路由请求、生成账单与用量报表" })}</li>
          <li>{t({ en: "Monitor platform health, diagnose issues, and prevent abuse.", zh: "监控平台健康状况、诊断故障、防范滥用" })}</li>
          <li>{t({ en: "Email users about account- and billing-related matters.", zh: "就账户、账单相关事宜与用户进行邮件通信" })}</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "5. Disclosure", zh: "5. 信息披露" })}</h2>
        <p>{t({ en: "We do not sell personal information to third parties. We may disclose information only in the following cases:", zh: "我们不会将您的个人信息出售给第三方。仅在以下情形可能披露相关信息：" })}</p>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "When required by laws, regulations, or competent law-enforcement / judicial authorities.", zh: "应法律法规或具有管辖权的执法/司法机关要求" })}</li>
          <li>{t({ en: "When necessary to prevent serious fraud or abuse, or to protect the legal rights of others.", zh: "为防范严重欺诈、滥用或保护他人合法权益所必需" })}</li>
          <li>{t({ en: "Other cases for which you have given explicit consent.", zh: "经您明确同意的其他情形" })}</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "6. Security", zh: "6. 安全" })}</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "Account passwords are stored as one-way hashes; we cannot recover the plaintext.", zh: "账户密码使用单向哈希存储，平台无法还原明文" })}</li>
          <li>{t({ en: "API keys are shown once at creation only; afterwards we only store the hash.", zh: "API Key 仅在创建时一次性展示，后续仅存储哈希" })}</li>
          <li>{t({ en: "All external communication is encrypted with HTTPS / WSS.", zh: "所有外部通信使用 HTTPS / WSS 加密" })}</li>
          <li>{t({ en: "Database backups are accessible to administrators only.", zh: "数据库备份仅管理员可访问" })}</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "7. Your rights", zh: "7. 您的权利" })}</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "Update your email and password at any time from Account settings.", zh: "可随时在「账户设置」中修改邮箱、密码" })}</li>
          <li>{t({ en: "Revoke or delete API keys / subscriptions at any time.", zh: "可随时撤销或删除 API Key / 订阅" })}</li>
          <li>{t({ en: "Self-serve account deletion at the bottom of the Account page (password + email code + typing ", zh: "可在「账号密码」页底部自助注销账户（需密码 + 邮箱验证码 + 键入 " })}<code>DELETE</code>{t({ en: " — triple confirmation; soft-delete preserves audit records; outstanding invoices must be paid first).", zh: " 三重确认，软删除保留审计底账；未付账单需先结清）" })}</li>
          <li>{t({ en: "Request export of your personal data via email.", zh: "可通过邮件申请导出个人相关数据" })}</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "8. Contact", zh: "8. 联系方式" })}</h2>
        <p>
          {t({ en: "Questions about this Privacy Policy? Email ", zh: "对本隐私政策有任何问题，请发送邮件至 " })}<a className="text-fg" href="mailto:bleu_jours@outlook.com">bleu_jours@outlook.com</a>.
        </p>
      </section>
    </article>
  )
}
