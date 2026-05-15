"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"
import PasswordInput from "@/components/PasswordInput"
import Link from "next/link"

export default function LoginPage() {
  const [login, setLogin] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState("")
  const [info, setInfo] = useState("")
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const cdRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const router = useRouter()
  const auth = useAuth()

  const handleSendCode = async () => {
    setError(""); setInfo("")
    if (!login.trim()) { setError("请先输入用户名或邮箱"); return }
    setSending(true)
    try {
      const data = await apiFetch("/api/auth/send-code", {
        method: "POST",
        body: JSON.stringify({ email: login.trim(), purpose: "login" }),
      })
      setInfo(data?.dev_code ? `验证码已生成（开发模式：${data.dev_code}）` : "验证码已发送至账号绑定邮箱")
      setCooldown(60)
      if (cdRef.current) clearInterval(cdRef.current)
      cdRef.current = setInterval(() => {
        setCooldown((c) => {
          if (c <= 1) { if (cdRef.current) { clearInterval(cdRef.current); cdRef.current = null } ; return 0 }
          return c - 1
        })
      }, 1000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "发送失败")
    } finally { setSending(false) }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const data = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ login, password, code: code.trim(), remember }),
      })
      await auth.login(data.token, remember)
      router.push("/models")
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "登录失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex justify-center pt-16">
      <div className="w-full max-w-lg bg-white rounded-lg border p-8">
        <h2 className="text-2xl font-bold text-center mb-6">登录</h2>
        {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded text-sm">{error}</div>}
        {info && <div className="mb-4 p-3 bg-green-50 text-green-600 rounded text-sm">{info}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">用户名或邮箱</label>
            <input
              type="text"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              required
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
          <PasswordInput label="密码" value={password} onChange={setPassword} required />
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
                placeholder="6 位验证码"
                className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSendCode}
                disabled={sending || cooldown > 0}
                className="px-3 py-2 text-sm border border-indigo-300 text-indigo-600 rounded-lg hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {cooldown > 0 ? `${cooldown}s` : sending ? "发送中" : "获取验证码"}
              </button>
            </div>
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="mr-2"
            />
            <span className="text-sm text-gray-600">记住我</span>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? "登录中..." : "登录"}
          </button>
        </form>
        <p className="text-center text-sm text-gray-500 mt-4">
          没有账号？<Link href="/register" className="text-indigo-600 hover:underline">注册</Link>
        </p>
      </div>
    </div>
  )
}
