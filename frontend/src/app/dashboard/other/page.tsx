"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"

export default function OtherPage() {
  const { user, logout } = useAuth()
  const router = useRouter()

  const [showDelete, setShowDelete] = useState(false)
  const [delPassword, setDelPassword] = useState("")
  const [delCode, setDelCode] = useState("")
  const [delConfirm, setDelConfirm] = useState("")
  const [delError, setDelError] = useState("")
  const [delSending, setDelSending] = useState(false)
  const [delSaving, setDelSaving] = useState(false)
  const [delCooldown, setDelCooldown] = useState(0)

  if (!user) return null

  const handleSendDeleteCode = async () => {
    if (!user?.email) return
    setDelError("")
    setDelSending(true)
    try {
      const data = await apiFetch("/api/auth/send-code", {
        method: "POST",
        body: JSON.stringify({ email: user.email, purpose: "delete-account" }),
      })
      if (data?.dev_code) setDelError(`验证码已生成（开发模式：${data.dev_code}）`)
      setDelCooldown(60)
      const iv = setInterval(() => {
        setDelCooldown((c) => { if (c <= 1) { clearInterval(iv); return 0 } ; return c - 1 })
      }, 1000)
    } catch (err: unknown) {
      setDelError(err instanceof Error ? err.message : "发送失败")
    } finally { setDelSending(false) }
  }

  const handleDeleteAccount = async () => {
    setDelError("")
    if (!delPassword) { setDelError("请输入密码"); return }
    if (!/^\d{6}$/.test(delCode.trim())) { setDelError("请输入 6 位邮箱验证码"); return }
    if (delConfirm.trim().toUpperCase() !== "DELETE") { setDelError('请在确认框输入 DELETE'); return }
    if (!confirm("注销后账号将停用、API 密钥失效、订阅解除且无法登录。已开出的账单仍需结清。确认继续？")) return
    setDelSaving(true)
    try {
      await apiFetch("/api/auth/delete-account", {
        method: "POST",
        body: JSON.stringify({
          password: delPassword,
          code: delCode.trim(),
          confirm: delConfirm.trim().toUpperCase(),
        }),
      })
      logout()
      router.replace("/login?deleted=1")
    } catch (err: unknown) {
      setDelError(err instanceof Error ? err.message : "注销失败")
    } finally { setDelSaving(false) }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">其他</h1>

      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="font-semibold mb-4">平台信息</h2>
        <div className="text-sm text-gray-600 space-y-2">
          <p>天枢 — 模型服务聚合平台</p>
          <p>支持 OpenAI 兼容 API、NAT 穿透隧道、按量计费</p>
        </div>
      </div>

      {user.role !== "admin" && (
        <div className="bg-white rounded-lg border border-red-200 p-6">
          <h2 className="font-semibold text-red-600 mb-2">注销账号</h2>
          <p className="text-sm text-gray-600 mb-3">
            注销后账号将立即停用、API 密钥全部失效、所有订阅解除、名下服务全部下架。历史账单与用量记录仍会保留用于审计。此操作不可逆。
          </p>
          <div className="text-xs text-gray-500 mb-3 leading-relaxed bg-gray-50 border rounded p-2">
            <div className="font-medium text-gray-700 mb-1">注销前请依次完成：</div>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>在「我的订阅」页取消全部订阅</li>
              <li>如是服务提供方，下架 / 撤回审核全部后端</li>
              <li>等待账户静默 30 分钟（防止在途请求漏计）</li>
              <li>在「账单」页点击「提前结清本月账单」把当月用量出账</li>
              <li>结清全部未付账单</li>
            </ol>
          </div>
          {!showDelete ? (
            <button
              onClick={() => { setShowDelete(true); setDelError("") }}
              className="px-4 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
            >
              我要注销账号
            </button>
          ) : (
            <div className="space-y-3 max-w-md border-t pt-4">
              {delError && <div className="p-2 bg-red-50 text-red-600 rounded text-sm">{delError}</div>}
              <div>
                <label className="block text-xs text-gray-600 mb-1">账号密码</label>
                <input
                  type="password"
                  value={delPassword}
                  onChange={(e) => setDelPassword(e.target.value)}
                  className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-red-400"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">邮箱验证码（发送至 {user.email}）</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={delCode}
                    onChange={(e) => setDelCode(e.target.value.replace(/\D/g, ""))}
                    className="flex-1 border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-red-400"
                  />
                  <button
                    onClick={handleSendDeleteCode}
                    disabled={delSending || delCooldown > 0}
                    className="px-3 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {delCooldown > 0 ? `${delCooldown}s 后重发` : delSending ? "发送中" : "发送验证码"}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  在下方输入大写 <span className="font-mono text-red-600">DELETE</span> 以确认
                </label>
                <input
                  type="text"
                  value={delConfirm}
                  onChange={(e) => setDelConfirm(e.target.value)}
                  placeholder="DELETE"
                  className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-red-400"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleDeleteAccount}
                  disabled={delSaving}
                  className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {delSaving ? "注销中..." : "确认注销"}
                </button>
                <button
                  onClick={() => { setShowDelete(false); setDelPassword(""); setDelCode(""); setDelConfirm(""); setDelError("") }}
                  className="px-4 py-2 text-sm border rounded-lg text-gray-600 hover:bg-gray-50"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
