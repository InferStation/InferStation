"use client"

import { useT } from "@/context/LocaleContext"

export default function TermsPage() {
  const t = useT()
  return (
    <article className="max-w-3xl mx-auto prose prose-sm text-gray-700">
      <h1 className="text-2xl font-semibold text-gray-800 mb-2">{t({ en: "Terms of Service", zh: "服务条款" })}</h1>
      <p className="text-xs text-gray-500 mb-6">{t({ en: "Last updated: 2026-04-24", zh: "最后更新：2026-04-24" })}</p>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "1. Scope", zh: "1. 协议范围" })}</h2>
        <p>
          {t({
            en: "Welcome to Tianshu (the \"Platform\"). The Platform is a technical intermediary that aggregates LLM model services. It is open to both consumers (users who call models via API) and providers (users who plug in their own GPU machines to serve models). Registering for or using the Platform means you have read, understood, and accepted these Terms.",
            zh: "欢迎使用天枢（以下称「本平台」）。本平台是一个聚合 LLM 模型服务的技术中介平台，向消费者（通过 API 调用模型的用户）与提供者（接入自有 GPU 机器对外提供模型的用户）同时开放。注册或使用本平台即视为您已阅读、理解并同意本条款。",
          })}
        </p>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "2. Accounts", zh: "2. 账户" })}</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "Account information must be true, accurate, and complete; you bear all consequences of false information.", zh: "账户信息真实、准确、完整；因虚假信息导致的一切后果由注册者自行承担" })}</li>
          <li>{t({ en: "Keep your account credentials and API keys safe; calls and charges resulting from leaks are the account holder's responsibility.", zh: "账户及 API Key 请妥善保管，因泄露造成的调用及计费由账户持有人负责" })}</li>
          <li>{t({ en: "We reserve the right to restrict or terminate accounts that violate these Terms.", zh: "本平台有权对违反条款的账户进行限制或注销" })}</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "3. Consumers (callers)", zh: "3. 消费者（调用方）" })}</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "Billed post-paid by actual tokens used and the unit price of the chosen backend.", zh: "按实际使用的 token 数量与对应后端单价后付费结算" })}</li>
          <li>{t({ en: "Call content must comply with applicable laws and may not be used for illegal purposes — including, without limitation, generating illegal content, infringing content, malware, spam, or material inappropriate for minors.", zh: "调用内容须符合所在地法律法规，不得用于非法用途，包括但不限于：生成违法信息、侵权内容、恶意代码、垃圾信息、对未成年人不当内容等" })}</li>
          <li>{t({ en: "Consumers are solely responsible for their use, distribution, and downstream processing of the call results.", zh: "对调用结果的使用、分发、二次加工由消费者自行承担法律责任" })}</li>
          <li>{t({ en: "If invoices are not settled on time, the Platform may suspend API calls until invoices are paid.", zh: "未按时结清账单的，平台可暂停 API 调用，直至账单结清" })}</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "4. Providers (compute side)", zh: "4. 提供者（算力方）" })}</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "You must hold the legal rights to use the connected models and weights and to serve them externally.", zh: "须对所接入的模型与权重拥有合法使用和对外提供服务的权利" })}</li>
          <li>{t({ en: "Declared model names, pricing, context length, and other metadata must be accurate and match the real backend.", zh: "所申报的模型名称、定价、上下文长度等信息须真实、与实际后端一致" })}</li>
          <li>{t({ en: "Do not inject ads, sensitive content, hijack content, or malicious responses into the platform's routing.", zh: "不得在平台路由中注入广告、敏感内容、劫持内容或恶意返回" })}</li>
          <li>{t({ en: "Preserve the integrity of the inference results delivered to end users — do not tamper or intentionally degrade.", zh: "应保障最终发给用户的推理结果的完整性，不得篡改或故意降级" })}</li>
          <li>{t({ en: "When taking a service offline or pausing it, switch its listing status to offline in My Services in time to avoid impacting subscribers.", zh: "服务下架或停机时应及时在「我的服务」中切换为下架状态，避免影响订阅者" })}</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "5. Prohibited conduct", zh: "5. 禁止行为" })}</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "Attempting to bypass billing, falsify token counts, or scrape platform data.", zh: "尝试绕过计费、伪造 token 统计、爬取平台数据" })}</li>
          <li>{t({ en: "Launching DoS or brute-force attacks against the platform, other users' backends, or tunnel connections.", zh: "对平台、其他用户的后端或隧道连接发起 DoS 或暴力破解" })}</li>
          <li>{t({ en: "Abusing the automatic failover mechanism to retry abnormally and at high frequency.", zh: "滥用自动失败转移机制进行异常高频重试" })}</li>
          <li>{t({ en: "Uploading or distributing illegal, infringing, or malicious content via the Platform.", zh: "在平台上传、分发违法、侵权、恶意内容" })}</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "6. Content responsibility", zh: "6. 内容责任" })}</h2>
        <p>
          {t({
            en: "The Platform acts as a neutral technical channel. We do not pre-screen any model-generated content and make no express or implied warranty regarding its truthfulness, accuracy, legality, or suitability. Generated content is the joint responsibility of the corresponding model provider and the end user.",
            zh: "本平台仅作为中立的技术通道，不对任何模型生成的内容进行事前审查，也不对内容的真实性、准确性、合法性、适用性作出任何明示或默示的保证。生成内容由对应的模型提供者与最终使用者共同承担相应责任。",
          })}
        </p>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "7. Service changes and termination", zh: "7. 服务变更与终止" })}</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>{t({ en: "We may suspend parts of the service for maintenance, upgrades, or third-party outages, with advance notice where possible.", zh: "平台可能因维护、升级、第三方服务中断等原因暂停部分功能，将尽可能提前公告" })}</li>
          <li>{t({ en: "For accounts that violate these Terms or applicable law, we may terminate service immediately and reserve the right to seek remedies.", zh: "对于违反本条款或相关法律的账户，平台有权立即终止服务并保留追索权利" })}</li>
          <li>{t({ en: "Users may delete their account at any time; outstanding invoices remain payable after deletion.", zh: "用户可随时注销账户；注销后未结清账单仍有义务结清" })}</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "8. Disclaimer", zh: "8. 免责" })}</h2>
        <p>
          {t({
            en: "To the maximum extent permitted by applicable law, the Platform shall not be liable for any indirect, incidental, special, or consequential damages (including loss of profit or data) arising from use of or inability to use the service.",
            zh: "在适用法律允许的最大范围内，本平台对因使用或无法使用本服务而导致的任何间接、偶然、特殊或后果性损失（包括但不限于利润损失、数据损失）不承担责任。",
          })}
        </p>

        <h2 className="text-lg font-semibold text-gray-800">{t({ en: "9. Updates to the Terms", zh: "9. 条款变更" })}</h2>
        <p>
          {t({
            en: "These Terms may be updated as the service evolves. Updates will be published on this page with the \"Last updated\" date revised; continued use of the Platform constitutes acceptance of the new Terms.",
            zh: "本条款可能随业务发展更新。更新后将在本页面发布并修改「最后更新」日期，继续使用本平台即视为接受新条款。",
          })}
        </p>
      </section>
    </article>
  )
}
