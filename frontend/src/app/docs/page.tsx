"use client"

import { useEffect, useState } from "react"

const NAV_SECTIONS = [
  { id: "intro", label: "平台简介" },
  { id: "quickstart", label: "快速开始" },
  { id: "api-call", label: "API 调用" },
  { id: "routing", label: "路由与失败转移" },
  { id: "billing", label: "计费与账单" },
  { id: "api-ref", label: "API 端点参考" },
  { id: "tunnel", label: "隧道模式接入" },
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
                  ? "bg-indigo-50 text-indigo-700 font-medium"
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
        <div className="bg-white rounded-lg border p-6 space-y-4 text-sm text-gray-700">
          <div>
            <h3 className="font-semibold text-base text-gray-800 mb-2">消费者</h3>
            <ol className="list-decimal list-inside space-y-1.5 ml-2">
              <li>注册账号并登录</li>
              <li>在「模型广场」浏览并订阅感兴趣的模型</li>
              <li>进入「我的订阅」，点击<strong>激活</strong>需要使用的订阅，并按优先级排序</li>
              <li>在「API Key」页面创建一个 key（格式 <code>sk-xxxx</code>）</li>
              <li>使用 OpenAI SDK 调用 <code>/v1</code>，平台会按订阅优先级自动选择后端</li>
            </ol>
          </div>
          <div>
            <h3 className="font-semibold text-base text-gray-800 mb-2">提供者</h3>
            <ol className="list-decimal list-inside space-y-1.5 ml-2">
              <li>注册账号，在「我的服务」中激活提供者身份</li>
              <li>注册后端服务（选择直连或隧道模式），填写支持的模型与单价</li>
              <li>如果是隧道模式，在本地运行 <code>tunnel_client.py</code> 建立连接</li>
              <li>手动点击「上架」，模型即在广场中可见</li>
            </ol>
          </div>
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
          <p>
            调用 <code>/v1/chat/completions</code>、<code>/v1/completions</code>、<code>/v1/responses</code> 时，平台按以下规则选择后端：
          </p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>只考虑你在「我的订阅」中<strong>已激活</strong>的订阅</li>
            <li>按订阅的<strong>优先级</strong>（可在订阅页拖拽排序）从高到低依次尝试</li>
            <li>优先选择 <code>model</code> 参数匹配、且后端 <code>status=online</code> 的订阅</li>
            <li>
              如果用户开启了 <strong>auto_fallback</strong>（默认开启），在首选不可用时会继续向后尝试其他激活订阅；
              关闭后则严格按最高优先级，单点失败时返回错误
            </li>
          </ol>
          <p>
            开关位于「我的订阅」页顶部，或通过 <code>POST /api/user/auto-fallback</code> 调整：
          </p>
          <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
            <pre>{`curl -X POST https://your-gateway/api/user/auto-fallback \\
  -H "Authorization: Bearer <web_token>" \\
  -H "Content-Type: application/json" \\
  -d '{"enabled": true}'`}</pre>
          </div>
          <p className="text-xs text-gray-500">
            没有激活任何订阅时，<code>/v1</code> 会退化为按 <code>model</code> 参数在你<strong>自有或公开的 online 后端</strong>里查找。
          </p>
        </div>
      </section>

      {/* 计费与账单 */}
      <section id="billing" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">计费与账单</h2>
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
              <strong>价格生效时间</strong>：首次注册后端的价格立即生效；注册后通过「我的服务」修改价格/货币一律在<strong>次日 00:00（CST, UTC+8）</strong>生效。当前挂起的价格会在服务卡片上以「次日生效」徽标展示
            </li>
            <li><strong>后付费月结</strong>：账单在每月 1 日自动生成，展示于「账单」页，多货币分账单单独结算</li>
            <li>未支付账单累计超出限额会暂停 API 调用，支付后自动恢复</li>
            <li>实时用量与本月累计费用可在「仪表盘」、<code>GET /api/billing/status</code>、<code>GET /api/usage</code>（按模型汇总）、<code>GET /api/usage/hourly</code>（今日按小时）、<code>GET /api/usage/daily?days=N</code>（历史按天）查询</li>
          </ul>
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
                <td className="px-4 py-2"><code className="text-indigo-600">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/v1/chat/completions</td>
                <td className="px-4 py-2 text-gray-600">聊天补全（按激活订阅优先级路由）</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-indigo-600">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/v1/completions</td>
                <td className="px-4 py-2 text-gray-600">文本补全</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-indigo-600">POST</code></td>
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
                <td className="px-4 py-2"><code className="text-indigo-600">POST</code></td>
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
                <td className="px-4 py-2"><code className="text-indigo-600">POST</code></td>
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
                <td className="px-4 py-2"><code className="text-indigo-600">POST</code></td>
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
                <td className="px-4 py-2"><code className="text-indigo-600">POST</code></td>
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
                <td className="px-4 py-2"><code className="text-indigo-600">POST</code></td>
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
                <td className="px-4 py-2 text-gray-600">上架/下架</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-red-600">DELETE</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/backends/&#123;name&#125;</td>
                <td className="px-4 py-2 text-gray-600">删除后端</td>
              </tr>

              <tr><td colSpan={3} className="px-4 py-2 bg-gray-50 font-semibold text-gray-600 text-xs">认证</td></tr>
              <tr>
                <td className="px-4 py-2"><code className="text-indigo-600">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/auth/register</td>
                <td className="px-4 py-2 text-gray-600">注册</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-indigo-600">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/auth/login</td>
                <td className="px-4 py-2 text-gray-600">登录</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-green-600">GET</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/auth/me</td>
                <td className="px-4 py-2 text-gray-600">获取当前用户信息</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 隧道模式 */}
      <section id="tunnel" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">隧道模式接入</h2>
        <div className="bg-white rounded-lg border p-6 space-y-4 text-sm text-gray-700">
          <p>
            如果你的 GPU 机器在 NAT/内网，没有公网 IP，可以使用隧道模式。
            在注册后端时选择「隧道」模式，然后在本地运行隧道客户端：
          </p>
          <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
            <pre>{`python tunnel_client.py \\
  --gateway wss://your-gateway/ws/tunnel \\
  --token sk-你的-provider-token \\
  --backend-name 你的后端名称 \\
  --local-url http://localhost:8000`}</pre>
          </div>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>连接建立后后端自动标记为 <code>online</code>，断开后自动 <code>offline</code></li>
            <li>平台对每个 WebSocket 帧不设总超时（流式生成可任意长），仅对空闲做保护</li>
            <li>SSE 流按行实时转发，首字延迟与直连接近</li>
            <li>平台定期发送健康探测验证后端可用性</li>
          </ul>
        </div>
      </section>
    </div>
    </div>
  )
}
