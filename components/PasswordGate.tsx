'use client'

import { useState, useEffect } from 'react'

const PASSWORD = 'ROUX2026'
const KEY      = 'roux_unlocked'

export default function PasswordGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false)
  const [input,    setInput]    = useState('')
  const [error,    setError]    = useState(false)
  const [ready,    setReady]    = useState(false)

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') { setUnlocked(true); setReady(true); return }
    if (sessionStorage.getItem(KEY) === '1') setUnlocked(true)
    setReady(true)
  }, [])

  function attempt() {
    if (input === PASSWORD) {
      sessionStorage.setItem(KEY, '1')
      setUnlocked(true); setError(false)
    } else {
      setError(true); setInput('')
    }
  }

  if (!ready)   return null
  if (unlocked) return <>{children}</>

  return (
    <div className="fixed inset-0 z-[9999] bg-[#0a0a0a] flex items-center justify-center">
      <div className="w-full max-w-[360px] px-6 flex flex-col items-center gap-6">
        <div className="text-center">
          <div className="text-[22px] font-extrabold tracking-[0.18em] text-white mb-1.5">ROUX</div>
          <div className="text-xs text-[#555] tracking-[0.06em]">Voer de toegangscode in</div>
        </div>

        <div className="w-full flex flex-col gap-2.5">
          <input
            type="password"
            value={input}
            autoFocus
            placeholder="Wachtwoord"
            onChange={e => { setInput(e.target.value); setError(false) }}
            onKeyDown={e => e.key === 'Enter' && attempt()}
            className="w-full px-4 py-3 rounded-[10px] bg-[#111] text-white text-[15px] outline-none tracking-[0.1em] transition-colors box-border"
            style={{ border: `1px solid ${error ? '#ef4444' : '#222'}` }}
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
