"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { useT } from "@/context/LocaleContext"

// Lands after a successful Google OAuth callback. The gateway redirects here
// with `#token=<jwt>&remember=0|1` in the URL fragment, so the token never
// reaches the server logs. We pull it out, hand it to AuthContext.login(),
// then bounce to the home page.
export default function GoogleOAuthDone() {
  const t = useT()
  const router = useRouter()
  const auth = useAuth()
  const [error, setError] = useState<string | null>(null)
  // AuthProvider rebuilds its context value on every render and useT() returns
  // a fresh closure each render, so the effect deps change as soon as
  // `auth.login()` calls setToken/setUser — without this guard the effect
  // re-fires, finds the hash already wiped, and bails out as "missing token"
  // (or worse, bounces the user back to /login mid-login).
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : ""
    const params = new URLSearchParams(hash)
    const token = params.get("token")
    const remember = params.get("remember") === "1"
    if (!token) {
      setError(t({ en: "Missing token in callback", zh: "回调缺少 token" }))
      return
    }
    // Wipe the fragment from the URL so the token isn't kept in browser history.
    window.history.replaceState({}, "", "/auth/google/done")
    auth
      .login(token, remember)
      .then(() => router.replace("/"))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
      })
  }, [auth, router, t])

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="text-center">
        {error ? (
          <>
            <p className="text-danger mb-3">{error}</p>
            <button
              onClick={() => router.replace("/login")}
              className="h-9 px-4 rounded-lg bg-fg text-accent-fg text-sm"
            >
              {t({ en: "Back to login", zh: "返回登录" })}
            </button>
          </>
        ) : (
          <p className="text-fg-muted text-sm">
            {t({ en: "Signing you in…", zh: "正在登录…" })}
          </p>
        )}
      </div>
    </div>
  )
}
