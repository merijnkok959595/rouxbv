'use client'

import { FileText, CheckSquare, Calendar, Phone, MapPin, TrendingUp, User } from 'lucide-react'

const MONO = "'SF Mono','Fira Code',monospace"

const LABEL_META: Record<string, { bg: string; text: string; border: string; title: string }> = {
  A: { bg: 'rgba(220,38,38,0.08)',  text: '#DC2626', border: 'rgba(220,38,38,0.2)',  title: 'Top prospect'     },
  B: { bg: 'rgba(217,119,6,0.08)',  text: '#D97706', border: 'rgba(217,119,6,0.2)',  title: 'Goede kans'       },
  C: { bg: 'rgba(37,99,235,0.08)',  text: '#2563EB', border: 'rgba(37,99,235,0.2)',  title: 'Gemiddeld'        },
  D: { bg: 'rgba(22,163,74,0.08)',  text: '#16A34A', border: 'rgba(22,163,74,0.2)',  title: 'Lage prioriteit'  },
}

export interface BriefingData {
  contactId:   string
  contactName: string
  contact: {
    companyName: string | null
    firstName:   string | null
    lastName:    string | null
    phone:       string | null
    city:        string | null
  }
  classification: {
    label:      string | null
    revenue:    number | null
    assignedTo: string | null
    color:      string | null
  } | null
  rawNotes:        { createdAt: string; body: string }[]
  rawTasks:        { dueDate: string; title: string; body?: string }[]
  rawAppointments: { startTime: string; title: string }[]
  stats: { notes: number; openTasks: number; appointments: number }
}

function nlDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', timeZone: 'Europe/Amsterdam' }) }
  catch { return iso }
}
function nlTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }) }
  catch { return '' }
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ color: 'var(--muted)', display: 'flex' }}>{icon}</span>
        <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

export default function BriefingCard({ data }: { data: BriefingData }) {
  const { contact, classification, rawNotes, rawTasks, rawAppointments, stats } = data
  const lm = classification?.label ? LABEL_META[classification.label] : null

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: '12px', overflow: 'hidden', width: '100%', maxWidth: '420px',
      fontSize: '13px',
    }}>

      {/* Header */}
      <div style={{ padding: '12px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          {contact.companyName ?? data.contactName}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px', flexWrap: 'wrap' }}>
          {contact.firstName && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--muted)' }}>
              <User size={11} /> {[contact.firstName, contact.lastName].filter(Boolean).join(' ')}
            </span>
          )}
          {contact.city && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--muted)' }}>
              <MapPin size={11} /> {contact.city}
            </span>
          )}
          {contact.phone && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--muted)' }}>
              <Phone size={11} /> {contact.phone}
            </span>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid var(--border)' }}>
        {[
          { label: 'Notities',  value: stats.notes,        icon: <FileText    size={12} /> },
          { label: 'Taken',     value: stats.openTasks,    icon: <CheckSquare size={12} /> },
          { label: 'Afspraken', value: stats.appointments, icon: <Calendar    size={12} /> },
        ].map(({ label, value, icon }) => (
          <div key={label} style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '2px', borderRight: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--muted)' }}>{icon}</div>
            <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{value}</span>
            <span style={{ fontSize: '10px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Classification (only when Supabase data found) */}
      {classification && (lm || classification.revenue || classification.assignedTo) && (
        <Section icon={<TrendingUp size={12} />} title="Classificatie">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {/* Label badge */}
            {lm && classification.label && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--muted)' }}>Label</span>
                <span title={lm.title} style={{
                  display: 'inline-flex', alignItems: 'center', fontSize: '12px', fontWeight: 700,
                  padding: '3px 10px', borderRadius: '5px',
                  background: lm.bg, color: lm.text, border: `1px solid ${lm.border}`,
                  fontFamily: MONO, letterSpacing: '0.08em', cursor: 'help',
                }}>
                  {classification.label}
                </span>
              </div>
            )}

            {/* Revenue */}
            {classification.revenue != null && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--muted)' }}>Volume</span>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', fontFamily: MONO }}>
                  {Number(classification.revenue).toLocaleString('nl-NL')}
                </span>
              </div>
            )}

            {/* Assigned to */}
            {classification.assignedTo && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--muted)' }}>Toegewezen aan</span>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px',
                  background: classification.color ? `${classification.color}18` : 'var(--active)',
                  color:      classification.color ?? 'var(--text)',
                  border:     `1px solid ${classification.color ? `${classification.color}40` : 'var(--border)'}`,
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                }}>
                  {classification.color && (
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: classification.color, flexShrink: 0 }} />
                  )}
                  {classification.assignedTo}
                </span>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Recent notes */}
      {rawNotes.length > 0 && (
        <Section icon={<FileText size={12} />} title="Recente notities">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {rawNotes.map((n, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0, paddingTop: '1px' }}>
                  {nlDate(n.createdAt)}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--text)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {n.body}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {rawNotes.length === 0 && (
        <Section icon={<FileText size={12} />} title="Recente notities">
          <span style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic' }}>Geen notities gevonden.</span>
        </Section>
      )}

      {/* Open tasks */}
      {rawTasks.length > 0 && (
        <Section icon={<CheckSquare size={12} />} title="Open taken">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {rawTasks.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0, paddingTop: '2px' }}>
                  {nlDate(t.dueDate)}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--text)', lineHeight: 1.5 }}>
                  <strong>{t.title}</strong>{t.body ? ` — ${t.body}` : ''}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Upcoming appointments */}
      {rawAppointments.length > 0 && (
        <Section icon={<Calendar size={12} />} title="Aankomende afspraken">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {rawAppointments.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {nlDate(a.startTime)} {nlTime(a.startTime)}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--text)' }}>{a.title}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

    </div>
  )
}
