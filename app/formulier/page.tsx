'use client'

import { useRef, useState, useEffect } from 'react'
import Link from 'next/link'
import {
  Briefcase, User, MapPin, Tag, FileText, RotateCcw,
  Flag, Loader2, ArrowUpRight, Mic, StopCircle,
} from 'lucide-react'
import PlacesCompanyInput, { type PlaceResult } from '@/components/PlacesCompanyInput'
import { beursOptionsForYear, defaultBeursSource, SOURCE_STORAGE_KEY } from '@/lib/beurs-sources'
import { nationalDigitsToE164NL, countNlNationalDigits } from '@/lib/phone-nl'
import { Field, TwoCol, FieldSection } from '@/components/ui/field'
import { cn } from '@/lib/utils'

const MONO = "'SF Mono','Fira Code',monospace"
const YEAR = new Date().getFullYear()
const CHANNEL = 'OFFLINE'
const SOURCE_OPTIONS = beursOptionsForYear(YEAR)

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
}
type TeamMember = { id: string; naam: string; color: string | null }
type Phase = 'idle' | 'saving' | 'enriching' | 'done'

export default function FormulierPage() {
  const formRef = useRef<HTMLFormElement>(null)
  const [phase,        setPhase]        = useState<Phase>('idle')
  const [error,        setError]        = useState<string | null>(null)
  const [savedContact, setSavedContact] = useState<SavedContact | null>(null)
  const [enrichResult, setEnrichResult] = useState<EnrichResult | null>(null)
  const [address,      setAddress]      = useState('')
  const [city,         setCity]         = useState('')
  const [postcode,     setPostcode]     = useState('')
  const [country,      setCountry]      = useState('Nederland')
  const [openingHours, setOpeningHours] = useState<PlaceResult['opening_hours']>(null)
  const [source,       setSource]       = useState(defaultBeursSource(YEAR))
  const [phoneNational, setPhoneNational] = useState('')
  const [teamMembers,  setTeamMembers]  = useState<TeamMember[]>([])
  const [notes,        setNotes]        = useState('')
  const [recording,    setRecording]    = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef   = useRef<Blob[]>([])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SOURCE_STORAGE_KEY)
      if (saved && SOURCE_OPTIONS.includes(saved)) setSource(saved)
    } catch { /* ignore */ }
    fetch('/api/settings/employees')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.members)) setTeamMembers(d.members) })
      .catch(() => {})
  }, [])

  function persistSource(s: string) {
    setSource(s)
    try { localStorage.setItem(SOURCE_STORAGE_KEY, s) } catch { /* ignore */ }
  }

  function handlePlaceSelect(p: PlaceResult) {
    setAddress(p.address); setCity(p.city); setPostcode(p.postcode)
    setCountry(p.country); setOpeningHours(p.opening_hours)
  }

  async function startRecording() {
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
    setPhoneNational(''); setNotes('')
    setOpeningHours(null); setError(null)
    setSavedContact(null); setEnrichResult(null); setPhase('idle')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formRef.current) return
    setError(null)
    const digits = countNlNationalDigits(phoneNational)
    if (digits < 9) { setError('Vul een geldig mobiel nummer in (9 cijfers na +31).'); return }
    const phoneE164 = nationalDigitsToE164NL(phoneNational)
    const fd = new FormData(formRef.current)
    const body = {
      company:    fd.get('company')     as string,
      first_name: fd.get('first_name')  as string,
      last_name:  fd.get('last_name')   as string,
      email:      fd.get('email')       as string,
      phone: phoneE164, address, city, postcode, country,
      opening_hours: openingHours,
      assigned_to: fd.get('assigned_to') as string,
      status:      fd.get('status')      as string,
      notes, source, channel: CHANNEL,
    }
    try {
      setPhase('saving')
      let res: Response
      try {
        res = await fetch('/api/formulier', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      } catch {
        throw new Error('Geen verbinding met de server.')
      }
      const data = (await res.json()) as { error?: string; id?: string; assigned_to?: string | null }
      if (!res.ok) throw new Error(data.error ?? 'Fout bij opslaan')
      if (!data.id) throw new Error('Server gaf geen contact-id terug')
      try { localStorage.setItem(SOURCE_STORAGE_KEY, source) } catch { /* ignore */ }

      const { status: formStatus, channel: _ch, ...contactFields } = body
      setSavedContact({ ...contactFields, id: data.id, assigned_to: data.assigned_to ?? null, contact_type: formStatus || 'lead', opening_hours: openingHours })
      formRef.current.reset()
      setAddress(''); setCity(''); setPostcode(''); setCountry('Nederland')
      setPhoneNational(''); setNotes(''); setOpeningHours(null)

      setPhase('enriching')
      try {
        const contactId = data.id
        const deadline  = Date.now() + 40_000
        const intervals = [1500, 2500, 2500, 3000, 3000, 3000, 4000, 4000, 4000, 5000]
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Er is iets misgegaan')
      setPhase('idle')
    }
  }

  const isSubmitting = phase === 'saving' || phase === 'enriching'
  const showResult   = phase === 'enriching' || phase === 'done'

  return (
    <div className="min-h-screen bg-bg">
      <div className="flex justify-center">
        <div className="w-full max-w-[520px] px-4 pt-8 pb-16">

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
              className="flex flex-col bg-surface border border-border rounded-xl overflow-hidden"
            >
              <FieldSection title="Bedrijf" icon={<Briefcase size={13} />}>
                <div>
                  <PlacesCompanyInput
                    required autoFocus onSelect={handlePlaceSelect}
                    inputStyle={{ width: '100%', padding: '10px 12px', fontSize: '15px', color: 'var(--text)', backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '7px', outline: 'none', boxSizing: 'border-box' }}
                    placeholder="bijv. Grand Café De Hoorn BV"
                  />
                  <p className="text-xs text-muted mt-1.5">
                    Begin te typen — adres vult automatisch in via Google Places
                  </p>
                </div>
              </FieldSection>

              <FieldSection title="Adres" icon={<MapPin size={13} />}>
                <Field label="Straat & nummer">
                  <input name="address" value={address} onChange={e => setAddress(e.target.value)}
                    placeholder="Marktstraat 14" className="field-input" />
                </Field>
                <TwoCol>
                  <Field label="Stad">
                    <input name="city" value={city} onChange={e => setCity(e.target.value)}
                      placeholder="Rotterdam" className="field-input" />
                  </Field>
                  <Field label="Postcode">
                    <input name="postcode" value={postcode} onChange={e => setPostcode(e.target.value)}
                      placeholder="3011 BV" className="field-input" />
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
                    <input name="first_name" required placeholder="Thomas" className="field-input" />
                  </Field>
                  <Field label="Achternaam">
                    <input name="last_name" placeholder="van den Berg" className="field-input" />
                  </Field>
                </TwoCol>
                <Field label="E-mailadres">
                  <input name="email" type="email" placeholder="thomas@grandcafe.nl" className="field-input" />
                </Field>
                <Field label="Telefoonnummer" required>
                  <div className="flex items-stretch rounded-lg border border-border overflow-hidden bg-surface">
                    <span className="flex items-center gap-1.5 px-3 text-sm font-semibold text-primary bg-active border-r border-border flex-shrink-0">
                      <span className="text-lg leading-none" title="Nederland">🇳🇱</span>
                      +31
                    </span>
                    <input
                      type="tel" inputMode="numeric" autoComplete="tel-national" required
                      value={phoneNational} onChange={e => setPhoneNational(e.target.value)}
                      placeholder="6 12345678" aria-label="Telefoonnummer zonder landcode"
                      className="field-input flex-1 min-w-0 border-0 rounded-none focus:ring-0"
                    />
                  </div>
                  <p className="text-xs text-muted mt-1 leading-snug">
                    Alleen je Nederlandse nummer invoeren; +31 wordt automatisch toegevoegd.
                  </p>
                </Field>
              </FieldSection>

              <FieldSection title="Classificatie" icon={<Tag size={13} />}>
                <TwoCol>
                  <Field label="Toegewezen aan">
                    <select name="assigned_to" className="field-input cursor-pointer">
                      <option value="">Auto</option>
                      {teamMembers.map(m => <option key={m.id} value={m.naam}>{m.naam}</option>)}
                    </select>
                  </Field>
                  <Field label="Type">
                    <select name="status" className="field-input cursor-pointer">
                      <option value="lead">Lead</option>
                      <option value="customer">Klant</option>
                      <option value="employee">Medewerker</option>
                    </select>
                  </Field>
                </TwoCol>
              </FieldSection>

              <FieldSection title="Notities" icon={<FileText size={13} />}>
                <div className="relative">
                  <textarea
                    name="notes" rows={4}
                    value={notes} onChange={e => setNotes(e.target.value)}
                    placeholder={transcribing ? 'Transcriberen…' : 'Interesse in… Opening gepland op… Bijzonderheden…'}
                    disabled={transcribing}
                    className="field-input resize-y leading-relaxed pr-11"
                  />
                  <button
                    type="button"
                    onClick={recording ? stopRecording : startRecording}
                    title={recording ? 'Stop opname' : 'Dicteer notities'}
                    disabled={transcribing}
                    className={cn(
                      'absolute top-2 right-2 w-8 h-8 rounded-md flex items-center justify-center border-none transition-all',
                      recording
                        ? 'bg-red-50 text-red-600 animate-[recPulse_1s_ease-in-out_infinite]'
                        : 'bg-active text-muted hover:text-primary',
                      transcribing && 'opacity-50 cursor-default',
                    )}
                  >
                    {recording ? <StopCircle size={14} /> : <Mic size={14} />}
                  </button>
                </div>
                {(recording || transcribing) && (
                  <p className="flex items-center gap-1.5 text-xs text-red-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-[recPulse_1s_ease-in-out_infinite]" />
                    {transcribing ? 'Transcriberen…' : 'Opname bezig — klik stop om klaar te zijn'}
                  </p>
                )}
              </FieldSection>

              <FieldSection title="Herkomst" icon={<Flag size={13} />}>
                <TwoCol>
                  <Field label="Beurs / herkomst">
                    <select name="source" value={source} onChange={e => persistSource(e.target.value)}
                      className="field-input cursor-pointer">
                      {SOURCE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </Field>
                  <Field label="Channel">
                    <select disabled value={CHANNEL} className="field-input text-muted bg-active cursor-not-allowed">
                      <option>{CHANNEL}</option>
                    </select>
                  </Field>
                </TwoCol>
              </FieldSection>

              <div className="px-5 py-4">
                {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
                <button
                  type="submit" disabled={isSubmitting}
                  className="btn-primary w-full py-3"
                >
                  {isSubmitting
                    ? <><Loader2 size={14} className="animate-spin" /> Opslaan…</>
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
                : <span className="text-xs text-muted">wordt bepaald…</span>
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
                : <span className="text-xs text-muted">wordt bepaald…</span>
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
