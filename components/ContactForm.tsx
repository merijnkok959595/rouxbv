'use client'

import { useState } from 'react'
import { X, Check, Loader2, MapPin, Phone, Globe, User, Building2, ShoppingCart } from 'lucide-react'
import { cn }              from '@/lib/utils'
import { Field, TwoCol, FieldSection } from '@/components/ui/field'

export interface ContactFormPrefilled {
  contactId?:         string
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

const PRODUCTEN_OPTIONS = [
  'Bitterballen', 'Chorizo kroketje', 'Risottini Tomaat',
  'Risottini Truffel', 'Risottini Spinazie',
]

function GoogleBadge() {
  return (
    <span className="text-[10px] font-bold text-brand bg-brand-subtle rounded px-1.5 py-px tracking-wide ml-1.5">
      Google
    </span>
  )
}

function ToggleBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 py-2.5 text-sm font-medium rounded-lg border transition-all duration-150',
        active
          ? 'bg-brand border-brand text-white'
          : 'bg-surface border-border text-muted hover:bg-active',
      )}
    >
      {children}
    </button>
  )
}

export default function ContactForm({ prefilled = {}, onSuccess, onCancel }: ContactFormProps) {
  const [companyName,       setCompanyName]       = useState(prefilled.companyName ?? '')
  const [firstName,         setFirstName]         = useState(prefilled.firstName   ?? '')
  const [lastName,          setLastName]          = useState(prefilled.lastName    ?? '')
  const [email,             setEmail]             = useState(prefilled.email       ?? '')
  const [phone,             setPhone]             = useState(prefilled.phone       ?? '')
  const [groothandel,       setGroothandel]       = useState(prefilled.groothandel ?? '')
  const [kortingsafspraken, setKortingsafspraken] = useState<'Ja' | 'Nee' | ''>((prefilled.kortingsafspraken as 'Ja' | 'Nee') ?? '')
  const [posMateriaal,      setPosMateriaal]      = useState<'Ja' | 'Nee' | ''>((prefilled.posMateriaal as 'Ja' | 'Nee') ?? '')
  const [producten,         setProducten]         = useState<string[]>(
    prefilled.producten ? prefilled.producten.split(',').map(s => s.trim()).filter(Boolean) : []
  )
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const address1     = prefilled.address1     ?? ''
  const postalCode   = prefilled.postalCode   ?? ''
  const city         = prefilled.city         ?? ''
  const website      = prefilled.website      ?? ''
  const openingHours = prefilled.openingHours ?? ''
  const isEdit       = !!prefilled.contactId

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
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
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

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-surface border border-border rounded-xl overflow-hidden w-full max-w-[400px] shadow-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-bg">
        <span className="text-sm font-bold text-primary tracking-tight">
          {isEdit ? 'Contact bewerken' : 'Nieuw contact'}
        </span>
        {onCancel && (
          <button
            type="button" onClick={onCancel}
            className="p-1 text-muted hover:text-primary hover:bg-active rounded-md transition-colors border-none bg-transparent"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* Google prefill strip */}
      {(address1 || phone || website) && (
        <div className="px-5 py-2.5 bg-bg border-b border-border flex flex-col gap-1">
          <span className="text-[10px] font-extrabold text-brand tracking-[0.08em] uppercase">
            Gevonden via Google
          </span>
          {address1 && (
            <div className="flex items-start gap-1.5 text-xs text-muted">
              <MapPin size={11} className="mt-px text-brand flex-shrink-0" />
              <span>{address1}{postalCode || city ? `, ${[postalCode, city].filter(Boolean).join(' ')}` : ''}</span>
            </div>
          )}
          {phone && (
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <Phone size={11} className="text-brand flex-shrink-0" />
              <span>{phone}</span>
            </div>
          )}
          {website && (
            <div className="flex items-center gap-1.5 text-xs">
              <Globe size={11} className="text-brand flex-shrink-0" />
              <a href={website} target="_blank" rel="noreferrer"
                className="text-brand truncate max-w-[280px] no-underline hover:underline">
                {website.replace(/^https?:\/\//, '')}
              </a>
            </div>
          )}
          {openingHours && (
            <p className="text-[11px] text-muted leading-relaxed">
              {openingHours.replace(/,\s*/g, ' · ')}
            </p>
          )}
        </div>
      )}

      {/* Section: Bedrijf */}
      <FieldSection title="Bedrijf" icon={<Building2 size={13} />}>
        <Field label={<>Bedrijfsnaam {prefilled.companyName && <GoogleBadge />}</>} required>
          <input
            value={companyName} onChange={e => setCompanyName(e.target.value)}
            className={cn('field-input', prefilled.companyName && 'bg-active')}
            placeholder="Café de Boom" required autoFocus
          />
        </Field>
      </FieldSection>

      {/* Section: Contactpersoon */}
      <FieldSection title="Contactpersoon" icon={<User size={13} />}>
        <TwoCol>
          <Field label="Voornaam" required>
            <input value={firstName} onChange={e => setFirstName(e.target.value)}
              className="field-input" placeholder="Jan" required />
          </Field>
          <Field label="Achternaam">
            <input value={lastName} onChange={e => setLastName(e.target.value)}
              className="field-input" placeholder="Jansen" />
          </Field>
        </TwoCol>
        <Field label="E-mail">
          <input value={email} onChange={e => setEmail(e.target.value)}
            className="field-input" placeholder="jan@cafe.nl" type="email" />
        </Field>
        <Field label={<>Telefoonnummer {prefilled.phone && <GoogleBadge />}</>}>
          <input value={phone} onChange={e => setPhone(e.target.value)}
            className={cn('field-input', prefilled.phone && 'bg-active')}
            placeholder="+31612345678" type="tel" />
        </Field>
      </FieldSection>

      {/* Section: Extra */}
      <FieldSection title="Extra" icon={<ShoppingCart size={13} />}>
        <Field label="Groothandel">
          <select value={groothandel} onChange={e => setGroothandel(e.target.value)}
            className="field-input cursor-pointer">
            <option value="">— kies groothandel —</option>
            {GROOTHANDEL_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>

        <Field label="Kortingsafspraken">
          <div className="flex gap-1.5">
            {(['Ja', 'Nee'] as const).map(v => (
              <ToggleBtn key={v} active={kortingsafspraken === v}
                onClick={() => setKortingsafspraken(p => p === v ? '' : v)}>
                {v}
              </ToggleBtn>
            ))}
          </div>
        </Field>

        <Field label="POS materiaal">
          <div className="flex gap-1.5">
            {(['Ja', 'Nee'] as const).map(v => (
              <ToggleBtn key={v} active={posMateriaal === v}
                onClick={() => setPosMateriaal(p => p === v ? '' : v)}>
                {v}
              </ToggleBtn>
            ))}
          </div>
        </Field>

        <Field label="Producten">
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
            {PRODUCTEN_OPTIONS.map(p => {
              const checked = producten.includes(p)
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProducten(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2 text-left transition-colors border-none cursor-pointer',
                    checked ? 'bg-active' : 'bg-surface hover:bg-active/60',
                  )}
                >
                  <span className={cn(
                    'w-[15px] h-[15px] rounded-[4px] border flex items-center justify-center flex-shrink-0 transition-colors',
                    checked ? 'bg-brand border-brand' : 'bg-surface border-border',
                  )}>
                    {checked && <Check size={9} strokeWidth={3} className="text-white" />}
                  </span>
                  <span className={cn(
                    'text-[12.5px] leading-none',
                    checked ? 'text-primary font-medium' : 'text-muted',
                  )}>
                    {p}
                  </span>
                </button>
              )
            })}
          </div>
        </Field>
      </FieldSection>

      {/* Footer */}
      <div className="px-5 py-4 flex flex-col gap-2">
        {error && <p className="text-xs text-red-500 mb-1">{error}</p>}
        <button
          type="submit" disabled={loading}
          className="btn-primary w-full py-3"
        >
          {loading
            ? <><Loader2 size={14} className="animate-spin" /> Bezig…</>
            : <><Check size={14} /> {isEdit ? 'Bijwerken in GHL' : 'Aanmaken in GHL'}</>
          }
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={loading}
            className="w-full py-2.5 text-sm text-muted hover:text-primary bg-transparent border-none cursor-pointer transition-colors">
            Annuleren
          </button>
        )}
      </div>
    </form>
  )
}
