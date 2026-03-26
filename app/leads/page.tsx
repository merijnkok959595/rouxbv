'use client'

import { useEffect, useState, useMemo } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

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
  { key: 'all',   label: 'Alles'   },
  { key: 'today', label: 'Vandaag' },
  { key: 'week',  label: 'Week'    },
  { key: 'month', label: 'Maand'   },
]

function Bool({ val }: { val: boolean | null }) {
  const on = val === true
  return (
    <span className={cn('text-[11px] font-semibold tracking-[0.01em]', on ? 'text-green-600' : 'text-muted')}
      style={{ fontFamily: MONO }}>
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
    <div className="min-h-[calc(100vh-44px)] bg-bg text-primary">
      <div className="max-w-[1200px] mx-auto px-6 pt-6 pb-12">

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <h1 className="text-xl font-extrabold tracking-tight flex-1">Leads</h1>
          <button onClick={() => void load()} disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold rounded-lg border border-border bg-surface text-primary cursor-pointer disabled:cursor-wait hover:bg-active transition-colors">
            <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
            Vernieuwen
          </button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="flex gap-2.5 mb-5">
            <StatTile icon="📋" label="Totaal leads"    value={stats.total}         />
            <StatTile icon="🔥" label="Hoog potentieel" value={stats.highPotential} />
            <StatTile icon="⚡" label="Vandaag"          value={stats.today}         />
          </div>
        )}

        {/* Date filter */}
        <div className="flex gap-1 mb-3">
          {DATE_FILTERS.map(f => (
            <button key={f.key} onClick={() => setDateFilter(f.key)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-semibold cursor-pointer border-none transition-colors',
                dateFilter === f.key
                  ? 'bg-primary text-white'
                  : 'bg-surface text-muted outline outline-1 outline-border hover:bg-active',
              )}>
              {f.label}
            </button>
          ))}
          {dateFilter !== 'all' && (
            <span className="text-xs text-muted self-center ml-1.5">{filtered.length} resultaten</span>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-700 mb-4 px-3 py-3 bg-red-50 rounded-lg">{error}</p>
        )}

        {loading && leads === null ? (
          <div className="flex items-center gap-2.5 text-sm text-muted">
            <Loader2 size={16} className="animate-spin" /> Laden…
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-auto">
            <table className="w-full border-collapse min-w-[800px]">
              <thead>
                <tr>
                  {['Bedrijf','Plaats','Type','Bron','Label','Volume','Toegewezen aan','WhatsApp','GHL','Datum'].map(h => (
                    <th key={h} className="px-3.5 py-2.5 text-left text-xs font-bold text-primary uppercase tracking-[0.05em] border-b border-border whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3.5 py-8 text-center text-sm text-muted border-b border-border">
                      Geen leads gevonden.
                    </td>
                  </tr>
                ) : filtered.map(row => {
                  const typeS  = TYPE_META[row.type?.toLowerCase() ?? '']
                  const ls     = row.label?.toUpperCase() ?? ''
                  const labelS = LABEL_STYLE[ls]
                  const member = row.assigned_to ? memberMap[row.assigned_to] : null
                  const mColor = member?.color ?? '#64748b'
                  return (
                    <tr key={row.id} className="hover:bg-bg transition-colors">
                      <td className="px-3.5 py-2.5 align-middle border-b border-border text-[13px] font-semibold">{row.company_name ?? '—'}</td>
                      <td className="px-3.5 py-2.5 align-middle border-b border-border text-[13px] text-muted">{row.city ?? '—'}</td>
                      <td className="px-3.5 py-2.5 align-middle border-b border-border text-[13px]">
                        {typeS
                          ? <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-[0.05em]"
                              style={{ backgroundColor: typeS.bg, color: typeS.color }}>{typeS.label}</span>
                          : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-3.5 py-2.5 align-middle border-b border-border text-[13px]">
                        {row.source
                          ? <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-active border border-border text-primary whitespace-nowrap">{row.source}</span>
                          : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-3.5 py-2.5 align-middle border-b border-border text-[13px]">
                        {labelS
                          ? <span className="px-2 py-0.5 rounded text-xs font-bold"
                              style={{ backgroundColor: labelS.bg, color: labelS.color, fontFamily: MONO }}>{ls}</span>
                          : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-3.5 py-2.5 align-middle border-b border-border text-xs text-muted"
                        style={{ fontFamily: MONO }}>
                        {row.revenue != null ? row.revenue.toLocaleString('nl-NL') : '—'}
                      </td>
                      <td className="px-3.5 py-2.5 align-middle border-b border-border text-[13px]">
                        {row.assigned_to ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-[0.05em] whitespace-nowrap"
                            style={{ backgroundColor: `${mColor}18`, color: mColor, border: `1px solid ${mColor}30` }}>
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: mColor }} />
                            {row.assigned_to}
                          </span>
                        ) : <span className="text-muted text-xs">—</span>}
                      </td>
                      <td className="px-3.5 py-2.5 align-middle border-b border-border text-[13px]"><Bool val={row.whatsapp} /></td>
                      <td className="px-3.5 py-2.5 align-middle border-b border-border text-[13px]"><Bool val={row.ghl_synced} /></td>
                      <td className="px-3.5 py-2.5 align-middle border-b border-border text-[11px] text-muted whitespace-nowrap"
                        style={{ fontFamily: MONO }}>
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

function StatTile({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div className="w-[148px] flex-shrink-0 bg-surface border border-border rounded-[10px] px-3.5 py-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[13px] leading-none">{icon}</span>
        <span className="text-[11px] font-semibold text-muted uppercase tracking-[0.05em]">{label}</span>
      </div>
      <span className="text-[26px] font-extrabold text-primary leading-[1.1] tracking-tight" style={{ fontFamily: MONO }}>
        {value}
      </span>
    </div>
  )
}
