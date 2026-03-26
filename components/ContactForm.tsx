'use client'

import { useState } from 'react'
import { X, Check, Loader2, MapPin, Phone, Globe, User, Building2, ShoppingCart } from 'lucide-react'

export interface ContactFormPrefilled {
  contactId?:         string   // present → edit/update mode
  companyName?:       string
  firstName?:         string
  lastName?:          string
  phone?:             string
  email?:             string
  address1?:          string
  postalCode?:        string
  city?:              string
  website?:           string
  openingHours?:      string
  // custom fields (preloaded in edit mode)
  groothandel?:       string
  kortingsafspraken?: string
  posMateriaal?:      string
  producten?:         string
}

interface ContactFormProps {
  prefilled?: ContactFormPrefilled
  onSuccess?: (contactId: string, companyName: string) => void
  onCancel?:  () => void
}

const GROOTHANDEL_OPTIONS = [
  'Bidfood', 'Hanos', 'Sligro', 'Makro', 'Metro',
  'Van Toor', 'De Kweker', 'Instock', 'Eigen inkoop', 'Anders',
]

export default function ContactForm({ prefilled = {}, onSuccess, onCancel }: ContactFormProps) {
  const [companyName,       setCompanyName]       = useState(prefilled.companyName ?? '')
  const [firstName,         setFirstName]         = useState(prefilled.firstName   ?? '')
  const [lastName,          setLastName]          = useState(prefilled.lastName    ?? '')
  const [email,             setEmail]             = useState(prefilled.email       ?? '')
  const [phone,             setPhone]             = useState(prefilled.phone       ?? '')
  const [groothandel,       setGroothandel]       = useState(prefilled.groothandel       ?? '')
  const [kortingsafspraken, setKortingsafspraken] = useState<'Ja' | 'Nee' | ''>((prefilled.kortingsafspraken as 'Ja' | 'Nee') ?? '')
  const [posMateriaal,      setPosMateriaal]      = useState<'Ja' | 'Nee' | ''>((prefilled.posMateriaal      as 'Ja' | 'Nee') ?? '')
  const [producten,         setProducten]         = useState<string[]>(
    prefilled.producten ? prefilled.producten.split(',').map(s => s.trim()).filter(Boolean) : []
  )
  const [loading,           setLoading]           = useState(false)
  const [error,             setError]             = useState<string | null>(null)

  const address1     = prefilled.address1     ?? ''
  const postalCode   = prefilled.postalCode   ?? ''
  const city         = prefilled.city         ?? ''
  const website      = prefilled.website      ?? ''
  const openingHours = prefilled.openingHours ?? ''

  const isEdit = !!prefilled.contactId

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!companyName.trim()) { setError('Bedrijfsnaam is verplicht'); return }
    if (!firstName.trim())   { setError('Voornaam is verplicht');     return }
    setLoading(true); setError(null)
    try {
      const payload = {
        companyName, firstName,
        lastName:    lastName    || undefined,
        email:       email       || undefined,
        phone:       phone       || undefined,
        address1, postalCode, city, website, openingHours,
        groothandel:       groothandel       || undefined,
        kortingsafspraken: kortingsafspraken || undefined,
        posMateriaal:      posMateriaal      || undefined,
        producten:         producten.length > 0 ? producten.join(', ') : undefined,
      }
      const url = isEdit ? `/api/contact-update/${prefilled.contactId}` : '/api/contact-create'
      const res  = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? (isEdit ? 'Fout bij bijwerken' : 'Fout bij aanmaken'))
      onSuccess?.(isEdit ? prefilled.contactId! : data.contactId, companyName)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onbekende fout')
    } finally {
      setLoading(false)
    }
  }

  // Beurs-form style helpers
  const inp = (prefilled = false): React.CSSProperties => ({
    width: '100%', padding: '10px 12px', fontSize: '14px',
    color: 'var(--text)', backgroundColor: prefilled ? 'var(--active)' : 'var(--surface)',
    border: '1px solid var(--border)', borderRadius: '7px',
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  })
  const lbl: React.CSSProperties = {
    fontSize: '13px', fontWeight: 700, color: 'var(--text)', letterSpacing: '0.01em',
  }
  const toggleBtn = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '10px 0', fontSize: '14px', fontWeight: 500,
    border: `1px solid ${active ? 'var(--brand)' : 'var(--border)'}`,
    borderRadius: '7px', cursor: 'pointer', transition: 'all 0.15s',
    background: active ? 'var(--brand)' : 'var(--surface)',
    color: active ? '#fff' : 'var(--muted)',
  })

  const googleBadge = (
    <span style={{
      fontSize: '10px', fontWeight: 700, color: 'var(--brand)',
      background: 'var(--brand-subtle)', borderRadius: '4px',
      padding: '1px 5px', letterSpacing: '0.03em', marginLeft: '6px',
    }}>
      Google
    </span>
  )

  return (
    <form onSubmit={handleSubmit} style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: '12px', overflow: 'hidden', width: '100%', maxWidth: '400px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
    }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg)',
      }}>
        <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          {isEdit ? 'Contact bewerken' : 'Nieuw contact'}
        </span>
        {onCancel && (
          <button type="button" onClick={onCancel} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
            color: 'var(--muted)', display: 'flex', borderRadius: '5px',
          }}>
            <X size={15} />
          </button>
        )}
      </div>

      {/* Google prefill strip */}
      {(address1 || phone || website) && (
        <div style={{
          padding: '10px 20px', background: 'var(--bg)',
          borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '5px',
        }}>
          <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--brand)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Gevonden via Google
          </span>
          {address1 && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '12px', color: 'var(--muted)' }}>
              <MapPin size={11} style={{ marginTop: '1px', color: 'var(--brand)', flexShrink: 0 }} />
              <span>{address1}{postalCode || city ? `, ${[postalCode, city].filter(Boolean).join(' ')}` : ''}</span>
            </div>
          )}
          {phone && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--muted)' }}>
              <Phone size={11} style={{ color: 'var(--brand)', flexShrink: 0 }} />
              <span>{phone}</span>
            </div>
          )}
          {website && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
              <Globe size={11} style={{ color: 'var(--brand)', flexShrink: 0 }} />
              <a href={website} target="_blank" rel="noreferrer" style={{
                color: 'var(--brand)', textDecoration: 'none',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '280px',
              }}>
                {website.replace(/^https?:\/\//, '')}
              </a>
            </div>
          )}
          {openingHours && (
            <div style={{ fontSize: '11px', color: 'var(--muted)', lineHeight: 1.5 }}>
              {openingHours.replace(/,\s*/g, ' · ')}
            </div>
          )}
        </div>
      )}

      {/* ── Section: Bedrijf & Contactpersoon ── */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Building2 size={13} style={{ color: 'var(--text)', opacity: 0.7 }} />
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Bedrijf</span>
        </div>

        {/* Bedrijfsnaam */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={lbl}>
            Bedrijfsnaam *
            {prefilled.companyName && googleBadge}
          </label>
          <input
            value={companyName} onChange={e => setCompanyName(e.target.value)}
            style={inp(!!prefilled.companyName)} placeholder="Café de Boom" required autoFocus
          />
        </div>
      </div>

      {/* ── Section: Contactpersoon ── */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <User size={13} style={{ color: 'var(--text)', opacity: 0.7 }} />
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Contactpersoon</span>
        </div>

        {/* Voornaam + Achternaam */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={lbl}>Voornaam *</label>
            <input value={firstName} onChange={e => setFirstName(e.target.value)}
              style={inp()} placeholder="Jan" required />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ ...lbl, color: 'var(--muted)' }}>Achternaam</label>
            <input value={lastName} onChange={e => setLastName(e.target.value)}
              style={inp()} placeholder="Jansen" />
          </div>
        </div>

        {/* E-mail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ ...lbl, color: 'var(--muted)' }}>E-mail</label>
          <input value={email} onChange={e => setEmail(e.target.value)}
            style={inp()} placeholder="jan@cafe.nl" type="email" />
        </div>

        {/* Telefoon */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ ...lbl, color: 'var(--muted)' }}>
            Telefoonnummer
            {prefilled.phone && googleBadge}
          </label>
          <input value={phone} onChange={e => setPhone(e.target.value)}
            style={inp(!!prefilled.phone)} placeholder="+31612345678" type="tel" />
        </div>
      </div>

      {/* ── Section: Extra ── */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ShoppingCart size={13} style={{ color: 'var(--text)', opacity: 0.7 }} />
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Extra</span>
        </div>

        {/* Groothandel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ ...lbl, color: 'var(--muted)' }}>Groothandel</label>
          <select value={groothandel} onChange={e => setGroothandel(e.target.value)}
            style={{ ...inp(), cursor: 'pointer' }}>
            <option value="">— kies groothandel —</option>
            {GROOTHANDEL_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>

        {/* Kortingsafspraken */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ ...lbl, color: 'var(--muted)' }}>Kortingsafspraken</label>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(['Ja', 'Nee'] as const).map(v => (
              <button key={v} type="button"
                onClick={() => setKortingsafspraken(p => p === v ? '' : v)}
                style={toggleBtn(kortingsafspraken === v)}>
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* POS materiaal */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ ...lbl, color: 'var(--muted)' }}>POS materiaal</label>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(['Ja', 'Nee'] as const).map(v => (
              <button key={v} type="button"
                onClick={() => setPosMateriaal(p => p === v ? '' : v)}
                style={toggleBtn(posMateriaal === v)}>
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Producten */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ ...lbl, color: 'var(--muted)' }}>Producten</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {['Bitterballen', 'Chorizo kroketje', 'Risottini Tomaat', 'Risottini Truffel', 'Risottini Spinazie'].map(p => {
              const active = producten.includes(p)
              return (
                <button key={p} type="button"
                  onClick={() => setProducten(prev => active ? prev.filter(x => x !== p) : [...prev, p])}
                  style={toggleBtn(active)}>
                  {p}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {error && (
          <p style={{ fontSize: '12px', color: '#DC2626', margin: '0 0 4px' }}>{error}</p>
        )}
        <button type="submit" disabled={loading} style={{
          width: '100%', padding: '12px', fontSize: '14px', fontWeight: 600,
          border: 'none', borderRadius: '8px', cursor: loading ? 'default' : 'pointer',
          background: loading ? 'var(--border)' : 'var(--text)', color: loading ? 'var(--muted)' : 'var(--surface)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
        }}>
          {loading
            ? <><Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> Bezig…</>
            : <><Check size={14} /> {isEdit ? 'Bijwerken in GHL' : 'Aanmaken in GHL'}</>
          }
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={loading} style={{
            width: '100%', padding: '10px', fontSize: '13px', fontWeight: 500,
            border: 'none', borderRadius: '8px', cursor: 'pointer', background: 'none',
            color: 'var(--muted)',
          }}>
            Annuleren
          </button>
        )}
      </div>
    </form>
  )
}
