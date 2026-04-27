export const metadata = { title: "服务等级 - 天枢" }

export default function SlaPage() {
  return (
    <article className="max-w-3xl mx-auto prose prose-sm text-gray-700">
      <h1 className="text-2xl font-semibold text-gray-800 mb-2">服务等级说明</h1>
      <p className="text-xs text-gray-500 mb-6">最后更新：2026-04-24</p>

      <section className="space-y-3">
        <p>
          天枢平台由<strong>网关层</strong>（路由、计费、账户）和由第三方<strong>提供者</strong>运行的<strong>后端推理层</strong>构成。
          本页分别说明两层的可用性目标。
        </p>

        <h2 className="text-lg font-semibold text-gray-800">1. 网关层</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>月度目标可用性：<strong>≥ 99.5%</strong>（不含计划内维护）</li>
          <li>计划内维护会尽量安排在北京时间 02:00–06:00 进行，并通过站内公告或邮件提前通知</li>
          <li>网关对单个 WebSocket 帧不设总超时，流式生成可任意长；对空闲连接有保护性断开</li>
          <li>网关不缓存请求体与响应内容</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">2. 后端推理层</h2>
        <p>
          后端由各提供者独立运行，其可用性、上下文长度、吞吐、延迟、并发能力由对应提供者决定，
          平台不对具体后端的可用性提供统一承诺。平台采取以下机制降低单点故障影响：
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li>定期对在线后端执行健康探测（<code>/v1/models</code> 检查），离线后端自动从路由中剔除</li>
          <li>用户可激活多条订阅并设置优先级：请求体 <code>model</code> 为 <code>Auto</code> 时跨订阅回退；为 <code>&lt;model&gt;</code> 时仅在该 model 的多个后端间回退；为 <code>&lt;model&gt;/&lt;backend_name&gt;</code> 时锁定单一后端不回退</li>
          <li>隧道后端连接断开自动下线，恢复后自动上线</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">3. 计费公平性</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>
            上游返回的 <code>usage</code> 是计费依据；若上游未返回 usage（如连接中途断开），该请求不计费
          </li>
          <li>
            请求 <code>model</code> 为 <code>Auto</code> 或 <code>&lt;model&gt;</code> 会触发回退；若首选后端无完整响应，则不按首选计费，只对最终<strong>成功产生 usage</strong>
            的那一跳计费
          </li>
          <li>账单和用量明细可随时在「用量」「账单」页查询</li>
        </ul>

        <h2 className="text-lg font-semibold text-gray-800">4. 故障报告</h2>
        <p>
          如果您遇到平台故障或异常计费，请发送邮件至
          <a className="text-fg ml-1" href="mailto:support@tianshu-gateway.cloud">support@tianshu-gateway.cloud</a>，
          建议附上时间、API Key 前缀、请求的大致参数以便定位。核实后可对异常扣费进行账单抵扣。
        </p>

        <h2 className="text-lg font-semibold text-gray-800">5. 免责</h2>
        <p>
          以下情形造成的服务中断不计入可用性计算：不可抗力、第三方网络/云厂商故障、用户自身或提供者自身的误操作、
          合规原因下架、已提前公告的维护。
        </p>
      </section>
    </article>
  )
}
