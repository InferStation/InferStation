export default function DocsPage() {
  return (
    <div className="max-w-4xl mx-auto py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">文档</h1>

      {/* 平台简介 */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">平台简介</h2>
        <div className="bg-white rounded-lg border p-6 space-y-3 text-gray-700 text-sm leading-relaxed">
          <p>
            <strong>LLM Gateway</strong> 是一个模型服务聚合平台，连接 AI 消费者与模型提供者。
            提供者可以将自己的 GPU 机器上运行的模型服务注册到平台，消费者则通过统一的 OpenAI 兼容 API 调用这些模型。
          </p>
          <p>平台支持两种接入模式：</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong>直连模式</strong>：后端服务有公网 IP，平台直接转发请求</li>
            <li><strong>隧道模式</strong>：后端在 NAT/内网后，通过 WebSocket 隧道穿透连接</li>
          </ul>
          <p>核心特性：</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>完全兼容 OpenAI API 格式，可直接使用 OpenAI SDK</li>
            <li>支持流式 (SSE) 和非流式响应</li>
            <li>按 token 用量计费，提供者可自定义定价</li>
            <li>自动健康检查，实时展示后端在线状态</li>
          </ul>
        </div>
      </section>

      {/* 快速开始 */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">快速开始</h2>
        <div className="bg-white rounded-lg border p-6 space-y-4 text-sm text-gray-700">
          <div>
            <h3 className="font-semibold text-base text-gray-800 mb-2">消费者</h3>
            <ol className="list-decimal list-inside space-y-1.5 ml-2">
              <li>注册账号并登录</li>
              <li>在「模型广场」浏览并订阅感兴趣的模型</li>
              <li>获取专属 API 地址（订阅后自动生成）</li>
              <li>使用 curl 或 OpenAI SDK 调用模型</li>
            </ol>
          </div>
          <div>
            <h3 className="font-semibold text-base text-gray-800 mb-2">提供者</h3>
            <ol className="list-decimal list-inside space-y-1.5 ml-2">
              <li>注册账号，在「我的服务」中激活提供者身份</li>
              <li>注册后端服务（选择直连或隧道模式）</li>
              <li>如果是隧道模式，在本地运行 client.py 建立连接</li>
              <li>手动点击「上架」，模型即在广场中可见</li>
            </ol>
          </div>
        </div>
      </section>

      {/* API 调用方式 */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">API 调用</h2>
        <div className="space-y-6">
          {/* 方式一：订阅 Key */}
          <div className="bg-white rounded-lg border p-6">
            <h3 className="font-semibold text-base text-gray-800 mb-3">方式一：通过订阅 Key 调用（推荐）</h3>
            <p className="text-sm text-gray-600 mb-3">
              在模型广场订阅模型后，会生成一个专属的 sub_key。使用该 key 构造 API 地址即可调用，无需额外鉴权。
            </p>
            <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
              <pre>{`curl https://your-gateway/s/{sub_key}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "Qwen/Qwen3-8B",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'`}</pre>
            </div>
            <p className="text-xs text-gray-500 mt-2">其中 sub_key 可在「我的订阅」或模型详情页获取。</p>
          </div>

          {/* 方式二：API Key */}
          <div className="bg-white rounded-lg border p-6">
            <h3 className="font-semibold text-base text-gray-800 mb-3">方式二：通过 API Key 调用</h3>
            <p className="text-sm text-gray-600 mb-3">
              在「API Key」页面创建 Key，通过标准 OpenAI 格式调用。平台会根据 model 参数自动路由到对应后端。
            </p>
            <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
              <pre>{`curl https://your-gateway/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-your-api-key" \\
  -d '{
    "model": "Qwen/Qwen3-8B",
    "messages": [{"role": "user", "content": "你好"}]
  }'`}</pre>
            </div>
          </div>

          {/* OpenAI SDK */}
          <div className="bg-white rounded-lg border p-6">
            <h3 className="font-semibold text-base text-gray-800 mb-3">使用 OpenAI SDK（Python）</h3>
            <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
              <pre>{`from openai import OpenAI

# 方式一：使用订阅 Key
client = OpenAI(
    base_url="https://your-gateway/s/{sub_key}/v1",
    api_key="unused"  # 订阅 Key 模式无需 api_key
)

# 方式二：使用 API Key
client = OpenAI(
    base_url="https://your-gateway/v1",
    api_key="sk-your-api-key"
)

response = client.chat.completions.create(
    model="Qwen/Qwen3-8B",
    messages=[{"role": "user", "content": "你好"}],
    stream=True
)

for chunk in response:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")`}</pre>
            </div>
          </div>
        </div>
      </section>

      {/* API 端点参考 */}
      <section className="mb-12">
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
              <tr><td colSpan={3} className="px-4 py-2 bg-gray-50 font-semibold text-gray-600 text-xs">OpenAI 兼容</td></tr>
              <tr>
                <td className="px-4 py-2"><code className="text-indigo-600">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/s/&#123;sub_key&#125;/v1/chat/completions</td>
                <td className="px-4 py-2 text-gray-600">通过订阅 Key 调用模型</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-indigo-600">GET</code></td>
                <td className="px-4 py-2 font-mono text-xs">/s/&#123;sub_key&#125;/v1/models</td>
                <td className="px-4 py-2 text-gray-600">列出订阅绑定的模型</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-indigo-600">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/v1/chat/completions</td>
                <td className="px-4 py-2 text-gray-600">通过 API Key 调用（需 Bearer token）</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-indigo-600">GET</code></td>
                <td className="px-4 py-2 font-mono text-xs">/v1/models</td>
                <td className="px-4 py-2 text-gray-600">列出可用模型（需 Bearer token）</td>
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
                <td className="px-4 py-2 text-gray-600">列出我的订阅</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-red-600">DELETE</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/subscriptions/&#123;id&#125;</td>
                <td className="px-4 py-2 text-gray-600">取消订阅</td>
              </tr>

              <tr><td colSpan={3} className="px-4 py-2 bg-gray-50 font-semibold text-gray-600 text-xs">后端管理（提供者）</td></tr>
              <tr>
                <td className="px-4 py-2"><code className="text-indigo-600">POST</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/backends</td>
                <td className="px-4 py-2 text-gray-600">注册/更新后端</td>
              </tr>
              <tr>
                <td className="px-4 py-2"><code className="text-green-600">GET</code></td>
                <td className="px-4 py-2 font-mono text-xs">/api/backends</td>
                <td className="px-4 py-2 text-gray-600">列出后端（mine=true 仅自己）</td>
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
      <section className="mb-12">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">隧道模式接入</h2>
        <div className="bg-white rounded-lg border p-6 space-y-4 text-sm text-gray-700">
          <p>
            如果你的 GPU 机器在 NAT/内网环境中，没有公网 IP，可以使用隧道模式。
            注册后端时选择「隧道」模式，然后在本地运行隧道客户端：
          </p>
          <div className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
            <pre>{`python client.py \\
  --gateway ws://GATEWAY_HOST:8080/ws/tunnel \\
  --token sk-你的API-Key \\
  --backend-name 你的后端名称 \\
  --local-url http://localhost:8000`}</pre>
          </div>
          <p>客户端会自动建立 WebSocket 连接，平台通过隧道转发请求到你的本地服务。</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>连接建立后后端自动标记为 online</li>
            <li>连接断开后自动标记为 offline</li>
            <li>平台定期发送健康探测验证后端可用性</li>
          </ul>
        </div>
      </section>

      {/* 角色说明 */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">角色体系</h2>
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-700">角色</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">权限</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="px-4 py-3 font-medium">consumer</td>
                <td className="px-4 py-3 text-gray-600">浏览模型、订阅、调用 API</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium">provider</td>
                <td className="px-4 py-3 text-gray-600">注册并管理后端服务</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium">both</td>
                <td className="px-4 py-3 text-gray-600">同时拥有消费者和提供者权限</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-medium">admin</td>
                <td className="px-4 py-3 text-gray-600">用户管理、余额调整、全局用量统计</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-2">新注册用户默认为 consumer，可在「我的服务」中激活 provider 身份升级为 both。</p>
      </section>

      {/* 支持的模型 */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">支持的模型类别</h2>
        <div className="bg-white rounded-lg border p-6 text-sm text-gray-700">
          <p className="mb-3">当前平台支持以下模型家族的注册：</p>
          <div className="flex gap-3">
            <span className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium">Qwen</span>
            <span className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium">THUDM</span>
            <span className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium">deepseek-ai</span>
          </div>
          <p className="text-xs text-gray-500 mt-3">如需添加更多模型类别，请联系管理员。</p>
        </div>
      </section>
    </div>
  )
}
