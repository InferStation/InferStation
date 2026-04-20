"use client"

import { useState } from "react"
import Link from "next/link"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"
import PasswordInput, { checkStrength } from "@/components/PasswordInput"

export default function AccountPage() {
  const { user, refreshUser } = useAuth()
  const [oldPw, setOldPw] = useState("")
  const [newPw, setNewPw] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [msg, setMsg] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [editingEmail, setEditingEmail] = useState(false)
  const [newEmail, setNewEmail] = useState("")
  const [emailMsg, setEmailMsg] = useState("")
  const [emailError, setEmailError] = useState("")
  const [emailSaving, setEmailSaving] = useState(false)

  if (!user) return null

  const handleChangeEmail = async () => {
    setEmailMsg(""); setEmailError("")
    if (!newEmail.trim()) { setEmailError("请输入邮箱"); return }
    setEmailSaving(true)
    try {
      await apiFetch("/api/auth/change-email", {
        method: "POST",
        body: JSON.stringify({ new_email: newEmail.trim() }),
      })
      setEmailMsg("邮箱修改成功")
      setEditingEmail(false)
      setNewEmail("")
      await refreshUser()
    } catch (err: unknown) {
      setEmailError(err instanceof Error ? err.message : "修改失败")
    } finally { setEmailSaving(false) }
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
              <span className="inline-flex items-center gap-2">
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder={user.email}
                  className="border rounded px-2 py-0.5 text-sm w-48 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <button onClick={handleChangeEmail} disabled={emailSaving} className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50">
                  {emailSaving ? "保存中" : "保存"}
                </button>
                <button onClick={() => { setEditingEmail(false); setNewEmail(""); setEmailError("") }} className="text-xs text-gray-400 hover:text-gray-600">取消</button>
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
            <span className="font-medium">¥{(user.billing?.current_month_cost ?? 0).toFixed(6)}</span>
            <span className="ml-2 text-xs text-gray-400">（每月 1 日结算出账）</span>
          </div>
          {user.billing && user.billing.unpaid_total > 0 && (
            <div>
              <span className="text-gray-500">未付账单：</span>
              <span className={`font-medium ${user.billing.is_suspended ? "text-red-600" : "text-amber-600"}`}>
                ¥{user.billing.unpaid_total.toFixed(6)}
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
        <h2 className="font-semibold mb-4">修改密码</h2>
        {msg && <div className="mb-4 p-3 bg-green-50 text-green-600 rounded text-sm">{msg}</div>}
        {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded text-sm">{error}</div>}
        <form onSubmit={handleChangePw} className="space-y-4 max-w-md">
          <PasswordInput label="原密码" value={oldPw} onChange={setOldPw} required />
          <PasswordInput label="新密码" value={newPw} onChange={setNewPw} required minLength={8} showStrength />
          <PasswordInput label="确认新密码" value={confirmPw} onChange={setConfirmPw} required />
          <button
            type="submit"
            disabled={saving}
            className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "修改密码"}
          </button>
        </form>
      </div>
    </div>
  )
}
