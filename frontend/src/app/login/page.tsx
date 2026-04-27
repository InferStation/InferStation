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
      router.push("/dashboard")
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "登录失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-5 bg-bg">
      {/* Left brand panel */}
      <aside className="hidden lg:flex lg:col-span-2 flex-col justify-between p-10 bg-fg text-accent-fg">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-white/10 grid place-items-center">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 2l9 5-9 5-9-5 9-5z M3 12l9 5 9-5 M3 17l9 5 9-5" /></svg>
          </div>
          <span className="text-base font-semibold tracking-tight">天枢</span>
        </Link>
        <div>
          <h2 className="text-3xl font-semibold leading-tight tracking-tight mb-3">
            一个 API，<br />接入所有大模型
          </h2>
          <p className="text-sm text-white/60 max-w-sm leading-relaxed">
            天枢把分散的 LLM 后端聚合为统一 OpenAI 兼容接口，按优先级自动调度、失败转移、按 token 真实计费。
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-white/40">
          <span>© {new Date().getFullYear()} Tianshu</span>
          <Link href="/terms" className="hover:text-white/70">服务条款</Link>
          <Link href="/privacy" className="hover:text-white/70">隐私政策</Link>
        </div>
      </aside>

      {/* Right form panel */}
      <div className="lg:col-span-3 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Link href="/" className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-7 h-7 rounded-lg bg-fg text-accent-fg grid place-items-center text-xs font-semibold">天</div>
            <span className="text-[15px] font-semibold tracking-tight">天枢</span>
          </Link>
          <h1 className="text-[22px] font-semibold tracking-tight mb-1">欢迎回来</h1>
          <p className="text-sm text-fg-muted mb-6">登录后管理订阅、密钥与账单</p>
          {error && <div className="mb-4 p-3 bg-danger/10 text-danger rounded-lg text-[13px]">{error}</div>}
          {info && <div className="mb-4 p-3 bg-success/10 text-success rounded-lg text-[13px]">{info}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-fg mb-1.5">用户名或邮箱</label>
              <input
                type="text"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                required
                className="w-full h-10 px-3 text-sm rounded-lg bg-surface border border-line placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-fg/15 focus:border-fg/40"
              />
            </div>
            <PasswordInput label="密码" value={password} onChange={setPassword} required />
            <div>
              <label className="block text-xs font-medium text-fg mb-1.5">邮箱验证码</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  required
                  placeholder="6 位验证码"
                  className="flex-1 h-10 px-3 text-sm rounded-lg bg-surface border border-line placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-fg/15 focus:border-fg/40"
                />
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={sending || cooldown > 0}
                  className="h-10 px-3 text-sm rounded-lg bg-surface border border-line text-fg hover:bg-accent-soft disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {cooldown > 0 ? `${cooldown}s` : sending ? "发送中" : "获取验证码"}
                </button>
              </div>
            </div>
            <label className="flex items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="w-4 h-4 rounded border-line accent-fg"
              />
              <span className="text-[13px] text-fg-muted">记住我</span>
            </label>
            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-lg bg-fg text-accent-fg text-sm font-medium hover:bg-fg/90 disabled:opacity-50"
            >
              {loading ? "登录中..." : "登录"}
            </button>
          </form>
          <p className="text-center text-[13px] text-fg-muted mt-6">
            没有账号？<Link href="/register" className="text-fg font-medium hover:underline">立即注册</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
