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
    <div className="min-h-screen grid lg:grid-cols-5 bg-bg">
      <aside className="hidden lg:flex lg:col-span-2 flex-col justify-between p-10 bg-fg text-accent-fg">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-white/10 grid place-items-center">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 2l9 5-9 5-9-5 9-5z M3 12l9 5 9-5 M3 17l9 5 9-5" /></svg>
          </div>
          <span className="text-base font-semibold tracking-tight">天枢</span>
        </Link>
        <div>
          <h2 className="text-3xl font-semibold leading-tight tracking-tight mb-3">
            立即加入<br />聚合 LLM 算力
          </h2>
          <p className="text-sm text-white/60 max-w-sm leading-relaxed">
            注册免费，按使用量后付费。也可作为提供者出租闲置算力，平台不抽成、不存储内容。
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-white/40">
          <span>© {new Date().getFullYear()} Tianshu</span>
          <Link href="/terms" className="hover:text-white/70">服务条款</Link>
          <Link href="/privacy" className="hover:text-white/70">隐私政策</Link>
        </div>
      </aside>

      <div className="lg:col-span-3 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Link href="/" className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-7 h-7 rounded-lg bg-fg text-accent-fg grid place-items-center text-xs font-semibold">天</div>
            <span className="text-[15px] font-semibold tracking-tight">天枢</span>
          </Link>
          <h1 className="text-[22px] font-semibold tracking-tight mb-1">创建账号</h1>
          <p className="text-sm text-fg-muted mb-6">几十秒完成，免审核即可使用</p>
          {error && <div className="mb-4 p-3 bg-danger/10 text-danger rounded-lg text-[13px]">{error}</div>}
          {codeMsg && <div className="mb-4 p-3 bg-success/10 text-success rounded-lg text-[13px]">{codeMsg}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-fg mb-1.5">用户名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full h-10 px-3 text-sm rounded-lg bg-surface border border-line placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-fg/15 focus:border-fg/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-fg mb-1.5">邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full h-10 px-3 text-sm rounded-lg bg-surface border border-line placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-fg/15 focus:border-fg/40"
              />
            </div>
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
                  placeholder="6 位数字"
                  className="flex-1 h-10 px-3 text-sm rounded-lg bg-surface border border-line placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-fg/15 focus:border-fg/40"
                />
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={sending || cooldown > 0}
                  className="h-10 px-3 text-sm rounded-lg bg-surface border border-line text-fg hover:bg-accent-soft disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {cooldown > 0 ? `${cooldown}s` : sending ? "发送中" : "发送验证码"}
                </button>
              </div>
            </div>
            <PasswordInput label="密码" value={password} onChange={setPassword} required minLength={8} showStrength />
            <PasswordInput label="确认密码" value={confirm} onChange={setConfirm} required />
            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-lg bg-fg text-accent-fg text-sm font-medium hover:bg-fg/90 disabled:opacity-50"
            >
              {loading ? "注册中..." : "注册"}
            </button>
          </form>
          <p className="text-xs text-fg-subtle text-center mt-4 leading-relaxed">
            注册即表示您已阅读并同意
            <Link href="/terms" className="text-fg hover:underline mx-1">服务条款</Link>
            与
            <Link href="/privacy" className="text-fg hover:underline mx-1">隐私政策</Link>
          </p>
          <p className="text-center text-[13px] text-fg-muted mt-3">
            已有账号？<Link href="/login" className="text-fg font-medium hover:underline">立即登录</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
