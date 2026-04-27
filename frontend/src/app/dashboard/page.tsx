"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useAuth } from "@/context/AuthContext"
import { useTheme, type ThemeMode } from "@/context/ThemeContext"
import { apiFetch } from "@/lib/api"
import { formatByCurrency } from "@/lib/currency"
import PasswordInput, { checkStrength } from "@/components/PasswordInput"

export default function AccountPage() {
  const { user, refreshUser, logout } = useAuth()
  const { mode: themeMode, setMode: setThemeMode } = useTheme()
  const [oldPw, setOldPw] = useState("")
  const [newPw, setNewPw] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [msg, setMsg] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [showPwModal, setShowPwModal] = useState(false)
  const [editingEmail, setEditingEmail] = useState(false)
  const [newEmail, setNewEmail] = useState("")
  const [emailCode, setEmailCode] = useState("")
  const [emailMsg, setEmailMsg] = useState("")
  const [emailError, setEmailError] = useState("")
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailSending, setEmailSending] = useState(false)
  const [emailCooldown, setEmailCooldown] = useState(0)

  useEffect(() => {
    if (msg === "密码修改成功" && showPwModal) {
      const t = setTimeout(() => setShowPwModal(false), 800)
      return () => clearTimeout(t)
    }
  }, [msg, showPwModal])

  if (!user) return null

  const handleSendEmailCode = async () => {
    setEmailMsg(""); setEmailError("")
    const target = newEmail.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target)) { setEmailError("请输入有效的邮箱"); return }
    setEmailSending(true)
    try {
      const data = await apiFetch("/api/auth/send-code", {
        method: "POST",
        body: JSON.stringify({ email: target, purpose: "change-email" }),
      })
      setEmailMsg(data?.dev_code ? `验证码已生成（开发模式：${data.dev_code}）` : "验证码已发送，请查收邮箱")
      setEmailCooldown(60)
      const iv = setInterval(() => {
        setEmailCooldown((c) => { if (c <= 1) { clearInterval(iv); return 0 } ; return c - 1 })
      }, 1000)
    } catch (err: unknown) {
      setEmailError(err instanceof Error ? err.message : "发送失败")
    } finally { setEmailSending(false) }
  }

  const handleChangeEmail = async () => {
    setEmailMsg(""); setEmailError("")
    if (!newEmail.trim()) { setEmailError("请输入邮箱"); return }
    if (!/^\d{6}$/.test(emailCode.trim())) { setEmailError("请输入 6 位验证码"); return }
    setEmailSaving(true)
    try {
      await apiFetch("/api/auth/change-email", {
        method: "POST",
        body: JSON.stringify({ new_email: newEmail.trim().toLowerCase(), code: emailCode.trim() }),
      })
      setEmailMsg("邮箱修改成功")
      setEditingEmail(false)
      setNewEmail("")
      setEmailCode("")
      await refreshUser()
    } catch (err: unknown) {
      setEmailError(err instanceof Error ? err.message : "修改失败")
    } finally { setEmailSaving(false) }
  }

  // --- Delete account moved to /dashboard/other ---

  const handleChangePw = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg("")
    setError("")
    if (newPw !== confirmPw) { setError("两次密码不一致"); return }
    if (!checkStrength(newPw).ok) { setError("密码需包含大写、小写、数字、特殊字符中的至少3种，且不少于8位"); return }
    setSaving(true)
    try {
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
      })
      setMsg("密码修改成功")
      setOldPw(""); setNewPw(""); setConfirmPw("")
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "修改失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">账号信息</h1>

      <div className="bg-white rounded-lg border p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 className="font-semibold">账号信息</h2>
          <button
            onClick={() => { if (confirm("确认退出登录？")) logout() }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 hover:border-red-300"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            退出登录
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-2 text-sm">
          <div>
            <span className="text-gray-500">用户名：</span>
            <span className="font-medium">{user.username}</span>
          </div>
          <div>
            <span className="text-gray-500">邮箱：</span>
            {editingEmail ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder={user.email}
                  className="border rounded px-2 py-0.5 text-sm w-48 focus:outline-none focus:ring-1 focus:ring-fg/15"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={emailCode}
                  onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="验证码"
                  className="border rounded px-2 py-0.5 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-fg/15"
                />
                <button
                  onClick={handleSendEmailCode}
                  disabled={emailSending || emailCooldown > 0}
                  className="text-xs text-fg hover:text-fg disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  {emailCooldown > 0 ? `${emailCooldown}s` : emailSending ? "发送中" : "发送验证码"}
                </button>
                <button onClick={handleChangeEmail} disabled={emailSaving} className="text-xs text-fg hover:text-fg disabled:opacity-50">
                  {emailSaving ? "保存中" : "保存"}
                </button>
                <button onClick={() => { setEditingEmail(false); setNewEmail(""); setEmailCode(""); setEmailError("") }} className="text-xs text-gray-400 hover:text-gray-600">取消</button>
              </span>
            ) : (
              <span className="font-medium">
                {user.email}
                <button onClick={() => { setEditingEmail(true); setNewEmail(user.email) }} className="ml-2 text-xs text-fg hover:text-fg">修改</button>
              </span>
            )}
            {emailMsg && <span className="ml-2 text-xs text-green-600">{emailMsg}</span>}
            {emailError && <span className="ml-2 text-xs text-red-500">{emailError}</span>}
          </div>
          <div>
            <span className="text-gray-500">本月用量：</span>
            <span className="font-medium">{formatByCurrency(user.billing?.current_month_by_currency ?? { CNY: user.billing?.current_month_cost ?? 0 })}</span>
            <span className="ml-2 text-xs text-gray-400">（每月 1 日结算出账）</span>
          </div>
          {user.billing && user.billing.unpaid_total > 0 && (
            <div>
              <span className="text-gray-500">未付账单：</span>
              <span className={`font-medium ${user.billing.is_suspended ? "text-red-600" : "text-amber-600"}`}>
                {formatByCurrency(user.billing.unpaid_by_currency ?? { CNY: user.billing.unpaid_total })}
              </span>
              {user.billing.is_suspended && (
                <span className="ml-2 text-xs text-red-600">⚠ 已逾期，服务已暂停</span>
              )}
              <Link href="/dashboard/invoices" className="ml-2 text-xs text-fg hover:underline">查看账单</Link>
            </div>
          )}
          <div>
            <span className="text-gray-500">角色：</span>
            <span className="font-medium">
              {user.role === "admin" ? "管理员" : user.role === "both" ? "消费者+提供者" : user.role === "provider" ? "提供者" : "消费者"}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border p-6 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-semibold">外观主题</h2>
            <p className="text-xs text-gray-500 mt-1">默认跟随系统；切换后会立即生效并记住选择</p>
          </div>
          <div className="inline-flex items-center rounded-lg border border-line bg-white p-0.5">
            {(
              [
                { value: "light", label: "浅色" },
                { value: "dark", label: "深色" },
                { value: "system", label: "跟随系统" },
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

      <div className="bg-white rounded-lg border p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">登录密码</h2>
            <p className="text-xs text-gray-500 mt-1">建议定期更换，使用大小写字母、数字和特殊字符的组合</p>
          </div>
          <button
            onClick={() => { setShowPwModal(true); setMsg(""); setError(""); setOldPw(""); setNewPw(""); setConfirmPw("") }}
            className="px-4 py-2 text-sm bg-fg text-white rounded-lg hover:bg-fg/90"
          >
            修改密码
          </button>
        </div>
        {msg && <div className="mt-4 p-3 bg-green-50 text-green-600 rounded text-sm">{msg}</div>}
      </div>

      {showPwModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setShowPwModal(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">修改密码</h3>
              <button
                onClick={() => !saving && setShowPwModal(false)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded text-sm">{error}</div>}
            <form onSubmit={handleChangePw} className="space-y-4">
              <PasswordInput label="原密码" value={oldPw} onChange={setOldPw} required />
              <PasswordInput label="新密码" value={newPw} onChange={setNewPw} required minLength={8} showStrength />
              <PasswordInput label="确认新密码" value={confirmPw} onChange={setConfirmPw} required />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPwModal(false)}
                  disabled={saving}
                  className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-fg text-white px-6 py-2 text-sm rounded-lg hover:bg-fg/90 disabled:opacity-50"
                >
                  {saving ? "保存中..." : "确认修改"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {user.role !== "admin" && (
        <div className="mt-6 text-sm text-gray-500">
          需要注销账号？请前往 <Link href="/dashboard/other" className="text-fg hover:underline">其他</Link> 页面。
        </div>
      )}
    </div>
  )
}
