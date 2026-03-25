'use client'

import { useState, useRef, useEffect } from 'react'
import { ArrowUp, Phone, PhoneOff, Mic, MicOff } from 'lucide-react'
import { RetellWebClient } from 'retell-client-js-sdk'

type Msg = { role: 'user' | 'ai'; text: string; streaming?: boolean }

const SUGGESTIONS = [
  'Maak een nieuw contact aan',
  'Plan een afspraak met een contact',
  'Voeg een notitie toe',
  'Maak een follow-up taak aan',
]

function useCallTimer(active: boolean) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!active) { setSecs(0); return }
    const id = setInterval(() => setSecs(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [active])
  return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
}

export default function SuusPage() {
  const [msgs,        setMsgs]        = useState<Msg[]>([])
  const [input,       setInput]       = useState('')
  const [sessionId]                   = useState(() => crypto.randomUUID())
  const [calling,     setCalling]     = useState(false)
  const [callStatus,  setCallStatus]  = useState<'idle' | 'connecting' | 'active'>('idle')
  const [agentTalking,setAgentTalking]= useState(false)
  const [userTalking, setUserTalking] = useState(false)
  const [muted,       setMuted]       = useState(false)
  const retellRef = useRef<RetellWebClient | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const timer     = useCallTimer(callStatus === 'active')

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  async function sendMessage(text: string) {
    if (!text.trim()) return
    setInput('')
    setMsgs(p => [...p, { role: 'user', text }, { role: 'ai', text: '', streaming: true }])

    try {
      const res = await fetch('/api/suus', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: text, session_id: sessionId }),
      })
      if (!res.ok || !res.body) throw new Error()

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let full = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        full += decoder.decode(value, { stream: true })
        setMsgs(p => p.map((m, i) => i === p.length - 1 ? { ...m, text: full } : m))
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      }
      setMsgs(p => p.map((m, i) => i === p.length - 1 ? { ...m, streaming: false } : m))
    } catch {
      setMsgs(p => p.map((m, i) => i === p.length - 1 ? { ...m, text: 'Er ging iets mis. Probeer opnieuw.', streaming: false } : m))
    }
  }

  async function toggleCall() {
    if (calling) {
      retellRef.current?.stopCall()
      retellRef.current = null
      setCalling(false); setCallStatus('idle'); setAgentTalking(false); setUserTalking(false); setMuted(false)
      return
    }
    setCalling(true); setCallStatus('connecting')
    try {
      const res  = await fetch('/api/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: sessionId }) })
      const data = await res.json()
      if (!data.access_token) throw new Error('No access token')

      const client = new RetellWebClient()
      retellRef.current = client

      client.on('call_started',          () => setCallStatus('active'))
      client.on('call_ended',            () => { setCalling(false); setCallStatus('idle') })
      client.on('agent_start_talking',   () => setAgentTalking(true))
      client.on('agent_stop_talking',    () => setAgentTalking(false))
      client.on('user_start_talking',    () => setUserTalking(true))
      client.on('user_stop_talking',     () => setUserTalking(false))
      client.on('error',                 () => { setCalling(false); setCallStatus('idle') })

      await client.startCall({ accessToken: data.access_token })
    } catch {
      setCalling(false); setCallStatus('idle')
    }
  }

  function toggleMute() {
    const c = retellRef.current as RetellWebClient & { mute?: (m: boolean) => void } | null
    if (!c) return
    const next = !muted
    c.mute?.(next)
    setMuted(next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: 'var(--bg)' }}>

      {/* Header */}
      <div style={{ height: '52px', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', flexShrink: 0 }}>
        <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>SUUS</span>
        <button
          onClick={toggleCall}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: '#fff', backgroundColor: calling ? '#DC2626' : '#16a34a', transition: 'background 0.2s' }}
        >
          {calling ? <PhoneOff size={14} /> : <Phone size={14} />}
          {calling ? 'Ophangen' : 'Bellen'}
        </button>
      </div>

      {/* Call overlay */}
      {calling && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)' }}>
          <div style={{ backgroundColor: 'var(--surface)', borderRadius: '20px', padding: '36px 32px', width: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', border: '1px solid var(--border)' }}>
            <div style={{ position: 'relative', width: '72px', height: '72px' }}>
              {agentTalking && <div style={{ position: 'absolute', inset: '-10px', borderRadius: '50%', border: '2px solid var(--brand)', opacity: 0.5, animation: 'pulse 1s ease-in-out infinite' }} />}
              <div style={{ width: '72px', height: '72px', borderRadius: '50%', backgroundColor: '#6366F1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px' }}>S</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' }}>SUUS</p>
              <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>
                {callStatus === 'connecting' ? 'Verbinden…' : userTalking ? 'Luistert…' : agentTalking ? 'Spreekt…' : timer}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={toggleMute} style={{ width: '48px', height: '48px', borderRadius: '50%', border: '1px solid var(--border)', backgroundColor: muted ? '#EF4444' : 'var(--active)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: muted ? '#fff' : 'var(--muted)' }}>
                {muted ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
              <button onClick={toggleCall} style={{ width: '48px', height: '48px', borderRadius: '50%', border: 'none', backgroundColor: '#DC2626', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                <PhoneOff size={18} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {msgs.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px', marginTop: '60px' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '50%', backgroundColor: '#6366F1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', color: '#fff', fontWeight: 700 }}>S</div>
            <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>Hoi! Ik ben SUUS.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', width: '100%', maxWidth: '400px' }}>
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => sendMessage(s)} style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', fontSize: '12px', color: 'var(--muted)', cursor: 'pointer', textAlign: 'left', lineHeight: 1.4 }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '80%', padding: '10px 14px', borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
              backgroundColor: m.role === 'user' ? 'var(--text)' : 'var(--surface)',
              color: m.role === 'user' ? '#fff' : 'var(--text)',
              fontSize: '14px', lineHeight: 1.55, border: m.role === 'ai' ? '1px solid var(--border)' : 'none',
            }}>
              {m.text || (m.streaming ? '…' : '')}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', backgroundColor: 'var(--surface)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', maxWidth: '700px', margin: '0 auto' }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
            placeholder="Stel een vraag of geef een opdracht…"
            rows={1}
            style={{ flex: 1, resize: 'none', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--border)', backgroundColor: 'var(--bg)', fontSize: '14px', color: 'var(--text)', outline: 'none', lineHeight: 1.5 }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim()}
            style={{ width: '40px', height: '40px', borderRadius: '10px', border: 'none', backgroundColor: input.trim() ? 'var(--text)' : 'var(--border)', color: input.trim() ? '#fff' : 'var(--muted)', cursor: input.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            <ArrowUp size={16} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  )
}
