'use client'

import { useEffect, useState, useMemo } from 'react'
import { Loader2, RefreshCw, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DateRangePicker, type DateRange } from '@/components/DateRangePicker'

const MONO = "'SF Mono','Fira Code',ui-monospace,monospace"

const LABEL_STYLE: Record<string, { bg: string; color: string }> = {
  A: { bg: 'rgba(220,38,38,0.08)',  color: '#DC2626' },
  B: { bg: 'rgba(217,119,6,0.08)',  color: '#D97706' },
  C: { bg: 'rgba(37,99,235,0.08)',  color: '#2563EB' },
  D: { bg: 'rgba(22,163,74,0.08)',  color: '#16A34A' },
}

const TYPE_META: Record<string, { bg: string; color: string; label: string }> = {
  lead:     { bg: 'rgba(29,78,216,0.08)',   color: '#1D4ED8', label: 'Lead'       },
  customer: { bg: 'rgba(21,128,61,0.08)',   color: '#15803D', label: 'Klant'      },
  employee: { bg: 'rgba(245,158,11,0.08)',  color: '#D97706', label: 'Medewerker' },
}

type Lead = {
  id:            string
  company_name:  string | null
  city:          string | null
  type:          string | null
  label:         string | null
  revenue:       number | null
  assigned_to:   string | null
  source:        string | null
  whatsapp:      boolean | null
  ghl_synced:    boolean | null
  created_at:    string | null
  custom_fields: { created_by?: string; intake_notes?: string } | null
}

type TeamMember = { id: string; naam: string; color: string | null }
type Stats      = { total: number; pipeline: number; today: number }

function Bool({ val }: { val: boolean | null }) {
  const on = val === true
  return (
    <span className={cn('text-[11px] font-semibold tracking-[0.01em]', on ? 'text-green-600' : 'text-muted')}
      style={{ fontFamily: MONO }}>
      {on ? 'TRUE' : 'FALSE'}
    </span>
  )
}


