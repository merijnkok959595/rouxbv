'use client'

import { useEffect, useState, useMemo } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'

const MONO = "'SF Mono','Fira Code',ui-monospace,monospace"

const LABEL_STYLE: Record<string, { bg: string; color: string }> = {
  A: { bg: 'rgba(220,38,38,0.08)',  color: '#DC2626' },
  B: { bg: 'rgba(217,119,6,0.08)',  color: '#D97706' },
  C: { bg: 'rgba(37,99,235,0.08)',  color: '#2563EB' },
  D: { bg: 'rgba(22,163,74,0.08)',  color: '#16A34A' },
}

const TYPE_META: Record<string, { bg: string; color: string; label: string }> = {
  lead:     { bg: 'rgba(124,58,237,0.08)',  color: '#7C3AED', label: 'Lead'       },
  customer: { bg: 'rgba(22,163,74,0.08)',   color: '#16A34A', label: 'Klant'      },
  employee: { bg: 'rgba(245,158,11,0.08)',  color: '#D97706', label: 'Medewerker' },
}

type Lead = {
  id:           string
  company_name: string | null
  city:         string | null
  type:         string | null
  label:        string | null
  revenue:      number | null
  assigned_to:  string | null
  source:       string | null
  whatsapp:     boolean | null
  ghl_synced:   boolean | null
  created_at:   string | null
}

type TeamMember = { id: string; naam: string; color: string | null }
type Stats      = { total: number; highPotential: number; today: number }
type DateFilter = 'all' | 'today' | 'week' | 'month'

const DATE_FILTERS: { key: DateFilter; label: string }[] = [
  { key: 'all',   label: 'Alles'    },
  { key: 'today', label: 'Vandaag'  },
  { key: 'week',  label: 'Week'     },
  { key: 'month', label: 'Maand'    },
]

const TH: React.CSSProperties = {
  padding: '10px 14px', fontWeight: 700, color: 'var(--text)',
  fontSize: '12px', whiteSpace: 'nowrap', textAlign: 'left',
  borderBottom: '1px solid var(--border)', textTransform: 'uppercase',
  letterSpacing: '0.05em',
}
const TD: React.CSSProperties = {
  padding: '10px 14px', verticalAlign: 'middle',
  borderBottom: '1px solid var(--border)', fontSize: '13px',
}

function Bool({ val }: { val: boolean | null }) {
  const on = val === true
  return (
    <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 600, color: on ? '#16a34a' : 'var(--muted)', letterSpacing: '0.01em' }}>
      {on ? 'TRUE' : 'FALSE'}
    </span>
  )
}

function startOf(unit: 'today' | 'week' | 'month'): Date {
  const d = new Date()
  if (unit === 'today') { d.setHours(0,0,0,0); return d }
  if (unit === 'week')  { d.setHours(0,0,0,0); d.setDate(d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1)); return d }
  d.setHours(0,0,0,0); d.setDate(1); return d
}

