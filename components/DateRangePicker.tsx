'use client'

import { useState, useRef, useEffect } from 'react'
import { Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'

export type DateRange = { from: string; to: string } | null

interface Props {
  value:     DateRange
  onChange:  (range: DateRange) => void
  className?: string
}

function fmt(d: Date): string { return d.toISOString().slice(0, 10) }

function fmtDisplay(s: string): string {
  return new Date(s + 'T12:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
}

const PRESETS = [
  {
    label: 'Vandaag',
    get: (): DateRange => { const d = fmt(new Date()); return { from: d, to: d } },
  },
  {
    label: 'Deze week',
    get: (): DateRange => {
      const now = new Date()
      const mon = new Date(now)
      mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
      return { from: fmt(mon), to: fmt(now) }
    },
  },
  {
    label: 'Deze maand',
    get: (): DateRange => {
      const now = new Date()
      return { from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), to: fmt(now) }
    },
  },
  { label: 'Alles', get: (): DateRange => null },
]

export function DateRangePicker({ value, onChange, className }: Props) {
  const [open,       setOpen]       = useState(false)
  const [customFrom, setCustomFrom] = useState(value?.from ?? '')
  const [customTo,   setCustomTo]   = useState(value?.to   ?? '')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  // Sync custom fields when value changes externally
  useEffect(() => {
    setCustomFrom(value?.from ?? '')
    setCustomTo(value?.to ?? '')
  }, [value])

  const label = value
    ? value.from === value.to
      ? fmtDisplay(value.from)
      : `${fmtDisplay(value.from)} — ${fmtDisplay(value.to)}`
    : 'Alles'

  function applyCustom() {
    const from = customFrom || customTo
    const to   = customTo   || customFrom
    if (!from) { onChange(null); setOpen(false); return }
    onChange({ from, to })
    setOpen(false)
  }

  function selectPreset(p: typeof PRESETS[number]) {
    const range = p.get()
    onChange(range)
    setCustomFrom(range?.from ?? '')
    setCustomTo(range?.to   ?? '')
    setOpen(false)
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors',
          'border border-border bg-surface text-primary hover:bg-active',
          open && 'bg-active',
        )}
      >
        <Calendar size={12} className="text-muted flex-shrink-0" />
        <span>{label}</span>
        <span className="text-muted text-[9px] ml-0.5">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 bg-surface border border-border rounded-xl shadow-panel w-[230px] overflow-hidden">
          {/* Presets */}
          <div className="grid grid-cols-2 gap-1 p-2 border-b border-border">
            {PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => selectPreset(p)}
                className={cn(
                  'px-2 py-1.5 text-xs font-semibold rounded-lg border-none cursor-pointer transition-colors text-left',
                  value === null && p.label === 'Alles'
                    ? 'bg-primary text-white'
                    : 'bg-bg text-primary hover:bg-active',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom range */}
          <div className="p-2 flex flex-col gap-1.5">
            <div className="flex gap-1.5 items-center">
              <span className="text-[10px] text-muted font-semibold w-6 flex-shrink-0">Van</span>
              <input
                type="date" value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="flex-1 text-xs border border-border rounded-md px-2 py-1 bg-bg text-primary cursor-pointer outline-none focus:border-primary/40"
              />
            </div>
            <div className="flex gap-1.5 items-center">
              <span className="text-[10px] text-muted font-semibold w-6 flex-shrink-0">Tot</span>
              <input
                type="date" value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="flex-1 text-xs border border-border rounded-md px-2 py-1 bg-bg text-primary cursor-pointer outline-none focus:border-primary/40"
              />
            </div>
            <button
              onClick={applyCustom}
              className="w-full mt-0.5 py-1.5 text-xs font-bold rounded-lg bg-primary text-white cursor-pointer border-none hover:opacity-90 transition-opacity"
            >
              Toepassen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
