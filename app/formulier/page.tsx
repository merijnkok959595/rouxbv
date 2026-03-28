'use client'

import { useRef, useState, useEffect } from 'react'
import Link from 'next/link'
import {
  Briefcase, User, MapPin, Tag, FileText, RotateCcw,
  Flag, Loader2, ArrowUpRight, Mic, Store,
} from 'lucide-react'
import PlacesCompanyInput, { type PlaceResult } from '@/components/PlacesCompanyInput'
import { BEURS_OPTIONS, buildSource, defaultBeursName, SOURCE_STORAGE_KEY } from '@/lib/beurs-sources'
import PhoneInput, { isValidPhoneNumber } from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { Field, TwoCol, FieldSection } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import { GROOTHANDEL_OPTIONS } from '@/components/ContactForm'

const MONO = "'SF Mono','Fira Code',monospace"
const YEAR    = new Date().getFullYear()
const CHANNEL = 'OFFLINE'

const LABEL_META: Record<string, { bg: string; text: string; border: string; title: string }> = {
  A: { bg: 'rgba(220,38,38,0.08)',  text: '#DC2626', border: 'rgba(220,38,38,0.15)',  title: 'Top prospect' },
  B: { bg: 'rgba(217,119,6,0.08)',  text: '#D97706', border: 'rgba(217,119,6,0.15)',  title: 'Goede kans' },
  C: { bg: 'rgba(37,99,235,0.08)',  text: '#2563EB', border: 'rgba(37,99,235,0.15)',  title: 'Gemiddeld' },
  D: { bg: 'rgba(22,163,74,0.08)',  text: '#16A34A', border: 'rgba(22,163,74,0.15)',  title: 'Lage prioriteit' },
}

type EnrichResult = { label: string | null; revenue: number | null; summary: string | null }
type SavedContact = {
  id: string; company: string; assigned_to: string | null; source: string
  address: string; city: string; postcode: string; country: string
  first_name: string; last_name: string; phone: string; email: string
  contact_type: string; notes: string; opening_hours: PlaceResult['opening_hours']
  groothandel: string
}
type TeamMember = { id: string; naam: string; color: string | null; functie?: string | null }
type Phase = 'idle' | 'saving' | 'enriching' | 'done'

