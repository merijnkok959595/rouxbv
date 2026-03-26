'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { ArrowUp, Phone, PhoneOff, Mic, MicOff, X, StopCircle, Paperclip, Image, Mic2 } from 'lucide-react'
import { RetellWebClient } from 'retell-client-js-sdk'
import { useEmployee }      from '@/lib/employee-context'
import ContactForm,  { ContactFormPrefilled } from '@/components/ContactForm'
import BriefingCard, { BriefingData }         from '@/components/BriefingCard'
import { ContactFormCard, ContactSelectorCards, ContactCardData } from '@/components/ContactCard'

type Msg = {
  role:          'user' | 'ai'
  text:          string
  streaming?:    boolean
  image_url?:    string
  formData?:     ContactFormPrefilled
  formDone?:     boolean
  briefingData?: BriefingData
  contactsData?: ContactCardData[]
}

/* ─── CSS ─────────────────────────────────────────────────── */
const CSS = `
  @keyframes orbMorph {
    0%,100% { border-radius:50% }
    25%      { border-radius:44% 56% 55% 45%/48% 52% 48% 52% }
    50%      { border-radius:56% 44% 48% 52%/52% 48% 54% 46% }
    75%      { border-radius:48% 52% 44% 56%/44% 56% 52% 48% }
  }
  @keyframes orbSpin  { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
  @keyframes orbInner { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.7;transform:scale(1.08)} }
  @keyframes ringPulse{ 0%{transform:scale(1);opacity:.5} 70%,100%{transform:scale(1.8);opacity:0} }
  @keyframes waveAnim { 0%,100%{height:4px} 50%{height:22px} }
  @keyframes waveUser { 0%,100%{height:4px} 50%{height:14px} }
  @keyframes recPulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  @keyframes fadeUp   { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  @keyframes msgIn    { from{opacity:0;transform:translateY(3px)} to{opacity:1;transform:translateY(0)} }
  @keyframes dotBounce{ 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }

  /* ── Page shell ── */
  .gpt-wrap { display:flex; flex-direction:column; height:calc(100vh - 44px); background:var(--bg); position:relative; }

  /* ── Feed ── */
  .gpt-feed { flex:1; overflow-y:auto; }
  .gpt-feed::-webkit-scrollbar { width:4px; }
  .gpt-feed::-webkit-scrollbar-track { background:transparent; }
  .gpt-feed::-webkit-scrollbar-thumb { background:var(--border); border-radius:2px; }
  .gpt-inner { max-width:720px; margin:0 auto; padding:24px 16px 16px; display:flex; flex-direction:column; gap:0; }

  /* ── Empty state ── */
  .gpt-empty { display:flex; flex-direction:column; align-items:center; gap:20px;
    padding:60px 0 32px; animation:fadeUp .4s ease; }
  .gpt-empty h2 { font-size:22px; font-weight:700; color:var(--text); letter-spacing:-.03em; margin:0; }
  .gpt-empty p  { font-size:13px; color:var(--muted); margin:0; }
  .gpt-chips { display:grid; grid-template-columns:1fr 1fr; gap:8px; width:100%; max-width:420px; }
  .gpt-chip  { padding:10px 13px; border-radius:10px; border:1px solid var(--border);
    background:var(--surface); font-size:12px; color:var(--text); cursor:pointer;
    text-align:left; line-height:1.4; font-weight:500; transition:background .12s; }
  .gpt-chip:hover { background:var(--active); }

  /* ── Message rows ── */
  .gpt-row { padding:6px 0; animation:msgIn .2s ease; }

  /* AI row: avatar + text side by side */
  .gpt-ai  { display:flex; gap:12px; align-items:flex-start; }
  .gpt-ai-body { flex:1; min-width:0; padding-top:2px; }
  .gpt-ai-text { font-size:14px; line-height:1.65; color:var(--text); white-space:pre-wrap; word-break:break-word; }
  .gpt-ai-cards { margin-top:10px; display:flex; flex-direction:column; gap:8px; }

  /* User row: pill bubble, right-aligned */
  .gpt-user { display:flex; justify-content:flex-end; }
  .gpt-user-bubble { background:var(--active); color:var(--text);
    border-radius:18px 18px 4px 18px;
    padding:9px 14px; font-size:14px; line-height:1.55; max-width:75%;
    white-space:pre-wrap; word-break:break-word; }
  .gpt-user-img { max-width:200px; max-height:150px; border-radius:8px; object-fit:cover;
    display:block; margin-bottom:6px; }

  /* Typing dots */
  .gpt-dots { display:flex; gap:4px; align-items:center; padding:4px 0; }
  .gpt-dot  { width:6px; height:6px; border-radius:50%; background:var(--muted);
    animation:dotBounce .9s ease-in-out infinite; }
  .gpt-dot:nth-child(2) { animation-delay:.15s; }
  .gpt-dot:nth-child(3) { animation-delay:.3s; }

  /* ── Image preview (above input) ── */
  .gpt-preview { max-width:720px; margin:0 auto; padding:0 16px 6px;
    display:flex; align-items:center; gap:8px; }
  .gpt-preview-thumb { height:44px; width:44px; object-fit:cover; border-radius:7px;
    border:1px solid var(--border); }
  .gpt-preview-del { position:absolute; top:-5px; right:-5px; width:16px; height:16px;
    border-radius:50%; border:none; background:#ef4444; color:#fff; cursor:pointer;
    display:flex; align-items:center; justify-content:center; padding:0; }

  /* ── Floating input ── */
  .gpt-bar-wrap { padding:0 16px 14px; padding-bottom:max(14px,env(safe-area-inset-bottom)); flex-shrink:0; }
  .gpt-bar      { max-width:720px; margin:0 auto; background:var(--surface);
    border:1px solid var(--border); border-radius:16px;
    box-shadow:0 2px 12px rgba(0,0,0,.07), 0 0 0 1px rgba(0,0,0,.04);
    overflow:hidden; }
  .gpt-bar-main { display:flex; align-items:flex-end; gap:0; padding:10px 10px 10px 14px; }
  .gpt-textarea { flex:1; resize:none; border:none; background:transparent;
    font-size:14px; color:var(--text); outline:none; line-height:1.55;
    max-height:160px; overflow-y:auto; padding:0; font-family:inherit; }
  .gpt-textarea::placeholder { color:var(--muted); }

  /* ── Input icon buttons ── */
  .gpt-icn { width:32px; height:32px; border-radius:8px; border:none; background:transparent;
    color:var(--muted); cursor:pointer; display:flex; align-items:center; justify-content:center;
    transition:background .12s,color .12s; flex-shrink:0; }
  .gpt-icn:hover { background:var(--active); color:var(--text); }
  .gpt-icn-active { background:var(--active); color:var(--text); }
  .gpt-icn-rec    { color:#ef4444; }
  .gpt-icn-send   { background:var(--text); color:#fff; border-radius:8px; }
  .gpt-icn-send:disabled { background:var(--border); color:var(--muted); cursor:default; }
  .gpt-icn-call-on { color:#dc2626; }

  /* ── Attach popover ── */
  .gpt-attach { position:relative; flex-shrink:0; }
  .gpt-popover { position:absolute; bottom:calc(100% + 6px); left:0;
    background:var(--surface); border:1px solid var(--border); border-radius:10px;
    box-shadow:0 4px 20px rgba(0,0,0,.1); overflow:hidden; min-width:150px;
    animation:fadeUp .14s ease; z-index:50; }
  .gpt-pop-item { display:flex; align-items:center; gap:8px; padding:9px 13px;
    font-size:12px; font-weight:500; color:var(--text); cursor:pointer;
    transition:background .1s; white-space:nowrap; border:none; background:none; width:100%; }
  .gpt-pop-item:hover { background:var(--active); }
  .gpt-pop-item + .gpt-pop-item { border-top:1px solid var(--border); }

  /* Recording indicator */
  .rec-dot   { width:7px; height:7px; border-radius:50%; background:#ef4444; animation:recPulse 1s ease-in-out infinite; flex-shrink:0; }
  .rec-label { font-size:12px; color:#ef4444; }
  .gpt-rec-bar { display:flex; align-items:center; gap:6px; padding:0 14px 10px; }

  /* ── Orbs ── */
  .suus-orb { position:relative; width:68px; height:68px;
    animation:orbMorph 9s cubic-bezier(.45,.05,.55,.95) infinite;
    overflow:hidden; isolation:isolate;
    box-shadow:0 2px 20px rgba(var(--brand-rgb),.12),0 1px 5px rgba(0,0,0,.06); }
  .suus-orb::before { content:''; position:absolute; inset:-30%;
    background:conic-gradient(from 0deg,#fff 0%,#f5f0ff 15%,#ede0ff 28%,#fff 42%,#f5f0ff 56%,#ede0ff 70%,#fff 100%);
    animation:orbSpin 8s linear infinite; }
  .suus-orb::after  { content:''; position:absolute; inset:0;
    background:radial-gradient(ellipse at 35% 30%,rgba(255,255,255,.95) 0%,transparent 55%),
               radial-gradient(ellipse at 70% 75%,rgba(var(--brand-rgb),.08) 0%,transparent 45%);
    animation:orbInner 12s ease-in-out infinite; }
  .suus-orb-active { animation:orbMorph 3s cubic-bezier(.45,.05,.55,.95) infinite !important; }
  .suus-orb-active::before { animation:orbSpin 2s linear infinite !important; }
  .suus-orb-active::after  { animation:orbInner 3s ease-in-out infinite !important; }

  /* Avatar orb (small, square-ish) */
  .suus-av { position:relative; width:26px; height:26px; border-radius:6px; flex-shrink:0; margin-top:1px;
    overflow:hidden; isolation:isolate;
    box-shadow:0 1px 6px rgba(var(--brand-rgb),.18); }
  .suus-av::before { content:''; position:absolute; inset:-30%;
    background:conic-gradient(from 0deg,#fff 0%,#f5f0ff 15%,#ede0ff 28%,#fff 42%,#f5f0ff 56%,#ede0ff 70%,#fff 100%);
    animation:orbSpin 8s linear infinite; }
  .suus-av::after { content:''; position:absolute; inset:0;
    background:radial-gradient(ellipse at 35% 30%,rgba(255,255,255,.95) 0%,transparent 55%),
               radial-gradient(ellipse at 70% 75%,rgba(var(--brand-rgb),.08) 0%,transparent 45%);
    animation:orbInner 12s ease-in-out infinite; }
  .suus-av-active::before { animation:orbSpin 1.5s linear infinite !important; }

  /* ── Call overlay ── */
  .sc-call-overlay { position:fixed; inset:0; z-index:200; display:flex; align-items:center;
    justify-content:center; background:rgba(0,0,0,.45);
    backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); animation:fadeUp .2s ease; }
  .sc-call-card { background:var(--surface); border-radius:22px; padding:36px 28px 28px;
    width:296px; display:flex; flex-direction:column; align-items:center;
    border:1px solid var(--border); box-shadow:0 24px 60px rgba(0,0,0,.18); }
  .call-ring { position:absolute; inset:0; border-radius:50%;
    border:2px solid rgba(var(--brand-rgb),.35);
    animation:ringPulse 1.6s ease-out infinite; pointer-events:none; }
  .call-ring-2 { animation-delay:.5s; }
  .wave-bar  { height:4px; transition:background .3s; }
  .wave-active { animation:waveAnim .6s ease-in-out infinite; }
  .wave-user   { animation:waveUser .8s ease-in-out infinite; }

  /* ── Contact form modal ── */
  .sc-modal { position:fixed; inset:0; z-index:300; background:rgba(0,0,0,.35);
    backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
    display:flex; align-items:flex-start; justify-content:center;
    padding:40px 16px; overflow-y:auto; animation:fadeUp .18s ease; }

  /* ── Mobile ── */
  @media (max-width:600px) {
    .gpt-inner  { padding:16px 12px 12px; }
    .gpt-chips  { grid-template-columns:1fr; }
    .gpt-bar-wrap { padding:0 10px 12px; padding-bottom:max(12px,env(safe-area-inset-bottom)); }
    .gpt-user-bubble { max-width:85%; }
    .gpt-empty h2 { font-size:18px; }
    .sc-modal { padding:20px 10px; }
  }
`

