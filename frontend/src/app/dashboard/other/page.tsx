"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { useTheme, type ThemeMode } from "@/context/ThemeContext"
import { useLocale, useT, type Lang } from "@/context/LocaleContext"
import { apiFetch } from "@/lib/api"

export default function OtherPage() {
  const { user, logout } = useAuth()
  const { mode: themeMode, setMode: setThemeMode } = useTheme()
  const { lang, setLang } = useLocale()
  const t = useT()
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
      if (data?.dev_code) setDelError(t({ en: `Code generated (dev mode: ${data.dev_code})`, zh: `验证码已生成（开发模式：${data.dev_code}）` }))
      setDelCooldown(60)
      const iv = setInterval(() => {
        setDelCooldown((c) => { if (c <= 1) { clearInterval(iv); return 0 } ; return c - 1 })
      }, 1000)
    } catch (err: unknown) {
      setDelError(err instanceof Error ? err.message : t({ en: "Send failed", zh: "发送失败" }))
    } finally { setDelSending(false) }
  }

  const handleDeleteAccount = async () => {
    setDelError("")
    if (!delPassword) { setDelError(t({ en: "Enter your password", zh: "请输入密码" })); return }
    if (!/^\d{6}$/.test(delCode.trim())) { setDelError(t({ en: "Enter the 6-digit email code", zh: "请输入 6 位邮箱验证码" })); return }
    if (delConfirm.trim().toUpperCase() !== "DELETE") { setDelError(t({ en: 'Type DELETE to confirm', zh: '请在确认框输入 DELETE' })); return }
    if (!confirm(t({ en: "After deletion the account is disabled, API keys revoked, subscriptions cancelled, and you cannot log in. Outstanding bills must still be settled. Continue?", zh: "注销后账号将停用、API 密钥失效、订阅解除且无法登录。已开出的账单仍需结清。确认继续？" }))) return
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
      setDelError(err instanceof Error ? err.message : t({ en: "Delete failed", zh: "注销失败" }))
    } finally { setDelSaving(false) }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t({ en: "Other", zh: "其他" })}</h1>

      <div className="bg-white rounded-lg border p-6 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-semibold">{t({ en: "Appearance", zh: "外观主题" })}</h2>
            <p className="text-xs text-gray-500 mt-1">{t({ en: "Defaults to system; takes effect immediately and is remembered.", zh: "默认跟随系统；切换后会立即生效并记住选择" })}</p>
          </div>
          <div className="inline-flex items-center rounded-lg border border-line bg-white p-0.5">
            {(
              [
                { value: "light", label: t({ en: "Light", zh: "浅色" }) },
                { value: "dark", label: t({ en: "Dark", zh: "深色" }) },
                { value: "system", label: t({ en: "System", zh: "跟随系统" }) },
              ] as { value: ThemeMode; label: string }[]
            ).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setThemeMode(opt.value)}
                className={`px-3 h-8 text-xs rounded-md transition-colors ${
                  themeMode === opt.value
                    ? "bg-fg text-accent-fg"
                    : "text-gray-600 hover:bg-accent-soft"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border p-6 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-semibold">{t({ en: "Language", zh: "语言" })}</h2>
            <p className="text-xs text-gray-500 mt-1">{t({ en: "Switches the entire UI; preference is remembered.", zh: "切换整站界面语言，会记住选择" })}</p>
          </div>
          <div className="inline-flex items-center rounded-lg border border-line bg-white p-0.5">
            {(
              [
                { value: "en", label: "English" },
                { value: "zh", label: "中文" },
              ] as { value: Lang; label: string }[]
            ).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setLang(opt.value)}
                className={`px-3 h-8 text-xs rounded-md transition-colors ${
                  lang === opt.value
                    ? "bg-fg text-accent-fg"
                    : "text-gray-600 hover:bg-accent-soft"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="font-semibold mb-4">{t({ en: "About the platform", zh: "平台信息" })}</h2>
        <div className="text-sm text-gray-600 space-y-2">
          <p>{t({ en: "Tianshu — LLM API gateway", zh: "天枢 — 模型服务聚合平台" })}</p>
          <p>{t({ en: "OpenAI-compatible API · NAT-traversal tunneling · usage-based billing", zh: "支持 OpenAI 兼容 API、NAT 穿透隧道、按量计费" })}</p>
        </div>
      </div>

      {user.role !== "admin" && (
        <div className="bg-white rounded-lg border border-red-200 p-6">
          <h2 className="font-semibold text-red-600 mb-2">{t({ en: "Delete account", zh: "注销账号" })}</h2>
          <p className="text-sm text-gray-600 mb-3">
            {t({ en: "Deletion immediately disables the account, revokes all API keys, cancels all subscriptions, and removes all your services. Past invoices and usage logs are retained for audit. This action is irreversible.", zh: "注销后账号将立即停用、API 密钥全部失效、所有订阅解除、名下服务全部下架。历史账单与用量记录仍会保留用于审计。此操作不可逆。" })}
          </p>
          <div className="text-xs text-gray-500 mb-3 leading-relaxed bg-gray-50 border rounded p-2">
            <div className="font-medium text-gray-700 mb-1">{t({ en: "Before you delete:", zh: "注销前请依次完成：" })}</div>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>{t({ en: "Cancel all subscriptions on the My Subscriptions page", zh: "在「我的订阅」页取消全部订阅" })}</li>
              <li>{t({ en: "If you are a provider, take down or withdraw all backends", zh: "如是服务提供方，下架 / 撤回审核全部后端" })}</li>
              <li>{t({ en: "Wait 30 minutes for in-flight requests to settle", zh: "等待账户静默 30 分钟（防止在途请求漏计）" })}</li>
              <li>{t({ en: "On the Invoices page click 'Settle current month' to invoice this month's usage", zh: "在「账单」页点击「提前结清本月账单」把当月用量出账" })}</li>
              <li>{t({ en: "Pay all outstanding invoices", zh: "结清全部未付账单" })}</li>
            </ol>
          </div>
          {!showDelete ? (
            <button
              onClick={() => { setShowDelete(true); setDelError("") }}
              className="px-4 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
            >
              {t({ en: "Delete my account", zh: "我要注销账号" })}
            </button>
          ) : (
            <div className="space-y-3 max-w-md border-t pt-4">
              {delError && <div className="p-2 bg-red-50 text-red-600 rounded text-sm">{delError}</div>}
              <div>
                <label className="block text-xs text-gray-600 mb-1">{t({ en: "Account password", zh: "账号密码" })}</label>
                <input
                  type="password"
                  value={delPassword}
                  onChange={(e) => setDelPassword(e.target.value)}
                  className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-red-400"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">{t({ en: `Email code (sent to ${user.email})`, zh: `邮箱验证码（发送至 ${user.email}）` })}</label>
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
                    {delCooldown > 0 ? t({ en: `Resend in ${delCooldown}s`, zh: `${delCooldown}s 后重发` }) : delSending ? t({ en: "Sending", zh: "发送中" }) : t({ en: "Send code", zh: "发送验证码" })}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  {t({ en: "Type ", zh: "在下方输入大写 " })}<span className="font-mono text-red-600">DELETE</span>{t({ en: " to confirm", zh: " 以确认" })}
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
                  {delSaving ? t({ en: "Deleting...", zh: "注销中..." }) : t({ en: "Confirm delete", zh: "确认注销" })}
                </button>
                <button
                  onClick={() => { setShowDelete(false); setDelPassword(""); setDelCode(""); setDelConfirm(""); setDelError("") }}
                  className="px-4 py-2 text-sm border rounded-lg text-gray-600 hover:bg-gray-50"
                >
                  {t({ en: "Cancel", zh: "取消" })}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
