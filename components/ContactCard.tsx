'use client'

import { Building2, MapPin, Phone, Plus, Pencil, Eye, User } from 'lucide-react'
import type { ContactFormPrefilled } from './ContactForm'

// ── Shared card base ─────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--surface)',
  border:     '1px solid var(--border)',
  borderRadius: '12px',
  overflow:   'hidden',
  fontSize:   '13px',
}

const iconBox: React.CSSProperties = {
  width: '30px', height: '30px', borderRadius: '8px',
  background: 'var(--bg)', border: '1px solid var(--border)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
}

const chip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '3px',
  fontSize: '11px', color: 'var(--muted)',
}

// ── ContactFormCard (trigger for create or update form) ──────────────────────

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
      <div style={{ ...card, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.55 }}>
        <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
          ✓ {isEdit ? 'Contact bijgewerkt' : 'Contact aangemaakt'}
        </span>
      </div>
    )
  }

  return (
    <div style={{ ...card, width: '100%', maxWidth: '340px' }}>

      {/* Header */}
      <div style={{ padding: '14px 16px 12px', background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
          <div style={iconBox}>
            <Building2 size={14} style={{ color: 'var(--muted)' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em', lineHeight: 1.3 }}>
              {company}
            </div>
            {isEdit && personStr && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                <User size={11} /> {personStr}
              </div>
            )}
          </div>
        </div>

        {/* Detail chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
          {prefilled.city && (
            <span style={chip}><MapPin size={10} /> {prefilled.city}</span>
          )}
          {!isEdit && addrStr && !prefilled.city && (
            <span style={{ ...chip, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
              <MapPin size={10} /> {addrStr}
            </span>
          )}
          {prefilled.phone && (
            <span style={chip}><Phone size={10} /> {prefilled.phone}</span>
          )}
        </div>
      </div>

      {/* CTA */}
      <div style={{ padding: '10px 16px' }}>
        <button
          onClick={onClick}
          style={{
            width: '100%', padding: '9px 12px', fontSize: '13px', fontWeight: 600,
            background: 'var(--text)', color: 'var(--surface)',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            letterSpacing: '-0.01em',
          }}
        >
          {isEdit
            ? <><Pencil size={12} /> Bijwerken</>
            : <><Plus   size={12} /> Aanmaken</>
          }
        </button>
      </div>
    </div>
  )
}

// ── ContactSelectorCards (multi-contact picker) ──────────────────────────────

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
    <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '4px', maxWidth: '100%' }}>
      {contacts.map(c => {
        const title = c.companyName || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Contact'
        const sub   = c.companyName ? [c.firstName, c.lastName].filter(Boolean).join(' ') : null

        return (
          <div key={c.contactId} style={{ ...card, minWidth: '155px', maxWidth: '175px', flexShrink: 0 }}>

            {/* Body */}
            <div style={{ padding: '12px 12px 10px' }}>
              <div style={{ ...iconBox, width: '26px', height: '26px', borderRadius: '7px', marginBottom: '8px' }}>
                <Building2 size={12} style={{ color: 'var(--muted)' }} />
              </div>
              <div style={{
                fontSize: '13px', fontWeight: 700, color: 'var(--text)', lineHeight: 1.3,
                overflow: 'hidden', display: '-webkit-box',
                WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              }}>
                {title}
              </div>
              {sub && (
                <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {sub}
                </div>
              )}
              {c.city && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px', marginTop: '6px', fontSize: '11px', color: 'var(--muted)' }}>
                  <MapPin size={9} /> {c.city}
                </div>
              )}
            </div>

            {/* Divider */}
            <div style={{ height: '1px', background: 'var(--border)' }} />

            {/* Actions */}
            <div style={{ padding: '8px 10px', display: 'flex', gap: '6px' }}>
              <button
                onClick={() => onSelect(c)}
                style={{
                  flex: 1, padding: '7px 6px', fontSize: '12px', fontWeight: 600,
                  background: 'var(--text)', color: 'var(--surface)',
                  border: 'none', borderRadius: '6px', cursor: 'pointer',
                }}
              >
                Selecteer
              </button>
              <button
                onClick={() => onView(c)}
                title="Bekijken"
                style={{
                  width: '30px', padding: '7px',
                  background: 'var(--surface)', color: 'var(--muted)',
                  border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Eye size={13} />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
