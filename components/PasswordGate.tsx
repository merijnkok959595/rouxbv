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
    // Skip gate in local development
    if (process.env.NODE_ENV === 'development') { setUnlocked(true); setReady(true); return }
    if (sessionStorage.getItem(KEY) === '1') setUnlocked(true)
    setReady(true)
  }, [])

  function attempt() {
    if (input === PASSWORD) {
      sessionStorage.setItem(KEY, '1')
      setUnlocked(true)
      setError(false)
    } else {
      setError(true)
      setInput('')
    }
  }

  if (!ready)    return null
  if (unlocked)  return <>{children}</>

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      backgroundColor: '#0a0a0a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: '100%', maxWidth: '360px', padding: '0 24px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: '22px', fontWeight: 800, letterSpacing: '0.18em',
            color: '#ffffff', marginBottom: '6px',
          }}>ROUX</div>
          <div style={{ fontSize: '12px', color: '#555', letterSpacing: '0.06em' }}>
            Voer de toegangscode in
          </div>
        </div>

        {/* Input */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input
            type="password"
            value={input}
            autoFocus
            placeholder="Wachtwoord"
            onChange={e => { setInput(e.target.value); setError(false) }}
            onKeyDown={e => e.key === 'Enter' && attempt()}
            style={{
              width: '100%', padding: '12px 16px', borderRadius: '10px',
              border: `1px solid ${error ? '#ef4444' : '#222'}`,
              backgroundColor: '#111', color: '#fff',
              fontSize: '15px', outline: 'none', boxSizing: 'border-box',
              letterSpacing: '0.1em',
              transition: 'border-color 0.2s',
            }}
          />
          {error && (
            <p style={{ margin: 0, fontSize: '12px', color: '#ef4444', textAlign: 'center' }}>
              Onjuiste code. Probeer opnieuw.
            </p>
          )}
          <button
            onClick={attempt}
            style={{
              width: '100%', padding: '12px', borderRadius: '10px',
              border: 'none', backgroundColor: '#ffffff', color: '#0a0a0a',
              fontSize: '14px', fontWeight: 700, cursor: 'pointer',
              letterSpacing: '0.04em',
            }}
          >
            Toegang
          </button>
        </div>
      </div>
    </div>
  )
}