function fmtRevenue(v: number): string {
  if (v >= 1_000_000) return `€ ${(v / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (v >= 1_000)     return `€ ${Math.round(v / 1_000)}K`
  return `€ ${v.toLocaleString('nl-NL')}`
}

/** "Ronald Stavast" → "RON STA", "Vincent" → "VIN" */
function abbrev(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 4).toUpperCase()
  return `${parts[0].slice(0, 3)} ${parts[parts.length - 1].slice(0, 3)}`.toUpperCase()
}

export default function LeadsPage() {
  const [leads,          setLeads]          = useState<Lead[] | null>(null)
  const [error,          setError]          = useState<string | null>(null)
  const [loading,        setLoading]        = useState(true)
  const [stats,          setStats]          = useState<Stats | null>(null)
  const [members,        setMembers]        = useState<TeamMember[]>([])
  const [dateRange,      setDateRange]      = useState<DateRange>(null)
  const [sourceFilter,   setSourceFilter]   = useState<string[] | null>(null)
  const [enriching,      setEnriching]      = useState(false)
  const [enrichMsg,      setEnrichMsg]      = useState<string | null>(null)

  async function load() {
    setLoading(true); setError(null)
    fetch('/api/leads/stats').then(r => r.json()).then(d => { if (d.total != null) setStats(d) }).catch(() => {})
    fetch('/api/settings/employees').then(r => r.json()).then(d => { const list = Array.isArray(d) ? d : (d.members ?? []); setMembers(list) }).catch(() => {})
    try {
      const res  = await fetch('/api/leads')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Laden mislukt')
      const list: Lead[] = data.leads ?? []
      setLeads(list)
      // default: filter op meest recente bron
      const recentSource = list.find(l => l.source)?.source ?? null
      setSourceFilter(recentSource ? [recentSource] : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Laden mislukt')
      setLeads([])
    } finally {
      setLoading(false)
    }
  }

  async function enrichAll() {
    setEnriching(true); setEnrichMsg(null)
    try {
      const res  = await fetch('/api/intelligence/enrich-all', { method: 'POST' })
      const data = await res.json() as { scored?: number; total?: number; errors?: string[] }
      setEnrichMsg(`${data.scored ?? 0} van ${data.total ?? 0} leads verrijkt`)
      void load()
    } catch {
      setEnrichMsg('Verrijking mislukt')
    } finally {
      setEnriching(false)
    }
  }

  useEffect(() => { void load() }, [])

  const memberMap = useMemo(() => {
    const m: Record<string, TeamMember> = {}
    members.forEach(tm => { m[tm.naam] = tm; m[tm.id] = tm })
    return m
  }, [members])

  const uniqueSources = useMemo(() => {
    if (!leads) return []
    const seen = new Set<string>()
    const ordered: string[] = []
    for (const l of leads) {
      if (l.source && !seen.has(l.source)) { seen.add(l.source); ordered.push(l.source) }
    }
    return ordered
  }, [leads])

  const filtered = useMemo(() => {
    if (!leads) return []
    let result = leads
    if (dateRange) {
      const from = new Date(dateRange.from + 'T00:00:00')
      const to   = new Date(dateRange.to   + 'T23:59:59')
      result = result.filter(r => {
        if (!r.created_at) return false
        const d = new Date(r.created_at)
        return d >= from && d <= to
      })
    }
    if (sourceFilter && sourceFilter.length > 0) {
      result = result.filter(r => r.source && sourceFilter.includes(r.source))
    }
    return result
  }, [leads, dateRange, sourceFilter])

  function toggleSource(src: string) {
    setSourceFilter(prev => {
      if (!prev) return [src]
      const has = prev.includes(src)
      const next = has ? prev.filter(s => s !== src) : [...prev, src]
      return next.length === 0 ? null : next
    })
  }

  return (
    <div className="min-h-[calc(100vh-44px)] bg-bg text-primary">
      <div className="max-w-[1200px] mx-auto px-6 pt-6 pb-12">

        {/* Header */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <h1 className="text-xl font-extrabold tracking-tight flex-1">Leads</h1>
          {enrichMsg && (
            <span className="text-xs text-green-600 font-semibold">{enrichMsg}</span>
          )}
          <button onClick={() => void enrichAll()} disabled={enriching || loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold rounded-lg border border-border bg-surface text-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-active transition-colors">
            {enriching ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
            {enriching ? 'Verrijken…' : 'Verrijk alle'}
          </button>
          <button onClick={() => void load()} disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold rounded-lg border border-border bg-surface text-primary cursor-pointer disabled:cursor-wait hover:bg-active transition-colors">
            <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
            Vernieuwen
          </button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="flex gap-2.5 mb-5 flex-wrap">
            <StatTile label="Totaal leads" value={stats.total.toString()} />
            <StatTile label="Vandaag"      value={stats.today.toString()} />
            <StatTile label="PIJPLIJN"     value={stats.pipeline > 0 ? fmtRevenue(stats.pipeline) : '—'} wide />
          </div>
        )}

        {/* Filters row — datum links, BRON rechts */}
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          {/* Date picker — left */}
          <DateRangePicker value={dateRange} onChange={setDateRange} />

          {/* BRON filter — right */}
          {uniqueSources.length > 0 && (
            <div className="flex gap-1 flex-wrap items-center justify-end">
              <span className="text-[11px] font-bold text-muted uppercase tracking-[0.06em] mr-0.5">Bron</span>
              <button
                onClick={() => setSourceFilter(null)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-semibold cursor-pointer border-none transition-colors',
                  !sourceFilter
                    ? 'bg-primary text-white'
                    : 'bg-surface text-muted outline outline-1 outline-border hover:bg-active',
                )}>
                Alle
              </button>
              {uniqueSources.map(src => (
                <button key={src} onClick={() => toggleSource(src)}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-semibold cursor-pointer border-none transition-colors',
                    sourceFilter?.includes(src)
                      ? 'bg-primary text-white'
                      : 'bg-surface text-muted outline outline-1 outline-border hover:bg-active',
                  )}>
                  {src}
                </button>
              ))}
              <span className="text-xs text-muted ml-1">{filtered.length}</span>
            </div>
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
                  {['Bedrijf','Plaats','Type','Bron','Label','Volume','Door','Aan','WhatsApp','GHL','Datum'].map(h => (
                    <th key={h} className="px-3.5 py-2.5 text-left text-xs font-bold text-primary uppercase tracking-[0.05em] border-b border-border whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3.5 py-8 text-center text-sm text-muted border-b border-border">
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
                      {/* Door — aangemaakt door */}
                      <td className="px-3.5 py-2.5 align-middle border-b border-border text-[13px]">
                        {(() => {
                          const naam  = row.custom_fields?.created_by?.trim()
                          if (!naam) return <span className="text-muted text-xs">—</span>
                          const tm    = memberMap[naam]
                          const color = tm?.color ?? '#64748b'
                          return (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-[0.05em] whitespace-nowrap"
                              style={{ backgroundColor: `${color}18`, color, border: `1px solid ${color}30` }}>
                              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                              {abbrev(naam)}
                            </span>
                          )
                        })()}
                      </td>
                      {/* Aan — toegewezen aan */}
                      <td className="px-3.5 py-2.5 align-middle border-b border-border text-[13px]">
                        {row.assigned_to ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-[0.05em] whitespace-nowrap"
                            style={{ backgroundColor: `${mColor}18`, color: mColor, border: `1px solid ${mColor}30` }}>
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: mColor }} />
                            {abbrev(row.assigned_to)}
                          </span>
                        ) : <span className="text-muted text-xs">—</span>}
                      </td>
                      <td className="px-3.5 py-2.5 align-middle border-b border-border text-[13px]"><Bool val={row.whatsapp} /></td>
                      <td className="px-3.5 py-2.5 align-middle border-b border-border text-[13px]"><Bool val={row.ghl_synced} /></td>
                      <td className="px-3.5 py-2.5 align-middle border-b border-border text-[11px] text-muted whitespace-nowrap"
                        style={{ fontFamily: MONO }}>
                        {row.created_at
                          ? new Date(row.created_at).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '')
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

function StatTile({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cn('flex-shrink-0 bg-surface border border-border rounded-[10px] px-3.5 py-3 flex flex-col gap-1', wide ? 'min-w-[180px]' : 'w-[148px]')}>
      <span className="text-[11px] font-semibold text-muted uppercase tracking-[0.05em]">{label}</span>
      <span className="text-[26px] font-extrabold text-primary leading-[1.1] tracking-tight" style={{ fontFamily: MONO }}>
        {value}
      </span>
    </div>
  )
}