export default function LeadsPage() {
  const [leads,      setLeads]      = useState<Lead[] | null>(null)
  const [error,      setError]      = useState<string | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [stats,      setStats]      = useState<Stats | null>(null)
  const [members,    setMembers]    = useState<TeamMember[]>([])
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')

  async function load() {
    setLoading(true); setError(null)
    fetch('/api/leads/stats').then(r => r.json()).then(d => { if (d.total != null) setStats(d) }).catch(() => {})
    fetch('/api/settings/employees').then(r => r.json()).then(d => { if (Array.isArray(d.members)) setMembers(d.members) }).catch(() => {})
    try {
      const res  = await fetch('/api/leads')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Laden mislukt')
      setLeads(data.leads ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Laden mislukt')
      setLeads([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const memberMap = useMemo(() => {
    const m: Record<string, TeamMember> = {}
    members.forEach(tm => { m[tm.naam] = tm; m[tm.id] = tm })
    return m
  }, [members])

  const filtered = useMemo(() => {
    if (!leads) return []
    if (dateFilter === 'all') return leads
    const since = startOf(dateFilter as 'today' | 'week' | 'month')
    return leads.filter(r => r.created_at && new Date(r.created_at) >= since)
  }, [leads, dateFilter])

  return (
    <div style={{ backgroundColor: 'var(--bg)', minHeight: 'calc(100vh - 44px)', color: 'var(--text)' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px 24px 48px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-0.02em', margin: 0, flex: 1 }}>Leads</h1>
          <button onClick={() => void load()} disabled={loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 13px', fontSize: '13px', fontWeight: 600, borderRadius: '7px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: loading ? 'wait' : 'pointer' }}>
            <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} />
            Vernieuwen
          </button>
        </div>

        {/* Stats */}
        {stats && (
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <StatTile icon="📋" label="Totaal leads"    value={stats.total}         />
            <StatTile icon="🔥" label="Hoog potentieel" value={stats.highPotential} />
            <StatTile icon="⚡" label="Vandaag"          value={stats.today}         />
          </div>
        )}

        {/* Date filter */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
          {DATE_FILTERS.map(f => (
            <button key={f.key} onClick={() => setDateFilter(f.key)}
              style={{
                padding: '5px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: 'none',
                backgroundColor: dateFilter === f.key ? 'var(--text)' : 'var(--surface)',
                color:           dateFilter === f.key ? 'var(--surface)' : 'var(--muted)',
                outline:         dateFilter === f.key ? 'none' : '1px solid var(--border)',
              }}>
              {f.label}
            </button>
          ))}
          {dateFilter !== 'all' && (
            <span style={{ fontSize: '12px', color: 'var(--muted)', alignSelf: 'center', marginLeft: '6px' }}>
              {filtered.length} resultaten
            </span>
          )}
        </div>

        {error && (
          <p style={{ fontSize: '14px', color: '#B91C1C', marginBottom: '16px', padding: '12px', background: '#FEF2F2', borderRadius: '8px' }}>{error}</p>
        )}

        {loading && leads === null ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: 'var(--muted)' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Laden…
          </div>
        ) : (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
              <thead>
                <tr>
                  <th style={TH}>Bedrijf</th>
                  <th style={TH}>Plaats</th>
                  <th style={TH}>Type</th>
                  <th style={TH}>Bron</th>
                  <th style={TH}>Label</th>
                  <th style={TH}>Volume</th>
                  <th style={TH}>Toegewezen aan</th>
                  <th style={TH}>WhatsApp</th>
                  <th style={TH}>GHL</th>
                  <th style={{ ...TH, fontFamily: MONO }}>Datum</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ ...TD, textAlign: 'center', color: 'var(--muted)', padding: '32px 14px' }}>
                      Geen leads gevonden.
                    </td>
                  </tr>
                ) : filtered.map(row => {
                  const typeS   = TYPE_META[row.type?.toLowerCase() ?? '']
                  const ls      = row.label?.toUpperCase() ?? ''
                  const labelS  = LABEL_STYLE[ls]
                  const member  = row.assigned_to ? memberMap[row.assigned_to] : null
                  const mColor  = member?.color ?? '#64748b'
                  return (
                    <tr key={row.id}>
                      <td style={{ ...TD, fontWeight: 600 }}>{row.company_name ?? '—'}</td>
                      <td style={{ ...TD, color: 'var(--muted)' }}>{row.city ?? '—'}</td>
                      <td style={TD}>
                        {typeS
                          ? <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, backgroundColor: typeS.bg, color: typeS.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{typeS.label}</span>
                          : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={TD}>
                        {row.source
                          ? <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, backgroundColor: 'var(--active)', border: '1px solid var(--border)', color: 'var(--text)', whiteSpace: 'nowrap' }}>{row.source}</span>
                          : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={TD}>
                        {labelS
                          ? <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 700, backgroundColor: labelS.bg, color: labelS.color, fontFamily: MONO }}>{ls}</span>
                          : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ ...TD, fontFamily: MONO, fontSize: '12px', color: 'var(--muted)' }}>
                        {row.revenue != null ? row.revenue.toLocaleString('nl-NL') : '—'}
                      </td>
                      <td style={TD}>
                        {row.assigned_to ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '5px',
                            padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700,
                            backgroundColor: `${mColor}18`, color: mColor,
                            border: `1px solid ${mColor}30`,
                            textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
                          }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: mColor, flexShrink: 0 }} />
                            {row.assigned_to}
                          </span>
                        ) : <span style={{ color: 'var(--muted)', fontSize: '12px' }}>—</span>}
                      </td>
                      <td style={TD}><Bool val={row.whatsapp} /></td>
                      <td style={TD}><Bool val={row.ghl_synced} /></td>
                      <td style={{ ...TD, fontFamily: MONO, fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        {row.created_at
                          ? new Date(row.created_at).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatTile({ icon, label, value }: { icon: string; label: string; value: number; accent?: string }) {
  return (
    <div style={{ width: '148px', flexShrink: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <span style={{ fontSize: '13px', lineHeight: 1 }}>{icon}</span>
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      </div>
      <span style={{ fontSize: '26px', fontWeight: 800, color: 'var(--text)', lineHeight: 1.1, fontFamily: MONO, letterSpacing: '-0.02em' }}>
        {value}
      </span>
    </div>
  )
}
