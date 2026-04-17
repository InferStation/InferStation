"use client"

import { useState } from "react"

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
  minLength?: number
  label: string
  showStrength?: boolean
}

function checkStrength(pw: string) {
  let cats = 0
  if (/[a-z]/.test(pw)) cats++
  if (/[A-Z]/.test(pw)) cats++
  if (/[0-9]/.test(pw)) cats++
  if (/[^a-zA-Z0-9]/.test(pw)) cats++
  return { cats, ok: cats >= 3 && pw.length >= 8 }
}

export default function PasswordInput({ value, onChange, placeholder, required, minLength, label, showStrength }: Props) {
  const [show, setShow] = useState(false)
  const { cats, ok } = checkStrength(value)

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          className="w-full px-3 py-2 pr-10 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          tabIndex={-1}
        >
          {show ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
      {showStrength && value.length > 0 && (
        <div className="mt-1.5 space-y-1">
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className={`h-1 flex-1 rounded ${i <= cats ? (ok ? "bg-green-500" : "bg-yellow-500") : "bg-gray-200"}`} />
            ))}
          </div>
          <p className={`text-xs ${ok ? "text-green-600" : "text-red-500"}`}>
            {ok ? "密码强度合格" : "需包含大写、小写、数字、特殊字符中的至少3种，且不少于8位"}
          </p>
        </div>
      )}
    </div>
  )
}

export { checkStrength }
