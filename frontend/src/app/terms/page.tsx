export const metadata = { title: "服务条款 - 天枢" }

export default function TermsPage() {
  return (
    <article className="max-w-3xl mx-auto prose prose-sm text-gray-700">
      <h1 className="text-2xl font-semibold text-gray-800 mb-2">服务条款</h1>
      <p className="text-xs text-gray-500 mb-6">最后更新：2026-04-24</p>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-800">1. 协议范围</h2>
        <p>
          欢迎使用天枢（以下称「本平台」）。本平台是一个聚合 LLM 模型服务的技术中介平台，向<strong>消费者</strong>（通过 API 调用模型的用户）与<strong>提供者</strong>（接入自有 GPU 机器对外提供模型的用户）同时开放。
          注册或使用本平台即视为您已阅读、理解并同意本条款。
        </p>

        <h2 className="text-lg font-semibold text-gray-800">2. 账户</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>账户信息真实、准确、完整；因虚假信息导致的一切后果由注册者自行承担</li>
          <li>账户及 API Key 请妥善保管，因泄露造成的调用及计费由账户持有人负责</li>
          <li>本平台有权对违反条款的账户进行限制或注销</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">3. 消费者（调用方）</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>按实际使用的 token 数量与对应后端单价后付费结算</li>
          <li>
            调用内容须符合所在地法律法规，不得用于非法用途，包括但不限于：生成违法信息、侵权内容、
            恶意代码、垃圾信息、对未成年人不当内容等
          </li>
          <li>对调用结果的使用、分发、二次加工由消费者自行承担法律责任</li>
          <li>未按时结清账单的，平台可暂停 API 调用，直至账单结清</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">4. 提供者（算力方）</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>须对所接入的模型与权重拥有合法使用和对外提供服务的权利</li>
          <li>所申报的模型名称、定价、上下文长度等信息须真实、与实际后端一致</li>
          <li>不得在平台路由中注入广告、敏感内容、劫持内容或恶意返回</li>
          <li>应保障最终发给用户的推理结果的完整性，不得篡改或故意降级</li>
          <li>服务下架或停机时应及时在「我的服务」中切换为下架状态，避免影响订阅者</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">5. 禁止行为</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>尝试绕过计费、伪造 token 统计、爬取平台数据</li>
          <li>对平台、其他用户的后端或隧道连接发起 DoS 或暴力破解</li>
          <li>滥用自动失败转移机制进行异常高频重试</li>
          <li>在平台上传、分发违法、侵权、恶意内容</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">6. 内容责任</h2>
        <p>
          本平台仅作为<strong>中立的技术通道</strong>，不对任何模型生成的内容进行事前审查，也不对内容的真实性、准确性、合法性、
          适用性作出任何明示或默示的保证。生成内容由对应的模型提供者与最终使用者共同承担相应责任。
        </p>

        <h2 className="text-lg font-semibold text-gray-800">7. 服务变更与终止</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>平台可能因维护、升级、第三方服务中断等原因暂停部分功能，将尽可能提前公告</li>
          <li>对于违反本条款或相关法律的账户，平台有权立即终止服务并保留追索权利</li>
          <li>用户可随时注销账户；注销后未结清账单仍有义务结清</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">8. 免责</h2>
        <p>
          在适用法律允许的最大范围内，本平台对因使用或无法使用本服务而导致的任何间接、偶然、特殊或后果性损失（包括但不限于利润损失、
          数据损失）不承担责任。
        </p>

        <h2 className="text-lg font-semibold text-gray-800">9. 条款变更</h2>
        <p>
          本条款可能随业务发展更新。更新后将在本页面发布并修改「最后更新」日期，继续使用本平台即视为接受新条款。
        </p>
      </section>
    </article>
  )
}
