'use client'

import { MapPin, Phone, Plus, Pencil, Eye, User, Store } from 'lucide-react'
import type { ContactFormPrefilled } from './ContactForm'

// ── ContactFormCard ───────────────────────────────────────────────────────────

interface ContactFormCardProps {
  prefilled: ContactFormPrefilled
  done?:     boolean
  onClick:   () => void
}

export function ContactFormCard({ prefilled, done, onClick }: ContactFormCardProps) {
  const isEdit    = !!prefilled.contactId
  const company   = prefilled.companyName || (isEdit ? 'Contact' : 'Nieuw contact')
  const personStr = [prefilled.firstName, prefilled.lastName].filter(Boolean).join(' ')
  const addrStr   = [prefilled.address1, prefilled.city].filter(Boolean).join(', ')

  if (done) {
    return (
      <div className="bg-surface border border-border rounded-xl px-3.5 py-2.5 flex items-center gap-2 opacity-55">
        <span className="text-xs text-muted">
          ✓ {isEdit ? 'Contact bijgewerkt' : 'Contact aangemaakt'}
        </span>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden w-full max-w-[340px] text-[13px]">
      {/* Header */}
      <div className="px-4 py-3.5 bg-bg border-b border-border">
        <div className="text-sm font-bold text-primary tracking-tight leading-snug">{company}</div>
        {isEdit && personStr && (
          <div className="flex items-center gap-1 text-xs text-muted mt-0.5">
            <User size={11} /> {personStr}
          </div>
        )}
        <div className="flex flex-wrap gap-2 mt-2">
          {(addrStr || prefilled.city) && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-muted">
              <MapPin size={10} /> {addrStr || prefilled.city}
            </span>
          )}
          {prefilled.phone && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-muted"><Phone size={10} /> {prefilled.phone}</span>
          )}
          {prefilled.groothandel && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-muted"><Store size={10} /> {prefilled.groothandel}</span>
          )}
        </div>
      </div>
      {/* CTA */}
      <div className="px-4 py-2.5">
        <button onClick={onClick} className="btn-primary w-full py-2.5">
          {isEdit ? <><Pencil size={12} /> Bijwerken</> : <><Plus size={12} /> Aanmaken</>}
        </button>
      </div>
    </div>
  )
}

// ── ContactSelectorCards ──────────────────────────────────────────────────────

export interface ContactCardData {
  contactId:   string
  companyName: string | null
  firstName:   string | null
  lastName:    string | null
  city:        string | null
  phone:       string | null
  address1:    string | null
}

interface ContactSelectorCardsProps {
  contacts: ContactCardData[]
  onSelect: (contact: ContactCardData) => void
  onView:   (contact: ContactCardData) => void
}

export function ContactSelectorCards({ contacts, onSelect, onView }: ContactSelectorCardsProps) {
  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1 max-w-full">
      {contacts.map(c => {
        const title = c.companyName || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Contact'
        const sub   = c.companyName ? [c.firstName, c.lastName].filter(Boolean).join(' ') : null

        return (
          <div key={c.contactId} className="bg-surface border border-border rounded-xl overflow-hidden min-w-[155px] max-w-[175px] flex-shrink-0 text-[13px]">
            <div className="px-3 pt-3 pb-2.5 relative">
              <button
                onClick={() => onView(c)}
                title="Bekijken"
                className="absolute top-2.5 right-2.5 w-[26px] h-[26px] bg-bg border border-border rounded-md cursor-pointer flex items-center justify-center hover:bg-active transition-colors text-muted"
              >
                <Eye size={12} />
              </button>
              <div className="pr-8">
                <div className="text-[13px] font-bold text-primary leading-snug line-clamp-2">{title}</div>
                {sub && <div className="text-[11px] text-muted mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">{sub}</div>}
                {c.city && (
                  <div className="flex items-center gap-0.5 mt-1.5 text-[11px] text-muted">
                    <MapPin size={9} /> {c.city}
                  </div>
                )}
              </div>
            </div>
            <div className="h-px bg-border" />
            <div className="px-2.5 py-2">
              <button
                onClick={() => onSelect(c)}
                className="w-full py-[7px] text-xs font-semibold bg-primary text-white border-none rounded-md cursor-pointer hover:opacity-90 transition-opacity"
              >
                Selecteer
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
