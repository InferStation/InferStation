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
              天枢
            </Link>
            <Link href="/models" className="text-gray-600 hover:text-gray-900">
              模型广场
            </Link>
            {user && (
              <Link href="/my-subscriptions" className="text-gray-600 hover:text-gray-900">
                我的订阅
              </Link>
            )}
            {user && (user.role === "provider" || user.role === "both" || user.role === "admin") && (
              <Link href="/my-services" className="text-gray-600 hover:text-gray-900">
                我的服务
              </Link>
            )}
            <Link href="/docs" className="text-gray-600 hover:text-gray-900">
              文档
            </Link>
            {user && user.role === "admin" && (
              <Link href="/admin" className="text-gray-600 hover:text-gray-900">
                管理
              </Link>
            )}
          </div>
          <div className="flex items-center gap-4">
            {user ? (
              <>
                <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-indigo-600">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-gray-500">
                    <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                  </svg>
                  <span className="font-medium">{user.username}</span>
                  {user.billing?.is_suspended && (
                    <span className="ml-2 text-xs text-red-600">⚠ 已暂停</span>
                  )}
                </Link>
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
