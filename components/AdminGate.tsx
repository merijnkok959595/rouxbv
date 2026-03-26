'use client'

import { useState, useEffect } from 'react'

const PASSWORD = 'ADMIN123!'
const KEY      = 'roux_admin_unlocked'

export default function AdminGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false)
  const [input,    setInput]    = useState('')
  const [error,    setError]    = useState(false)
  const [ready,    setReady]    = useState(false)

  useEffect(() => {
    if (localStorage.getItem(KEY) === '1') setUnlocked(true)
    setReady(true)
  }, [])

  function attempt() {
    if (input === PASSWORD) {
      localStorage.setItem(KEY, '1')
      setUnlocked(true); setError(false)
    } else {
      setError(true); setInput('')
    }
  }

  if (!ready)   return null
  if (unlocked) return <>{children}</>

  return (
    <div className="fixed inset-x-0 bottom-0 z-[9999] bg-[#0a0a0a] flex items-center justify-center px-6" style={{ top: '80px' }}>
      <div className="w-full max-w-[360px] flex flex-col items-center gap-6">
        <div className="text-center">
          <div className="text-[22px] font-extrabold tracking-[0.18em] text-white mb-1.5">ROUX</div>
          <div className="text-xs text-[#555] tracking-[0.06em]">Admin toegang vereist</div>
        </div>
        <div className="w-full flex flex-col gap-2.5">
          <input
            type="password"
            value={input}
            autoFocus
            placeholder="Admin wachtwoord"
            onChange={e => { setInput(e.target.value); setError(false) }}
            onKeyDown={e => e.key === 'Enter' && attempt()}
            className="w-full px-4 py-3 rounded-[10px] bg-white text-[#0a0a0a] text-[15px] outline-none tracking-[0.1em] transition-colors box-border placeholder:text-[#999]"
            style={{ border: `1px solid ${error ? '#ef4444' : '#ddd'}` }}
          />
          {error && (
            <p className="text-xs text-red-400 text-center">Onjuiste code. Probeer opnieuw.</p>
          )}
          <button
            onClick={attempt}
            className="w-full py-3 rounded-[10px] border-none bg-white text-[#0a0a0a] text-sm font-bold cursor-pointer tracking-[0.04em] hover:opacity-90 transition-opacity"
          >
            Toegang
          </button>
        </div>
      </div>
    </div>
  )
}
