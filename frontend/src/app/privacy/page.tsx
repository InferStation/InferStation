export const metadata = { title: "隐私政策 - 天枢" }

export default function PrivacyPage() {
  return (
    <article className="max-w-3xl mx-auto prose prose-sm text-gray-700">
      <h1 className="text-2xl font-semibold text-gray-800 mb-2">隐私政策</h1>
      <p className="text-xs text-gray-500 mb-6">最后更新：2026-04-24</p>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-800">1. 我们收集的信息</h2>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>账户信息</strong>：用户名、邮箱、密码哈希</li>
          <li><strong>订阅与 API Key</strong>：订阅关系、优先级、Key 前缀与哈希（我们不会保存明文 Key）</li>
          <li>
            <strong>调用元数据</strong>：时间戳、所选模型、路由到的后端、token 数量、HTTP 状态码
            （用于计费和用量展示）
          </li>
          <li>
            <strong>运行日志</strong>：转发过程中的错误、健康检查结果（用于保障可用性，不涉及对话内容）
          </li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">2. 我们不保存的内容</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>
            用户发送给模型的<strong>请求正文</strong>（prompts / messages）以及模型返回的<strong>生成内容</strong>
            不会被平台持久化存储
          </li>
          <li>仅在转发期间驻留内存；流式响应逐片透传，不写入磁盘</li>
          <li>如需诊断问题，平台可能在得到用户明确同意后才临时捕获相关请求</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">3. 提供者侧的处理</h2>
        <p>
          当您通过平台调用某个后端时，您的请求体（包含对话内容）会<strong>直接转发</strong>到对应模型<strong>提供者</strong>的后端。
          提供者对请求内容有独立的处理和日志策略，平台无法对提供者的存储行为做出保证。建议在调用敏感内容前：
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li>查看模型详情页，了解提供者的承诺</li>
          <li>优先选择您信任的提供者</li>
          <li>或通过自建后端订阅使用（即成为自己服务的消费者）</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">4. 信息使用</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>提供服务、路由请求、生成账单与用量报表</li>
          <li>监控平台健康状况、诊断故障、防范滥用</li>
          <li>就账户、账单相关事宜与用户进行邮件通信</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">5. 信息披露</h2>
        <p>我们不会将您的个人信息出售给第三方。仅在以下情形可能披露相关信息：</p>
        <ul className="list-disc list-inside space-y-1">
          <li>应法律法规或具有管辖权的执法/司法机关要求</li>
          <li>为防范严重欺诈、滥用或保护他人合法权益所必需</li>
          <li>经您明确同意的其他情形</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">6. 安全</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>账户密码使用单向哈希存储，平台无法还原明文</li>
          <li>API Key 仅在创建时一次性展示，后续仅存储哈希</li>
          <li>所有外部通信使用 HTTPS / WSS 加密</li>
          <li>数据库备份仅管理员可访问</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">7. 您的权利</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>可随时在「账户设置」中修改邮箱、密码</li>
          <li>可随时撤销或删除 API Key / 订阅</li>
          <li>可在「账号密码」页底部自助注销账户（需密码 + 邮箱验证码 + 键入 <code>DELETE</code> 三重确认，软删除保留审计底账；未付账单需先结清）</li>
          <li>可通过邮件申请导出个人相关数据</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">8. 联系方式</h2>
        <p>
          对本隐私政策有任何问题，请发送邮件至 <a className="text-indigo-600" href="mailto:support@tianshu-gateway.cloud">support@tianshu-gateway.cloud</a>。
        </p>
      </section>
    </article>
  )
}
