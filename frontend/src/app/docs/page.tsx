"use client"

import { useEffect, useState } from "react"

const NAV_SECTIONS = [
  { id: "intro", label: "平台简介" },
  { id: "quickstart", label: "快速开始" },
  { id: "api-call", label: "API 调用" },
  { id: "routing", label: "路由与失败转移" },
  { id: "errors", label: "错误码" },
  { id: "billing", label: "计费与账单" },
  { id: "account", label: "账户与邮箱验证" },
  { id: "api-ref", label: "API 端点参考" },
  { id: "provider", label: "提供者接入指南" },
]

export default function DocsPage() {
  const [active, setActive] = useState("intro")

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length > 0) {
          const top = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b))
          setActive(top.target.id)
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 }
    )
    NAV_SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  const scrollTo = (id: string) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" })
      setActive(id)
    }
  }

  return (
    <div className="flex gap-8 min-h-[calc(100vh-8rem)]">
      {/* Left Sidebar */}
      <aside className="w-48 shrink-0 sticky top-24 self-start h-[calc(100vh-6rem)] overflow-y-auto">
        <nav className="space-y-1">
          {NAV_SECTIONS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              className={`block w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                active === id
                  ? "bg-accent-soft text-fg font-medium"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 max-w-4xl py-8">

      {/* 平台简介 */}
      <section id="intro" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">平台简介</h2>
        <div className="bg-white rounded-lg border p-6 space-y-3 text-gray-700 text-sm leading-relaxed">
          <p>
            <strong>天枢</strong> 是一个模型服务聚合平台，连接 AI 消费者与模型提供者。
            提供者将 GPU 机器上运行的模型服务注册到平台，消费者通过统一的 OpenAI 兼容 API 调用这些模型。
          </p>
          <p>平台支持两种接入模式：</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong>直连模式</strong>：后端服务有公网 IP，平台直接转发请求</li>
            <li><strong>隧道模式</strong>：后端在 NAT/内网后，通过 WebSocket 隧道穿透连接</li>
          </ul>
          <p>核心特性：</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>完全兼容 OpenAI API，可直接使用 OpenAI SDK</li>
            <li>支持流式 (SSE) 和非流式；流式响应自动回传 <code>usage</code> 用于计费</li>
            <li>统一 <code>/v1</code> 入口：按用户激活订阅的<strong>优先级</strong>路由，可选失败转移</li>
            <li>按 token 用量计费，提供者自定义每百万 token 单价，平台后付费月结</li>
            <li>自动健康检查，实时展示后端在线状态</li>
          </ul>
        </div>
      </section>

      {/* 快速开始 */}
      <section id="quickstart" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">快速开始</h2>

        {/* 5 分钟跑通 */}
        <div className="bg-accent-soft border border-line rounded-lg p-6 mb-4 text-sm text-gray-700">
          <h3 className="font-semibold text-base text-fg mb-2">5 分钟跑通</h3>
          <ol className="list-decimal list-inside space-y-1.5 ml-1">
            <li>在 <a href="/register" className="text-fg underline">注册</a> 页用邮箱验证码完成注册</li>
            <li>在 <a href="/models" className="text-fg underline">模型广场</a> 选一个免费模型，点「订阅」</li>
            <li>进入 <a href="/my-subscriptions" className="text-fg underline">我的订阅</a>，把它<strong>激活</strong></li>
            <li>在 <a href="/dashboard/keys" className="text-fg underline">API Key</a> 页创建一个 <code>sk-xxxx</code></li>
            <li>把下面这条 curl 里的 <code>sk-your-api-key</code> 和 <code>MODEL_NAME</code> 换成自己的：</li>
          </ol>
          <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-x-auto mt-3">
            <pre>{`curl https://your-gateway/v1/chat/completions \\
  -H "Authorization: Bearer sk-your-api-key" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"MODEL_NAME","messages":[{"role":"user","content":"你好"}]}'`}</pre>
          </div>
          <p className="text-xs text-gray-600 mt-2">
            <code>MODEL_NAME</code> 用模型广场或 <code>GET /v1/models</code> 里的 <code>id</code> 字段。完整的模型清单和最新价格以广场为准，不在本文档维护。
          </p>
        </div>

        <div className="bg-white rounded-lg border p-6 space-y-4 text-sm text-gray-700">
          <div>
            <h3 className="font-semibold text-base text-gray-800 mb-2">消费者完整路径</h3>
            <ol className="list-decimal list-inside space-y-1.5 ml-2">
              <li>注册：邮箱 + 6 位验证码（10 分钟有效，60 秒限流，每小时 3 条）；登录同样需要密码 + 验证码</li>
              <li>模型广场订阅 → 我的订阅页激活 → 按优先级拖拽排序</li>
              <li>API Key 页创建 <code>sk-xxxx</code>，把它当作 OpenAI 的 key 用</li>
              <li>调用 <code>/v1</code> 时平台按激活订阅的优先级自动选后端，详见下文「路由」</li>
            </ol>
          </div>
          <div>
            <h3 className="font-semibold text-base text-gray-800 mb-2">提供者完整路径</h3>
            <ol className="list-decimal list-inside space-y-1.5 ml-2">
              <li>账号页将身份切换为 provider 或 both</li>
              <li>「我的服务」注册后端：选直连或隧道、填模型白名单与单价（详见下文「提供者接入指南」）</li>
              <li>隧道模式在本地跑 <code>tunnel_client.py</code>（建议 systemd 托管，见下）</li>
              <li>点「申请上架」进入审核；通过后自动出现在广场，被驳回可看 review_note 修改后重新提交</li>
            </ol>
          </div>
        </div>

        {/* API Key vs sub_key 决策树 */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 mt-4 text-sm text-gray-700">
          <h3 className="font-semibold text-base text-amber-900 mb-2">API Key 还是 sub_key？</h3>
          <ul className="space-y-1.5 ml-1">
            <li>· <strong>99% 场景用 API Key</strong>（<code>sk-xxxx</code>）。它走 <code>/v1</code>，按激活订阅优先级自动路由 + 失败转移。</li>
            <li>· <strong>sub_key</strong> 只在你需要<em>强制锁定</em>到某一家提供者的某个后端时用，例如对比测试或诊断。它走 <code>/s/&#123;sub_key&#125;/v1</code>，<strong>不</strong>走路由也<strong>不</strong>转移。</li>
            <li>· 一个 API Key 调用所有激活订阅；一个 sub_key 只对应一条订阅。</li>
          </ul>
        </div>
      </section>

      {/* API 调用 */}
      <section id="api-call" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">API 调用</h2>
        <div className="space-y-6">

          {/* 方式一：API Key */}
          <div className="bg-white rounded-lg border p-6">
            <h3 className="font-semibold text-base text-gray-800 mb-3">方式一：API Key + 统一 /v1（推荐）</h3>
            <p className="text-sm text-gray-600 mb-3">
              在「API Key」页面创建 key，通过标准 OpenAI 格式调用 <code>/v1</code>。平台会按你<strong>激活的订阅的优先级</strong>选择后端（详见下方「路由与失败转移」）。
            </p>
            <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
              <pre>{`curl https://your-gateway/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-your-api-key" \\
  -d '{
    "model": "Qwen/Qwen3-8B",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'`}</pre>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              流式请求平台会自动注入 <code>stream_options.include_usage=true</code>，最后一条 chunk 会携带 token 统计。
            </p>
          </div>

          {/* OpenAI SDK */}
          <div className="bg-white rounded-lg border p-6">
            <h3 className="font-semibold text-base text-gray-800 mb-3">使用 OpenAI SDK（Python）</h3>
            <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
              <pre>{`from openai import OpenAI

client = OpenAI(
    base_url="https://your-gateway/v1",
    api_key="sk-your-api-key",
)

resp = client.chat.completions.create(
    model="Qwen/Qwen3-8B",
    messages=[{"role": "user", "content": "你好"}],
    stream=True,
)

for chunk in resp:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")`}</pre>
            </div>
          </div>

          {/* 方式二：sub_key 直达 */}
          <div className="bg-white rounded-lg border p-6">
            <h3 className="font-semibold text-base text-gray-800 mb-3">方式二：sub_key 直达（不经路由）</h3>
            <p className="text-sm text-gray-600 mb-3">
              订阅生成的 <code>sub_key</code> 可直接定位到某一个具体后端，<strong>不走</strong>优先级与失败转移。适合调试或强制指定某家提供者的场景。
            </p>
            <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
              <pre>{`curl https://your-gateway/s/{sub_key}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "Qwen/Qwen3-8B",
    "messages": [{"role": "user", "content": "你好"}]
  }'`}</pre>
            </div>
            <p className="text-xs text-gray-500 mt-2">sub_key 可在「我的订阅」或模型详情页获取，无需 Authorization 头。</p>
          </div>
        </div>
      </section>

      {/* 路由与失败转移 */}
      <section id="routing" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">路由与失败转移</h2>
        <div className="bg-white rounded-lg border p-6 space-y-3 text-sm text-gray-700 leading-relaxed">
          <p>调用 <code>/v1/chat/completions</code>、<code>/v1/completions</code>、<code>/v1/responses</code> 时，平台只在你<strong>已激活的订阅</strong>中按优先级（订阅页可拖拽 ↑↓）选后端。同一个模型可同时订阅多个 provider，订阅时默认按 <code>input_price + output_price</code> 升序插入到该模型组末尾，可手动再调整顺序。</p>

          <div className="rounded-lg border border-line bg-accent-soft p-3 text-xs text-fg space-y-1.5">
            <div className="font-semibold">两级回退（auto_fallback = ON）</div>
            <div><span className="font-mono bg-white/60 px-1 rounded">第 1 级</span> 同一 <code>model</code> 内：按订阅优先级依次尝试，连接失败 / 5xx / 首字节超时 → 跳到下一个 provider</div>
            <div><span className="font-mono bg-white/60 px-1 rounded">第 2 级</span> 该 model 的所有 provider 全部失败 → 退到下一个已激活 model（按全局优先级），重复第 1 级</div>
            <div className="text-fg">✅ 流式请求：仅在<strong>首个 chunk 之前</strong>可重试；一旦开始向客户端 yield 数据就不再切换。</div>
            <div className="text-fg">✅ 4xx（你的请求自身有问题，比如 token 超限、参数非法）<strong>不重试</strong>，直接透传。</div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 my-2">
            <div className="border rounded-lg p-3 bg-emerald-50 border-emerald-200">
              <div className="font-semibold text-emerald-900 mb-1">auto_fallback = ON（默认）</div>
              <ul className="text-xs space-y-1 list-disc list-inside">
                <li>第 1 级：先把候选限定到 <code>model</code> 匹配的那一组，按优先级穷尽</li>
                <li>第 2 级：该组全部失败 → 跨 model 退到下一组（仍按全局优先级）</li>
                <li>没有激活订阅：退化到自有 / 公开 online 后端按 <code>model</code> 查找；都没有 → 404</li>
                <li>所有候选均失败 → <strong>503</strong>，错误体里带最多 5 条尝试摘要</li>
              </ul>
            </div>
            <div className="border rounded-lg p-3 bg-rose-50 border-rose-200">
              <div className="font-semibold text-rose-900 mb-1">auto_fallback = OFF</div>
              <ul className="text-xs space-y-1 list-disc list-inside">
                <li>必须显式指定 <code>model</code>，且 model 必须等于某条已激活订阅</li>
                <li>同一 model 多个订阅：仍会按优先级回退（第 1 级），只是<strong>不会</strong>跨 model</li>
                <li>不指定 model → <strong>400</strong></li>
                <li>没匹配到 → <strong>404</strong></li>
                <li>该 model 全部 provider 都失败 → <strong>503</strong></li>
              </ul>
            </div>
          </div>

          <p className="text-xs text-gray-500">开关在「我的订阅」页顶部，或通过 <code>POST /api/user/auto-fallback</code> 切换（请求体 <code>&#123;"enabled": true|false&#125;</code>）。</p>
          <p className="text-xs text-gray-500">没有激活任何订阅时，<code>/v1</code> 退化为按 <code>model</code> 参数在你<strong>自有或公开的 online 后端</strong>里查找；这条路径不计入路由日志的「按订阅命中」统计。</p>
        </div>
      </section>

      {/* 错误码 */}
      <section id="errors" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">错误码</h2>
        <div className="bg-white rounded-lg border p-6 space-y-3 text-sm text-gray-700 leading-relaxed">
          <p>所有错误统一为 FastAPI 默认体格式 <code>&#123;"detail": "..."&#125;</code>。<code>detail</code> 多为中文文案，前端可直接展示。下表只列<strong>调用 <code>/v1</code> 时</strong>会遇到的状态码：</p>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-gray-50">
                <tr className="text-left">
                  <th className="px-3 py-2 border">状态码</th>
                  <th className="px-3 py-2 border">含义</th>
                  <th className="px-3 py-2 border">应该怎么做</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className="px-3 py-2 border font-mono">400</td><td className="px-3 py-2 border">关闭了 auto_fallback 但请求未指定 <code>model</code></td><td className="px-3 py-2 border">补上 <code>model</code>，或开启 auto_fallback</td></tr>
                <tr><td className="px-3 py-2 border font-mono">401</td><td className="px-3 py-2 border">缺少 / 无效 / 已禁用的 API Key 或 sub_key</td><td className="px-3 py-2 border">检查 Authorization 头；在「API Key」页确认未禁用</td></tr>
                <tr><td className="px-3 py-2 border font-mono">402</td><td className="px-3 py-2 border">有逾期未付账单，账户已挂起</td><td className="px-3 py-2 border">在「账单」页结清逾期账单后自动恢复</td></tr>
                <tr><td className="px-3 py-2 border font-mono">403</td><td className="px-3 py-2 border">用户被管理员停用 / 账号已注销</td><td className="px-3 py-2 border">联系平台管理员</td></tr>
                <tr><td className="px-3 py-2 border font-mono">404</td><td className="px-3 py-2 border">没激活任何订阅 / 关闭 fallback 时 model 未匹配 / 模型不存在</td><td className="px-3 py-2 border">在「我的订阅」激活；或换 model；或在广场重新订阅</td></tr>
                <tr><td className="px-3 py-2 border font-mono">429</td><td className="px-3 py-2 border">邮件验证码相关接口的限流（登录/注册/改邮箱/注销）</td><td className="px-3 py-2 border">60 秒后或下一小时再试</td></tr>
                <tr><td className="px-3 py-2 border font-mono">503</td><td className="px-3 py-2 border">候选后端全部 offline / 隧道未连接</td><td className="px-3 py-2 border">稍后重试；提供者请检查 tunnel_client 是否在跑</td></tr>
                <tr><td className="px-3 py-2 border font-mono">5xx</td><td className="px-3 py-2 border">上游 backend 或 SSE 中途异常</td><td className="px-3 py-2 border">建议客户端实现一次小退避重试</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">
            注意：平台目前<strong>不</strong>对 <code>/v1</code> 强制 user-level 限速；429 仅出现在邮件验证码接口。后端实际吞吐由具体 backend（vLLM、上游 OpenAI 等）的容量决定，遇瓶颈时建议增加订阅或在客户端做退避。
          </p>
          <p className="text-xs text-gray-500">
            未实现的端点（如 <code>/v1/embeddings</code>、<code>/v1/images</code>、<code>/v1/audio</code>、<code>/v1/batches</code>）会按 FastAPI 默认返回 <code>404 Not Found</code>。
          </p>
        </div>
      </section>

      {/* 计费与账单 */}
      <section id="billing" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">计费与账单</h2>

        {/* 价格生效 callout */}
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4 text-sm text-amber-900">
          <strong>提供者请注意</strong>：首次注册后端的价格立即生效，此后通过「我的服务」修改 <code>input_price</code> / <code>output_price</code> / <code>cache_price</code> / <code>currency</code> 一律在<strong>次日 00:00（CST, UTC+8）</strong>才生效，写入后服务卡片显示「次日生效」徽标。当天涨价不会立刻吃到收益，当天降价也不会立刻让用户便宜。
        </div>

        <div className="bg-white rounded-lg border p-6 space-y-3 text-sm text-gray-700 leading-relaxed">
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              计费粒度：每次请求按返回的 <code>usage.prompt_tokens</code> / <code>usage.completion_tokens</code>（<code>/v1/responses</code> 为 <code>input_tokens</code> / <code>output_tokens</code>）× 后端单价结算
            </li>
            <li>单价由提供者在注册后端时设定，单位为「货币 / 百万 token」，分输入与输出两档；货币支持 CNY / USD</li>
            <li>
              <strong>时区与计量颗粒度</strong>：所有时间按 <code>CST（UTC+8）</code> 统计。每次请求实时写入<strong>小时桶</strong>（<code>usage_hourly</code>），每日 00:00 把前一日的小时桶聚合归档到日表（<code>usage_daily</code>）
            </li>
            <li>
              <strong>缓存命中统计</strong>：若上游返回 <code>usage.prompt_tokens_details.cached_tokens</code>（OpenAI / vLLM 前缀缓存）、<code>prompt_cache_hit_tokens</code>（DeepSeek）或 <code>cache_read_input_tokens</code>（Anthropic），网关会累计到 <code>cached_tokens</code>，并在使用明细与「我的服务」卡片上展示命中率。如果服务提供者设置了 <code>cache_price</code>，则缓存命中部分按缓存价计费、其余输入按 <code>input_price</code> 计费；若未设置，则默认按输入价的 10% 计费（对齐 OpenAI / Anthropic / DeepSeek / 阿里百炼显式缓存的行业通行折扣）。缓存价同样支持「次日 00:00 CST 生效」。
            </li>
            <li><strong>后付费月结</strong>：账单在每月 1 日自动生成，展示于「账单」页，多货币分账单单独结算；「本月用量/花费」汇总以本月为统计窗口，归档结算后自动归零，历史底账仍可在 <code>/api/usage/daily</code> 回看</li>
            <li>
              <strong>平台技术服务费（Platform Technical Service Fee）</strong>：本网关作为撮合 + 算力转接 + 计费结算的技术服务提供方，按账单金额的 <strong>1%</strong> 收取平台技术服务费（发票品目：<code>*现代服务*技术服务费</code>）。<span className="text-emerald-700 font-medium">试运营期间，平台技术服务费减免 100%，用户与服务提供者均不产生额外费用</span>。试运营结束后将在本页面提前公告生效日期与具体收取方式。
            </li>
            <li><strong>自有模型 100% 减免</strong>：当你订阅/调用的是自己名下的后端模型时，统计依然记录 token 与单价，但「按模型汇总」与账单结算阶段会全额减免，不会进入 <code>current_month_cost</code> 与月账单。「使用明细」的小时表与日表会单独列出 <em>自有模型减免</em> 与 <em>实际计费</em> 两列方便核对</li>
            <li>未支付账单累计超出限额会暂停 API 调用，支付后自动恢复</li>
            <li>
              <strong>提前结清本月账单</strong>：若计划离开或注销账号，可在 <strong>取消所有订阅 + 下架所有服务 + 账户静默 30 分钟</strong> 后，通过 <code>POST /api/billing/settle-now</code>（或账单页「提前结清」按钮）把本月用量立即出账；出账幂等按 <em>年月 × 货币</em>，本月若再产生计费会另起一张账单
            </li>
            <li>实时用量与本月累计费用可在「仪表盘」、<code>GET /api/billing/status</code>、<code>GET /api/billing/settle-now/eligibility</code>（查询能否提前结清）、<code>GET /api/usage</code>（按模型汇总）、<code>GET /api/usage/hourly</code>（今日按小时）、<code>GET /api/usage/daily?days=N</code>（历史按天）查询</li>
          </ul>
        </div>
      </section>

      {/* 账户与邮箱验证 */}
      <section id="account" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">账户与邮箱验证</h2>
        <div className="bg-white rounded-lg border p-6 space-y-3 text-sm text-gray-700 leading-relaxed">
          <p>
            平台所有敏感账户操作都需要通过<strong>邮箱 6 位验证码</strong>二次确认，包括：
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong>注册</strong>（<code>purpose: "register"</code>）：验证邮箱所有权</li>
            <li><strong>登录</strong>（<code>purpose: "login"</code>）：密码 + 验证码双因子</li>
            <li><strong>修改邮箱</strong>（<code>purpose: "change-email"</code>）：发送到<strong>新</strong>邮箱</li>
            <li><strong>注销账号</strong>（<code>purpose: "delete-account"</code>）：发送到当前绑定邮箱</li>
          </ul>
          <p>
            验证码规则：
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>长度 6 位数字，单条有效期 <strong>10 分钟</strong></li>
            <li>发送限流：同一邮箱同一用途 <strong>60 秒内</strong>最多 1 条；<strong>1 小时内</strong>最多 3 条</li>
            <li>每条验证码最多尝试 <strong>5 次</strong>，超限或过期自动作废，需重新发送</li>
            <li>登录用途的 <code>send-code</code> 入参可填<strong>用户名或邮箱</strong>，系统会自动发到账号绑定的邮箱</li>
          </ul>
          <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
            <pre>{`# 1. 登录前先索取验证码
curl -X POST https://your-gateway/api/auth/send-code \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "purpose": "login"}'
# => {"ok": true}

# 2. 带验证码登录
curl -X POST https://your-gateway/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"login": "you@example.com", "password": "xxxxx", "code": "123456"}'`}</pre>
          </div>
          <p>
            <strong>修改密码 / 注销账号</strong> 均在个人中心「账号密码」页完成：修改密码弹窗要求原密码；注销账号需依次输入当前密码、邮箱验证码并键入 <code>DELETE</code> 三重确认。
          </p>
          <p>
            <strong>注销前置 5 步（任何一步不满足，后端直接返回 400）：</strong>
          </p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>取消全部订阅（<code>subscriptions.is_active = 1</code> 必须为 0 条）</li>
            <li>下架 / 撤回审核全部名下后端（无 <code>listed</code> / <code>pending</code>）</li>
            <li>账户静默至少 <strong>30 分钟</strong>（最近一个 <code>usage_hourly</code> 桶距今 ≥ 30 min，防止漏计在途请求）</li>
            <li>用 <code>POST /api/billing/settle-now</code> 把当前月份用量提前出账（<code>current_month_cost == 0</code>）</li>
            <li>结清全部未付账单（<code>unpaid_total == 0</code>）</li>
          </ol>
          <p>
            admin 账号不可自助注销。软删除会把 <code>username</code> 改成 <code>deleted_&#123;id&#125;_&#123;rand&#125;_&#123;原用户名&#125;</code>（便于审计回溯），<code>email</code> 置为 <code>deleted_&#123;id&#125;_&#123;rand&#125;@deleted.invalid</code>，账单与用量记录保留。
          </p>
        </div>
      </section>

      {/* API 端点参考 */}
      <section id="api-ref" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">API 端点参考</h2>
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-700">方法</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">端点</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">说明</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr><td colSpan={3} className="px-4 py-2 bg-gray-50 font-semibold text-gray-600 text-xs">OpenAI 兼容（统一 /v1，需 Bearer API Key）</td></tr>
              <tr>
                <td className="px-4 py-2"><code className="text-fg">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/v1/chat/completions</td>
                <td className="px-4 py-2 text-gray-600">聊天补全（按激活订阅优先级路由）</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-fg">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/v1/completions</td>
                <td className="px-4 py-2 text-gray-600">文本补全</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-fg">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/v1/responses</td>
                <td className="px-4 py-2 text-gray-600">Responses API</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-green-600">GET</code></td>
                <td className="px-4 py-2 font-mono text-xs">/v1/models</td>
                <td className="px-4 py-2 text-gray-600">列出可用模型（优先返回已激活订阅绑定的模型）</td>
              </tr>

              <tr><td colSpan={3} className="px-4 py-2 bg-gray-50 font-semibold text-gray-600 text-xs">sub_key 直达</td></tr>
              <tr>
                <td className="px-4 py-2"><code className="text-fg">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/s/&#123;sub_key&#125;/v1/chat/completions</td>
                <td className="px-4 py-2 text-gray-600">直达订阅绑定的单个后端（不走路由）</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-green-600">GET</code></td>
                <td className="px-4 py-2 font-mono text-xs">/s/&#123;sub_key&#125;/v1/models</td>
                <td className="px-4 py-2 text-gray-600">列出订阅绑定的模型</td>
              </tr>

              <tr><td colSpan={3} className="px-4 py-2 bg-gray-50 font-semibold text-gray-600 text-xs">模型广场</td></tr>
              <tr>
                <td className="px-4 py-2"><code className="text-green-600">GET</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/models</td>
                <td className="px-4 py-2 text-gray-600">获取所有已上架的公开模型</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-green-600">GET</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/models/&#123;model_id&#125;</td>
                <td className="px-4 py-2 text-gray-600">获取模型详情</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-green-600">GET</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/model-families</td>
                <td className="px-4 py-2 text-gray-600">获取支持的模型类别</td>
              </tr>

              <tr><td colSpan={3} className="px-4 py-2 bg-gray-50 font-semibold text-gray-600 text-xs">订阅管理</td></tr>
              <tr>
                <td className="px-4 py-2"><code className="text-fg">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/subscriptions</td>
                <td className="px-4 py-2 text-gray-600">订阅模型</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-green-600">GET</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/subscriptions</td>
                <td className="px-4 py-2 text-gray-600">列出我的订阅（含激活状态与优先级）</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-yellow-600">PUT</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/subscriptions/&#123;id&#125;/activate</td>
                <td className="px-4 py-2 text-gray-600">激活/取消激活某条订阅</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-yellow-600">PUT</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/subscriptions/reorder</td>
                <td className="px-4 py-2 text-gray-600">调整订阅优先级顺序</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-red-600">DELETE</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/subscriptions/&#123;id&#125;</td>
                <td className="px-4 py-2 text-gray-600">取消订阅</td>
              </tr>

              <tr><td colSpan={3} className="px-4 py-2 bg-gray-50 font-semibold text-gray-600 text-xs">API Key 与账户</td></tr>
              <tr>
                <td className="px-4 py-2"><code className="text-fg">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/keys</td>
                <td className="px-4 py-2 text-gray-600">创建 API Key</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-green-600">GET</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/keys</td>
                <td className="px-4 py-2 text-gray-600">列出我的 API Key</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-yellow-600">PUT</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/keys/&#123;key_id&#125;/toggle</td>
                <td className="px-4 py-2 text-gray-600">启用/禁用 Key</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-red-600">DELETE</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/keys/&#123;key_id&#125;</td>
                <td className="px-4 py-2 text-gray-600">删除 Key</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-fg">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/user/auto-fallback</td>
                <td className="px-4 py-2 text-gray-600">开关自动失败转移</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-green-600">GET</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/billing/status</td>
                <td className="px-4 py-2 text-gray-600">查询本月用量与未付账单</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-green-600">GET</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/billing/settle-now/eligibility</td>
                <td className="px-4 py-2 text-gray-600">能否提前结清本月账单（返回 <code>eligible</code> + <code>reasons</code> 清单）</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-fg">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/billing/settle-now</td>
                <td className="px-4 py-2 text-gray-600">把本月用量立即出账（需无激活订阅、无 listed/pending 后端、静默 ≥ 30 分钟）</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-green-600">GET</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/usage</td>
                <td className="px-4 py-2 text-gray-600">按模型汇总调用明细（默认近 7 天，<code>days</code> 可选）</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-green-600">GET</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/usage/hourly</td>
                <td className="px-4 py-2 text-gray-600">今日按小时桶（CST, UTC+8）</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-green-600">GET</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/usage/daily</td>
                <td className="px-4 py-2 text-gray-600">历史按天归档（不含今日）</td>
              </tr>

              <tr><td colSpan={3} className="px-4 py-2 bg-gray-50 font-semibold text-gray-600 text-xs">后端管理（提供者）</td></tr>
              <tr>
                <td className="px-4 py-2"><code className="text-fg">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/backends</td>
                <td className="px-4 py-2 text-gray-600">注册后端</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-green-600">GET</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/backends</td>
                <td className="px-4 py-2 text-gray-600">列出后端（<code>mine=true</code> 仅自己）</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-green-600">GET</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/backends/&#123;name&#125;</td>
                <td className="px-4 py-2 text-gray-600">获取后端详情</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-yellow-600">PUT</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/backends/&#123;name&#125;</td>
                <td className="px-4 py-2 text-gray-600">编辑后端</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-yellow-600">PUT</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/backends/&#123;name&#125;/toggle</td>
                <td className="px-4 py-2 text-gray-600">申请上架（→审核中） / 撤回 / 下架</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-red-600">DELETE</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/backends/&#123;name&#125;</td>
                <td className="px-4 py-2 text-gray-600">删除后端</td>
              </tr>

              <tr><td colSpan={3} className="px-4 py-2 bg-gray-50 font-semibold text-gray-600 text-xs">认证与账户</td></tr>
              <tr>
                <td className="px-4 py-2"><code className="text-fg">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/auth/send-code</td>
                <td className="px-4 py-2 text-gray-600">索取邮箱验证码（purpose: register / login / change-email / delete-account）</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-fg">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/auth/register</td>
                <td className="px-4 py-2 text-gray-600">注册（需先调用 send-code 并带上 <code>code</code>）</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-fg">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/auth/login</td>
                <td className="px-4 py-2 text-gray-600">登录：<code>login</code> + <code>password</code> + <code>code</code></td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-green-600">GET</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/auth/me</td>
                <td className="px-4 py-2 text-gray-600">获取当前用户信息</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-fg">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/auth/change-password</td>
                <td className="px-4 py-2 text-gray-600">修改密码（<code>old_password</code> + <code>new_password</code>）</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-fg">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/auth/change-email</td>
                <td className="px-4 py-2 text-gray-600">修改邮箱（需 <code>change-email</code> 用途的验证码）</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-fg">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/auth/delete-account</td>
                <td className="px-4 py-2 text-gray-600">自助注销（<code>password</code> + <code>code</code> + <code>confirm: "DELETE"</code>，软删除；需先通过上述 5 项注销前置）</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 提供者接入指南 */}
      <section id="provider" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">提供者接入指南</h2>

        {/* 直连 vs 隧道 */}
        <div className="bg-white rounded-lg border p-6 space-y-4 text-sm text-gray-700">
          <h3 className="font-semibold text-base text-gray-800">1. 选模式：直连 / 隧道</h3>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong>直连（direct）</strong>：你的后端有公网可达地址（含通过反向 SSH 等手段暴露到本机 loopback 的）。注册时填 <code>url</code>，平台直接 httpx 转发。</li>
            <li><strong>隧道（tunnel）</strong>：后端在 NAT/内网，没有公网 IP。注册后在本地跑 <code>tunnel_client.py</code>，由 client 主动 WebSocket 连到平台，平台借这条连接反向请求后端。</li>
          </ul>
        </div>

        {/* 字段含义 */}
        <div className="bg-white rounded-lg border p-6 space-y-3 text-sm text-gray-700 mt-4">
          <h3 className="font-semibold text-base text-gray-800">2. 注册表单关键字段</h3>
          <ul className="list-disc list-inside space-y-1.5 ml-2">
            <li><code>name</code>：后端名（全局唯一）。隧道模式下，<code>tunnel_client.py</code> 的 <code>--backend-name</code> 必须与之一致。</li>
            <li><code>models</code>：你对外暴露的 OpenAI 兼容模型 ID 列表（用户请求里的 <code>model</code> 字段）。多模型用换行分隔。</li>
            <li><code>client_info.model_map</code>（可选）：把对外 ID 翻译成上游真实 ID。例：对外 <code>Qwen/Qwen3.6-35B-A3B</code> → 上游 <code>qwen36-awq</code>。不填即透传。</li>
            <li><code>client_info.api_key</code>（可选，仅 direct）：转发时附加的 <code>Authorization: Bearer &lt;key&gt;</code>。<strong>仅 owner / admin 可见</strong>。</li>
            <li><code>input_price / output_price / cache_price</code>：单位「货币 / 1M tokens」。<code>cache_price</code> 不填默认按 <code>input_price × 0.1</code> 计费。</li>
          </ul>
        </div>

        {/* 隧道客户端 */}
        <div className="bg-white rounded-lg border p-6 space-y-3 text-sm text-gray-700 mt-4">
          <h3 className="font-semibold text-base text-gray-800">3. 隧道客户端</h3>
          <p>仓库 <code>backend/tunnel_client.py</code>，依赖 <code>websockets</code> + <code>httpx</code>：</p>
          <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-x-auto">
            <pre>{`python tunnel_client.py \\
  --gateway   wss://your-gateway/ws/tunnel \\
  --token     sk-你的-provider-API-Key \\
  --backend-name 你注册的后端名 \\
  --local-url http://127.0.0.1:8000`}</pre>
          </div>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><code>--token</code> 用你账号下任一 API Key（<code>sk-xxxx</code>），不是登录密码。</li>
            <li>连接建立后后端自动标记 <code>online</code>，断开自动 <code>offline</code>。客户端内置自动重连与心跳，无需 systemd 之外的额外守护。</li>
            <li>SSE 按行实时转发；流式生成无总超时，仅做空闲保护。</li>
          </ul>

          <p className="text-gray-800 font-medium mt-2">推荐用 systemd 托管（24×7）：</p>
          <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-x-auto">
            <pre>{`# /etc/systemd/system/tianshu-tunnel@.service
[Unit]
Description=Tianshu tunnel client (%i)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=lkang
WorkingDirectory=/home/lkang/llm-gateway/backend
EnvironmentFile=/etc/tianshu/%i.env
ExecStart=/home/lkang/llm-gateway/backend/.venv/bin/python tunnel_client.py \\
  --gateway   \${GATEWAY} \\
  --token     \${TOKEN} \\
  --backend-name \${BACKEND_NAME} \\
  --local-url \${LOCAL_URL}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target`}</pre>
          </div>
          <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-x-auto">
            <pre>{`# /etc/tianshu/qwen36.env
GATEWAY=wss://your-gateway/ws/tunnel
TOKEN=sk-xxxxxxxx
BACKEND_NAME=vllm-qwen36-awq
LOCAL_URL=http://127.0.0.1:8002

# 启用
sudo systemctl daemon-reload
sudo systemctl enable --now tianshu-tunnel@qwen36
sudo journalctl -u tianshu-tunnel@qwen36 -f`}</pre>
          </div>
        </div>

        {/* 审核状态机 */}
        <div className="bg-white rounded-lg border p-6 space-y-3 text-sm text-gray-700 mt-4">
          <h3 className="font-semibold text-base text-gray-800">4. 上架审核流程</h3>
          <p>新注册的后端默认 <code>offline</code> + <code>private</code>，只对 owner 可见。状态机：</p>
          <pre className="bg-gray-50 border rounded p-3 text-xs leading-relaxed overflow-x-auto">{`offline ──[申请上架]──▶ pending ──[admin approve]──▶ listed
   ▲                       │
   │                       └─[admin reject + note]──▶ offline (附 review_note)
   │
   └──[owner 主动下架 / admin 强制下架]── listed`}</pre>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>「申请上架」按钮在 <a href="/my-services" className="text-fg underline">我的服务</a> 卡片上。</li>
            <li>被驳回时 <code>review_note</code> 会显示在卡片上；按 note 修改后再次点「申请上架」即可重新进入 pending。</li>
            <li>已 listed 的后端，编辑价格/货币/cache 价不会触发重新审核，但会按上面「次日 00:00 CST 生效」的规则延后。</li>
            <li>注销账号或下架前必须先把所有 listed/pending 的后端撤回到 offline。</li>
          </ul>
        </div>
      </section>
    </div>
    </div>
  )
}
