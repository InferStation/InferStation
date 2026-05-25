"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { apiFetch } from "@/lib/api"
import PasswordInput from "@/components/PasswordInput"
import Link from "next/link"
import { useT } from "@/context/LocaleContext"

const API_URL = process.env.NEXT_PUBLIC_API_URL || ""

export default function LoginPage() {
  const t = useT()
  const [login, setLogin] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState("")
  const [info, setInfo] = useState("")
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [googleEnabled, setGoogleEnabled] = useState(false)
  const cdRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const router = useRouter()
  const search = useSearchParams()
  const auth = useAuth()

  useEffect(() => () => { if (cdRef.current) clearInterval(cdRef.current) }, [])

  // Surface ?error=... from the OAuth callback redirect.
  useEffect(() => {
    const e = search.get("error")
    if (e) setError(decodeURIComponent(e))
  }, [search])

  // Probe whether Google sign-in is configured on this gateway.
  useEffect(() => {
    let alive = true
    apiFetch("/api/auth/google/config")
      .then((d) => { if (alive) setGoogleEnabled(!!d?.enabled) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const handleGoogleLogin = () => {
    window.location.href = `${API_URL}/api/auth/google/login?remember=${remember ? 1 : 0}`
  }

  const handleSendCode = async () => {
    setError(""); setInfo("")
    if (!login.trim()) { setError(t({ en: "Please enter your username or email first", zh: "请先输入用户名或邮箱" })); return }
    setSending(true)
    try {
      const data = await apiFetch("/api/auth/send-code", {
        method: "POST",
        body: JSON.stringify({ email: login.trim(), purpose: "login" }),
      })
      setInfo(data?.dev_code
        ? t({ en: `Verification code generated (dev mode: ${data.dev_code})`, zh: `验证码已生成（开发模式：${data.dev_code}）` })
        : t({ en: "Verification code sent to the account's bound email", zh: "验证码已发送至账号绑定邮箱" }))
      setCooldown(60)
      if (cdRef.current) clearInterval(cdRef.current)
      cdRef.current = setInterval(() => {
        setCooldown((c) => {
          if (c <= 1) { if (cdRef.current) { clearInterval(cdRef.current); cdRef.current = null } ; return 0 }
          return c - 1
        })
      }, 1000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t({ en: "Failed to send", zh: "发送失败" }))
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
      setError(err instanceof Error ? err.message : t({ en: "Login failed", zh: "登录失败" }))
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
          <span className="text-base font-semibold tracking-tight">{t({ en: "Tianshu", zh: "天枢" })}</span>
        </Link>
        <div>
          <h2 className="text-3xl font-semibold leading-tight tracking-tight mb-3">
            {t({ en: "Welcome back", zh: "欢迎回来" })}<br />{t({ en: "Aggregate LLM compute", zh: "聚合 LLM 算力" })}
          </h2>
          <p className="text-sm text-white/60 max-w-sm leading-relaxed">
            {t({ en: "Sign in to manage your API keys, top up balance, or list your own backends.", zh: "登录后管理 API Key、充值余额，或挂载你自己的算力服务。" })}
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-white/40">
          <span>© {new Date().getFullYear()} Tianshu</span>
          <Link href="/terms" className="hover:text-white/70">{t({ en: "Terms", zh: "服务条款" })}</Link>
          <Link href="/privacy" className="hover:text-white/70">{t({ en: "Privacy", zh: "隐私政策" })}</Link>
        </div>
      </aside>

      <div className="lg:col-span-3 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Link href="/" className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-7 h-7 rounded-lg bg-fg text-accent-fg grid place-items-center text-xs font-semibold">{t({ en: "T", zh: "天" })}</div>
            <span className="text-[15px] font-semibold tracking-tight">{t({ en: "Tianshu", zh: "天枢" })}</span>
          </Link>
          <h1 className="text-[22px] font-semibold tracking-tight mb-1">{t({ en: "Sign in", zh: "登录" })}</h1>
          <p className="text-sm text-fg-muted mb-6">{t({ en: "Use your username or email and password.", zh: "使用用户名或邮箱 + 密码登录。" })}</p>
          {error && <div className="mb-4 p-3 bg-danger/10 text-danger rounded-lg text-[13px]">{error}</div>}
          {info && <div className="mb-4 p-3 bg-success/10 text-success rounded-lg text-[13px]">{info}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-fg mb-1.5">{t({ en: "Username or email", zh: "用户名或邮箱" })}</label>
              <input
                type="text"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                required
                className="w-full h-10 px-3 text-sm rounded-lg bg-surface border border-line placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-fg/15 focus:border-fg/40"
              />
            </div>
            <PasswordInput label={t({ en: "Password", zh: "密码" })} value={password} onChange={setPassword} required />
            <div>
              <label className="block text-xs font-medium text-fg mb-1.5">{t({ en: "Email verification code", zh: "邮箱验证码" })}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder={t({ en: "6 digits (admins may leave blank)", zh: "6 位验证码（管理员可留空）" })}
                  className="flex-1 h-10 px-3 text-sm rounded-lg bg-surface border border-line placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-fg/15 focus:border-fg/40"
                />
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={sending || cooldown > 0}
                  className="h-10 px-3 text-sm rounded-lg bg-surface border border-line text-fg hover:bg-accent-soft disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {cooldown > 0 ? `${cooldown}s` : sending ? t({ en: "Sending", zh: "发送中" }) : t({ en: "Send code", zh: "发送验证码" })}
                </button>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-fg-muted select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-line text-fg focus:ring-fg/20"
              />
              {t({ en: "Remember me", zh: "记住我" })}
            </label>
            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-lg bg-fg text-accent-fg text-sm font-medium hover:bg-fg/90 disabled:opacity-50 transition-colors"
            >
              {loading ? t({ en: "Signing in…", zh: "登录中…" }) : t({ en: "Sign in", zh: "登录" })}
            </button>
          </form>
          {googleEnabled && (
            <>
              <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-fg-subtle">
                <div className="flex-1 h-px bg-line" />
                <span>{t({ en: "or", zh: "或" })}</span>
                <div className="flex-1 h-px bg-line" />
              </div>
              <button
                type="button"
                onClick={handleGoogleLogin}
                className="w-full h-10 rounded-lg bg-surface border border-line text-fg text-sm font-medium hover:bg-accent-soft transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                  <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                  <path fill="#4CAF50" d="M24 44c5.5 0 10.4-2.1 14.1-5.5l-6.5-5.5C29.5 34.8 26.9 36 24 36c-5.3 0-9.7-3.4-11.3-8l-6.6 5.1C9.6 39.6 16.3 44 24 44z" />
                  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4-4 5.2l6.5 5.5c-.5.4 7-5.1 7-14.7 0-1.3-.1-2.4-.4-3.5z" />
                </svg>
                {t({ en: "Sign in with Google", zh: "使用 Google 登录" })}
              </button>
            </>
          )}
          <p className="text-center text-sm text-fg-muted mt-6">
            {t({ en: "No account?", zh: "没有账号？" })} <Link href="/register" className="text-fg font-medium hover:underline">{t({ en: "Sign up", zh: "注册" })}</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
