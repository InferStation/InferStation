"use client"

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react"

const API = process.env.NEXT_PUBLIC_API_URL || ""

interface BillingSummary {
  current_month_cost: number
  unpaid_total: number
  overdue_total: number
  is_suspended: boolean
}

interface User {
  id: number
  email: string
  username: string
  role: string
  verified: number
  billing?: BillingSummary
}

interface AuthCtx {
  user: User | null
  token: string | null
  login: (token: string, remember?: boolean) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
  loading: boolean
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  token: null,
  login: async () => {},
  logout: () => {},
  refreshUser: async () => {},
  loading: true,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchUser = useCallback(async (t: string) => {
    try {
      const res = await fetch(`${API}/api/auth/me`, {
        headers: { Authorization: `Bearer ${t}` },
      })
      if (res.ok) {
        const u = await res.json()
        setUser(u)
        setToken(t)
      } else {
        localStorage.removeItem("token")
        sessionStorage.removeItem("token")
        setToken(null)
        setUser(null)
      }
    } catch {
      localStorage.removeItem("token")
      sessionStorage.removeItem("token")
      setToken(null)
      setUser(null)
    }
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem("token") || sessionStorage.getItem("token")
    if (saved) {
      fetchUser(saved).finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [fetchUser])

  const login = async (t: string, remember = false) => {
    if (remember) localStorage.setItem("token", t)
    else sessionStorage.setItem("token", t)
    setToken(t)
    await fetchUser(t)
  }

  const logout = () => {
    localStorage.removeItem("token")
    sessionStorage.removeItem("token")
    setToken(null)
    setUser(null)
  }

  const refreshUser = async () => {
    const t = localStorage.getItem("token") || sessionStorage.getItem("token")
    if (t) await fetchUser(t)
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout, refreshUser, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
