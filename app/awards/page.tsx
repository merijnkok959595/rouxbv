'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader2, RefreshCw, Users, Gem, TrendingUp, PenLine, Send, Zap, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DateRangePicker, type DateRange } from '@/components/DateRangePicker'
import { SourcePicker } from '@/components/SourcePicker'

const MONO = "'SF Mono','Fira Code',ui-monospace,monospace"

const MEDAL = ['🥇', '🥈', '🥉']

function fmtVolume(v: number) {
  if (v >= 1_000_000) return `# ${(v / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (v >= 1_000)     return `# ${Math.round(v / 1_000)}K`
  return `# ${v.toLocaleString('nl-NL')}`
}

const AWARD_DEFS: { key: string; icon: LucideIcon; title: string; unit: (v: number) => string; desc: string }[] = [
  { key: 'meeste_leads',    icon: Users,      title: 'Meeste leads',        unit: (v) => `${v} leads`,              desc: 'Wie heeft de meeste contacten aangemaakt?' },
  { key: 'beste_lead',      icon: Gem,        title: 'Beste lead',          unit: (v) => v > 0 ? fmtVolume(v) : '—', desc: 'Hoogste volume op een enkele lead' },
  { key: 'beste_pijplijn',  icon: TrendingUp, title: 'Beste pijplijn',      unit: (v) => v > 0 ? fmtVolume(v) : '—', desc: 'Meeste volume in A/B leads' },
  { key: 'meeste_notities', icon: PenLine,    title: 'Boekhouder',          unit: (v) => `${v} notities`,           desc: 'Wie schrijft het meest?' },
  { key: 'teamspeler',      icon: Send,       title: 'Teamspeler',          unit: (v) => `${v} doorgegeven`,        desc: 'Leads gemaakt voor een collega' },
  { key: 'grootste_dief',   icon: Zap,        title: 'Dealtjes dief',       unit: (v) => `${v} gejat`,             desc: 'Meeste leads door anderen binnengehaald' },
]

interface RankEntry { naam: string; value: number }
interface AwardsData {
  sources: string[]
  total:   number
  awards: Record<string, RankEntry[]>
}


export default function AwardsPage() {
  const [data,         setData]         = useState<AwardsData | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [sourceFilter, setSourceFilter] = useState<string[] | null>(null)
  const [dateRange,    setDateRange]    = useState<DateRange>(null)
  const [initialized,  setInitialized]  = useState(false)

  const fetchAwards = useCallback(async (sources: string[] | null, range: DateRange) => {
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams()
      if (sources && sources.length > 0) sources.forEach(s => params.append('source', s))
      if (range?.from) params.set('from', range.from)
      if (range?.to)   params.set('to',   range.to)

      const res  = await fetch(`/api/awards?${params.toString()}`)
      const json = await res.json() as AwardsData & { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Laden mislukt')
      setData(json)

      // First load: default to most recent source
      if (!initialized) {
        setInitialized(true)
        const recent = json.sources[0] ?? null
        if (recent && sources === null) {
          setSourceFilter([recent])
          const p2 = new URLSearchParams()
          p2.append('source', recent)
          if (range?.from) p2.set('from', range.from)
          if (range?.to)   p2.set('to',   range.to)
          const r2  = await fetch(`/api/awards?${p2.toString()}`)
          const j2  = await r2.json() as AwardsData
          if (r2.ok) setData(j2)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Laden mislukt')
    } finally {
      setLoading(false)
    }
  }, [initialized])

  useEffect(() => { void fetchAwards(null, null) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function onDateChange(range: DateRange) {
    setDateRange(range)
    void fetchAwards(sourceFilter, range)
  }

  return (
    <div className="min-h-[calc(100vh-44px)] bg-bg text-primary">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 pt-4 sm:pt-6 pb-16">

        {/* Header */}
        <div className="flex items-start gap-2 mb-5">
          <div className="flex-1">
            <h1 className="text-xl font-extrabold tracking-tight">Awards</h1>
            {data && data.total > 0 && (
              <p className="text-[12px] text-muted mt-0.5 tabular-nums">{data.total} leads</p>
            )}
          </div>
          <button onClick={() => void fetchAwards(sourceFilter, dateRange)} disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold rounded-lg border border-border bg-surface text-primary cursor-pointer disabled:cursor-wait hover:bg-active transition-colors">
            <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
            Vernieuwen
          </button>
        </div>

        {/* Filter bar — datum links, BRON rechts */}
        <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
          <DateRangePicker value={dateRange} onChange={onDateChange} />
          {data && data.sources.length > 0 && (
            <SourcePicker
              sources={data.sources}
              value={sourceFilter}
              onChange={next => { setSourceFilter(next); void fetchAwards(next, dateRange) }}
            />
          )}
        </div>

        {error && (
          <p className="text-sm text-red-700 mb-4 px-3 py-3 bg-red-50 rounded-lg">{error}</p>
        )}

        {loading && !data ? (
          <div className="flex items-center gap-2.5 text-sm text-muted">
            <Loader2 size={16} className="animate-spin" /> Laden…
          </div>
        ) : data ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {AWARD_DEFS.map(def => (
              <AwardCard
                key={def.key}
                icon={def.icon}
                title={def.title}
                desc={def.desc}
                entries={data.awards[def.key] ?? []}
                unit={def.unit}
                loading={loading}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function AwardCard({ icon: Icon, title, desc, entries, unit, loading }: {
  icon:    LucideIcon
  title:   string
  desc:    string
  entries: RankEntry[]
  unit:    (v: number) => string
  loading: boolean
}) {
  return (
    <div className={cn(
      'bg-surface border border-border rounded-xl overflow-hidden flex flex-col',
      loading && 'opacity-60 pointer-events-none',
    )}>
      {/* Card header — light gray with lucide icon */}
      <div className="px-3.5 pt-3 pb-2.5 bg-active border-b border-border">
        <div className="flex items-center gap-1.5">
          <Icon size={12} strokeWidth={2.5} className="text-primary flex-shrink-0" />
          <span className="text-[11px] font-black text-primary uppercase tracking-[0.06em] leading-tight">{title}</span>
        </div>
        <span className="block text-[10px] text-muted mt-0.5 leading-snug">{desc}</span>
      </div>

      {/* Podium */}
      <div className="flex flex-col divide-y divide-border flex-1">
        {entries.length === 0 ? (
          <div className="px-3.5 py-5 text-center text-xs text-muted">Nog geen data</div>
        ) : (
          <>
            {entries.map((e, i) => {
              const isFirst = i === 0
              return (
                <div key={e.naam} className={cn(
                  'flex items-center gap-2 px-3.5',
                  isFirst ? 'py-2.5' : 'py-1.5',
                )}>
                  <span className="text-[13px] leading-none flex-shrink-0 w-4 text-center">{MEDAL[i]}</span>
                  <span className={cn(
                    'flex-1 min-w-0 truncate',
                    isFirst ? 'text-[13px] font-bold text-primary' : 'text-[11px] font-medium text-secondary',
                  )}>
                    {e.naam}
                  </span>
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 whitespace-nowrap text-muted tabular-nums"
                    style={{ backgroundColor: 'var(--active)', fontFamily: MONO }}
                  >
                    {unit(e.value)}
                  </span>
                </div>
              )
            })}
            {entries.length < 3 && Array.from({ length: 3 - entries.length }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-3.5 py-1.5 opacity-20">
                <span className="text-[13px] leading-none w-4 text-center">{MEDAL[entries.length + i]}</span>
                <span className="text-[11px] text-muted">—</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
