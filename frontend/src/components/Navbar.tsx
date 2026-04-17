"use client"

import Link from "next/link"
import { useAuth } from "@/context/AuthContext"

export default function Navbar() {
  const { user, logout } = useAuth()

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <div className="flex items-center gap-8">
            <Link href="/" className="text-xl font-bold text-indigo-600">
              LLM Gateway
            </Link>
            <Link href="/models" className="text-gray-600 hover:text-gray-900">
              模型市场
            </Link>
            {user && (
              <>
                <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">
                  控制台
                </Link>
                <Link href="/keys" className="text-gray-600 hover:text-gray-900">
                  API Keys
                </Link>
                {(user.role === "provider" || user.role === "both" || user.role === "admin") && (
                  <Link href="/backends" className="text-gray-600 hover:text-gray-900">
                    我的服务
                  </Link>
                )}
                {user.role === "admin" && (
                  <Link href="/admin" className="text-gray-600 hover:text-gray-900">
                    管理
                  </Link>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-4">
            {user ? (
              <>
                <span className="text-sm text-gray-500">
                  {user.username}
                  <span className="ml-2 px-2 py-0.5 rounded text-xs bg-gray-100">
                    {user.role === "admin" ? "管理员" : user.role === "both" ? "消费者+提供者" : user.role === "provider" ? "提供者" : "消费者"}
                  </span>
                  <span className="ml-2 text-green-600">¥{user.balance.toFixed(2)}</span>
                </span>
                <button onClick={logout} className="text-sm text-red-500 hover:text-red-700">
                  退出
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900">
                  登录
                </Link>
                <Link
                  href="/register"
                  className="text-sm bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700"
                >
                  注册
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