function OrbAvatar({ active = false }: { active?: boolean }) {
  return <div className={`suus-av${active ? ' suus-av-active' : ''}`} />
}

function OrbLg({ active = false }: { active?: boolean }) {
  return <div className={`suus-orb${active ? ' suus-orb-active' : ''}`} />
}

function TypingDots() {
  return (
    <div className="gpt-dots">
      <div className="gpt-dot" />
      <div className="gpt-dot" />
      <div className="gpt-dot" />
    </div>
  )
}

const SUGGESTIONS = [
  'Hoeveel leads hebben we?',
  'Zoek contact: Café de Boom',
  'Maak een nieuw contact aan',
  'Briefing voor [bedrijfsnaam]',
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
  const [msgs,         setMsgs]         = useState<Msg[]>([])
  const [input,        setInput]        = useState('')
  const [sessionId]                     = useState(() => crypto.randomUUID())
  const [calling,      setCalling]      = useState(false)
  const [callStatus,   setCallStatus]   = useState<'idle' | 'connecting' | 'active'>('idle')
  const [agentTalking, setAgentTalking] = useState(false)
  const [userTalking,  setUserTalking]  = useState(false)
  const [muted,        setMuted]        = useState(false)
  const [attachOpen,   setAttachOpen]   = useState(false)
  const [pendingImage, setPendingImage] = useState<{ url: string; base64: string } | null>(null)
  const [recording,    setRecording]    = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [modalForm,    setModalForm]    = useState<{ data: ContactFormPrefilled; msgIdx: number } | null>(null)

  const { activeEmployee } = useEmployee()
  const imageInputRef    = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef   = useRef<Blob[]>([])
  const retellRef        = useRef<RetellWebClient | null>(null)
  const bottomRef        = useRef<HTMLDivElement>(null)
  const textareaRef      = useRef<HTMLTextAreaElement>(null)
  const attachRef        = useRef<HTMLDivElement>(null)
  const timer            = useCallTimer(callStatus === 'active')

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  // Close attach popover on outside click
  useEffect(() => {
    if (!attachOpen) return
    const h = (e: MouseEvent) => {
      if (attachRef.current && !attachRef.current.contains(e.target as Node)) setAttachOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [attachOpen])

  function resizeTextarea() {
    const el = textareaRef.current; if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  // Paste image
  useEffect(() => {
    const h = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'))
      if (!item) return
      const file = item.getAsFile(); if (!file) return
      const r = new FileReader()
      r.onload = ev => { const url = ev.target?.result as string; setPendingImage({ url, base64: url }) }
      r.readAsDataURL(file)
    }
    window.addEventListener('paste', h)
    return () => window.removeEventListener('paste', h)
  }, [])

  function onImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const r = new FileReader()
    r.onload = ev => { const url = ev.target?.result as string; setPendingImage({ url, base64: url }) }
    r.readAsDataURL(file)
    e.target.value = ''
    setAttachOpen(false)
  }

  // ── Send ────────────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string, imageUrl?: string) => {
    if (!text.trim() && !imageUrl) return
    setInput(''); setPendingImage(null)
    setTimeout(resizeTextarea, 0)

    setMsgs(p => [...p,
      { role: 'user', text, image_url: imageUrl },
      { role: 'ai',   text: '', streaming: true },
    ])

    try {
      const res = await fetch('/api/suus', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: text || '(afbeelding)', session_id: sessionId, image_url: imageUrl, employee_id: activeEmployee?.id }),
      })
      if (!res.ok || !res.body) throw new Error()

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let full = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        full += decoder.decode(value, { stream: true })

        const formMatch     = full.match(/\n__FORM__:(.+)/)
        const briefingMatch = full.match(/\n__BRIEFING__:(.+)/)
        const contactsMatch = full.match(/\n__CONTACTS__:(.+)/)

        if (formMatch) {
          const vis = full.replace(/\n__FORM__:.+/, '').trim()
          try {
            const parsed = JSON.parse(formMatch[1])
            setMsgs(p => p.map((m, i) => i === p.length - 1
              ? { ...m, text: vis, formData: parsed.prefilled ?? parsed, streaming: false } : m))
          } catch { setMsgs(p => p.map((m, i) => i === p.length - 1 ? { ...m, text: vis } : m)) }
        } else if (briefingMatch) {
          const vis = full.replace(/\n__BRIEFING__:.+/, '').trim()
          try {
            const parsed = JSON.parse(briefingMatch[1]) as BriefingData
            setMsgs(p => p.map((m, i) => i === p.length - 1
              ? { ...m, text: vis, briefingData: parsed, streaming: false } : m))
          } catch { setMsgs(p => p.map((m, i) => i === p.length - 1 ? { ...m, text: full } : m)) }
        } else if (contactsMatch) {
          const vis = full.replace(/\n__CONTACTS__:.+/, '').trim()
          try {
            const parsed = JSON.parse(contactsMatch[1]) as { contacts: ContactCardData[] }
            setMsgs(p => p.map((m, i) => i === p.length - 1
              ? { ...m, text: vis, contactsData: parsed.contacts, streaming: false } : m))
          } catch { setMsgs(p => p.map((m, i) => i === p.length - 1 ? { ...m, text: full } : m)) }
        } else {
          setMsgs(p => p.map((m, i) => i === p.length - 1 ? { ...m, text: full } : m))
        }
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      }
      setMsgs(p => p.map((m, i) => i === p.length - 1 ? { ...m, streaming: false } : m))
    } catch {
      setMsgs(p => p.map((m, i) => i === p.length - 1
        ? { ...m, text: 'Er ging iets mis. Probeer opnieuw.', streaming: false } : m))
    }
  }, [sessionId, activeEmployee])

  // ── Audio ───────────────────────────────────────────────────────────────────
  async function startRecording() {
    setAttachOpen(false)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      audioChunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        setTranscribing(true)
        try {
          const fd = new FormData(); fd.append('audio', blob, 'recording.webm')
          const res  = await fetch('/api/suus/transcribe', { method: 'POST', body: fd })
          const data = await res.json()
          if (data.text) { setInput(data.text); setTimeout(resizeTextarea, 0) }
        } catch { /**/ } finally { setTranscribing(false) }
      }
      mr.start(); mediaRecorderRef.current = mr; setRecording(true)
    } catch { alert('Microfoon toegang vereist.') }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    setRecording(false)
  }

  // ── Call ────────────────────────────────────────────────────────────────────
  async function toggleCall() {
    if (calling) {
      retellRef.current?.stopCall(); retellRef.current = null
      setCalling(false); setCallStatus('idle'); setAgentTalking(false); setUserTalking(false); setMuted(false)
      return
    }
    setCalling(true); setCallStatus('connecting')
    try {
      const res  = await fetch('/api/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: sessionId }) })
      const data = await res.json()
      if (!data.access_token) throw new Error(data.error ?? 'No access token')
      const client = new RetellWebClient(); retellRef.current = client
      client.on('call_started',        () => setCallStatus('active'))
      client.on('call_ended',          () => { setCalling(false); setCallStatus('idle') })
      client.on('agent_start_talking', () => setAgentTalking(true))
      client.on('agent_stop_talking',  () => setAgentTalking(false))
      client.on('user_start_talking',  () => setUserTalking(true))
      client.on('user_stop_talking',   () => setUserTalking(false))
      client.on('error',               () => { setCalling(false); setCallStatus('idle') })
      await client.startCall({ accessToken: data.access_token })
    } catch { setCalling(false); setCallStatus('idle') }
  }

  function toggleMute() {
    const c = retellRef.current as RetellWebClient & { mute?: (m: boolean) => void } | null
    if (!c) return
    const next = !muted; c.mute?.(next); setMuted(next)
  }

  const hasContent = !!(input.trim() || pendingImage)

  return (
    <div className="gpt-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* ── Call overlay ── */}
      {calling && (
        <div className="sc-call-overlay">
          <div className="sc-call-card">
            <div style={{ position: 'relative', marginBottom: '24px' }}>
              {agentTalking && (<><div className="call-ring" /><div className="call-ring call-ring-2" /></>)}
              <OrbLg active={agentTalking} />
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-.03em', marginBottom: '4px' }}>SUUS</div>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '22px', minHeight: '18px' }}>
              {callStatus === 'connecting'
                ? 'Verbinden…'
                : agentTalking ? <span style={{ color: 'var(--brand)', fontWeight: 500 }}>Spreekt…</span>
                : userTalking  ? <span style={{ color: '#16a34a', fontWeight: 500 }}>Luistert…</span>
                : timer}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', height: '24px', marginBottom: '28px' }}>
              {[0,1,2,3,4,5,6].map(i => (
                <div key={i}
                  className={agentTalking ? 'wave-bar wave-active' : userTalking ? 'wave-bar wave-user' : 'wave-bar'}
                  style={{ width: '3px', borderRadius: '2px', background: agentTalking ? 'var(--brand)' : userTalking ? '#16a34a' : 'var(--border)', animationDelay: `${i * 0.08}s` }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', gap: '18px', alignItems: 'center' }}>
              <button onClick={toggleMute} style={{ width: '48px', height: '48px', borderRadius: '50%', border: '1px solid var(--border)', background: muted ? '#fef2f2' : 'var(--bg)', color: muted ? '#dc2626' : 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {muted ? <MicOff size={18} strokeWidth={1.75} /> : <Mic size={18} strokeWidth={1.75} />}
              </button>
              <button onClick={toggleCall} style={{ width: '58px', height: '58px', borderRadius: '50%', border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(220,38,38,.35)' }}>
                <PhoneOff size={22} strokeWidth={2} />
              </button>
              <div style={{ width: '48px' }} />
            </div>
          </div>
        </div>
      )}

      {/* ── Contact form modal ── */}
      {modalForm && (
        <div className="sc-modal" onClick={e => { if (e.target === e.currentTarget) setModalForm(null) }}>
          <ContactForm
            prefilled={modalForm.data}
            onSuccess={(contactId, company) => {
              const wasEdit = !!modalForm.data.contactId
              const successText = wasEdit
                ? `✅ ${company} bijgewerkt in GHL. [contactId: ${contactId}]`
                : `✅ ${company} aangemaakt in GHL. [contactId: ${contactId}]`
              setModalForm(null)
              setMsgs(p => p.map((msg, j) =>
                j === modalForm.msgIdx ? { ...msg, formDone: true } : msg
              ).concat([{ role: 'ai', text: wasEdit ? `✅ ${company} bijgewerkt in GHL.` : `✅ ${company} aangemaakt in GHL.` }]))
              bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
              fetch('/api/suus/save-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: sessionId, role: 'assistant', content: successText }),
              }).catch(() => {})
            }}
            onCancel={() => setModalForm(null)}
          />
        </div>
      )}

      {/* ── Feed ── */}
      <div className="gpt-feed">
        <div className="gpt-inner">

          {/* Empty state */}
          {msgs.length === 0 && (
            <div className="gpt-empty">
              <OrbLg />
              <div style={{ textAlign: 'center' }}>
                <h2>Hoi! Ik ben SUUS.</h2>
                <p>Stel een vraag, stuur een foto of start een gesprek</p>
              </div>
              <div className="gpt-chips">
                {SUGGESTIONS.map(s => (
                  <button key={s} className="gpt-chip" onClick={() => sendMessage(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          {msgs.map((m, i) => (
            <div key={i} className="gpt-row">
              {m.role === 'user' ? (
                /* ── User bubble ── */
                <div className="gpt-user">
                  <div className="gpt-user-bubble">
                    {m.image_url && <img src={m.image_url} alt="bijlage" className="gpt-user-img" />}
                    {m.text}
                  </div>
                </div>
              ) : (
                /* ── AI row ── */
                <div className="gpt-ai">
                  <OrbAvatar active={!!m.streaming} />
                  <div className="gpt-ai-body">
                    {/* Typing dots while streaming with no text yet */}
                    {m.streaming && !m.text && <TypingDots />}
                    {/* Text */}
                    {m.text && <p className="gpt-ai-text">{m.text}</p>}
                    {/* Rich cards */}
                    {(m.briefingData || m.formData || (m.contactsData && m.contactsData.length > 0)) && (
                      <div className="gpt-ai-cards">
                        {m.briefingData && <BriefingCard data={m.briefingData} />}
                        {m.formData && (
                          <ContactFormCard
                            prefilled={m.formData}
                            done={m.formDone}
                            onClick={() => !m.formDone && setModalForm({ data: m.formData!, msgIdx: i })}
                          />
                        )}
                        {m.contactsData && m.contactsData.length > 0 && (
                          <ContactSelectorCards
                            contacts={m.contactsData}
                            onSelect={c => {
                              const name = c.companyName || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'contact'
                              sendMessage(`Gebruik contact ${name} (contactId: ${c.contactId})`)
                            }}
                            onView={c => {
                              const name = c.companyName || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'contact'
                              sendMessage(`Briefing van ${name} (contactId: ${c.contactId})`)
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Image preview above bar ── */}
      {pendingImage && (
        <div className="gpt-preview">
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <img src={pendingImage.url} alt="preview" className="gpt-preview-thumb" />
            <button className="gpt-preview-del" onClick={() => setPendingImage(null)}>
              <X size={9} />
            </button>
          </div>
          <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Afbeelding bijgevoegd</span>
        </div>
      )}

      {/* ── Floating input bar ── */}
      <div className="gpt-bar-wrap">
        <div className="gpt-bar">

          {/* Recording indicator strip */}
          {(recording || transcribing) && (
            <div className="gpt-rec-bar">
              <div className="rec-dot" />
              <span className="rec-label">{transcribing ? 'Transcriberen…' : 'Opname…'}</span>
            </div>
          )}

          <div className="gpt-bar-main">
            {/* Attach */}
            <input ref={imageInputRef} type="file" accept="image/*" onChange={onImageFile} style={{ display: 'none' }} />
            <div className="gpt-attach" ref={attachRef}>
              {attachOpen && (
                <div className="gpt-popover">
                  <button className="gpt-pop-item" onClick={() => imageInputRef.current?.click()}>
                    <Image size={13} style={{ color: 'var(--muted)' }} /> Afbeelding
                  </button>
                  <button className="gpt-pop-item"
                    onClick={recording ? stopRecording : startRecording}
                    style={recording ? { color: '#ef4444' } : undefined}
                  >
                    <Mic2 size={13} style={{ color: recording ? '#ef4444' : 'var(--muted)' }} />
                    {recording ? 'Stop opname' : 'Spraakbericht'}
                  </button>
                </div>
              )}
              <button
                className={`gpt-icn${pendingImage || recording ? ' gpt-icn-active' : ''}${recording ? ' gpt-icn-rec' : ''}`}
                onClick={() => setAttachOpen(p => !p)}
                title="Bijlage"
              >
                {recording ? <StopCircle size={16} /> : <Paperclip size={16} />}
              </button>
            </div>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              className="gpt-textarea"
              value={input}
              onChange={e => { setInput(e.target.value); resizeTextarea() }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input, pendingImage?.base64) } }}
              placeholder={transcribing ? 'Transcriberen…' : 'Vraag iets aan SUUS…'}
              rows={1}
              disabled={recording || transcribing}
              style={{ color: (recording || transcribing) ? 'transparent' : undefined }}
            />

            {/* Call button */}
            <button
              className={`gpt-icn${calling ? ' gpt-icn-call-on' : ''}`}
              onClick={toggleCall}
              title={calling ? 'Ophangen' : 'Bellen met SUUS'}
            >
              {calling ? <PhoneOff size={16} /> : <Phone size={16} />}
            </button>

            {/* Send */}
            <button
              className="gpt-icn gpt-icn-send"
              onClick={() => sendMessage(input, pendingImage?.base64)}
              disabled={!hasContent}
              title="Versturen (Enter)"
            >
              <ArrowUp size={15} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* Hint */}
        <p style={{ textAlign: 'center', fontSize: '11px', color: 'var(--muted)', margin: '6px 0 0', opacity: .7 }}>
          SUUS kan fouten maken. Controleer altijd belangrijke informatie.
        </p>
      </div>
    </div>
  )
}
