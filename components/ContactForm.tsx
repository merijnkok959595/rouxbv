'use client'

import { useState } from 'react'
import { X, Check, Loader2, MapPin, Phone, Globe, User, Building2, ShoppingCart, Tag } from 'lucide-react'
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
  klantType?:         string   // 'Lead' | 'Klant'
}

interface ContactFormProps {
  prefilled?: ContactFormPrefilled
  onSuccess?: (contactId: string, companyName: string) => void
  onCancel?:  () => void
}

// Full groothandel list — synced with GHL custom field options
export const GROOTHANDEL_OPTIONS: string[] = [
  // Bidfood
  'Bidfood Amsterdam', 'Bidfood Den Haag', 'Bidfood Drachten', 'Bidfood Ede', 'Bidfood Emmen',
  'Bidfood Geleen', 'Bidfood Goirle', 'Bidfood Groningen', 'Bidfood Harderwijk', 'Bidfood Helmond',
  'Bidfood Hengelo', 'Bidfood Hoofddorp', 'Bidfood Nieuwegein', 'Bidfood Rogat', 'Bidfood Schiedam',
  'Bidfood Utrecht', 'Bidfood Zierikzee',
  // Hanos
  'Hanos Ameland', 'Hanos Amsterdam', 'Hanos Antwerpen', 'Hanos Apeldoorn', 'Hanos Den Haag-Delft',
  'Hanos Doetinchem', 'Hanos Eindhoven', 'Hanos Groningen', 'Hanos Haarlem', 'Hanos Hasselt',
  'Hanos Heereveen', 'Hanos Heerlen', 'Hanos Hengelo', 'Hanos ISPC Breda', 'Hanos ISPC Utrecht Nieuwegein',
  'Hanos Maastricht', 'Hanos Nijmegen', 'Hanos Texel', 'Hanos Venlo', 'Hanos Zwolle',
  // Sligro
  "Sligro 's Hertogenbosch", 'Sligro Alkmaar', 'Sligro Almelo', 'Sligro Almere', 'Sligro Amersfoort',
  'Sligro Amsterdam', 'Sligro Apeldoorn', 'Sligro Arnhem', 'Sligro Assen', 'Sligro Bergen op Zoom',
  'Sligro Breda', 'Sligro De Kweker Purmerend', 'Sligro Den Haag Forepark', 'Sligro Den Haag Kerketuinen',
  'Sligro Deventer', 'Sligro Doetichem', 'Sligro Drachten', 'Sligro Eindhoven', 'Sligro Emmen',
  'Sligro Enschede', 'Sligro Goes', 'Sligro Gorichem', 'Sligro Gouda', 'Sligro Groningen',
  'Sligro Haarlem', 'Sligro Heerlen', 'Sligro Helmond', 'Sligro Hilversum', 'Sligro Leeuwarden',
  'Sligro Leiden', 'Sligro Maastricht', 'Sligro Nieuwegein', 'Sligro Nijmegen', 'Sligro Roermond',
  'Sligro Roosendaal', 'Sligro Rotterdam Spaanse Polder', 'Sligro Rotterdam-Zuid', 'Sligro Sittard',
  'Sligro Sluis', 'Sligro Terneuzen', 'Sligro Texel', 'Sligro Tiel', 'Sligro Tilburg',
  'Sligro Utrecht-Cartesiusweg', 'Sligro Veghel', 'Sligro Venlo', 'Sligro Vlissingen',
  'Sligro Weert', 'Sligro Zwolle',
  // VHC
  'VHC Jongens Oostzaan', 'VHC Jongens Texel', 'VHC Jongens Almere', 'VHC Actifood Oosterwolde',
  'VHC Kreko Moerdijk', 'VHC Kreko Ede', 'VHC Kreko Goes', 'VHC Kreko Hellevoetsluis',
  'VHC Kreko Pijnacker', 'VHC Kreko Geldermalsen', 'VHC Van der Star',
  // Makro / Metro / overige groten
  'Makro', 'Metro',
  // Overig
  'ABZ Anloo BV', 'Broekhuyzen Horecagroothandel Noordwijk', 'Brouwer Horeca',
  'Chefs Culinair Nijmegen', 'Combigro Helmink Foodservice', 'De Groot Edelgebak',
  'De Jong Diepvries BV', 'De Kweker', 'DG Grootverbruik Den Hoorn',
  'Fontijn vlees en vleeswaren', 'Foodpartners BV', 'Froster BV Waalwijk',
  'Haymana Groothandel', 'Hoka Foodservice Den Haag', 'Horeca Groothandel Tilburg',
  'Horeca Groothandel Waddinxveen', 'Horesca Lieferink Goirle', 'Horesca Lieferink Leiderdorp',
  'Horesca Lieferink Meppel', 'Horesca Lieferink Raamsdonkveer', 'Horesca Lieferink Twello',
  'Horesca Lieferink Zeist', 'Howa Foodservice BV', 'Huize Horeca Beverwijk',
  'Instock', 'Jansen Foodservice Apeldoorn', 'Jansen Foodservice Doetichem',
  'Jansen Foodservice Lochem', 'JR Food', 'Keijzers Horecaservice', 'Krikke',
  'MarSchee Helmond', "Palvé Heerhugowaard", "Palvé Leeuwarden",
  'QSTA BV', 'Robben Horeca BV', 'Schiava Groningen', 'V&S Horeca',
  'Van Der Wee Grootverbruik', 'Van Rijsingen Diepvries Deurne', 'Van Rijsingen Diepvries Helmond',
  'Van Rijsingen Diepvries Veghel', 'Van Toor', 'Veldboer Eenhoorn', 'Verhage Foodservice BV',
  // Generiek
  'Eigen inkoop', 'Anders',
]

