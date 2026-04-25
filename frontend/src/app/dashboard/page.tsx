"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"
import { formatByCurrency } from "@/lib/currency"
import PasswordInput, { checkStrength } from "@/components/PasswordInput"

export default function AccountPage() {
  const { user, refreshUser, logout } = useAuth()
  const router = useRouter()
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

  // --- Delete account ---
  const [showDelete, setShowDelete] = useState(false)
  const [delPassword, setDelPassword] = useState("")
  const [delCode, setDelCode] = useState("")
  const [delConfirm, setDelConfirm] = useState("")
  const [delError, setDelError] = useState("")
  const [delSending, setDelSending] = useState(false)
  const [delSaving, setDelSaving] = useState(false)
  const [delCooldown, setDelCooldown] = useState(0)

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
      <h1 className="text-2xl font-bold mb-6">账号密码</h1>

      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="font-semibold mb-4">账号信息</h2>
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
                  className="border rounded px-2 py-0.5 text-sm w-48 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={emailCode}
                  onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="验证码"
                  className="border rounded px-2 py-0.5 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <button
                  onClick={handleSendEmailCode}
                  disabled={emailSending || emailCooldown > 0}
                  className="text-xs text-indigo-600 hover:text-indigo-800 disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  {emailCooldown > 0 ? `${emailCooldown}s` : emailSending ? "发送中" : "发送验证码"}
                </button>
                <button onClick={handleChangeEmail} disabled={emailSaving} className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50">
                  {emailSaving ? "保存中" : "保存"}
                </button>
                <button onClick={() => { setEditingEmail(false); setNewEmail(""); setEmailCode(""); setEmailError("") }} className="text-xs text-gray-400 hover:text-gray-600">取消</button>
              </span>
            ) : (
              <span className="font-medium">
                {user.email}
                <button onClick={() => { setEditingEmail(true); setNewEmail(user.email) }} className="ml-2 text-xs text-indigo-500 hover:text-indigo-700">修改</button>
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
              <Link href="/dashboard/invoices" className="ml-2 text-xs text-indigo-600 hover:underline">查看账单</Link>
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

      <div className="bg-white rounded-lg border p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">登录密码</h2>
            <p className="text-xs text-gray-500 mt-1">建议定期更换，使用大小写字母、数字和特殊字符的组合</p>
          </div>
          <button
            onClick={() => { setShowPwModal(true); setMsg(""); setError(""); setOldPw(""); setNewPw(""); setConfirmPw("") }}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
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
                  className="bg-indigo-600 text-white px-6 py-2 text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? "保存中..." : "确认修改"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {user.role !== "admin" && (
        <div className="bg-white rounded-lg border border-red-200 p-6 mt-6">
          <h2 className="font-semibold text-red-600 mb-2">注销账号</h2>
          <p className="text-sm text-gray-600 mb-3">
            注销后账号将立即停用、API 密钥全部失效、所有订阅解除、名下服务全部下架。历史账单与用量记录仍会保留用于审计。此操作不可逆。
          </p>
          <div className="text-xs text-gray-500 mb-3 leading-relaxed bg-gray-50 border rounded p-2">
            <div className="font-medium text-gray-700 mb-1">注销前请依次完成：</div>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>在「订阅」页取消全部订阅</li>
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
