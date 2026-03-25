'use client'

import { useRef, useState } from 'react'
import { Briefcase, User, Phone, MapPin, Tag, FileText, RotateCcw, Zap, Loader2, ArrowUpRight } from 'lucide-react'
import PlacesCompanyInput, { type PlaceResult } from '@/components/PlacesCompanyInput'

const MONO = "'SF Mono','Fira Code',monospace"
const F    = "'Inter',-apple-system,sans-serif"
const YEAR = new Date().getFullYear()
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
}
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
  const [country,      setCountry]      = useState('')
  const [openingHours, setOpeningHours] = useState<PlaceResult['opening_hours']>(null)
  const [source,       setSource]       = useState(`Overig`)

  function handlePlaceSelect(p: PlaceResult) {
    setAddress(p.address); setCity(p.city); setPostcode(p.postcode)
    setCountry(p.country); setOpeningHours(p.opening_hours)
  }

  function startOver() {
    formRef.current?.reset()
    setAddress(''); setCity(''); setPostcode(''); setCountry('')
    setOpeningHours(null); setError(null)
    setSavedContact(null); setEnrichResult(null); setPhase('idle')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formRef.current) return
    setError(null)
    const fd = new FormData(formRef.current)
    const body = {
      company:       fd.get('company')    as string,
      first_name:    fd.get('first_name') as string,
      last_name:     fd.get('last_name')  as string,
      email:         fd.get('email')      as string,
      phone:         fd.get('phone')      as string,
      address, city, postcode, country,
      opening_hours: openingHours,
      assigned_to:   fd.get('assigned_to') as string,
      status:        fd.get('status')      as string,
      notes:         fd.get('notes')       as string,
      source, channel: CHANNEL,
    }

    try {
      setPhase('saving')
      const res = await fetch('/api/formulier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Fout bij opslaan')

      setSavedContact({ id: data.id, assigned_to: data.assigned_to, source, ...body, contact_type: body.status || 'lead', opening_hours: openingHours })
      formRef.current.reset()
      setAddress(''); setCity(''); setPostcode(''); setCountry(''); setOpeningHours(null)

      // Now poll for enrich result
      setPhase('enriching')
      try {
        const orgId = '' // enrich is fire-and-forget on server; optionally poll here
        void orgId // suppress unused warning
        // Optimistic: wait 3s then show done
        await new Promise(r => setTimeout(r, 3000))
        setEnrichResult({ label: null, revenue: null, summary: null })
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
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: '520px', padding: '32px 16px 64px' }}>

          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em', margin: '0 0 6px' }}>
              Beurs formulier
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
              Intake formulier voor nieuwe beurs leads
            </p>
          </div>

          {showResult && savedContact && (
            <SuccessCard phase={phase} contact={savedContact} enrich={enrichResult} onStartOver={startOver} />
          )}

          <div style={{ display: showResult ? 'none' : 'block' }}>
            <form ref={formRef} onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>

              <Section title="Bedrijf" icon={<Briefcase size={13} />}>
                <div>
                  <PlacesCompanyInput required autoFocus onSelect={handlePlaceSelect} inputStyle={inp()} placeholder="bijv. Grand Café De Hoorn BV" />
                  <p style={{ fontSize: '10px', color: 'var(--subtle)', marginTop: '5px', marginBottom: 0 }}>
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
                  <div style={{ position: 'relative' }}>
                    <Phone size={12} color="var(--subtle)" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                    <input name="phone" type="tel" required placeholder="+31 6 12 34 56 78" style={{ ...inp(), paddingLeft: 28 }} />
                  </div>
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
                      <option value="customer">Customer</option>
                    </select>
                  </LF>
                </TwoCol>
              </Section>

              <Section title="Notities" icon={<FileText size={13} />}>
                <textarea name="notes" rows={4} placeholder="Interesse in… Opening gepland op… Bijzonderheden…" style={{ ...inp(), resize: 'vertical', lineHeight: 1.6 }} />
              </Section>

              <Section title="Herkomst" icon={<Zap size={13} />}>
                <TwoCol>
                  <LF label="Source">
                    <input value={source} onChange={e => setSource(e.target.value)} placeholder={`Beurs ${YEAR}`} style={inp()} />
                  </LF>
                  <LF label="Channel">
                    <select disabled value={CHANNEL} style={{ ...inp(), color: '#9CA3AF', backgroundColor: 'var(--active)', cursor: 'not-allowed' }}>
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

