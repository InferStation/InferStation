"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"
import PasswordInput, { checkStrength } from "@/components/PasswordInput"
import Link from "next/link"

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export default function RegisterPage() {
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [codeMsg, setCodeMsg] = useState("")
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const router = useRouter()
  const auth = useAuth()

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  const startCooldown = (seconds: number) => {
    setCooldown(seconds)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) { if (timerRef.current) clearInterval(timerRef.current); return 0 }
        return c - 1
      })
    }, 1000)
  }

  const handleSendCode = async () => {
    setError(""); setCodeMsg("")
    if (!EMAIL_RE.test(email.trim())) { setError("请先输入有效的邮箱"); return }
    setSending(true)
    try {
      const data = await apiFetch("/api/auth/send-code", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase(), purpose: "register" }),
      })
      setCodeMsg(data?.dev_code ? `验证码已生成（开发模式：${data.dev_code}）` : "验证码已发送，请查收邮箱")
      startCooldown(60)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "发送失败")
    } finally {
      setSending(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (password !== confirm) { setError("两次密码不一致"); return }
    if (!checkStrength(password).ok) {
      setError("密码需包含大写、小写、数字、特殊字符中的至少3种，且不少于8位")
      return
    }
    if (!/^\d{6}$/.test(code.trim())) { setError("请输入 6 位邮箱验证码"); return }
    setLoading(true)
    try {
      const data = await apiFetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          username,
          email: email.trim().toLowerCase(),
          password,
          code: code.trim(),
        }),
      })
      await auth.login(data.token, true)
      router.push("/dashboard")
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "注册失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex justify-center pt-16">
      <div className="w-full max-w-lg bg-white rounded-lg border p-8">
        <h2 className="text-2xl font-bold text-center mb-6">注册</h2>
        {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded text-sm">{error}</div>}
        {codeMsg && <div className="mb-4 p-3 bg-emerald-50 text-emerald-700 rounded text-sm">{codeMsg}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">邮箱</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">邮箱验证码</label>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
                placeholder="6 位数字"
                className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSendCode}
                disabled={sending || cooldown > 0}
                className="px-3 py-2 text-sm bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {cooldown > 0 ? `${cooldown}s 后重发` : sending ? "发送中..." : "发送验证码"}
              </button>
            </div>
          </div>
          <PasswordInput label="密码" value={password} onChange={setPassword} required minLength={8} showStrength />
          <PasswordInput label="确认密码" value={confirm} onChange={setConfirm} required />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? "注册中..." : "注册"}
          </button>
        </form>
        <p className="text-xs text-gray-500 text-center mt-3">
          注册即表示您已阅读并同意
          <Link href="/terms" className="text-indigo-600 hover:underline mx-1"> 服务条款</Link>
          与
          <Link href="/privacy" className="text-indigo-600 hover:underline mx-1">隐私政策</Link>
        </p>
        <p className="text-center text-sm text-gray-500 mt-4">
          已有账号？<Link href="/login" className="text-indigo-600 hover:underline">登录</Link>
        </p>
      </div>
    </div>
  )
}
