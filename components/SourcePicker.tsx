'use client'

import { useState, useRef, useEffect } from 'react'
import { Tag, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  sources:   string[]
  value:     string[] | null   // null = all
  onChange:  (v: string[] | null) => void
  className?: string
}

export function SourcePicker({ sources, value, onChange, className }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  const label = !value
    ? 'Alle bronnen'
    : value.length === 1
      ? value[0]
      : `${value.length} bronnen`

  function toggle(src: string) {
    if (!value) {
      onChange([src])
      return
    }
    const next = value.includes(src)
      ? value.filter(s => s !== src)
      : [...value, src]
    onChange(next.length === 0 ? null : next)
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
        <Tag size={12} className="text-muted flex-shrink-0" />
        <span className="max-w-[140px] truncate">{label}</span>
        <span className="text-muted text-[9px] ml-0.5">▾</span>
      </button>

      {open && sources.length > 0 && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 bg-surface border border-border rounded-xl shadow-panel min-w-[190px] overflow-hidden">
          {/* All option */}
          <button
            onClick={() => { onChange(null); setOpen(false) }}
            className={cn(
              'w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-left cursor-pointer border-none transition-colors border-b border-border',
              !value ? 'bg-primary text-white font-semibold' : 'bg-transparent text-muted hover:bg-active',
            )}
          >
            <span className="flex-1">Alle bronnen</span>
            {!value && <Check size={12} strokeWidth={2.5} />}
          </button>

          {/* Source list */}
          {sources.map(src => {
            const active = value?.includes(src) ?? false
            return (
              <button
                key={src}
                onClick={() => toggle(src)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-left cursor-pointer border-none transition-colors border-b border-border last:border-0',
                  active ? 'bg-bg text-primary font-semibold' : 'bg-transparent text-primary hover:bg-active',
                )}
              >
                <span className="flex-1 truncate">{src}</span>
                {active && <Check size={12} strokeWidth={2.5} className="text-primary flex-shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
