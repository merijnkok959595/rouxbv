'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { ArrowUp, PhoneOff, Mic, MicOff, X, ImageIcon, Plus, AudioLines, Check, Phone } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn }              from '@/lib/utils'
import { useEmployee }     from '@/lib/employee-context'
import ContactForm,  { ContactFormPrefilled } from '@/components/ContactForm'
import BriefingCard, { BriefingData }         from '@/components/BriefingCard'
import { ContactFormCard, ContactSelectorCards, ContactCardData } from '@/components/ContactCard'
import { VoiceOrb } from '@/components/ui/voice-orb'

/* ─── Types ─────────────────────────────────────────────────────── */
type AgentState = null | 'thinking' | 'listening' | 'talking'

function toOrbState(s: AgentState, callStatus?: 'idle' | 'connecting' | 'active') {
  if (callStatus === 'connecting') return 'connecting' as const
  if (s === 'listening') return 'listening' as const
  if (s === 'talking')   return 'speaking' as const
  if (s === 'thinking')  return 'connecting' as const
  return 'idle' as const
}

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


function TypingDots() {
  return (
    <span className="inline-block w-2 h-[1.1em] bg-primary rounded-[2px] align-middle animate-[thinkPulse_1s_ease-in-out_infinite] opacity-80" />
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

/* ─── Page ───────────────────────────────────────────────────────── */
export default function SuusPage() {
  const [msgs,         setMsgs]         = useState<Msg[]>([])
  const [input,        setInput]        = useState('')
  const [sessionId]                     = useState(() => crypto.randomUUID())
  const [calling,      setCalling]      = useState(false)
  const callingRef     = useRef(false)
  const [callStatus,   setCallStatus]   = useState<'idle' | 'connecting' | 'active'>('idle')
  const [agentTalking, setAgentTalking] = useState(false)
  const [userTalking,  setUserTalking]  = useState(false)
  const [muted,        setMuted]        = useState(false)
  const [attachOpen,      setAttachOpen]      = useState(false)
  const [pendingImage,    setPendingImage]    = useState<{ url: string; base64: string } | null>(null)
  const [modalForm,       setModalForm]       = useState<{ data: ContactFormPrefilled; msgIdx: number } | null>(null)
  const [dictating,       setDictating]       = useState(false)
  const [transcribingVoice, setTranscribingVoice] = useState(false)
  const dictRecorderRef  = useRef<MediaRecorder | null>(null)
  const dictChunksRef    = useRef<Blob[]>([])
  const dictAnalyserRef  = useRef<AnalyserNode | null>(null)
  const dictAudioCtxRef  = useRef<AudioContext | null>(null)
  const dictAnimFrameRef = useRef<number>(0)
  const dictBarsRef      = useRef<(HTMLDivElement | null)[]>([])
  const callBarsRef      = useRef<(HTMLDivElement | null)[]>([])
  const callAnalyserRef  = useRef<AnalyserNode | null>(null)
  const callAudioCtxRef  = useRef<AudioContext | null>(null)
  const callAnimFrameRef = useRef<number>(0)
  const realtimeStreamingRef = useRef(false)

  const { activeEmployee } = useEmployee()
  const imageInputRef    = useRef<HTMLInputElement>(null)
  const pcRef            = useRef<RTCPeerConnection | null>(null)
  const dcRef            = useRef<RTCDataChannel | null>(null)
  const localStreamRef   = useRef<MediaStream | null>(null)
  const audioElRef       = useRef<HTMLAudioElement | null>(null)
  const bottomRef        = useRef<HTMLDivElement>(null)
  const textareaRef      = useRef<HTMLTextAreaElement>(null)
  const attachRef        = useRef<HTMLDivElement>(null)
  const timer            = useCallTimer(callStatus === 'active')

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  // Scroll to bottom when keyboard opens on mobile (visualViewport resize)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => { bottomRef.current?.scrollIntoView({ behavior: 'instant' }) }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [])

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

  function stopDictVisualizer() {
    cancelAnimationFrame(dictAnimFrameRef.current)
    dictAnalyserRef.current = null
    dictAudioCtxRef.current?.close()
    dictAudioCtxRef.current = null
  }

  async function startDictate() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // Set up real audio visualizer
      const audioCtx = new AudioContext()
      dictAudioCtxRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 128
      analyser.smoothingTimeConstant = 0.75
      source.connect(analyser)
      dictAnalyserRef.current = analyser
      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      function drawBars() {
        if (!dictAnalyserRef.current) return
        dictAnalyserRef.current.getByteFrequencyData(dataArray)
        const bars = dictBarsRef.current
        for (let i = 0; i < bars.length; i++) {
          const bar = bars[i]; if (!bar) continue
          const binIndex = Math.min(Math.floor((i / bars.length) * dataArray.length), dataArray.length - 1)
          const value = dataArray[binIndex] / 255
          bar.style.height = `${3 + value * 30}px`
        }
        dictAnimFrameRef.current = requestAnimationFrame(drawBars)
      }
      drawBars()

      const mr = new MediaRecorder(stream)
      dictChunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) dictChunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        stopDictVisualizer()
        const blob = new Blob(dictChunksRef.current, { type: 'audio/webm' })
        setTranscribingVoice(true)
        try {
          const fd = new FormData()
          fd.append('audio', blob, 'recording.webm')
          const res  = await fetch('/api/suus/transcribe', { method: 'POST', body: fd })
          const data = await res.json() as { text?: string }
          if (data.text) {
            setInput(prev => prev ? `${prev} ${data.text}` : data.text!)
            setTimeout(resizeTextarea, 0)
            textareaRef.current?.focus()
          }
        } catch { /* ignore */ } finally { setTranscribingVoice(false) }
      }
      mr.start()
      dictRecorderRef.current = mr
      setDictating(true)
    } catch { alert('Microfoon toegang vereist.') }
  }

  function stopDictate() {
    dictRecorderRef.current?.stop()
    dictRecorderRef.current = null
    setDictating(false)
  }

  function cancelDictate() {
    if (dictRecorderRef.current) {
      dictRecorderRef.current.ondataavailable = null
      dictRecorderRef.current.onstop = null
      dictRecorderRef.current.stop()
      dictRecorderRef.current = null
    }
    stopDictVisualizer()
    dictChunksRef.current = []
    setDictating(false)
    setTranscribingVoice(false)
  }

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

  /* ── Send ─────────────────────────────────────────────────────── */
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

  /* ── Realtime / WebRTC ────────────────────────────────────────── */
  function sendRealtimeEvent(event: unknown) {
    if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify(event))
  }

  async function executeTool(item: { call_id: string; name: string; arguments: string }) {
    try {
      const args = JSON.parse(item.arguments || '{}')
      const res = await fetch('/api/suus/tool-call', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: item.name, args, session_id: sessionId }),
      })
      const { result } = await res.json()
      sendRealtimeEvent({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(result) } })
      sendRealtimeEvent({ type: 'response.create' })
    } catch (err) {
      console.error('[voice/tool]', err)
      sendRealtimeEvent({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify({ error: String(err) }) } })
      sendRealtimeEvent({ type: 'response.create' })
    }
  }

  function handleRealtimeEvent(e: MessageEvent) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ev = JSON.parse(e.data as string) as any
      switch (ev.type) {
        case 'input_audio_buffer.speech_started': setUserTalking(true);  break
        case 'input_audio_buffer.speech_stopped': setUserTalking(false); break
        case 'response.audio.delta':              setAgentTalking(true);  break
        case 'response.audio.done':               setAgentTalking(false); break

        case 'response.audio_transcript.delta': {
          const delta = (ev.delta as string) ?? ''
          if (!realtimeStreamingRef.current) {
            realtimeStreamingRef.current = true
            setMsgs(p => [...p, { role: 'ai', text: delta, streaming: true }])
          } else {
            setMsgs(p => {
              const next = [...p]
              const idx = next.findLastIndex(m => m.role === 'ai')
              if (idx >= 0) next[idx] = { ...next[idx], text: next[idx].text + delta }
              return next
            })
          }
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
          break
        }

        case 'response.audio_transcript.done':
          realtimeStreamingRef.current = false
          setMsgs(p => {
            const next = [...p]
            const idx = next.findLastIndex(m => m.role === 'ai')
            if (idx >= 0) next[idx] = { ...next[idx], streaming: false }
            return next
          })
          break

        case 'conversation.item.input_audio_transcription.completed': {
          const transcript = (ev.transcript as string)?.trim()
          if (transcript) {
            setMsgs(p => [...p, { role: 'user', text: transcript }])
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
          }
          break
        }

        case 'response.output_item.done':
          if (ev.item?.type === 'function_call') executeTool(ev.item as { call_id: string; name: string; arguments: string })
          break
        case 'error': console.error('[voice/realtime]', ev); break
      }
    } catch { /* ignore */ }
  }

  function startCallVisualizer(stream: MediaStream) {
    const audioCtx = new AudioContext()
    callAudioCtxRef.current = audioCtx
    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 32
    analyser.smoothingTimeConstant = 0.8
    source.connect(analyser)
    callAnalyserRef.current = analyser
    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    function draw() {
      if (!callAnalyserRef.current) return
      callAnalyserRef.current.getByteFrequencyData(dataArray)
      const bars = callBarsRef.current
      for (let i = 0; i < bars.length; i++) {
        const bar = bars[i]; if (!bar) continue
        const binIndex = Math.min(Math.floor((i / bars.length) * (dataArray.length / 2)), dataArray.length - 1)
        const value = dataArray[binIndex] / 255
        bar.style.height = `${3 + value * 13}px`
      }
      callAnimFrameRef.current = requestAnimationFrame(draw)
    }
    draw()
  }

  function stopCallVisualizer() {
    cancelAnimationFrame(callAnimFrameRef.current)
    callAnalyserRef.current = null
    callAudioCtxRef.current?.close()
    callAudioCtxRef.current = null
  }

  function stopCall() {
    callingRef.current = false
    dcRef.current?.close(); dcRef.current = null
    pcRef.current?.close(); pcRef.current = null
    localStreamRef.current?.getTracks().forEach(t => t.stop()); localStreamRef.current = null
    if (audioElRef.current) {
      audioElRef.current.pause()
      audioElRef.current.srcObject = null
      audioElRef.current = null
    }
    stopCallVisualizer()
    realtimeStreamingRef.current = false
    setCalling(false); setCallStatus('idle'); setAgentTalking(false); setUserTalking(false); setMuted(false)
  }

  async function toggleCall() {
    if (callingRef.current) { stopCall(); return }
    callingRef.current = true
    setCalling(true); setCallStatus('connecting')
    try {
      const res  = await fetch('/api/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: sessionId, employee_id: activeEmployee?.id }) })
      if (!callingRef.current) return
      const data = await res.json() as { client_secret?: { value: string }; error?: string }
      if (!data.client_secret?.value) throw new Error(data.error ?? 'No client secret')
      if (!callingRef.current) return
      const pc = new RTCPeerConnection(); pcRef.current = pc
      pc.oniceconnectionstatechange = () => { if (callingRef.current && (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected')) stopCall() }
      const audioEl = new Audio(); audioEl.autoplay = true; audioElRef.current = audioEl
      pc.ontrack = e => { audioEl.srcObject = e.streams[0] }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!callingRef.current) { stream.getTracks().forEach(t => t.stop()); pc.close(); return }
      localStreamRef.current = stream; stream.getTracks().forEach(t => pc.addTrack(t, stream))
      startCallVisualizer(stream)
      const dc = pc.createDataChannel('oai-events'); dcRef.current = dc
      dc.onopen = () => {
        setCallStatus('active')
        dc.send(JSON.stringify({ type: 'session.update', session: { type: 'realtime', input_audio_transcription: { model: 'whisper-1', language: 'nl' } } }))
      }
      // Wait for full peer connection before greeting — avoids audio cutoff
      let greetingScheduled = false
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected' && !greetingScheduled) {
          greetingScheduled = true
          setTimeout(() => {
            dcRef.current?.send(JSON.stringify({ type: 'response.create', response: { instructions: 'Zeg nu je openingsgroet.' } }))
          }, 1000)
        }
      }
      dc.onclose = () => { if (callingRef.current) stopCall() }; dc.onmessage = handleRealtimeEvent
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer)
      if (!callingRef.current) { pc.close(); return }
      const sdpRes = await fetch('https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview', { method: 'POST', headers: { Authorization: `Bearer ${data.client_secret.value}`, 'Content-Type': 'application/sdp' }, body: offer.sdp })
      if (!callingRef.current) { pc.close(); return }
      if (!sdpRes.ok) throw new Error(`SDP exchange failed: ${sdpRes.status}`)
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() })
    } catch (err) { console.error('[voice]', err); if (callingRef.current) stopCall() }
  }

  function toggleMute() {
    const stream = localStreamRef.current; if (!stream) return
    const next = !muted; stream.getTracks().forEach(t => { t.enabled = !next }); setMuted(next)
  }

  const hasContent = !!(input.trim() || pendingImage)

  /* ── Render ───────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col bg-bg overflow-x-hidden" style={{ height: 'calc(100dvh - var(--nav-height, 80px))' }}>


      {/* ── Contact form modal ───────────────────────────────────── */}
      {modalForm && (
        <div
          className="fixed inset-0 z-[300] bg-black/35 backdrop-blur-md flex items-start justify-center px-4 py-10 overflow-y-auto animate-fade-up"
          onClick={e => { if (e.target === e.currentTarget) setModalForm(null) }}
        >
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
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: sessionId, role: 'assistant', content: successText }),
              }).catch(() => {})
            }}
            onCancel={() => setModalForm(null)}
          />
        </div>
      )}

      {/* ── Message feed ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:thin] [scrollbar-color:theme(colors.border)_transparent]">
        <div className="max-w-[720px] mx-auto w-full px-4 sm:px-6 pt-14 pb-4 flex flex-col relative">

          {/* Bellen button — top-right, belt het SUUS Twilio nummer */}
          <div className="absolute top-4 right-4 sm:right-6 z-10">
            <a
              href="tel:+3197010275858"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-primary text-white text-[12px] font-medium rounded-full hover:opacity-85 transition-opacity"
            >
              <Phone size={13} strokeWidth={2} />
              Bellen
            </a>
          </div>

          {/* Empty state */}
          {msgs.length === 0 && (
            <div className="flex flex-col items-center gap-5 pt-16 pb-8 animate-fade-up">
              <div className="text-center">
                <h2 className="text-[22px] font-bold tracking-tight text-primary mb-1 max-sm:text-lg">
                  Hoi! Ik ben SUUS.
                </h2>
                <p className="text-[13px] text-muted">Stel een vraag, stuur een foto of start een gesprek</p>
              </div>
              <div className="grid grid-cols-2 gap-2 w-full max-w-[420px]">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    className="px-3.5 py-2.5 rounded-[10px] border border-border bg-surface text-xs font-medium text-primary text-left leading-snug transition-colors hover:bg-active"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          {msgs.map((m, i) => (
            <div key={i} className="py-2 animate-msg-in">
              {m.role === 'user' ? (
                /* User message */
                <div className="flex justify-end">
                  <div className="max-w-[75%] max-sm:max-w-[85%]">
                    <p className="text-[11px] font-bold text-[#0d0d0d] mb-1 text-right">
                      {activeEmployee?.naam.split(' ')[0] ?? 'Jij'}
                    </p>
                    <div className="text-[14.5px] leading-[1.6] text-[#374151] whitespace-pre-wrap break-words bg-white px-5 py-3 rounded-[22px]">
                      {m.image_url && (
                        <img src={m.image_url} alt="bijlage" className="max-w-[200px] max-h-[150px] rounded-lg object-cover block mb-1.5" />
                      )}
                      {m.text}
                    </div>
                  </div>
                </div>
              ) : (
                /* AI row */
                <div className="flex gap-3 items-start">
                  <div className="min-w-0 max-w-[480px]">
                    <p className="text-[11px] font-bold text-[#0d0d0d] mb-1">Suus</p>
                    {m.text ? (
                      <div className="text-[14.5px] leading-[1.6] text-[#374151]">
                        {m.streaming ? (
                          <p className="whitespace-pre-wrap break-words">
                            {m.text}
                            <TypingDots />
                          </p>
                        ) : (
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              p:      ({children}) => <p className="mb-2 last:mb-0">{children}</p>,
                              strong: ({children}) => <strong className="font-semibold text-[#374151]">{children}</strong>,
                              em:     ({children}) => <em className="italic">{children}</em>,
                              ul:     ({children}) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
                              ol:     ({children}) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
                              li:     ({children}) => <li className="leading-[1.6]">{children}</li>,
                              h1:     ({children}) => <h1 className="text-[15px] font-bold mb-1.5 mt-2">{children}</h1>,
                              h2:     ({children}) => <h2 className="text-[14.5px] font-semibold mb-1 mt-2">{children}</h2>,
                              h3:     ({children}) => <h3 className="text-[14px] font-semibold mb-1 mt-1.5">{children}</h3>,
                              code:   ({children}) => <code className="bg-black/6 rounded px-1 py-0.5 text-[13px] font-mono">{children}</code>,
                              a:      ({href, children}) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline underline-offset-2">{children}</a>,
                            }}
                          >
                            {m.text}
                          </ReactMarkdown>
                        )}
                      </div>
                    ) : m.streaming ? (
                      <TypingDots />
                    ) : null}
                    {(m.briefingData || m.formData || (m.contactsData && m.contactsData.length > 0)) && (
                      <div className="mt-2.5 flex flex-col gap-2">
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

      {/* ── Image preview ────────────────────────────────────────── */}
      {pendingImage && (
        <div className="max-w-[720px] mx-auto px-4 pb-1.5 flex items-center gap-2">
          <div className="relative inline-block">
            <img src={pendingImage.url} alt="preview" className="h-11 w-11 object-cover rounded-lg border border-border" />
            <button
              onClick={() => setPendingImage(null)}
              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center border-none"
            >
              <X size={9} />
            </button>
          </div>
          <span className="text-[11px] text-muted">Afbeelding bijgevoegd</span>
        </div>
      )}


      {/* ── Input bar ────────────────────────────────────────────── */}
      <div className="px-4 pb-[max(16px,env(safe-area-inset-bottom))] flex-shrink-0">
        <div className="max-w-[760px] mx-auto">

          {dictating || transcribingVoice ? (
            /* ── Waveform recording bar ─────────────────────────── */
            <div className="flex items-center gap-3 px-4 py-4 border border-border rounded-[28px] bg-surface shadow-[0_2px_12px_rgba(0,0,0,.07),0_0_0_1px_rgba(0,0,0,.03)]">
              {/* Waveform */}
              <div className="flex-1 flex items-center justify-center gap-[3px] h-9 overflow-hidden">
                {Array.from({ length: 48 }, (_, i) => (
                  <div
                    key={i}
                    ref={el => { dictBarsRef.current[i] = el }}
                    className={cn(
                      'w-[3px] rounded-full origin-center transition-[height] duration-75',
                      transcribingVoice ? 'bg-muted/40' : 'bg-primary',
                    )}
                    style={{ height: '3px' }}
                  />
                ))}
              </div>

              {/* Cancel */}
              <button
                onClick={cancelDictate}
                title="Annuleer opname"
                className="w-9 h-9 rounded-full flex items-center justify-center text-muted hover:text-red-500 transition-colors flex-shrink-0"
              >
                <X size={18} strokeWidth={2} />
              </button>

              {/* Confirm / transcribe */}
              <button
                onClick={stopDictate}
                disabled={transcribingVoice}
                title="Stop en transcribeer"
                className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center hover:opacity-85 transition-opacity disabled:opacity-40 flex-shrink-0"
              >
                <Check size={16} strokeWidth={2.5} />
              </button>
            </div>
          ) : (
            /* ── Normal pill ─────────────────────────────────────── */
            <div className="flex items-center gap-3 px-4 py-4 border border-border rounded-[28px] bg-surface shadow-[0_2px_12px_rgba(0,0,0,.07),0_0_0_1px_rgba(0,0,0,.03)] hover:shadow-[0_4px_18px_rgba(0,0,0,.1)] transition-shadow">

              {/* Left: attach / plus */}
              <input ref={imageInputRef} type="file" accept="image/*" onChange={onImageFile} className="hidden" />
              <div className="relative flex-shrink-0" ref={attachRef}>
                {attachOpen && (
                  <div className="absolute bottom-[calc(100%+8px)] left-0 bg-surface border border-border rounded-[12px] shadow-panel overflow-hidden min-w-[140px] animate-fade-up z-50">
                    <button
                      className="flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium text-primary w-full hover:bg-active transition-colors border-none bg-transparent"
                      onClick={() => imageInputRef.current?.click()}
                    >
                      <ImageIcon size={13} className="text-muted" /> Afbeelding
                    </button>
                  </div>
                )}
                <button
                  onClick={() => setAttachOpen(p => !p)}
                  title="Bijlage toevoegen"
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center text-secondary hover:text-primary transition-colors',
                    pendingImage && 'text-primary',
                  )}
                >
                  <Plus size={22} strokeWidth={1.5} />
                </button>
              </div>

              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => { setInput(e.target.value); resizeTextarea() }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input, pendingImage?.base64) } }}
                placeholder="Vraag SUUS iets..."
                rows={1}
                enterKeyHint="send"
                autoComplete="off"
                autoCorrect="on"
                spellCheck={false}
                className="flex-1 resize-none border-none bg-transparent text-[16px] text-primary outline-none leading-[1.55] max-h-40 overflow-y-auto p-0 font-[inherit] placeholder:text-muted"
              />

              {/* Right icons */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Dictate button — hidden during call (mute btn takes over) */}
                {!calling && (
                  <button
                    onClick={startDictate}
                    title="Dicteer bericht"
                    className="w-9 h-9 rounded-full flex items-center justify-center text-muted hover:text-primary transition-colors"
                  >
                    <Mic size={20} strokeWidth={1.5} />
                  </button>
                )}

                {/* Send / call button */}
                {calling ? (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <VoiceOrb
                      state={toOrbState(agentTalking ? 'talking' : userTalking ? 'listening' : null, callStatus)}
                      size={28}
                    />
                    <button
                      onClick={toggleMute}
                      title={muted ? 'Unmute' : 'Mute'}
                      className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center transition-colors flex-shrink-0',
                        muted ? 'bg-red-100 text-red-500' : 'bg-black/6 text-secondary hover:text-primary',
                      )}
                    >
                      {muted ? <MicOff size={14} strokeWidth={2} /> : <Mic size={14} strokeWidth={2} />}
                    </button>
                    <button
                      onClick={toggleCall}
                      className="inline-flex items-center gap-2 pl-3 pr-4 h-9 bg-[#007AFF] text-white rounded-full hover:opacity-90 transition-opacity flex-shrink-0"
                    >
                      <div className="flex items-center gap-[2.5px]">
                        {[0, 1, 2].map(i => (
                          <div
                            key={i}
                            ref={el => { callBarsRef.current[i] = el }}
                            className="w-[3px] rounded-full bg-white transition-[height] duration-75"
                            style={{ height: '3px' }}
                          />
                        ))}
                      </div>
                      <span className="text-[13px] font-semibold">
                        {callStatus === 'connecting' ? 'Verbinden…' : 'Ophangen'}
                      </span>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { if (hasContent) sendMessage(input, pendingImage?.base64); else toggleCall() }}
                    title={hasContent ? 'Versturen (Enter)' : 'Bellen met SUUS'}
                    className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center hover:opacity-85 transition-opacity"
                  >
                    {hasContent
                      ? <ArrowUp size={17} strokeWidth={2.5} />
                      : <AudioLines size={17} strokeWidth={2} />
                    }
                  </button>
                )}
              </div>
            </div>
          )}

          <p className="text-center text-[11px] text-muted mt-2 opacity-60 tracking-tight">
            SUUS kan fouten maken. Controleer altijd belangrijke informatie.
          </p>
        </div>
      </div>
    </div>
  )
}