const PRODUCTEN_OPTIONS = [
  'Bitterballen', 'Chorizo kroketje', 'Risottini Tomaat',
  'Risottini Truffel', 'Risottini Spinazie',
]

function GoogleBadge() {
  return (
    <span className="text-[10px] font-semibold text-muted bg-active border border-border rounded px-1.5 py-px tracking-wide ml-1.5">
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
          ? 'bg-primary border-primary text-white'
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
  const [address1,          setAddress1]          = useState(prefilled.address1    ?? '')
  const [postalCode,        setPostalCode]        = useState(prefilled.postalCode  ?? '')
  const [city,              setCity]              = useState(prefilled.city        ?? '')
  const [groothandel,       setGroothandel]       = useState(prefilled.groothandel ?? '')
  const [klantType,         setKlantType]         = useState<'Lead' | 'Klant' | ''>(
    (prefilled.klantType as 'Lead' | 'Klant') ?? '',
  )
  const [kortingsafspraken, setKortingsafspraken] = useState<'Ja' | 'Nee' | ''>((prefilled.kortingsafspraken as 'Ja' | 'Nee') ?? '')
  const [posMateriaal,      setPosMateriaal]      = useState<'Ja' | 'Nee' | ''>((prefilled.posMateriaal as 'Ja' | 'Nee') ?? '')
  const [producten,         setProducten]         = useState<string[]>(
    prefilled.producten ? prefilled.producten.split(',').map(s => s.trim()).filter(Boolean) : []
  )
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const website      = prefilled.website      ?? ''
  const openingHours = prefilled.openingHours ?? ''
  const isEdit       = !!prefilled.contactId

  // Show Google strip if new contact was Google-enriched
  const hasGoogleData = !isEdit && (prefilled.address1 || prefilled.phone || prefilled.website)

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
        address1:    address1    || undefined,
        postalCode:  postalCode  || undefined,
        city:        city        || undefined,
        website:     website     || undefined,
        openingHours: openingHours || undefined,
        klantType:         klantType         || undefined,
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

      {/* Google prefill strip — only for new contacts */}
      {hasGoogleData && (
        <div className="px-5 py-2.5 bg-bg border-b border-border flex flex-col gap-1">
          <span className="text-[10px] font-extrabold text-primary tracking-[0.08em] uppercase">
            Gevonden via Google
          </span>
          {prefilled.address1 && (
            <div className="flex items-start gap-1.5 text-xs text-muted">
              <MapPin size={11} className="mt-px text-secondary flex-shrink-0" />
              <span>{prefilled.address1}{(prefilled.postalCode || prefilled.city) ? `, ${[prefilled.postalCode, prefilled.city].filter(Boolean).join(' ')}` : ''}</span>
            </div>
          )}
          {prefilled.phone && (
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <Phone size={11} className="text-secondary flex-shrink-0" />
              <span>{prefilled.phone}</span>
            </div>
          )}
          {website && (
            <div className="flex items-center gap-1.5 text-xs">
              <Globe size={11} className="text-secondary flex-shrink-0" />
              <a href={website} target="_blank" rel="noreferrer"
                className="text-primary underline underline-offset-2 truncate max-w-[280px]">
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

      {/* Section: Type */}
      <FieldSection title="Type" icon={<Tag size={13} />}>
        <Field label="Klant type" required>
          <div className="flex gap-1.5">
            {(['Lead', 'Klant'] as const).map(v => (
              <ToggleBtn key={v} active={klantType === v}
                onClick={() => setKlantType(p => p === v ? '' : v)}>
                {v}
              </ToggleBtn>
            ))}
          </div>
        </Field>
      </FieldSection>

      {/* Section: Bedrijf */}
      <FieldSection title="Bedrijf" icon={<Building2 size={13} />}>
        <Field label={<>Bedrijfsnaam {prefilled.companyName && !isEdit && <GoogleBadge />}</>} required>
          <input
            value={companyName} onChange={e => setCompanyName(e.target.value)}
            className={cn('field-input', prefilled.companyName && !isEdit && 'bg-active')}
            placeholder="Café de Boom" required autoFocus
          />
        </Field>
        <Field label={<>Adres {prefilled.address1 && !isEdit && <GoogleBadge />}</>}>
          <input
            value={address1} onChange={e => setAddress1(e.target.value)}
            className={cn('field-input', prefilled.address1 && !isEdit && 'bg-active')}
            placeholder="Hoofdstraat 1"
          />
        </Field>
        <TwoCol>
          <Field label="Postcode">
            <input value={postalCode} onChange={e => setPostalCode(e.target.value)}
              className={cn('field-input', prefilled.postalCode && !isEdit && 'bg-active')}
              placeholder="1234 AB" />
          </Field>
          <Field label="Stad">
            <input value={city} onChange={e => setCity(e.target.value)}
              className={cn('field-input', prefilled.city && !isEdit && 'bg-active')}
              placeholder="Amsterdam" />
          </Field>
        </TwoCol>
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
        <Field label={<>Telefoonnummer {prefilled.phone && !isEdit && <GoogleBadge />}</>}>
          <input value={phone} onChange={e => setPhone(e.target.value)}
            className={cn('field-input', prefilled.phone && !isEdit && 'bg-active')}
            placeholder="+31612345678" type="tel" />
        </Field>
      </FieldSection>

      {/* Section: Extra */}
      <FieldSection title="Extra" icon={<ShoppingCart size={13} />}>
        <Field label="Groothandel">
          {/* datalist = free text + autocomplete for all GHL options */}
          <input
            value={groothandel}
            onChange={e => setGroothandel(e.target.value)}
            list="groothandel-list"
            className="field-input"
            placeholder="Typ of kies groothandel…"
            autoComplete="off"
          />
          <datalist id="groothandel-list">
            {GROOTHANDEL_OPTIONS.map(g => <option key={g} value={g} />)}
          </datalist>
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
                    checked ? 'bg-primary border-primary' : 'bg-surface border-border',
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
