"use client"

import { useEffect, useState } from "react"
import { useT, type Bilingual } from "@/context/LocaleContext"

const NAV_SECTIONS: { id: string; label: Bilingual }[] = [
  { id: "intro", label: { en: "Overview", zh: "平台简介" } },
  { id: "quickstart", label: { en: "Quickstart", zh: "快速开始" } },
  { id: "api-call", label: { en: "API calls", zh: "API 调用" } },
  { id: "routing", label: { en: "Routing & failover", zh: "路由与失败转移" } },
  { id: "errors", label: { en: "Error codes", zh: "错误码" } },
  { id: "billing", label: { en: "Billing", zh: "计费与账单" } },
  { id: "account", label: { en: "Accounts & email codes", zh: "账户与邮箱验证" } },
  { id: "api-ref", label: { en: "API reference", zh: "API 端点参考" } },
  { id: "provider", label: { en: "Provider guide", zh: "提供者接入指南" } },
]

export default function DocsPage() {
  const t = useT()
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
              {t(label)}
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex-1 max-w-4xl py-8">

      <section id="intro" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">{t({ en: "Overview", zh: "平台简介" })}</h2>
        <div className="bg-white rounded-lg border p-6 space-y-3 text-gray-700 text-sm leading-relaxed">
          <p>
            {t({
              en: "Tianshu is a model-service aggregation platform that connects AI consumers with model providers. Providers register model services running on GPU machines with the platform; consumers call them through a unified OpenAI-compatible API.",
              zh: "天枢是一个模型服务聚合平台，连接 AI 消费者与模型提供者。提供者将 GPU 机器上运行的模型服务注册到平台，消费者通过统一的 OpenAI 兼容 API 调用这些模型。",
            })}
          </p>
          <p>{t({ en: "Two integration modes:", zh: "平台支持两种接入模式：" })}</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>{t({ en: "Direct mode: the backend has a publicly reachable IP; the platform forwards requests directly.", zh: "直连模式：后端服务有公网 IP，平台直接转发请求" })}</li>
            <li>{t({ en: "Tunnel mode: the backend lives behind NAT / a private network and is reached via a WebSocket tunnel.", zh: "隧道模式：后端在 NAT/内网后，通过 WebSocket 隧道穿透连接" })}</li>
          </ul>
          <p>{t({ en: "Core features:", zh: "核心特性：" })}</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>{t({ en: "Fully OpenAI-API compatible — works with the OpenAI SDK as-is.", zh: "完全兼容 OpenAI API，可直接使用 OpenAI SDK" })}</li>
            <li>{t({ en: "Streaming (SSE) and non-streaming; streaming responses automatically include ", zh: "支持流式 (SSE) 和非流式；流式响应自动回传 " })}<code>usage</code>{t({ en: " for billing.", zh: " 用于计费" })}</li>
            <li>{t({ en: "Unified ", zh: "统一 " })}<code>/v1</code>{t({ en: " endpoint: routes by the priority of activated subscriptions, with optional failover.", zh: " 入口：按用户激活订阅的优先级路由，可选失败转移" })}</li>
            <li>{t({ en: "Token-based billing; providers set their own per-million-token price; post-paid monthly settlement.", zh: "按 token 用量计费，提供者自定义每百万 token 单价，平台后付费月结" })}</li>
            <li>{t({ en: "Automatic health checks with real-time online status.", zh: "自动健康检查，实时展示后端在线状态" })}</li>
          </ul>
        </div>
      </section>

      <section id="quickstart" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">{t({ en: "Quickstart", zh: "快速开始" })}</h2>

        <div className="bg-accent-soft border border-line rounded-lg p-6 mb-4 text-sm text-gray-700">
          <h3 className="font-semibold text-base text-fg mb-2">{t({ en: "5-minute walkthrough", zh: "5 分钟跑通" })}</h3>
          <ol className="list-decimal list-inside space-y-1.5 ml-1">
            <li>{t({ en: "Sign up on the ", zh: "在 " })}<a href="/register" className="text-fg underline">{t({ en: "register", zh: "注册" })}</a>{t({ en: " page using an email verification code.", zh: " 页用邮箱验证码完成注册" })}</li>
            <li>{t({ en: "Pick a free model in the ", zh: "在 " })}<a href="/models" className="text-fg underline">{t({ en: "model catalog", zh: "模型广场" })}</a>{t({ en: " and click Subscribe.", zh: " 选一个免费模型，点「订阅」" })}</li>
            <li>{t({ en: "Open ", zh: "进入 " })}<a href="/my-subscriptions" className="text-fg underline">{t({ en: "My Subscriptions", zh: "我的订阅" })}</a>{t({ en: " and activate it.", zh: "，把它激活" })}</li>
            <li>{t({ en: "Create an ", zh: "在 " })}<a href="/dashboard/keys" className="text-fg underline">{t({ en: "API key", zh: "API Key" })}</a>{t({ en: " (an ", zh: " 页创建一个 " })}<code>sk-xxxx</code>{t({ en: ").", zh: "" })}</li>
            <li>{t({ en: "Replace ", zh: "把下面这条 curl 里的 " })}<code>sk-your-api-key</code>{t({ en: " and ", zh: " 和 " })}<code>MODEL_NAME</code>{t({ en: " in the curl below with your own:", zh: " 换成自己的：" })}</li>
          </ol>
          <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-x-auto mt-3">
            <pre>{`curl https://your-gateway/v1/chat/completions \\
  -H "Authorization: Bearer sk-your-api-key" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"MODEL_NAME","messages":[{"role":"user","content":"hello"}]}'`}</pre>
          </div>
          <p className="text-xs text-gray-600 mt-2">
            {t({ en: "Use the ", zh: "" })}<code>MODEL_NAME</code>{t({ en: " from the catalog or the ", zh: " 用模型广场或 " })}<code>GET /v1/models</code>{t({ en: " ", zh: " 里的 " })}<code>id</code>{t({ en: " field. The full model list and current prices live in the catalog and are not duplicated here.", zh: " 字段。完整的模型清单和最新价格以广场为准，不在本文档维护。" })}
          </p>
        </div>

        <div className="bg-white rounded-lg border p-6 space-y-4 text-sm text-gray-700">
          <div>
            <h3 className="font-semibold text-base text-gray-800 mb-2">{t({ en: "Consumer flow", zh: "消费者完整路径" })}</h3>
            <ol className="list-decimal list-inside space-y-1.5 ml-2">
              <li>{t({ en: "Register: email + 6-digit code (10-min validity, 60-second cooldown, max 3/hour); login uses password + code as well.", zh: "注册：邮箱 + 6 位验证码（10 分钟有效，60 秒限流，每小时 3 条）；登录同样需要密码 + 验证码" })}</li>
              <li>{t({ en: "Subscribe in the catalog → activate in My Subscriptions → drag to reorder by priority.", zh: "模型广场订阅 → 我的订阅页激活 → 按优先级拖拽排序" })}</li>
              <li>{t({ en: "Create an ", zh: "API Key 页创建 " })}<code>sk-xxxx</code>{t({ en: " on the API Keys page; use it like an OpenAI key.", zh: "，把它当作 OpenAI 的 key 用" })}</li>
              <li>{t({ en: "When calling ", zh: "调用 " })}<code>/v1</code>{t({ en: ", the platform routes by the priority of your activated subscriptions — see Routing below.", zh: " 时平台按激活订阅的优先级自动选后端，详见下文「路由」" })}</li>
            </ol>
          </div>
          <div>
            <h3 className="font-semibold text-base text-gray-800 mb-2">{t({ en: "Provider flow", zh: "提供者完整路径" })}</h3>
            <ol className="list-decimal list-inside space-y-1.5 ml-2">
              <li>{t({ en: "Switch your role to provider or both on the Account page.", zh: "账号页将身份切换为 provider 或 both" })}</li>
              <li>{t({ en: "Register a backend in My Services: pick direct or tunnel mode and fill model whitelist and unit price (see Provider guide below).", zh: "「我的服务」注册后端：选直连或隧道、填模型白名单与单价（详见下文「提供者接入指南」）" })}</li>
              <li>{t({ en: "For tunnel mode, run ", zh: "隧道模式在本地跑 " })}<code>tunnel_client.py</code>{t({ en: " locally (systemd recommended — see below).", zh: "（建议 systemd 托管，见下）" })}</li>
              <li>{t({ en: "Click \"Submit for listing\" to enter review; once approved your service appears in the catalog. If rejected, read the review_note, fix, and resubmit.", zh: "点「申请上架」进入审核；通过后自动出现在广场，被驳回可看 review_note 修改后重新提交" })}</li>
            </ol>
          </div>
        </div>
      </section>

      <section id="api-call" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">{t({ en: "API calls", zh: "API 调用" })}</h2>
        <div className="space-y-6">

          <div className="bg-white rounded-lg border p-6">
            <h3 className="font-semibold text-base text-gray-800 mb-3">{t({ en: "Recommended: API Key + unified /v1", zh: "方式一：API Key + 统一 /v1（推荐）" })}</h3>
            <p className="text-sm text-gray-600 mb-3">
              {t({ en: "Create a key on the API Keys page and call ", zh: "在「API Key」页面创建 key，通过标准 OpenAI 格式调用 " })}<code>/v1</code>{t({ en: " using the standard OpenAI format. The platform picks a backend by ", zh: "。平台会按你" })}<strong>{t({ en: "the priority of your activated subscriptions", zh: "激活的订阅的优先级" })}</strong>{t({ en: " (see Routing below).", zh: "选择后端（详见下方「路由与失败转移」）" })}
            </p>
            <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
              <pre>{`curl https://your-gateway/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-your-api-key" \\
  -d '{
    "model": "Auto",
    "messages": [{"role": "user", "content": "hello"}],
    "stream": true
  }'`}</pre>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {t({ en: "For streaming requests the platform automatically injects ", zh: "流式请求平台会自动注入 " })}<code>stream_options.include_usage=true</code>{t({ en: ", so the final chunk carries token statistics.", zh: "，最后一条 chunk 会携带 token 统计。" })}
            </p>
          </div>

          <div className="bg-white rounded-lg border p-6">
            <h3 className="font-semibold text-base text-gray-800 mb-3">{t({ en: "Using the OpenAI SDK (Python)", zh: "使用 OpenAI SDK（Python）" })}</h3>
            <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
              <pre>{`from openai import OpenAI

client = OpenAI(
    base_url="https://your-gateway/v1",
    api_key="sk-your-api-key",
)

resp = client.chat.completions.create(
    # three forms: "Auto" / "<model>" / "<model>/<backend_name>"
    model="Auto",
    messages=[{"role": "user", "content": "hello"}],
    stream=True,
)

for chunk in resp:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")`}</pre>
            </div>
          </div>
        </div>
      </section>

      <section id="routing" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">{t({ en: "Routing & failover", zh: "路由与失败转移" })}</h2>
        <div className="bg-white rounded-lg border p-6 space-y-3 text-sm text-gray-700 leading-relaxed">
          <p>
            {t({
              en: "When you call /v1/chat/completions, /v1/completions, or /v1/responses, the platform only routes within your activated subscriptions and follows their priority (drag ↑↓ on the subscriptions page). You can subscribe to multiple providers for the same model — new subscriptions are inserted at the end of the model group sorted by input_price + output_price ascending; you can rearrange them afterwards. Routing is fully driven by the request body's model field, in three forms:",
              zh: "调用 /v1/chat/completions、/v1/completions、/v1/responses 时，平台只在你已激活的订阅里按优先级（订阅页可拖拽 ↑↓）选后端。同一个模型可同时订阅多个 provider，订阅时默认按 input_price + output_price 升序插入到该模型组末尾，可手动再调整顺序。路由完全由请求体的 model 字段决定，三种形态：",
            })}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 my-2">
            <div className="border rounded-lg p-3 bg-emerald-50 border-emerald-200">
              <div className="font-mono font-semibold text-emerald-900 mb-1">"model": "Auto"</div>
              <div className="text-xs">{t({ en: "Failover across all activated subscriptions by global priority (online before offline; ascending sort_order within a group).", zh: "在所有已激活订阅之间按全局优先级回退（先在线后离线，组内 sort_order 升序）。" })}</div>
            </div>
            <div className="border rounded-lg p-3 bg-sky-50 border-sky-200">
              <div className="font-mono font-semibold text-sky-900 mb-1">"model": "&lt;model&gt;"</div>
              <div className="text-xs">{t({ en: "e.g. ", zh: "例如 " })}<code>"Qwen/Qwen3-32B-AWQ"</code>{t({ en: ". Failover across the backends of that model only — never across models.", zh: "。仅在该模型对应的多个后端之间回退，不跨模型。" })}</div>
            </div>
            <div className="border rounded-lg p-3 bg-rose-50 border-rose-200">
              <div className="font-mono font-semibold text-rose-900 mb-1">"model": "&lt;model&gt;/&lt;backend_name&gt;"</div>
              <div className="text-xs">{t({ en: "e.g. ", zh: "例如 " })}<code>"Qwen/Qwen3-32B-AWQ/vllm-qwen36-awq-45"</code>{t({ en: ". Locked to that single backend — 503 if offline; no failover.", zh: "。锁定到该一个后端，离线即 503，不回退。" })}</div>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-accent-soft p-3 text-xs text-fg space-y-1.5">
            <div className="font-semibold">{t({ en: "Failover rules", zh: "回退机制" })}</div>
            <div>{t({ en: "· The candidate list is generated by the three forms above and tried in order. Connection failure / 5xx / first-byte timeout → move on to the next candidate.", zh: "· 候选清单按上述三种形态生成后，平台按顺序逐个尝试。连接失败 / 5xx / 首字节超时 → 跳到下一个候选。" })}</div>
            <div>{t({ en: "· 4xx errors (your request itself is wrong: bad params, upstream 401, context overflow) are not retried — passed through as-is.", zh: "· 4xx（你的请求自身有问题：参数非法、上游 401、context 超限）不重试，直接透传错误。" })}</div>
            <div>{t({ en: "· Streaming requests can only be retried before the first chunk; once data starts flowing to the client the provider is locked in.", zh: "· 流式请求：仅在首个 chunk 之前可重试；一旦开始向客户端 yield 数据就锁死该 provider。" })}</div>
            <div>{t({ en: "· If all candidates fail → 503 with up to 5 attempt summaries in the error body.", zh: "· 全部候选失败 → 503，错误体里带最多 5 条尝试摘要。" })}</div>
          </div>

          <p className="text-xs text-gray-500">
            {t({ en: "Pull the available model list (Auto / model / model/backend) via ", zh: "可用 model 列表（含 Auto / 模型名 / 模型名/后端名 三种形态）通过 " })}<code>GET /v1/models</code>{t({ en: " — Bearer API Key required.", zh: " 拉取，需要 Bearer API Key。" })}
          </p>
          <p className="text-xs text-gray-500">
            {t({ en: "If you have no active subscriptions, ", zh: "没有激活任何订阅时，" })}<code>/v1</code>{t({ en: " falls back to looking up the literal ", zh: " 会退化为按原始 " })}<code>model</code>{t({ en: " field in your own or public online backends; this path is not counted toward subscription-hit routing stats.", zh: " 字段在你自有或公开的 online 后端里查找；这条路径不计入路由日志的「按订阅命中」统计。" })}
          </p>
        </div>
      </section>

      <section id="errors" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">{t({ en: "Error codes", zh: "错误码" })}</h2>
        <div className="bg-white rounded-lg border p-6 space-y-3 text-sm text-gray-700 leading-relaxed">
          <p>{t({ en: "All errors use FastAPI's default ", zh: "所有错误统一为 FastAPI 默认体格式 " })}<code>&#123;"detail": "..."&#125;</code>{t({ en: " body. The ", zh: "。" })}<code>detail</code>{t({ en: " message is human-readable and safe to display. The table below lists status codes you can hit when calling ", zh: " 多为中文文案，前端可直接展示。下表只列调用 " })}<code>/v1</code>{t({ en: ":", zh: " 时会遇到的状态码：" })}</p>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-gray-50">
                <tr className="text-left">
                  <th className="px-3 py-2 border">{t({ en: "Status", zh: "状态码" })}</th>
                  <th className="px-3 py-2 border">{t({ en: "Meaning", zh: "含义" })}</th>
                  <th className="px-3 py-2 border">{t({ en: "What to do", zh: "应该怎么做" })}</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className="px-3 py-2 border font-mono">400</td><td className="px-3 py-2 border">{t({ en: "Request did not specify ", zh: "请求未指定 " })}<code>model</code></td><td className="px-3 py-2 border">{t({ en: "Add a ", zh: "补上 " })}<code>model</code>{t({ en: " field (one of ", zh: " 字段（" })}<code>Auto</code> / <code>&lt;model&gt;</code> / <code>&lt;model&gt;/&lt;backend_name&gt;</code>{t({ en: ").", zh: " 三种之一）" })}</td></tr>
                <tr><td className="px-3 py-2 border font-mono">401</td><td className="px-3 py-2 border">{t({ en: "Missing / invalid / disabled API key", zh: "缺少 / 无效 / 已禁用的 API Key" })}</td><td className="px-3 py-2 border">{t({ en: "Check the Authorization header; verify the key is enabled on the API Keys page.", zh: "检查 Authorization 头；在「API Key」页确认未禁用" })}</td></tr>
                <tr><td className="px-3 py-2 border font-mono">402</td><td className="px-3 py-2 border">{t({ en: "Overdue invoice — account suspended", zh: "有逾期未付账单，账户已挂起" })}</td><td className="px-3 py-2 border">{t({ en: "Pay the overdue invoice on the Invoices page; service resumes automatically.", zh: "在「账单」页结清逾期账单后自动恢复" })}</td></tr>
                <tr><td className="px-3 py-2 border font-mono">403</td><td className="px-3 py-2 border">{t({ en: "User disabled by admin / account deleted", zh: "用户被管理员停用 / 账号已注销" })}</td><td className="px-3 py-2 border">{t({ en: "Contact a platform admin.", zh: "联系平台管理员" })}</td></tr>
                <tr><td className="px-3 py-2 border font-mono">404</td><td className="px-3 py-2 border">{t({ en: "Model matches no active subscription / model does not exist", zh: "model 未匹配任何已激活订阅 / 模型不存在" })}</td><td className="px-3 py-2 border">{t({ en: "Activate it on My Subscriptions; or change the model; or re-subscribe in the catalog.", zh: "在「我的订阅」激活；或换 model；或在广场重新订阅" })}</td></tr>
                <tr><td className="px-3 py-2 border font-mono">429</td><td className="px-3 py-2 border">{t({ en: "Rate limit on email-code endpoints (login/register/change-email/delete-account)", zh: "邮件验证码相关接口的限流（登录/注册/改邮箱/注销）" })}</td><td className="px-3 py-2 border">{t({ en: "Retry in 60 seconds, or in the next hour.", zh: "60 秒后或下一小时再试" })}</td></tr>
                <tr><td className="px-3 py-2 border font-mono">503</td><td className="px-3 py-2 border">{t({ en: "All candidate backends offline / tunnel disconnected", zh: "候选后端全部 offline / 隧道未连接" })}</td><td className="px-3 py-2 border">{t({ en: "Retry later; providers should check whether tunnel_client is running.", zh: "稍后重试；提供者请检查 tunnel_client 是否在跑" })}</td></tr>
                <tr><td className="px-3 py-2 border font-mono">5xx</td><td className="px-3 py-2 border">{t({ en: "Upstream backend or SSE error mid-flight", zh: "上游 backend 或 SSE 中途异常" })}</td><td className="px-3 py-2 border">{t({ en: "Implement a small backoff retry on the client.", zh: "建议客户端实现一次小退避重试" })}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">
            {t({ en: "Note: there is currently no enforced user-level rate limit on ", zh: "注意：平台目前不对 " })}<code>/v1</code>{t({ en: "; 429 only appears on the email-code endpoints. Real backend throughput depends on each backend's capacity (vLLM, upstream OpenAI, etc.); when you hit a bottleneck, add subscriptions or back off on the client.", zh: " 强制 user-level 限速；429 仅出现在邮件验证码接口。后端实际吞吐由具体 backend（vLLM、上游 OpenAI 等）的容量决定，遇瓶颈时建议增加订阅或在客户端做退避。" })}
          </p>
          <p className="text-xs text-gray-500">
            {t({ en: "Unimplemented endpoints (", zh: "未实现的端点（如 " })}<code>/v1/embeddings</code>, <code>/v1/images</code>, <code>/v1/audio</code>, <code>/v1/batches</code>{t({ en: ") return FastAPI's default ", zh: "）会按 FastAPI 默认返回 " })}<code>404 Not Found</code>.
          </p>
        </div>
      </section>

      <section id="billing" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">{t({ en: "Billing", zh: "计费与账单" })}</h2>

        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4 text-sm text-amber-900">
          <strong>{t({ en: "Providers, please note:", zh: "提供者请注意" })}</strong>
          {t({
            en: " — the price for a backend takes effect immediately on first registration. Afterwards, edits to input_price / output_price / cache_price / currency in My Services only take effect at 00:00 the next day (CST, UTC+8); after writing, the service card shows a \"takes effect tomorrow\" badge. A same-day price increase does not earn revenue immediately, and a same-day decrease does not give consumers the lower price immediately.",
            zh: "：首次注册后端的价格立即生效，此后通过「我的服务」修改 input_price / output_price / cache_price / currency 一律在次日 00:00（CST, UTC+8）才生效，写入后服务卡片显示「次日生效」徽标。当天涨价不会立刻吃到收益，当天降价也不会立刻让用户便宜。",
          })}
        </div>

        <div className="bg-white rounded-lg border p-6 space-y-3 text-sm text-gray-700 leading-relaxed">
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>{t({ en: "Granularity: per request, billed on the returned ", zh: "计费粒度：每次请求按返回的 " })}<code>usage.prompt_tokens</code> / <code>usage.completion_tokens</code>{t({ en: " (", zh: "（" })}<code>/v1/responses</code>{t({ en: " uses ", zh: " 为 " })}<code>input_tokens</code> / <code>output_tokens</code>{t({ en: ") × the backend's unit price.", zh: "）× 后端单价结算" })}</li>
            <li>{t({ en: "Unit prices are set by providers when registering a backend. The unit is \"currency / 1M tokens\", split into input and output. All prices are in USD.", zh: "单价由提供者在注册后端时设定，单位为「货币 / 百万 token」，分输入与输出两档；价格单位为 USD" })}</li>
            <li>{t({ en: "Time zone & granularity: all times are in CST (UTC+8). Each request is written into an hourly bucket (", zh: "时区与计量颗粒度：所有时间按 CST（UTC+8）统计。每次请求实时写入小时桶（" })}<code>usage_hourly</code>{t({ en: ") in real time; at 00:00 every day, the previous day's hourly buckets are aggregated into the daily table (", zh: "），每日 00:00 把前一日的小时桶聚合归档到日表（" })}<code>usage_daily</code>{t({ en: ").", zh: "）" })}</li>
            <li>{t({ en: "Cache-hit accounting: when upstream returns ", zh: "缓存命中统计：若上游返回 " })}<code>usage.prompt_tokens_details.cached_tokens</code>{t({ en: " (OpenAI / vLLM prefix cache), ", zh: "（OpenAI / vLLM 前缀缓存）、" })}<code>prompt_cache_hit_tokens</code>{t({ en: " (DeepSeek), or ", zh: "（DeepSeek）或 " })}<code>cache_read_input_tokens</code>{t({ en: " (Anthropic), the gateway accumulates them as ", zh: "（Anthropic），网关会累计到 " })}<code>cached_tokens</code>{t({ en: " and shows hit ratios in usage details and on My Services cards. If a provider sets ", zh: "，并在使用明细与「我的服务」卡片上展示命中率。如果服务提供者设置了 " })}<code>cache_price</code>{t({ en: ", cache-hit tokens are billed at the cache price and the rest of input at ", zh: "，则缓存命中部分按缓存价计费、其余输入按 " })}<code>input_price</code>{t({ en: "; if not, cache hits default to 10% of the input price (matching the industry standard for explicit caching at OpenAI / Anthropic / DeepSeek / Aliyun Bailian). Cache prices also follow the \"effective at 00:00 CST tomorrow\" rule.", zh: " 计费；若未设置，则默认按输入价的 10% 计费（对齐 OpenAI / Anthropic / DeepSeek / 阿里百炼显式缓存的行业通行折扣）。缓存价同样支持「次日 00:00 CST 生效」。" })}</li>
            <li>{t({ en: "Post-paid monthly billing: invoices are generated automatically on the 1st of each month and shown on the Invoices page; multi-currency settles on separate invoices. The This-Month usage/spend summary uses the current month as its window and resets to zero after closing; historical records remain available via ", zh: "后付费月结：账单在每月 1 日自动生成，展示于「账单」页，多货币分账单单独结算；「本月用量/花费」汇总以本月为统计窗口，归档结算后自动归零，历史底账仍可在 " })}<code>/api/usage/daily</code>{t({ en: ".", zh: " 回看" })}</li>
            <li>{t({ en: "Platform Technical Service Fee: the gateway acts as a matchmaking + compute relay + billing/settlement technical service provider, charging ", zh: "平台技术服务费（Platform Technical Service Fee）：本网关作为撮合 + 算力转接 + 计费结算的技术服务提供方，按账单金额的 " })}<strong>1%</strong>{t({ en: " of the invoice amount as the platform technical service fee (invoice category: ", zh: " 收取平台技术服务费（发票品目：" })}<code>*Modern Services*Technical Service Fee</code>{t({ en: ").", zh: "）。" })}<span className="text-emerald-700 font-medium">{t({ en: "During the trial period, this fee is 100% waived — neither consumers nor providers are charged extra.", zh: "试运营期间，平台技术服务费减免 100%，用户与服务提供者均不产生额外费用" })}</span>{t({ en: " The effective date and exact charging method after the trial will be announced in advance on this page.", zh: "。试运营结束后将在本页面提前公告生效日期与具体收取方式。" })}</li>
            <li>{t({ en: "Self-owned-model 100% waiver: when you subscribe to / call a backend you own, the platform still records tokens and unit prices, but the \"per-model summary\" and the invoice settlement stage waive the amount entirely — it is excluded from ", zh: "自有模型 100% 减免：当你订阅/调用的是自己名下的后端模型时，统计依然记录 token 与单价，但「按模型汇总」与账单结算阶段会全额减免，不会进入 " })}<code>current_month_cost</code>{t({ en: " and from monthly invoices. Hourly and daily tables in Usage list \"self-owned waiver\" and \"actual billed\" columns separately for reconciliation.", zh: " 与月账单。「使用明细」的小时表与日表会单独列出 自有模型减免 与 实际计费 两列方便核对" })}</li>
            <li>{t({ en: "Outstanding invoices beyond the credit limit will pause API calls; service resumes automatically once paid.", zh: "未支付账单累计超出限额会暂停 API 调用，支付后自动恢复" })}</li>
            <li>{t({ en: "Settle the current month early: if you plan to leave or delete your account, after canceling all subscriptions, taking all services offline, and 30 minutes of account silence, you can close the current month immediately via ", zh: "提前结清本月账单：若计划离开或注销账号，可在 取消所有订阅 + 下架所有服务 + 账户静默 30 分钟 后，通过 " })}<code>POST /api/billing/settle-now</code>{t({ en: " (or the \"Settle now\" button on the Invoices page). Settlement is idempotent per ", zh: "（或账单页「提前结清」按钮）把本月用量立即出账；出账幂等按 " })}<em>{t({ en: "year-month × currency", zh: "年月 × 货币" })}</em>{t({ en: "; new charges later in the month start a new invoice.", zh: "，本月若再产生计费会另起一张账单" })}</li>
            <li>{t({ en: "Real-time usage and month-to-date cost are available on the dashboard, ", zh: "实时用量与本月累计费用可在「仪表盘」、" })}<code>GET /api/billing/status</code>, <code>GET /api/billing/settle-now/eligibility</code>{t({ en: " (whether early settlement is allowed), ", zh: "（查询能否提前结清）、" })}<code>GET /api/usage</code>{t({ en: " (per-model summary), ", zh: "（按模型汇总）、" })}<code>GET /api/usage/hourly</code>{t({ en: " (today by hour), and ", zh: "（今日按小时）、" })}<code>GET /api/usage/daily?days=N</code>{t({ en: " (history by day).", zh: "（历史按天）查询" })}</li>
          </ul>
        </div>
      </section>

      <section id="account" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">{t({ en: "Accounts & email codes", zh: "账户与邮箱验证" })}</h2>
        <div className="bg-white rounded-lg border p-6 space-y-3 text-sm text-gray-700 leading-relaxed">
          <p>{t({ en: "All sensitive account operations require a 6-digit email verification code, including:", zh: "平台所有敏感账户操作都需要通过邮箱 6 位验证码二次确认，包括：" })}</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong>{t({ en: "Sign up", zh: "注册" })}</strong>{t({ en: " (", zh: "（" })}<code>purpose: "register"</code>{t({ en: "): proves email ownership.", zh: "）：验证邮箱所有权" })}</li>
            <li><strong>{t({ en: "Sign in", zh: "登录" })}</strong>{t({ en: " (", zh: "（" })}<code>purpose: "login"</code>{t({ en: "): password + code two-factor.", zh: "）：密码 + 验证码双因子" })}</li>
            <li><strong>{t({ en: "Change email", zh: "修改邮箱" })}</strong>{t({ en: " (", zh: "（" })}<code>purpose: "change-email"</code>{t({ en: "): code is sent to the new email.", zh: "）：发送到新邮箱" })}</li>
            <li><strong>{t({ en: "Delete account", zh: "注销账号" })}</strong>{t({ en: " (", zh: "（" })}<code>purpose: "delete-account"</code>{t({ en: "): code is sent to the currently bound email.", zh: "）：发送到当前绑定邮箱" })}</li>
          </ul>
          <p>{t({ en: "Code rules:", zh: "验证码规则：" })}</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>{t({ en: "6 digits, single-code validity ", zh: "长度 6 位数字，单条有效期 " })}<strong>{t({ en: "10 minutes", zh: "10 分钟" })}</strong>.</li>
            <li>{t({ en: "Send rate limit: per email + purpose, max 1 per ", zh: "发送限流：同一邮箱同一用途 " })}<strong>{t({ en: "60 seconds", zh: "60 秒内" })}</strong>{t({ en: " and max 3 per ", zh: "最多 1 条；" })}<strong>{t({ en: "hour", zh: "1 小时内" })}</strong>{t({ en: ".", zh: "最多 3 条" })}</li>
            <li>{t({ en: "Each code can be tried at most ", zh: "每条验证码最多尝试 " })}<strong>{t({ en: "5 times", zh: "5 次" })}</strong>{t({ en: "; over the limit or expired → invalidated automatically; resend.", zh: "，超限或过期自动作废，需重新发送" })}</li>
            <li>{t({ en: "For login, the input to ", zh: "登录用途的 " })}<code>send-code</code>{t({ en: " can be either a username or an email; the system will send to the email bound to the account.", zh: " 入参可填用户名或邮箱，系统会自动发到账号绑定的邮箱" })}</li>
          </ul>
          <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
            <pre>{`# 1. Request a code before sign-in
curl -X POST https://your-gateway/api/auth/send-code \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "purpose": "login"}'
# => {"ok": true}

# 2. Sign in with the code
curl -X POST https://your-gateway/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"login": "you@example.com", "password": "xxxxx", "code": "123456"}'`}</pre>
          </div>
          <p>
            <strong>{t({ en: "Change password / delete account", zh: "修改密码 / 注销账号" })}</strong>
            {t({ en: " are both done in the user center on the Account page. The change-password modal asks for the old password; deletion requires current password, an email code, and typing ", zh: " 均在个人中心「账号密码」页完成：修改密码弹窗要求原密码；注销账号需依次输入当前密码、邮箱验证码并键入 " })}<code>DELETE</code>{t({ en: " — triple confirmation.", zh: " 三重确认。" })}
          </p>
          <p>
            <strong>{t({ en: "5 prerequisites for deletion (any one missing → backend returns 400):", zh: "注销前置 5 步（任何一步不满足，后端直接返回 400）：" })}</strong>
          </p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>{t({ en: "Cancel all subscriptions (", zh: "取消全部订阅（" })}<code>subscriptions.is_active = 1</code>{t({ en: " must be 0 rows).", zh: " 必须为 0 条）" })}</li>
            <li>{t({ en: "Take down / withdraw review of all your backends (no ", zh: "下架 / 撤回审核全部名下后端（无 " })}<code>listed</code> / <code>pending</code>{t({ en: ").", zh: "）" })}</li>
            <li>{t({ en: "Account silent for at least ", zh: "账户静默至少 " })}<strong>{t({ en: "30 minutes", zh: "30 分钟" })}</strong>{t({ en: " (the most recent ", zh: "（最近一个 " })}<code>usage_hourly</code>{t({ en: " bucket is ≥ 30 min ago — protects against in-flight requests).", zh: " 桶距今 ≥ 30 min，防止漏计在途请求）" })}</li>
            <li>{t({ en: "Use ", zh: "用 " })}<code>POST /api/billing/settle-now</code>{t({ en: " to close the current month early (", zh: " 把当前月份用量提前出账（" })}<code>current_month_cost == 0</code>{t({ en: ").", zh: "）" })}</li>
            <li>{t({ en: "Settle all unpaid invoices (", zh: "结清全部未付账单（" })}<code>unpaid_total == 0</code>{t({ en: ").", zh: "）" })}</li>
          </ol>
          <p>
            {t({
              en: "Admin accounts cannot self-delete. Soft-delete renames the username to deleted_{id}_{rand}_{original_username} (for audit traceability) and sets the email to deleted_{id}_{rand}@deleted.invalid; invoices and usage records are preserved.",
              zh: "admin 账号不可自助注销。软删除会把 username 改成 deleted_{id}_{rand}_{原用户名}（便于审计回溯），email 置为 deleted_{id}_{rand}@deleted.invalid，账单与用量记录保留。",
            })}
          </p>
        </div>
      </section>

      <section id="api-ref" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">{t({ en: "API reference", zh: "API 端点参考" })}</h2>
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-700">{t({ en: "Method", zh: "方法" })}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">{t({ en: "Endpoint", zh: "端点" })}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">{t({ en: "Description", zh: "说明" })}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr><td colSpan={3} className="px-4 py-2 bg-gray-50 font-semibold text-gray-600 text-xs">{t({ en: "OpenAI compatible (unified /v1, Bearer API key required)", zh: "OpenAI 兼容（统一 /v1，需 Bearer API Key）" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-fg">POST</code></td><td className="px-4 py-2 font-mono text-xs">/v1/chat/completions</td><td className="px-4 py-2 text-gray-600">{t({ en: "Chat completions (routed by activated-subscription priority)", zh: "聊天补全（按激活订阅优先级路由）" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-fg">POST</code></td><td className="px-4 py-2 font-mono text-xs">/v1/completions</td><td className="px-4 py-2 text-gray-600">{t({ en: "Text completions", zh: "文本补全" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-fg">POST</code></td><td className="px-4 py-2 font-mono text-xs">/v1/responses</td><td className="px-4 py-2 text-gray-600">Responses API</td></tr>
              <tr><td className="px-4 py-2"><code className="text-green-600">GET</code></td><td className="px-4 py-2 font-mono text-xs">/v1/models</td><td className="px-4 py-2 text-gray-600">{t({ en: "List available models (models bound to active subscriptions are returned first)", zh: "列出可用模型（优先返回已激活订阅绑定的模型）" })}</td></tr>

              <tr><td colSpan={3} className="px-4 py-2 bg-gray-50 font-semibold text-gray-600 text-xs">{t({ en: "Model catalog", zh: "模型广场" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-green-600">GET</code></td><td className="px-4 py-2 font-mono text-xs">/api/models</td><td className="px-4 py-2 text-gray-600">{t({ en: "List all listed public models", zh: "获取所有已上架的公开模型" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-green-600">GET</code></td><td className="px-4 py-2 font-mono text-xs">/api/models/&#123;model_id&#125;</td><td className="px-4 py-2 text-gray-600">{t({ en: "Get model details (public listed by default; logged-in owners also see their own non-archived backends for preview)", zh: "获取模型详情（默认仅公开已上架；登录后 owner 可预览自己的未上架/未公开后端，归档除外）" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-green-600">GET</code></td><td className="px-4 py-2 font-mono text-xs">/api/models/&#123;model_id&#125;/performance</td><td className="px-4 py-2 text-gray-600">{t({ en: "Per-provider performance summary (TTFT / uptime / errors). Placeholder: numeric fields are null and available=false until metrics collection ships.", zh: "按 provider 统计的性能概要（TTFT / 在线率 / 错误率）。当前为占位实现：数值字段为 null、available=false，待真实指标采集上线。" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-green-600">GET</code></td><td className="px-4 py-2 font-mono text-xs">/api/model-families</td><td className="px-4 py-2 text-gray-600">{t({ en: "List supported model families", zh: "获取支持的模型类别" })}</td></tr>

              <tr><td colSpan={3} className="px-4 py-2 bg-gray-50 font-semibold text-gray-600 text-xs">{t({ en: "Subscriptions", zh: "订阅管理" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-fg">POST</code></td><td className="px-4 py-2 font-mono text-xs">/api/subscriptions</td><td className="px-4 py-2 text-gray-600">{t({ en: "Subscribe to a model", zh: "订阅模型" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-green-600">GET</code></td><td className="px-4 py-2 font-mono text-xs">/api/subscriptions</td><td className="px-4 py-2 text-gray-600">{t({ en: "List my subscriptions (with active state and priority)", zh: "列出我的订阅（含激活状态与优先级）" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-yellow-600">PUT</code></td><td className="px-4 py-2 font-mono text-xs">/api/subscriptions/&#123;id&#125;/activate</td><td className="px-4 py-2 text-gray-600">{t({ en: "Activate / deactivate a subscription", zh: "激活/取消激活某条订阅" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-yellow-600">PUT</code></td><td className="px-4 py-2 font-mono text-xs">/api/subscriptions/reorder</td><td className="px-4 py-2 text-gray-600">{t({ en: "Reorder subscription priority", zh: "调整订阅优先级顺序" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-red-600">DELETE</code></td><td className="px-4 py-2 font-mono text-xs">/api/subscriptions/&#123;id&#125;</td><td className="px-4 py-2 text-gray-600">{t({ en: "Unsubscribe", zh: "取消订阅" })}</td></tr>

              <tr><td colSpan={3} className="px-4 py-2 bg-gray-50 font-semibold text-gray-600 text-xs">{t({ en: "API keys & account", zh: "API Key 与账户" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-fg">POST</code></td><td className="px-4 py-2 font-mono text-xs">/api/keys</td><td className="px-4 py-2 text-gray-600">{t({ en: "Create an API key", zh: "创建 API Key" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-green-600">GET</code></td><td className="px-4 py-2 font-mono text-xs">/api/keys</td><td className="px-4 py-2 text-gray-600">{t({ en: "List my API keys", zh: "列出我的 API Key" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-yellow-600">PUT</code></td><td className="px-4 py-2 font-mono text-xs">/api/keys/&#123;key_id&#125;/toggle</td><td className="px-4 py-2 text-gray-600">{t({ en: "Enable / disable a key", zh: "启用/禁用 Key" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-red-600">DELETE</code></td><td className="px-4 py-2 font-mono text-xs">/api/keys/&#123;key_id&#125;</td><td className="px-4 py-2 text-gray-600">{t({ en: "Delete a key", zh: "删除 Key" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-green-600">GET</code></td><td className="px-4 py-2 font-mono text-xs">/api/billing/status</td><td className="px-4 py-2 text-gray-600">{t({ en: "Query month-to-date usage and unpaid invoices", zh: "查询本月用量与未付账单" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-green-600">GET</code></td><td className="px-4 py-2 font-mono text-xs">/api/billing/settle-now/eligibility</td><td className="px-4 py-2 text-gray-600">{t({ en: "Whether early settlement is allowed (returns ", zh: "能否提前结清本月账单（返回 " })}<code>eligible</code>{t({ en: " + ", zh: " + " })}<code>reasons</code>{t({ en: ").", zh: " 清单）" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-fg">POST</code></td><td className="px-4 py-2 font-mono text-xs">/api/billing/settle-now</td><td className="px-4 py-2 text-gray-600">{t({ en: "Close the current month immediately (no active subs, no listed/pending backends, ≥30 min silent).", zh: "把本月用量立即出账（需无激活订阅、无 listed/pending 后端、静默 ≥ 30 分钟）" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-green-600">GET</code></td><td className="px-4 py-2 font-mono text-xs">/api/usage</td><td className="px-4 py-2 text-gray-600">{t({ en: "Per-model usage summary (default last 7 days; ", zh: "按模型汇总调用明细（默认近 7 天，" })}<code>days</code>{t({ en: " optional).", zh: " 可选）" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-green-600">GET</code></td><td className="px-4 py-2 font-mono text-xs">/api/usage/hourly</td><td className="px-4 py-2 text-gray-600">{t({ en: "Today by hour bucket (CST, UTC+8)", zh: "今日按小时桶（CST, UTC+8）" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-green-600">GET</code></td><td className="px-4 py-2 font-mono text-xs">/api/usage/daily</td><td className="px-4 py-2 text-gray-600">{t({ en: "History by day (excluding today)", zh: "历史按天归档（不含今日）" })}</td></tr>

              <tr><td colSpan={3} className="px-4 py-2 bg-gray-50 font-semibold text-gray-600 text-xs">{t({ en: "Backend management (providers)", zh: "后端管理（提供者）" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-fg">POST</code></td><td className="px-4 py-2 font-mono text-xs">/api/backends</td><td className="px-4 py-2 text-gray-600">{t({ en: "Register a backend", zh: "注册后端" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-green-600">GET</code></td><td className="px-4 py-2 font-mono text-xs">/api/backends</td><td className="px-4 py-2 text-gray-600">{t({ en: "List backends (", zh: "列出后端（" })}<code>mine=true</code>{t({ en: " for own only)", zh: " 仅自己）" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-green-600">GET</code></td><td className="px-4 py-2 font-mono text-xs">/api/backends/&#123;name&#125;</td><td className="px-4 py-2 text-gray-600">{t({ en: "Get backend details", zh: "获取后端详情" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-yellow-600">PUT</code></td><td className="px-4 py-2 font-mono text-xs">/api/backends/&#123;name&#125;</td><td className="px-4 py-2 text-gray-600">{t({ en: "Edit a backend", zh: "编辑后端" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-yellow-600">PUT</code></td><td className="px-4 py-2 font-mono text-xs">/api/backends/&#123;name&#125;/toggle</td><td className="px-4 py-2 text-gray-600">{t({ en: "Submit for listing (→pending) / withdraw / take offline", zh: "申请上架（→审核中） / 撤回 / 下架" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-red-600">DELETE</code></td><td className="px-4 py-2 font-mono text-xs">/api/backends/&#123;name&#125;</td><td className="px-4 py-2 text-gray-600">{t({ en: "Soft-delete a backend (requires listing_status=offline; subscriptions are deactivated, the row is cleaned up at the next billing settlement)", zh: "软删除后端（要求先下架到 offline；订阅会被停用，下次结账时清理）" })}</td></tr>

              <tr><td colSpan={3} className="px-4 py-2 bg-gray-50 font-semibold text-gray-600 text-xs">{t({ en: "Auth & account", zh: "认证与账户" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-fg">POST</code></td><td className="px-4 py-2 font-mono text-xs">/api/auth/send-code</td><td className="px-4 py-2 text-gray-600">{t({ en: "Request an email code (purpose: register / login / change-email / delete-account)", zh: "索取邮箱验证码（purpose: register / login / change-email / delete-account）" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-fg">POST</code></td><td className="px-4 py-2 font-mono text-xs">/api/auth/register</td><td className="px-4 py-2 text-gray-600">{t({ en: "Sign up (call send-code first and pass ", zh: "注册（需先调用 send-code 并带上 " })}<code>code</code>)</td></tr>
              <tr><td className="px-4 py-2"><code className="text-fg">POST</code></td><td className="px-4 py-2 font-mono text-xs">/api/auth/login</td><td className="px-4 py-2 text-gray-600">{t({ en: "Sign in: ", zh: "登录：" })}<code>login</code> + <code>password</code> + <code>code</code></td></tr>
              <tr><td className="px-4 py-2"><code className="text-green-600">GET</code></td><td className="px-4 py-2 font-mono text-xs">/api/auth/me</td><td className="px-4 py-2 text-gray-600">{t({ en: "Get the current user", zh: "获取当前用户信息" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-fg">POST</code></td><td className="px-4 py-2 font-mono text-xs">/api/auth/change-password</td><td className="px-4 py-2 text-gray-600">{t({ en: "Change password (", zh: "修改密码（" })}<code>old_password</code> + <code>new_password</code>)</td></tr>
              <tr><td className="px-4 py-2"><code className="text-fg">POST</code></td><td className="px-4 py-2 font-mono text-xs">/api/auth/change-email</td><td className="px-4 py-2 text-gray-600">{t({ en: "Change email (requires a ", zh: "修改邮箱（需 " })}<code>change-email</code>{t({ en: "-purpose code)", zh: " 用途的验证码）" })}</td></tr>
              <tr><td className="px-4 py-2"><code className="text-fg">POST</code></td><td className="px-4 py-2 font-mono text-xs">/api/auth/delete-account</td><td className="px-4 py-2 text-gray-600">{t({ en: "Self-serve deletion (", zh: "自助注销（" })}<code>password</code> + <code>code</code> + <code>confirm: "DELETE"</code>{t({ en: ", soft-delete; the 5 prerequisites above must be satisfied first)", zh: "，软删除；需先通过上述 5 项注销前置）" })}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="provider" className="mb-12 scroll-mt-20">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">{t({ en: "Provider guide", zh: "提供者接入指南" })}</h2>

        <div className="bg-white rounded-lg border p-6 space-y-4 text-sm text-gray-700">
          <h3 className="font-semibold text-base text-gray-800">{t({ en: "1. Pick a mode: direct / tunnel", zh: "1. 选模式：直连 / 隧道" })}</h3>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong>{t({ en: "Direct", zh: "直连（direct）" })}</strong>{t({ en: ": your backend has a publicly reachable address (including loopback addresses exposed via reverse SSH or similar). Fill in ", zh: "：你的后端有公网可达地址（含通过反向 SSH 等手段暴露到本机 loopback 的）。注册时填 " })}<code>url</code>{t({ en: " when registering; the platform forwards directly via httpx.", zh: "，平台直接 httpx 转发。" })}</li>
            <li><strong>{t({ en: "Tunnel", zh: "隧道（tunnel）" })}</strong>{t({ en: ": your backend is behind NAT or a private network with no public IP. After registering, run ", zh: "：后端在 NAT/内网，没有公网 IP。注册后在本地跑 " })}<code>tunnel_client.py</code>{t({ en: " locally; the client opens a WebSocket to the gateway, and the gateway uses that connection to reach your backend in reverse.", zh: "，由 client 主动 WebSocket 连到平台，平台借这条连接反向请求后端。" })}</li>
          </ul>
        </div>

        <div className="bg-white rounded-lg border p-6 space-y-3 text-sm text-gray-700 mt-4">
          <h3 className="font-semibold text-base text-gray-800">{t({ en: "2. Key fields in the registration form", zh: "2. 注册表单关键字段" })}</h3>
          <ul className="list-disc list-inside space-y-1.5 ml-2">
            <li><code>name</code>: {t({ en: "backend name (globally unique). In tunnel mode, ", zh: "后端名（全局唯一）。隧道模式下，" })}<code>tunnel_client.py</code>{t({ en: "'s ", zh: " 的 " })}<code>--backend-name</code>{t({ en: " must match.", zh: " 必须与之一致。" })}</li>
            <li><code>models</code>: {t({ en: "OpenAI-compatible model IDs you expose (the ", zh: "你对外暴露的 OpenAI 兼容模型 ID 列表（用户请求里的 " })}<code>model</code>{t({ en: " field that consumers send). Separate multiple with newlines.", zh: " 字段）。多模型用换行分隔。" })}</li>
            <li><code>client_info.model_map</code>{t({ en: " (optional): translate the public ID to the upstream's real ID. e.g. public ", zh: "（可选）：把对外 ID 翻译成上游真实 ID。例：对外 " })}<code>Qwen/Qwen3.6-35B-A3B</code>{t({ en: " → upstream ", zh: " → 上游 " })}<code>qwen36-awq</code>{t({ en: ". Leave empty to pass through.", zh: "。不填即透传。" })}</li>
            <li><code>client_info.api_key</code>{t({ en: " (optional, direct only): adds an ", zh: "（可选，仅 direct）：转发时附加的 " })}<code>Authorization: Bearer &lt;key&gt;</code>{t({ en: " when forwarding. Visible to owner / admin only.", zh: "。仅 owner / admin 可见。" })}</li>
            <li><code>input_price / output_price / cache_price</code>: {t({ en: "unit is currency / 1M tokens. If ", zh: "单位「货币 / 1M tokens」。" })}<code>cache_price</code>{t({ en: " is empty, defaults to ", zh: " 不填默认按 " })}<code>input_price × 0.1</code>{t({ en: ".", zh: " 计费。" })}</li>
          </ul>
        </div>

        <div className="bg-white rounded-lg border p-6 space-y-3 text-sm text-gray-700 mt-4">
          <h3 className="font-semibold text-base text-gray-800">{t({ en: "3. Tunnel client", zh: "3. 隧道客户端" })}</h3>
          <p>{t({ en: "Source at ", zh: "仓库 " })}<code>backend/tunnel_client.py</code>{t({ en: ", depends on ", zh: "，依赖 " })}<code>websockets</code> + <code>httpx</code>:</p>
          <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-x-auto">
            <pre>{`python tunnel_client.py \\
  --gateway   wss://your-gateway/ws/tunnel \\
  --token     sk-your-provider-API-Key \\
  --backend-name your-registered-backend-name \\
  --local-url http://127.0.0.1:8000`}</pre>
          </div>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><code>--token</code>{t({ en: " is any API key under your account (", zh: " 用你账号下任一 API Key（" })}<code>sk-xxxx</code>{t({ en: "), not your login password.", zh: "），不是登录密码。" })}</li>
            <li>{t({ en: "Once connected the backend is auto-marked online; on disconnect, auto offline. The client has built-in reconnect and heartbeat — no extra daemon beyond systemd is needed.", zh: "连接建立后后端自动标记 online，断开自动 offline。客户端内置自动重连与心跳，无需 systemd 之外的额外守护。" })}</li>
            <li>{t({ en: "SSE is forwarded line-by-line in real time; streaming generation has no aggregate timeout, only an idle guard.", zh: "SSE 按行实时转发；流式生成无总超时，仅做空闲保护。" })}</li>
          </ul>

          <p className="text-gray-800 font-medium mt-2">{t({ en: "Recommended: run under systemd (24×7):", zh: "推荐用 systemd 托管（24×7）：" })}</p>
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

# Enable
sudo systemctl daemon-reload
sudo systemctl enable --now tianshu-tunnel@qwen36
sudo journalctl -u tianshu-tunnel@qwen36 -f`}</pre>
          </div>
        </div>

        <div className="bg-white rounded-lg border p-6 space-y-3 text-sm text-gray-700 mt-4">
          <h3 className="font-semibold text-base text-gray-800">{t({ en: "4. Listing review flow", zh: "4. 上架审核流程" })}</h3>
          <p>{t({ en: "A newly registered backend defaults to ", zh: "新注册的后端默认 " })}<code>offline</code> + <code>private</code>{t({ en: ", visible only to the owner. State machine:", zh: "，只对 owner 可见。状态机：" })}</p>
          <pre className="bg-gray-50 border rounded p-3 text-xs leading-relaxed overflow-x-auto">{`offline ──[submit]──▶ pending ──[admin approve]──▶ listed
   ▲                       │
   │                       └─[admin reject + note]──▶ offline (with review_note)
   │
   └──[owner takes offline / admin force offline]── listed`}</pre>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>{t({ en: "The Submit button is on the ", zh: "「申请上架」按钮在 " })}<a href="/my-services" className="text-fg underline">{t({ en: "My Services", zh: "我的服务" })}</a>{t({ en: " card.", zh: " 卡片上。" })}</li>
            <li>{t({ en: "When rejected, ", zh: "被驳回时 " })}<code>review_note</code>{t({ en: " appears on the card; fix per the note and click Submit again to re-enter pending.", zh: " 会显示在卡片上；按 note 修改后再次点「申请上架」即可重新进入 pending。" })}</li>
            <li>{t({ en: "Editing price / currency / cache price on a listed backend does not trigger a new review, but follows the \"effective at 00:00 CST tomorrow\" rule above.", zh: "已 listed 的后端，编辑价格/货币/cache 价不会触发重新审核，但会按上面「次日 00:00 CST 生效」的规则延后。" })}</li>
            <li>{t({ en: "Before deleting your account or going offline, withdraw all listed/pending backends to offline first.", zh: "注销账号或下架前必须先把所有 listed/pending 的后端撤回到 offline。" })}</li>
            <li>{t({ en: "Deleting a backend requires it to be offline first; deletion soft-removes the backend (still visible to you under \"Deleted services\" in My Services until your next billing settlement, then it is archived and no longer visible to you). Subscriptions are deactivated immediately on delete.", zh: "删除后端必须先下架到 offline 状态；删除采用软删除——在「我的服务」的「已删除服务」折叠区仍可见，直到下次结账后归档（对你不再可见）。删除瞬间所有订阅会被停用。" })}</li>
          </ul>
        </div>
      </section>
    </div>
    </div>
  )
}
