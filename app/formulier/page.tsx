'use client'

import { useRef, useState, useEffect } from 'react'
import Link from 'next/link'
import { Briefcase, User, MapPin, Tag, FileText, RotateCcw, Flag, Loader2, ArrowUpRight, Mic, StopCircle } from 'lucide-react'
import PlacesCompanyInput, { type PlaceResult } from '@/components/PlacesCompanyInput'
import { beursOptionsForYear, defaultBeursSource, SOURCE_STORAGE_KEY } from '@/lib/beurs-sources'
import { nationalDigitsToE164NL, countNlNationalDigits } from '@/lib/phone-nl'

const MONO = "'SF Mono','Fira Code',monospace"
const F    = "'Inter',-apple-system,sans-serif"
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
  const [country,       setCountry]       = useState('Nederland')
  const [openingHours,  setOpeningHours]  = useState<PlaceResult['opening_hours']>(null)
  const [source,        setSource]        = useState(defaultBeursSource(YEAR))
  const [phoneNational, setPhoneNational] = useState('')
  const [teamMembers,   setTeamMembers]   = useState<TeamMember[]>([])
  const [notes,         setNotes]         = useState('')
  const [recording,     setRecording]     = useState(false)
  const [transcribing,  setTranscribing]  = useState(false)
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
    try {
      localStorage.setItem(SOURCE_STORAGE_KEY, s)
    } catch { /* ignore */ }
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
          if (data.text) {
            setNotes(prev => prev ? `${prev} ${data.text}` : data.text!)
          }
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
    if (digits < 9) {
      setError('Vul een geldig mobiel nummer in (9 cijfers na +31).')
      return
    }
    const phoneE164 = nationalDigitsToE164NL(phoneNational)

    const fd = new FormData(formRef.current)
    const body = {
      company:       fd.get('company')    as string,
      first_name:    fd.get('first_name') as string,
      last_name:     fd.get('last_name')  as string,
      email:         fd.get('email')      as string,
      phone:         phoneE164,
      address, city, postcode, country,
      opening_hours: openingHours,
      assigned_to:   fd.get('assigned_to') as string,
      status:        fd.get('status')      as string,
      notes,
      source, channel: CHANNEL,
    }

    try {
      setPhase('saving')
      let res: Response
      try {
        res = await fetch('/api/formulier', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } catch {
        throw new Error('Geen verbinding met de server (fetch mislukt). Controleer of `npm run dev` draait en de juiste poort (b.v. :3001).')
      }
      const data = (await res.json()) as { error?: string; id?: string; assigned_to?: string | null }
      if (!res.ok) throw new Error(data.error ?? 'Fout bij opslaan')
      if (!data.id) throw new Error('Server gaf geen contact-id terug')

      try {
        localStorage.setItem(SOURCE_STORAGE_KEY, source)
      } catch { /* ignore */ }

      const { status: formStatus, channel: _ch, ...contactFields } = body
      setSavedContact({
        ...contactFields,
        id: data.id,
        assigned_to: data.assigned_to ?? null,
        contact_type: formStatus || 'lead',
        opening_hours: openingHours,
      })
      formRef.current.reset()
      setAddress(''); setCity(''); setPostcode(''); setCountry('Nederland')
      setPhoneNational(''); setNotes('')
      setOpeningHours(null)

      // Poll for enrich result (label + revenue + assigned_to)
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
          if (pollData.label) {
            result = { label: pollData.label, revenue: pollData.revenue ?? null, summary: null }
            break
          }
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
    <div style={{ backgroundColor: 'var(--bg)', minHeight: '100vh' }}>
      <style>{`
        @keyframes recPulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
      `}</style>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: '520px', padding: '32px 16px 64px' }}>

          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em', margin: '0 0 6px' }}>
              Beurs formulier
            </h1>
            <p style={{ fontSize: '14px', color: 'var(--label-secondary)', margin: '0 0 8px', lineHeight: 1.45 }}>
              Intake formulier voor nieuwe beurs leads
            </p>
            <Link href="/leads" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', textDecoration: 'underline' }}>
              Bekijk opgeslagen leads
            </Link>
          </div>


          {showResult && savedContact && (
            <SuccessCard phase={phase} contact={savedContact} enrich={enrichResult} onStartOver={startOver} teamMembers={teamMembers} />
          )}

          <div style={{ display: showResult ? 'none' : 'block' }}>
            <form ref={formRef} onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>

              <Section title="Bedrijf" icon={<Briefcase size={13} />}>
                <div>
                  <PlacesCompanyInput required autoFocus onSelect={handlePlaceSelect} inputStyle={inp()} placeholder="bijv. Grand Café De Hoorn BV" />
                  <p style={{ fontSize: '12px', color: 'var(--label-secondary)', marginTop: '6px', marginBottom: 0 }}>
                    Begin te typen — adres vult automatisch in via Google Places
                  </p>
                </div>
              </Section>

              <Section title="Adres" icon={<MapPin size={13} />}>
                <LF label="Straat & nummer">
                  <input name="address" value={address} onChange={e => setAddress(e.target.value)} placeholder="Marktstraat 14" style={inp()} />
                </LF>
                <TwoCol>
                  <LF label="Stad"><input name="city" value={city} onChange={e => setCity(e.target.value)} placeholder="Rotterdam" style={inp()} /></LF>
                  <LF label="Postcode"><input name="postcode" value={postcode} onChange={e => setPostcode(e.target.value)} placeholder="3011 BV" style={inp()} /></LF>
                </TwoCol>
                <LF label="Land">
                  <input name="country" value={country} onChange={e => setCountry(e.target.value)} placeholder="Nederland" style={inp()} />
                </LF>
              </Section>

              <Section title="Contactpersoon" icon={<User size={13} />}>
                <TwoCol>
                  <LF label="Voornaam *"><input name="first_name" required placeholder="Thomas" style={inp()} /></LF>
                  <LF label="Achternaam"><input name="last_name" placeholder="van den Berg" style={inp()} /></LF>
                </TwoCol>
                <LF label="E-mailadres">
                  <input name="email" type="email" placeholder="thomas@grandcafe.nl" style={inp()} />
                </LF>
                <LF label="Telefoonnummer *">
                  <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, borderRadius: '7px', border: '1px solid var(--border)', overflow: 'hidden', backgroundColor: 'var(--surface)' }}>
                    <span
                      aria-hidden
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '0 10px',
                        fontSize: '14px',
                        fontWeight: 600,
                        color: 'var(--text)',
                        backgroundColor: 'var(--active)',
                        borderRight: '1px solid var(--border)',
                        flexShrink: 0,
                      }}
                    >
                      <span style={{ fontSize: '18px', lineHeight: 1 }} title="Nederland">🇳🇱</span>
                      +31
                    </span>
                    <input
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      required
                      value={phoneNational}
                      onChange={e => setPhoneNational(e.target.value)}
                      placeholder="6 12345678"
                      aria-label="Telefoonnummer zonder landcode"
                      style={{
                        ...inp(),
                        border: 'none',
                        borderRadius: 0,
                        flex: 1,
                        minWidth: 0,
                      }}
                    />
                  </div>
                  <p style={{ fontSize: '13px', color: 'var(--label-secondary)', margin: '6px 0 0', lineHeight: 1.45 }}>
                    Alleen je Nederlandse nummer invoeren; +31 wordt automatisch toegevoegd.
                  </p>
                </LF>
              </Section>

              <Section title="Classificatie" icon={<Tag size={13} />}>
                <TwoCol>
                  <LF label="Toegewezen aan">
                    <select name="assigned_to" style={{ ...inp(), cursor: 'pointer' }}>
                      <option value="">Auto</option>
                    </select>
                  </LF>
                  <LF label="Type">
                    <select name="status" style={{ ...inp(), cursor: 'pointer' }}>
                      <option value="lead">Lead</option>
                      <option value="customer">Klant</option>
                      <option value="employee">Medewerker</option>
                    </select>
                  </LF>
                </TwoCol>
              </Section>

              <Section title="Notities" icon={<FileText size={13} />}>
                <div style={{ position: 'relative' }}>
                  <textarea
                    name="notes"
                    rows={4}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder={transcribing ? 'Transcriberen…' : 'Interesse in… Opening gepland op… Bijzonderheden…'}
                    disabled={transcribing}
                    style={{ ...inp(), resize: 'vertical', lineHeight: 1.6, paddingRight: '44px' }}
                  />
                  <button
                    type="button"
                    onClick={recording ? stopRecording : startRecording}
                    title={recording ? 'Stop opname' : 'Dicteer notities'}
                    style={{
                      position: 'absolute', top: '8px', right: '8px',
                      width: '30px', height: '30px', borderRadius: '6px', border: 'none',
                      background: recording ? '#fef2f2' : 'var(--active)',
                      color: recording ? '#dc2626' : 'var(--muted)',
                      cursor: transcribing ? 'default' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, opacity: transcribing ? 0.5 : 1,
                      animation: recording ? 'recPulse 1s ease-in-out infinite' : 'none',
                    }}
                  >
                    {recording ? <StopCircle size={14} /> : <Mic size={14} />}
                  </button>
                </div>
                {(recording || transcribing) && (
                  <p style={{ fontSize: '12px', color: '#dc2626', margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#dc2626', display: 'inline-block', animation: 'recPulse 1s ease-in-out infinite' }} />
                    {transcribing ? 'Transcriberen…' : 'Opname bezig — klik stop om klaar te zijn'}
                  </p>
                )}
              </Section>

              <Section title="Herkomst" icon={<Flag size={13} />}>
                <TwoCol>
                  <LF label="Beurs / herkomst">
                    <select
                      name="source"
                      value={source}
                      onChange={e => persistSource(e.target.value)}
                      style={{ ...inp(), cursor: 'pointer' }}
                    >
                      {SOURCE_OPTIONS.map(opt => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </LF>
                  <LF label="Channel">
                    <select disabled value={CHANNEL} style={{ ...inp(), color: 'var(--label-secondary)', backgroundColor: 'var(--active)', cursor: 'not-allowed' }}>
                      <option>{CHANNEL}</option>
                    </select>
                  </LF>
                </TwoCol>
              </Section>

              <div style={{ padding: '16px 20px', backgroundColor: 'var(--surface)' }}>
                {error && <p style={{ fontSize: '12px', color: '#DC2626', marginBottom: '8px' }}>{error}</p>}
                <button type="submit" disabled={isSubmitting} style={submitBtn(isSubmitting)}>
                  {isSubmitting ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Opslaan…</> : 'Opslaan'}
                </button>
              </div>

            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Success card ────────────────────────────────────────────────

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
    <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', marginBottom: '20px' }}>
      {/* Header */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--active)', display: 'flex', alignItems: 'center', gap: '7px' }}>
        {enriching && <Loader2 size={12} color="var(--label-secondary)" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
          {enriching ? 'Kwalificeren…' : 'Lead opgeslagen ✓'}
        </span>
      </div>

      {/* Bedrijf */}
      {contact.company && (
        <CSection title="Bedrijf" icon={<Briefcase size={12} />}>
          <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>{contact.company}</span>
        </CSection>
      )}

      {/* Adres */}
      {(contact.address || contact.city) && (
        <CSection title="Adres" icon={<MapPin size={12} />}>
          {contact.address && <Val label="Straat" value={contact.address} />}
          <TwoCol>
            {contact.city     && <Val label="Stad"     value={contact.city} />}
            {contact.postcode && <Val label="Postcode" value={contact.postcode} mono />}
          </TwoCol>
        </CSection>
      )}

      {/* Contactpersoon */}
      {(contact.first_name || contact.phone) && (
        <CSection title="Contactpersoon" icon={<User size={12} />}>
          <TwoCol>
            {contact.first_name && <Val label="Voornaam"   value={contact.first_name} />}
            {contact.last_name  && <Val label="Achternaam" value={contact.last_name} />}
          </TwoCol>
          <TwoCol>
            {contact.phone && <Val label="Telefoon" value={contact.phone} mono />}
            {contact.email && <Val label="E-mail"   value={contact.email} />}
          </TwoCol>
        </CSection>
      )}

      {/* Herkomst */}
      <CSection title="Herkomst" icon={<Flag size={12} />}>
        <TwoCol>
          <Val label="Beurs / bron" value={contact.source || '—'} />
          <Val label="Channel"      value={'OFFLINE'} mono />
        </TwoCol>
      </CSection>

      {/* Classificatie */}
      <CSection title="Classificatie" icon={<Tag size={12} />}>
        <TwoCol>
          {/* Label */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--label-secondary)' }}>Label</span>
            {enriching
              ? <div style={{ height: '22px', width: '36px', borderRadius: '4px', backgroundColor: 'var(--border)', animation: 'pulse 1.4s ease-in-out infinite' }} />
              : lm && enrich?.label
                ? <span style={{ display: 'inline-flex', alignSelf: 'flex-start', fontSize: '12px', fontWeight: 700, padding: '3px 10px', borderRadius: '4px', backgroundColor: lm.bg, color: lm.text, border: `1px solid ${lm.border}`, fontFamily: MONO, letterSpacing: '0.08em' }}>{enrich.label}</span>
                : <span style={{ fontSize: '12px', color: 'var(--label-secondary)' }}>wordt bepaald…</span>
            }
          </div>
          {/* Volume */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--label-secondary)' }}>Volume</span>
            {enriching
              ? <div style={{ height: '16px', width: '60px', borderRadius: '4px', backgroundColor: 'var(--border)', animation: 'pulse 1.4s ease-in-out infinite' }} />
              : enrich?.revenue != null
                ? <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', fontFamily: MONO }}>{Number(enrich.revenue).toLocaleString('nl-NL')}</span>
                : <span style={{ fontSize: '12px', color: 'var(--label-secondary)' }}>wordt bepaald…</span>
            }
          </div>
        </TwoCol>

        {/* Toegewezen aan */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--label-secondary)' }}>Toegewezen aan</span>
          {enriching
            ? <div style={{ height: '22px', width: '100px', borderRadius: '20px', backgroundColor: 'var(--border)', animation: 'pulse 1.4s ease-in-out infinite' }} />
            : contact.assigned_to
              ? <span style={{ display: 'inline-flex', alignSelf: 'flex-start', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', backgroundColor: mc ? `${mc}18` : 'var(--active)', color: mc ?? 'var(--text)', border: `1px solid ${mc ? `${mc}40` : 'var(--border)'}`, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  {mc && <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: mc, flexShrink: 0 }} />}
                  {contact.assigned_to}
                </span>
              : <span style={{ fontSize: '12px', color: 'var(--label-secondary)' }}>wordt bepaald…</span>
          }
        </div>

        {enrich?.summary && (
          <p style={{ fontSize: '13px', lineHeight: 1.55, color: 'var(--label-secondary)', fontStyle: 'italic', margin: '6px 0 0' }}>{enrich.summary}</p>
        )}
      </CSection>

      {/* Notities */}
      {contact.notes && (
        <CSection title="Notities" icon={<FileText size={12} />}>
          <p style={{ fontSize: '14px', lineHeight: 1.55, color: 'var(--text)', margin: 0 }}>{contact.notes}</p>
        </CSection>
      )}

      {/* Actions */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <button onClick={onStartOver} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: 'none', backgroundColor: 'var(--text)', color: 'var(--surface)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px' }}>
          <RotateCcw size={13} strokeWidth={2} /> Nieuwe lead toevoegen
        </button>
        <a href="/leads" style={{ width: '100%', padding: '9px', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', fontSize: '13px', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px', textDecoration: 'none', boxSizing: 'border-box' }}>
          <ArrowUpRight size={13} strokeWidth={2} /> Bekijk alle leads
        </a>
      </div>
    </div>
  )
}

function CSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ color: 'var(--label-secondary)', display: 'flex' }}>{icon}</span>
        <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function Val({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--label-secondary)' }}>{label}</span>
      <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text)', fontFamily: mono ? MONO : F, lineHeight: 1.4 }}>{value}</span>
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ color: 'var(--text)', opacity: 0.85 }}>{icon}</span>
        <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>{title}</p>
      </div>
      {children}
    </div>
  )
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>{children}</div>
}

function LF({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', letterSpacing: '0.01em' }}>{label}</label>
      {children}
    </div>
  )
}

function inp(): React.CSSProperties {
  return { width: '100%', padding: '10px 12px', fontSize: '15px', color: 'var(--text)', backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '7px', outline: 'none', boxSizing: 'border-box' }
}

function submitBtn(disabled: boolean): React.CSSProperties {
  return { width: '100%', padding: '12px', fontSize: '14px', fontWeight: 600, borderRadius: '8px', border: 'none', backgroundColor: disabled ? 'var(--border)' : 'var(--text)', color: disabled ? 'var(--muted)' : 'var(--surface)', cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }
}