function SuccessCard({ phase, contact, enrich, onStartOver }: {
  phase: Phase; contact: SavedContact; enrich: EnrichResult | null; onStartOver: () => void
}) {
  const enriching = phase === 'enriching'
  const lm = enrich?.label ? LABEL_META[enrich.label] : null
  return (
    <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', marginBottom: '20px' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--active)', display: 'flex', alignItems: 'center', gap: '7px' }}>
        {enriching && <Loader2 size={12} color="var(--subtle)" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>
          {enriching ? 'Kwalificeren…' : 'Lead opgeslagen ✓'}
        </span>
        <span style={{ fontSize: '11px', color: 'var(--subtle)', fontFamily: MONO, marginLeft: 'auto' }}>{contact.source}</span>
      </div>

      {contact.company && (
        <CSection title="Bedrijf" icon={<Briefcase size={12} />}>
          <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>{contact.company}</span>
        </CSection>
      )}

      {(contact.address || contact.city) && (
        <CSection title="Adres" icon={<MapPin size={12} />}>
          {contact.address && <Val label="Straat" value={contact.address} />}
          <TwoCol>
            {contact.city     && <Val label="Stad"     value={contact.city} />}
            {contact.postcode && <Val label="Postcode" value={contact.postcode} mono />}
          </TwoCol>
        </CSection>
      )}

      {(contact.first_name || contact.phone) && (
        <CSection title="Contactpersoon" icon={<User size={12} />}>
          <TwoCol>
            {contact.first_name && <Val label="Voornaam"  value={contact.first_name} />}
            {contact.last_name  && <Val label="Achternaam" value={contact.last_name} />}
          </TwoCol>
          <TwoCol>
            {contact.phone && <Val label="Telefoon" value={contact.phone} mono />}
            {contact.email && <Val label="E-mail"   value={contact.email} />}
          </TwoCol>
        </CSection>
      )}

      <CSection title="Classificatie" icon={<Tag size={12} />}>
        <TwoCol>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '10px', fontWeight: 500, color: 'var(--subtle)' }}>Label</span>
            {enriching
              ? <div style={{ height: '20px', width: '32px', borderRadius: '4px', backgroundColor: 'var(--border)', animation: 'pulse 1.4s ease-in-out infinite' }} />
              : lm && enrich?.label
                ? <span style={{ display: 'inline-flex', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', backgroundColor: lm.bg, color: lm.text, border: `1px solid ${lm.border}`, fontFamily: MONO, letterSpacing: '0.08em' }}>{enrich.label}</span>
                : <span style={{ fontSize: '11px', color: 'var(--subtle)' }}>wordt bepaald…</span>
            }
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '10px', fontWeight: 500, color: 'var(--subtle)' }}>Verwacht omzet</span>
            {enriching
              ? <div style={{ height: '16px', width: '60px', borderRadius: '4px', backgroundColor: 'var(--border)', animation: 'pulse 1.4s ease-in-out infinite' }} />
              : enrich?.revenue != null
                ? <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', fontFamily: MONO }}>€{Number(enrich.revenue).toLocaleString('nl-NL')}</span>
                : <span style={{ fontSize: '11px', color: 'var(--subtle)' }}>wordt bepaald…</span>
            }
          </div>
        </TwoCol>
        {enrich?.summary && (
          <p style={{ fontSize: '11px', lineHeight: 1.65, color: 'var(--subtle)', fontStyle: 'italic', margin: '4px 0 0' }}>{enrich.summary}</p>
        )}
      </CSection>

      {contact.notes && (
        <CSection title="Notities" icon={<FileText size={12} />}>
          <p style={{ fontSize: '12px', lineHeight: 1.6, color: 'var(--muted)', margin: 0 }}>{contact.notes}</p>
        </CSection>
      )}

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <button onClick={onStartOver} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: 'none', backgroundColor: 'var(--text)', color: 'var(--surface)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px' }}>
          <RotateCcw size={13} strokeWidth={2} /> Nieuwe lead toevoegen
        </button>
        {contact.id && (
          <a href={`${process.env.NEXT_PUBLIC_APP_URL ?? ''}/dashboard/contacts/${contact.id}`} target="_blank" rel="noreferrer" style={{ width: '100%', padding: '9px', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', fontSize: '13px', fontWeight: 500, color: 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px', textDecoration: 'none', boxSizing: 'border-box' }}>
            <ArrowUpRight size={13} strokeWidth={2} /> Contact bekijken
          </a>
        )}
      </div>
    </div>
  )
}

function CSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ color: 'var(--subtle)', display: 'flex' }}>{icon}</span>
        <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function Val({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <span style={{ fontSize: '10px', fontWeight: 500, color: 'var(--subtle)' }}>{label}</span>
      <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text)', fontFamily: mono ? MONO : F, lineHeight: 1.4 }}>{value}</span>
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ color: 'var(--muted)' }}>{icon}</span>
        <p style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>{title}</p>
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
      <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', opacity: 0.65 }}>{label}</label>
      {children}
    </div>
  )
}

function inp(): React.CSSProperties {
  return { width: '100%', padding: '8px 10px', fontSize: '13px', color: 'var(--text)', backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '7px', outline: 'none', boxSizing: 'border-box' }
}

function submitBtn(disabled: boolean): React.CSSProperties {
  return { width: '100%', padding: '12px', fontSize: '14px', fontWeight: 600, borderRadius: '8px', border: 'none', backgroundColor: disabled ? 'var(--border)' : 'var(--text)', color: disabled ? 'var(--muted)' : 'var(--surface)', cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }
}