export default function FormulierPage() {
  const formRef        = useRef<HTMLFormElement>(null)
  const lateContactRef = useRef<string | null>(null) // for background retry
  const [phase,        setPhase]        = useState<Phase>('idle')
  const [error,        setError]        = useState<string | null>(null)
  const [savedContact, setSavedContact] = useState<SavedContact | null>(null)
  const [enrichResult, setEnrichResult] = useState<EnrichResult | null>(null)
  const [address,      setAddress]      = useState('')
  const [city,         setCity]         = useState('')
  const [postcode,     setPostcode]     = useState('')
  const [country,      setCountry]      = useState('Nederland')
  const [openingHours, setOpeningHours] = useState<PlaceResult['opening_hours']>(null)
  const [beursName,    setBeursName]    = useState(defaultBeursName())
  const [contactType,  setContactType]  = useState<'lead' | 'customer'>('lead')
  const [phoneValue,     setPhoneValue]     = useState<string | undefined>(undefined)
  const [teamMembers,    setTeamMembers]    = useState<TeamMember[]>([])
  const [loadingTeam,    setLoadingTeam]    = useState(true)
  const [assignedTo,     setAssignedTo]     = useState('')
  const [assignedOpen,   setAssignedOpen]   = useState(false)
  const assignedRef = useRef<HTMLDivElement>(null)
  const [aangemeldDoor,  setAangemeldDoor]  = useState('')
  const [creatorOpen,    setCreatorOpen]    = useState(false)
  const creatorRef = useRef<HTMLDivElement>(null)
  const [groothandel,  setGroothandel]  = useState('')
  const [notes,        setNotes]        = useState('')
  const [recording,    setRecording]    = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef   = useRef<Blob[]>([])
  const audioCtxRef      = useRef<AudioContext | null>(null)
  const analyserRef      = useRef<AnalyserNode | null>(null)
  const animFrameRef     = useRef<number>(0)
  const [recBars,        setRecBars]        = useState([0.3, 0.5, 0.3])

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (creatorRef.current && !creatorRef.current.contains(e.target as Node)) {
        setCreatorOpen(false)
      }
      if (assignedRef.current && !assignedRef.current.contains(e.target as Node)) {
        setAssignedOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  useEffect(() => {
    try {
      const savedBeurs = localStorage.getItem(SOURCE_STORAGE_KEY)
      if (savedBeurs && BEURS_OPTIONS.includes(savedBeurs)) setBeursName(savedBeurs)
    } catch { /* ignore */ }
    fetch('/api/settings/employees')
      .then(r => r.json())
      .then((d: TeamMember[]) => {
        const list: TeamMember[] = Array.isArray(d) ? d : (d as { members?: TeamMember[] }).members ?? []
        setTeamMembers(list)
        // Default: logged-in user from localStorage, else last used, else first employee
        const loggedIn  = typeof window !== 'undefined' ? localStorage.getItem('roux_active_employee') : null
        const lastUsed  = typeof window !== 'undefined' ? localStorage.getItem('roux_formulier_creator') : null
        const byId      = (id: string | null) => list.find(m => m.id === id)?.naam ?? null
        const byName    = (n: string | null) => list.find(m => m.naam === n)?.naam ?? null
        setAangemeldDoor(
          byId(loggedIn) ?? byName(lastUsed) ?? list[0]?.naam ?? ''
        )
      })
      .catch(() => {})
      .finally(() => setLoadingTeam(false))
  }, [])

  // Background retry: if polling missed the label, keep checking for up to 60s after done
  useEffect(() => {
    if (phase !== 'done' || enrichResult?.label) return
    const contactId = lateContactRef.current
    if (!contactId) return

    let cancelled = false
    const deadline = Date.now() + 60_000
    const delays   = [4000, 5000, 6000, 8000, 10000, 12000, 15000]

    async function retry() {
      for (const delay of delays) {
        if (cancelled || Date.now() >= deadline) break
        await new Promise(r => setTimeout(r, delay))
        if (cancelled) break
        try {
          const res  = await fetch(`/api/contacts/${contactId}`)
          const data = await res.json() as { label?: string | null; revenue?: number | null }
          if (data.label) {
            setEnrichResult({ label: data.label, revenue: data.revenue ?? null, summary: null })
            break
          }
        } catch { /* ignore */ }
      }
    }
    void retry()
    return () => { cancelled = true }
  }, [phase, enrichResult?.label])

  function persistBeursName(name: string) {
    setBeursName(name)
    try { localStorage.setItem(SOURCE_STORAGE_KEY, name) } catch { /* ignore */ }
  }

  function handlePlaceSelect(p: PlaceResult) {
    setAddress(p.address); setCity(p.city); setPostcode(p.postcode)
    setCountry(p.country); setOpeningHours(p.opening_hours)
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // Web Audio API for bar visualisation
      const ctx      = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      ctx.createMediaStreamSource(stream).connect(analyser)
      audioCtxRef.current  = ctx
      analyserRef.current  = analyser
      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(data)
        const avg = (start: number, end: number) => {
          let s = 0; for (let i = start; i < end; i++) s += data[i]
          return Math.min(1, (s / (end - start)) / 140)
        }
        setRecBars([
          Math.max(0.15, avg(1, 4)),
          Math.max(0.25, avg(4, 10)),
          Math.max(0.15, avg(10, 16)),
        ])
        animFrameRef.current = requestAnimationFrame(tick)
      }
      animFrameRef.current = requestAnimationFrame(tick)

      const mr = new MediaRecorder(stream)
      audioChunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      mr.onstop = async () => {
        cancelAnimationFrame(animFrameRef.current)
        audioCtxRef.current?.close(); audioCtxRef.current = null
        setRecBars([0.3, 0.5, 0.3])
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        setTranscribing(true)
        try {
          const fd = new FormData(); fd.append('audio', blob, 'recording.webm')
          const res  = await fetch('/api/suus/transcribe', { method: 'POST', body: fd })
          const data = await res.json() as { text?: string }
          if (data.text) setNotes(prev => prev ? `${prev} ${data.text}` : data.text!)
        } catch { /* ignore */ } finally { setTranscribing(false) }
      }
      mr.start(); mediaRecorderRef.current = mr; setRecording(true)
    } catch { alert('Microfoon toegang vereist.') }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    setRecording(false)
  }

  function startOver() {
    formRef.current?.reset()
    setAddress(''); setCity(''); setPostcode(''); setCountry('Nederland')
    setPhoneValue(undefined); setNotes(''); setGroothandel('')
    setBeursName(defaultBeursName()); setContactType('lead'); setAssignedTo('')
    // Keep aangemeldDoor — persists to last used
    setOpeningHours(null); setError(null)
    setSavedContact(null); setEnrichResult(null); setPhase('idle')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formRef.current) return
    setError(null)
    if (!phoneValue || !isValidPhoneNumber(phoneValue)) {
      setError('Vul een geldig telefoonnummer in.'); return
    }
    const phoneE164 = phoneValue
    const fd = new FormData(formRef.current)
    const body = {
      company:    fd.get('company')     as string,
      first_name: fd.get('first_name')  as string,
      last_name:  fd.get('last_name')   as string,
      email:      fd.get('email')       as string,
      phone: phoneE164, address, city, postcode, country,
      opening_hours: openingHours,
      assigned_to:    assignedTo,
      status:         contactType,
      created_by:     aangemeldDoor,
      groothandel:    groothandel || undefined,
      notes, source: buildSource(beursName, YEAR), channel: CHANNEL,
    }
    try {
      setPhase('saving')
      let res: Response
      try {
        res = await fetch('/api/formulier', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      } catch {
        throw new Error('Geen verbinding met de server.')
      }
      const data = (await res.json()) as { error?: string; id?: string; assigned_to?: string | null; label?: string | null; revenue?: number | null }
      if (!res.ok) throw new Error(data.error ?? 'Fout bij opslaan')
      if (!data.id) throw new Error('Server gaf geen contact-id terug')
      try { localStorage.setItem(SOURCE_STORAGE_KEY, beursName) } catch { /* ignore */ }

      const { status: formStatus, channel: _ch, ...contactFields } = body
      lateContactRef.current = data.id
      setSavedContact({ ...contactFields, id: data.id, assigned_to: data.assigned_to ?? null, contact_type: formStatus || 'lead', opening_hours: openingHours, groothandel: groothandel })
      formRef.current.reset()
      setAddress(''); setCity(''); setPostcode(''); setCountry('Nederland')
      setPhoneValue(undefined); setNotes(''); setGroothandel(''); setOpeningHours(null)

      // Enrichment runs inline on the server — check if it came back immediately
      if (data.label) {
        setEnrichResult({ label: data.label, revenue: data.revenue ?? null, summary: null })
        if (data.assigned_to) setSavedContact(prev => prev ? { ...prev, assigned_to: data.assigned_to! } : prev)
        setPhase('done')
      } else {
        // Fallback: poll for a few rounds in case enrichment is still settling
        setPhase('enriching')
        try {
          const contactId = data.id
          const deadline  = Date.now() + 20_000
          const intervals = [2000, 3000, 3000, 4000, 4000, 4000]
          let result: EnrichResult = { label: null, revenue: null, summary: null }
          let assignedTo: string | null = null
          for (const wait of intervals) {
            if (Date.now() >= deadline) break
            await new Promise(r => setTimeout(r, wait))
            const pollRes  = await fetch(`/api/contacts/${contactId}`)
            const pollData = await pollRes.json() as { label?: string | null; revenue?: number | null; assigned_to?: string | null }
            if (pollData.assigned_to && !assignedTo) {
              assignedTo = pollData.assigned_to
              setSavedContact(prev => prev ? { ...prev, assigned_to: assignedTo } : prev)
            }
            if (pollData.label) { result = { label: pollData.label, revenue: pollData.revenue ?? null, summary: null }; break }
          }
          setEnrichResult(result)
        } catch { /* ignore */ }
        setPhase('done')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Er is iets misgegaan')
      setPhase('idle')
    }
  }

  const isSubmitting = phase === 'saving' || phase === 'enriching'
  const canSubmit    = !isSubmitting && !loadingTeam && !!aangemeldDoor
  const showResult   = phase === 'enriching' || phase === 'done'

  return (
    <div className="min-h-screen bg-bg">
      <div className="flex justify-center">
        <div className="w-full max-w-[520px] px-4 pt-8 pb-safe-bottom pb-16">

          {/* Header */}
          <div className="text-center mb-5">
            <h1 className="text-xl font-bold text-primary tracking-tight mb-1.5">
              Beurs formulier
            </h1>
            <p className="text-sm text-muted mb-2 leading-snug">
              Intake formulier voor nieuwe beurs leads
            </p>
            <Link href="/leads" className="text-[13px] font-semibold text-primary underline">
              Bekijk opgeslagen leads
            </Link>
          </div>

          {/* Success card */}
          {showResult && savedContact && (
            <SuccessCard
              phase={phase} contact={savedContact} enrich={enrichResult}
              onStartOver={startOver} teamMembers={teamMembers}
            />
          )}

          {/* Form */}
          <div className={showResult ? 'hidden' : 'block'}>
            <form
              ref={formRef} onSubmit={handleSubmit}
              className="flex flex-col bg-surface border border-border rounded-xl"
            >
              <FieldSection title="Bedrijf" icon={<Briefcase size={13} />}>
                <div>
                  <PlacesCompanyInput
                    required autoFocus onSelect={handlePlaceSelect}
                    className="field-input"
                    placeholder="Grootmeester"
                  />
                  <p className="text-xs text-muted mt-1.5">
                    Begin te typen — adres vult automatisch in via Google Places
                  </p>
                </div>
              </FieldSection>

              <FieldSection title="Adres" icon={<MapPin size={13} />}>
                <Field label="Straat & nummer">
                  <input name="address" value={address} onChange={e => setAddress(e.target.value)}
                    placeholder="Galileistraat 19" className="field-input" />
                </Field>
                <TwoCol>
                  <Field label="Stad">
                    <input name="city" value={city} onChange={e => setCity(e.target.value)}
                      placeholder="Heerhugowaard" className="field-input" />
                  </Field>
                  <Field label="Postcode">
                    <input name="postcode" value={postcode} onChange={e => setPostcode(e.target.value)}
                      placeholder="2704 SE" inputMode="text" autoCapitalize="characters" className="field-input" />
                  </Field>
                </TwoCol>
                <Field label="Land">
                  <input name="country" value={country} onChange={e => setCountry(e.target.value)}
                    placeholder="Nederland" className="field-input" />
                </Field>
              </FieldSection>

              <FieldSection title="Contactpersoon" icon={<User size={13} />}>
                <TwoCol>
                  <Field label="Voornaam" required>
                    <input name="first_name" required placeholder="Vincent" className="field-input" />
                  </Field>
                  <Field label="Achternaam">
                    <input name="last_name" placeholder="Jongens" className="field-input" />
                  </Field>
                </TwoCol>
                <Field label="E-mailadres">
                  <input name="email" type="email" placeholder="info@rouxbv.nl" className="field-input" />
                </Field>
                <Field label="Telefoonnummer" required>
                  <PhoneInput
                    defaultCountry="NL"
                    value={phoneValue}
                    onChange={setPhoneValue}
                    international
                    countryCallingCodeEditable={false}
                    placeholder="6 12 345 678"
                  />
                </Field>
              </FieldSection>

              <FieldSection title="Classificatie" icon={<Tag size={13} />}>
                <TwoCol>
                  <Field label="Toegewezen aan">
                    <div ref={assignedRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setAssignedOpen(o => !o)}
                        disabled={loadingTeam}
                        className="field-input w-full flex items-center gap-2.5 cursor-pointer text-left"
                      >
                        {assignedTo ? (() => {
                          const m = teamMembers.find(m => m.naam === assignedTo)
                          return m ? (
                            <>
                              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 inline-block"
                                style={{ backgroundColor: m.color || '#888' }} />
                              <span className="flex-1 truncate text-sm">{m.naam}</span>
                            </>
                          ) : <span className="flex-1 text-sm">{assignedTo}</span>
                        })() : <span className="flex-1 text-sm text-muted">Auto</span>}
                        <svg className="w-3.5 h-3.5 text-muted flex-shrink-0" viewBox="0 0 12 12" fill="none">
                          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      {assignedOpen && (
                        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-surface border border-border rounded-lg shadow-lg overflow-hidden">
                          <button
                            type="button"
                            onClick={() => { setAssignedTo(''); setAssignedOpen(false) }}
                            className={cn(
                              'w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-active transition-colors',
                              assignedTo === '' && 'bg-active font-medium',
                            )}
                          >
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-border bg-active inline-block" />
                            <span className="flex-1 truncate">Auto</span>
                            <span className="text-[11px] text-muted">routing logica</span>
                          </button>
                          {teamMembers.map(m => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => { setAssignedTo(m.naam); setAssignedOpen(false) }}
                              className={cn(
                                'w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-active transition-colors',
                                assignedTo === m.naam && 'bg-active font-medium',
                              )}
                            >
                              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 inline-block"
                                style={{ backgroundColor: m.color || '#888' }} />
                              <span className="flex-1 truncate">{m.naam}</span>
                              {m.functie && <span className="text-[11px] text-muted">{m.functie}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </Field>
                  <Field label="Type">
                    <select value={contactType} onChange={e => setContactType(e.target.value as 'lead' | 'customer')} className="field-input cursor-pointer">
                      <option value="lead">Lead</option>
                      <option value="customer">Klant</option>
                    </select>
                  </Field>
                </TwoCol>
              </FieldSection>

              <FieldSection title="Groothandel" icon={<Store size={13} />}>
                <Field label="Groothandel leverancier">
                  <input
                    value={groothandel}
                    onChange={e => setGroothandel(e.target.value)}
                    list="groothandel-list-formulier"
                    className="field-input"
                    placeholder="Typ of kies groothandel…"
                    autoComplete="off"
                  />
                  <datalist id="groothandel-list-formulier">
                    {GROOTHANDEL_OPTIONS.map(g => <option key={g} value={g} />)}
                  </datalist>
                </Field>
              </FieldSection>

              <FieldSection title="Notities" icon={<FileText size={13} />}>
                <div className="relative">
                  <textarea
                    name="notes" rows={4}
                    value={notes} onChange={e => setNotes(e.target.value)}
                    placeholder={transcribing ? 'Transcriberen…' : 'Klant wilt graag een proeverij doen…'}
                    disabled={transcribing}
                    className="field-input resize-y leading-relaxed pr-11"
                  />
                  <button
                    type="button"
                    onClick={recording ? stopRecording : startRecording}
                    title={recording ? 'Stop opname' : 'Dicteer notities'}
                    disabled={transcribing}
                    className={cn(
                      'absolute top-2 right-2 rounded-md flex items-center justify-center border-none transition-all',
                      recording ? 'h-8 px-2.5 gap-[3px] bg-[#0d0d0d]' : 'w-8 h-8 bg-[#0d0d0d] hover:bg-black',
                      transcribing && 'opacity-40 cursor-default',
                    )}
                  >
                    {recording ? (
                      recBars.map((h, i) => (
                        <span
                          key={i}
                          className="w-[3px] rounded-full bg-white transition-all duration-75"
                          style={{ height: `${Math.round(6 + h * 18)}px` }}
                        />
                      ))
                    ) : transcribing ? (
                      <Loader2 size={14} className="text-white animate-spin" />
                    ) : (
                      <Mic size={14} className="text-white" />
                    )}
                  </button>
                </div>
                {(recording || transcribing) && (
                  <p className="flex items-center gap-1.5 text-xs text-muted mt-1">
                    <span className={cn('w-1.5 h-1.5 rounded-full', recording ? 'bg-red-500 animate-[recPulse_1s_ease-in-out_infinite]' : 'bg-muted')} />
                    {transcribing ? 'Transcriberen…' : 'Opname bezig — klik om te stoppen'}
                  </p>
                )}
              </FieldSection>

              <FieldSection title="Herkomst" icon={<Flag size={13} />}>
                <div className="grid grid-cols-[1fr_auto_1fr] max-[420px]:grid-cols-1 gap-3">
                  <Field label="Beurs">
                    <select value={beursName} onChange={e => persistBeursName(e.target.value)}
                      className="field-input cursor-pointer">
                      {BEURS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </Field>
                  <Field label="Jaar">
                    <div className="field-input bg-active text-muted cursor-default select-none flex items-center justify-center font-semibold text-sm min-w-[64px]"
                      style={{ fontFamily: MONO }}>
                      {YEAR}
                    </div>
                  </Field>
                  <Field label="Channel">
                    <div className="field-input bg-active text-muted cursor-default select-none flex items-center font-semibold text-sm"
                      style={{ fontFamily: MONO }}>
                      {CHANNEL}
                    </div>
                  </Field>
                </div>
                <Field label="Aangemaakt door">
                  <div ref={creatorRef} className="relative">
                    {/* Trigger */}
                    <button
                      type="button"
                      onClick={() => setCreatorOpen(o => !o)}
                      disabled={loadingTeam}
                      className="field-input w-full flex items-center gap-2.5 cursor-pointer text-left"
                    >
                      {(() => {
                        const m = teamMembers.find(m => m.naam === aangemeldDoor)
                        return m ? (
                          <>
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 inline-block"
                              style={{ backgroundColor: m.color || '#888' }} />
                            <span className="flex-1 truncate text-sm">{m.naam}</span>
                          </>
                        ) : <span className="flex-1 text-sm text-muted">Selecteer…</span>
                      })()}
                      <svg className="w-3.5 h-3.5 text-muted flex-shrink-0" viewBox="0 0 12 12" fill="none">
                        <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>

                    {/* Dropdown */}
                    {creatorOpen && (
                      <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-surface border border-border rounded-lg shadow-lg overflow-hidden">
                        {teamMembers.map(m => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              setAangemeldDoor(m.naam)
                              try { localStorage.setItem('roux_formulier_creator', m.naam) } catch { /* ignore */ }
                              setCreatorOpen(false)
                            }}
                            className={cn(
                              'w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-active transition-colors',
                              aangemeldDoor === m.naam && 'bg-active font-medium',
                            )}
                          >
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 inline-block"
                              style={{ backgroundColor: m.color || '#888' }} />
                            <span className="flex-1 truncate">{m.naam}</span>
                            {m.functie && (
                              <span className="text-[11px] text-muted">{m.functie}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </Field>
              </FieldSection>

              <div className="sticky bottom-0 z-10 bg-surface border-t border-border px-5 py-3">
                {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
                <button
                  type="submit" disabled={!canSubmit}
                  className="btn-primary w-full py-3.5"
                >
                  {isSubmitting
                    ? <><Loader2 size={14} className="animate-spin" /> Opslaan…</>
                    : loadingTeam
                      ? <><Loader2 size={14} className="animate-spin" /> Laden…</>
                      : 'Opslaan'
                  }
                </button>
              </div>
            </form>
          </div>

        </div>
      </div>
    </div>
  )
}

// ── Success card ─────────────────────────────────────────────────────────────

function SuccessCard({ phase, contact, enrich, onStartOver, teamMembers }: {
  phase: Phase; contact: SavedContact; enrich: EnrichResult | null; onStartOver: () => void; teamMembers: TeamMember[]
}) {
  const enriching      = phase === 'enriching'
  const lm             = enrich?.label ? LABEL_META[enrich.label] : null
  const assignedMember = contact.assigned_to
    ? teamMembers.find(m => m.naam === contact.assigned_to || m.id === contact.assigned_to) ?? null
    : null
  const mc = assignedMember?.color ?? null

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden mb-5">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-active">
        {enriching && <Loader2 size={12} className="animate-spin text-muted flex-shrink-0" />}
        <span className="text-xs font-semibold text-primary">
          {enriching ? 'Kwalificeren…' : 'Lead opgeslagen ✓'}
        </span>
      </div>

      {contact.company && (
        <ResultSection title="Bedrijf" icon={<Briefcase size={12} />}>
          <span className="text-sm font-bold text-primary tracking-tight">{contact.company}</span>
        </ResultSection>
      )}

      {(contact.address || contact.city) && (
        <ResultSection title="Adres" icon={<MapPin size={12} />}>
          {contact.address && <Val label="Straat" value={contact.address} />}
          <TwoCol>
            {contact.city     && <Val label="Stad"     value={contact.city} />}
            {contact.postcode && <Val label="Postcode" value={contact.postcode} mono />}
          </TwoCol>
        </ResultSection>
      )}

      {(contact.first_name || contact.phone) && (
        <ResultSection title="Contactpersoon" icon={<User size={12} />}>
          <TwoCol>
            {contact.first_name && <Val label="Voornaam"   value={contact.first_name} />}
            {contact.last_name  && <Val label="Achternaam" value={contact.last_name} />}
          </TwoCol>
          <TwoCol>
            {contact.phone && <Val label="Telefoon" value={contact.phone} mono />}
            {contact.email && <Val label="E-mail"   value={contact.email} />}
          </TwoCol>
        </ResultSection>
      )}

      <ResultSection title="Herkomst" icon={<Flag size={12} />}>
        <TwoCol>
          <Val label="Beurs / bron" value={contact.source || '—'} />
          <Val label="Channel"      value="OFFLINE" mono />
        </TwoCol>
      </ResultSection>

      {contact.groothandel && (
        <ResultSection title="Groothandel" icon={<Store size={12} />}>
          <Val label="Leverancier" value={contact.groothandel} />
        </ResultSection>
      )}

      <ResultSection title="Classificatie" icon={<Tag size={12} />}>
        <TwoCol>
          {/* Label */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted">Label</span>
            {enriching
              ? <div className="h-[22px] w-9 rounded bg-border animate-pulse" />
              : lm && enrich?.label
                ? <span className="self-start text-xs font-bold px-2.5 py-1 rounded"
                    style={{ backgroundColor: lm.bg, color: lm.text, border: `1px solid ${lm.border}`, fontFamily: MONO, letterSpacing: '0.08em' }}>
                    {enrich.label}
                  </span>
                : <span className="text-xs text-muted">—</span>
            }
          </div>
          {/* Volume */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted">Volume</span>
            {enriching
              ? <div className="h-4 w-16 rounded bg-border animate-pulse" />
              : enrich?.revenue != null
                ? <span className="text-[13px] font-bold text-primary" style={{ fontFamily: MONO }}>
                    {Number(enrich.revenue).toLocaleString('nl-NL')}
                  </span>
                : <span className="text-xs text-muted">—</span>
            }
          </div>
        </TwoCol>

        {/* Toegewezen aan */}
        <div className="flex flex-col gap-1 mt-1.5">
          <span className="text-xs font-semibold text-muted">Toegewezen aan</span>
          {enriching
            ? <div className="h-[22px] w-24 rounded-full bg-border animate-pulse" />
            : contact.assigned_to
              ? <span className="self-start flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full tracking-wide uppercase"
                  style={{ backgroundColor: mc ? `${mc}18` : 'var(--active)', color: mc ?? 'var(--text)', border: `1px solid ${mc ? `${mc}40` : 'var(--border)'}` }}>
                  {mc && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: mc }} />}
                  {contact.assigned_to}
                </span>
              : <span className="text-xs text-muted">wordt bepaald…</span>
          }
        </div>

        {enrich?.summary && (
          <p className="text-[13px] leading-snug text-muted italic mt-1.5">{enrich.summary}</p>
        )}
      </ResultSection>

      {contact.notes && (
        <ResultSection title="Notities" icon={<FileText size={12} />}>
          <p className="text-sm leading-relaxed text-primary">{contact.notes}</p>
        </ResultSection>
      )}

      <div className="px-4 py-3 flex flex-col gap-2">
        <button onClick={onStartOver}
          className="btn-primary w-full py-2.5">
          <RotateCcw size={13} strokeWidth={2} /> Nieuwe lead toevoegen
        </button>
        <a href="/leads"
          className="w-full py-2.5 rounded-lg border border-border bg-surface text-[13px] font-semibold text-primary flex items-center justify-center gap-2 no-underline box-border hover:bg-active transition-colors">
          <ArrowUpRight size={13} strokeWidth={2} /> Bekijk alle leads
        </a>
      </div>
    </div>
  )
}

function ResultSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3 border-b border-border last:border-b-0 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-muted flex">{icon}</span>
        <span className="text-[11px] font-extrabold text-primary uppercase tracking-[0.06em]">{title}</span>
      </div>
      {children}
    </div>
  )
}

function Val({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <span className="text-xs font-medium text-primary leading-snug" style={mono ? { fontFamily: MONO } : undefined}>{value}</span>
    </div>
  )
}
