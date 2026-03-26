'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader2, RefreshCw, Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DateRangePicker, type DateRange } from '@/components/DateRangePicker'

const MONO = "'SF Mono','Fira Code',ui-monospace,monospace"

const MEDAL = ['🥇', '🥈', '🥉']

function fmtVolume(v: number) {
  if (v >= 1_000_000) return `# ${(v / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (v >= 1_000)     return `# ${Math.round(v / 1_000)}K`
  return `# ${v.toLocaleString('nl-NL')}`
}

const AWARD_DEFS = [
  {
    key:   'meeste_leads',
    title: 'Meeste leads',
    unit:  (v: number) => `${v} leads`,
    desc:  'Wie heeft de meeste contacten aangemaakt?',
  },
  {
    key:   'beste_lead',
    title: 'Beste lead',
    unit:  (v: number) => v > 0 ? fmtVolume(v) : '—',
    desc:  'Hoogste volume op een enkele lead',
  },
  {
    key:   'beste_pijplijn',
    title: 'Beste pijplijn',
    unit:  (v: number) => v > 0 ? fmtVolume(v) : '—',
    desc:  'Meeste volume in A/B leads',
  },
  {
    key:   'meeste_notities',
    title: 'Grootste boekhouder',
    unit:  (v: number) => `${v} notities`,
    desc:  'Wie schrijft het meest?',
  },
  {
    key:   'teamspeler',
    title: 'Grootste teamspeler',
    unit:  (v: number) => `${v} doorgegeven`,
    desc:  'Leads gemaakt voor een collega',
  },
  {
    key:   'grootste_dief',
    title: 'Grootste dief',
    unit:  (v: number) => `${v} gejat`,
    desc:  'Meeste leads door anderen binngehaald',
  },
]

interface RankEntry { naam: string; value: number }
interface AwardsData {
  sources: string[]
  total:   number
  awards: Record<string, RankEntry[]>
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn(
        'px-3 py-1 rounded-full text-xs font-semibold cursor-pointer border-none transition-colors whitespace-nowrap',
        active ? 'bg-primary text-white' : 'bg-surface text-muted outline outline-1 outline-border hover:bg-active',
      )}>
      {children}
    </button>
  )
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

  function onSourceToggle(src: string) {
    const next = !sourceFilter ? [src]
      : sourceFilter.includes(src)
        ? (sourceFilter.filter(s => s !== src).length === 0 ? null : sourceFilter.filter(s => s !== src))
        : [...sourceFilter, src]
    setSourceFilter(next)
    void fetchAwards(next, dateRange)
  }

  function onDateChange(range: DateRange) {
    setDateRange(range)
    void fetchAwards(sourceFilter, range)
  }

  return (
    <div className="min-h-[calc(100vh-44px)] bg-bg text-primary">
      <div className="max-w-[1100px] mx-auto px-6 pt-6 pb-16">

        {/* Header */}
        <div className="flex items-center gap-2 mb-5">
          <Trophy size={18} className="text-primary" />
          <h1 className="text-xl font-extrabold tracking-tight flex-1">Awards</h1>
          <button onClick={() => void fetchAwards(sourceFilter, dateRange)} disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold rounded-lg border border-border bg-surface text-primary cursor-pointer disabled:cursor-wait hover:bg-active transition-colors">
            <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
            Vernieuwen
          </button>
        </div>

        {/* Filter bar — datum links, BRON rechts */}
        <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
          {/* Date picker — left */}
          <DateRangePicker value={dateRange} onChange={onDateChange} />

          {/* BRON filter — right */}
          {data && data.sources.length > 0 && (
            <div className="flex gap-1 flex-wrap items-center justify-end">
              <span className="text-[11px] font-bold text-muted uppercase tracking-[0.06em] mr-0.5">Bron</span>
              <Pill active={!sourceFilter} onClick={() => { setSourceFilter(null); void fetchAwards(null, dateRange) }}>
                Alle
              </Pill>
              {data.sources.map(src => (
                <Pill key={src} active={sourceFilter?.includes(src) ?? false} onClick={() => onSourceToggle(src)}>
                  {src}
                </Pill>
              ))}
              {data.total > 0 && (
                <span className="text-xs text-muted ml-1">{data.total} leads</span>
              )}
            </div>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {AWARD_DEFS.map(def => (
              <AwardCard
                key={def.key}
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

function AwardCard({ title, desc, entries, unit, loading }: {
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
      {/* Card header */}
      <div className="px-4 py-3 border-b border-border bg-bg">
        <div className="flex items-center gap-2">
          <Trophy size={11} className="text-muted flex-shrink-0" />
          <span className="text-[12px] font-extrabold text-primary uppercase tracking-[0.05em]">{title}</span>
        </div>
        <p className="text-[10px] text-muted mt-0.5 leading-snug">{desc}</p>
      </div>

      {/* Podium */}
      <div className="flex flex-col divide-y divide-border flex-1">
        {entries.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted">Nog geen data</div>
        ) : (
          <>
            {entries.map((e, i) => {
              const isFirst = i === 0
              return (
                <div key={e.naam} className="flex items-center gap-3 px-4 py-3">
                  <span className="text-[18px] leading-none w-6 flex-shrink-0">{MEDAL[i]}</span>
                  <span className={cn(
                    'flex-1 truncate',
                    isFirst ? 'text-[14px] font-bold text-primary' : 'text-[13px] font-medium text-primary',
                  )}>
                    {e.naam}
                  </span>
                  <span
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-md flex-shrink-0 whitespace-nowrap text-muted"
                    style={{ backgroundColor: 'var(--active)', fontFamily: MONO }}
                  >
                    {unit(e.value)}
                  </span>
                </div>
              )
            })}
            {/* Ghost rows to keep uniform height */}
            {entries.length < 3 && Array.from({ length: 3 - entries.length }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 opacity-25">
                <span className="text-[18px] leading-none w-6">{MEDAL[entries.length + i]}</span>
                <span className="text-[13px] text-muted">—</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
