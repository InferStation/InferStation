const API_URL = process.env.NEXT_PUBLIC_API_URL || ""

function getToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem("token") || sessionStorage.getItem("token")
}

export async function apiFetch(
  path: string,
  init?: RequestInit,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const token = getToken()
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`
  if (typeof window !== "undefined") {
    const lang = localStorage.getItem("lang")
    headers["Accept-Language"] = lang === "zh" ? "zh-CN" : "en"
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string>) },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.detail || "请求失败")
  return data
}
