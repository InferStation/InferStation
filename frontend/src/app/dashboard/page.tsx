"use client"

import { useState } from "react"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"
import PasswordInput, { checkStrength } from "@/components/PasswordInput"

export default function AccountPage() {
  const { user } = useAuth()
  const [oldPw, setOldPw] = useState("")
  const [newPw, setNewPw] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [msg, setMsg] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  if (!user) return null

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
            <span className="font-medium">{user.email}</span>
          </div>
          <div>
            <span className="text-gray-500">余额：</span>
            <span className="font-medium text-green-600">¥{user.balance.toFixed(2)}</span>
          </div>
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
