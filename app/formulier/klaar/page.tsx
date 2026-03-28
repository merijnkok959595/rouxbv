'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle, Loader2, Plus, ListChecks } from 'lucide-react'
import Link from 'next/link'

const LABEL_META: Record<string, { bg: string; text: string; border: string; title: string; emoji: string }> = {
  A: { bg: 'rgba(220,38,38,0.08)',  text: '#DC2626', border: 'rgba(220,38,38,0.20)',  title: 'Top prospect',     emoji: '🔥' },
  B: { bg: 'rgba(217,119,6,0.08)',  text: '#D97706', border: 'rgba(217,119,6,0.20)',  title: 'Goede kans',       emoji: '⭐' },
  C: { bg: 'rgba(37,99,235,0.08)',  text: '#2563EB', border: 'rgba(37,99,235,0.20)',  title: 'Gemiddeld',        emoji: '👍' },
  D: { bg: 'rgba(22,163,74,0.08)',  text: '#16A34A', border: 'rgba(22,163,74,0.20)',  title: 'Lage prioriteit',  emoji: '📋' },
}

type Contact = {
  id: string
  company_name: string | null
  label: string | null
  revenue: number | null
  assigned_to: string | null
  source: string | null
  custom_fields: Record<string, unknown> | null
}

export default function KlaarPage() {
  const params   = useSearchParams()
  const router   = useRouter()
  const id       = params.get('id')
  const company  = params.get('company') ?? ''

  const [contact,    setContact]    = useState<Contact | null>(null)
  const [labelReady, setLabelReady] = useState(false)
  const [dots,       setDots]       = useState('.')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Animated dots for loading text
  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? '.' : d + '.'), 500)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!id) { router.replace('/formulier'); return }

    async function fetchContact() {
      try {
        const res  = await fetch(`/api/contacts/${id}`)
        if (!res.ok) return
        const data = await res.json() as Contact
        setContact(data)
        if (data.label) { setLabelReady(true); clearPoll() }
      } catch { /* ignore */ }
    }

    function clearPoll() {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }

    fetchContact()

    // Poll until label arrives (max ~30s)
    let attempts = 0
    pollRef.current = setInterval(() => {
      attempts++
      if (attempts > 10) { clearPoll(); return }
      fetchContact()
    }, 3000)

    return clearPoll
  }, [id, router])

  const lm = contact?.label ? LABEL_META[contact.label] : null
  const createdBy = (contact?.custom_fields as Record<string, unknown> | null)?.created_by as string | null ?? null

  return (
    <div className="min-h-[calc(100svh-44px)] flex flex-col items-center justify-center px-5 py-8 bg-background">

      {/* Check icon */}
      <div className="mb-6 flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
          <CheckCircle size={36} className="text-green-500" strokeWidth={1.8} />
        </div>
        <div className="text-center">
          <h1 className="text-lg font-bold text-primary tracking-tight">Opgeslagen!</h1>
          <p className="text-sm text-muted mt-0.5">
            {company || contact?.company_name || 'Contact'}
          </p>
        </div>
      </div>

      {/* Result card */}
      <div className="w-full max-w-sm bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">

        {/* Classificatie */}
        <div className="px-4 py-3 border-b border-border">
          <div className="text-[11px] font-semibold text-muted uppercase tracking-[0.07em] mb-2">
            Classificatie
          </div>

          {labelReady && lm ? (
            <div className="flex items-center gap-3">
              {/* Label badge */}
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black flex-shrink-0"
                style={{ background: lm.bg, color: lm.text, border: `1px solid ${lm.border}` }}
              >
                {contact!.label}
              </div>
              <div>
                <div className="text-sm font-semibold text-primary leading-tight">{lm.title} {lm.emoji}</div>
                {contact?.revenue != null && (
                  <div className="text-xs text-muted mt-0.5">
                    Geschat volume: <span className="font-semibold text-primary">€{contact.revenue.toLocaleString('nl-NL')}/jr</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 size={13} className="animate-spin flex-shrink-0" />
              <span>Kwalificeren{dots}</span>
            </div>
          )}
        </div>

        {/* Toegewezen aan */}
        <div className="px-4 py-3 border-b border-border">
          <div className="text-[11px] font-semibold text-muted uppercase tracking-[0.07em] mb-1.5">
            Toegewezen aan
          </div>
          {contact?.assigned_to ? (
            <div className="text-sm font-semibold text-primary">{contact.assigned_to}</div>
          ) : labelReady ? (
            <div className="text-sm text-muted">—</div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 size={13} className="animate-spin flex-shrink-0" />
              <span>Routeren{dots}</span>
            </div>
          )}
        </div>

        {/* Aangemaakt door + bron */}
        <div className="px-4 py-3 flex gap-4">
          {createdBy && (
            <div className="flex-1">
              <div className="text-[11px] font-semibold text-muted uppercase tracking-[0.07em] mb-1">Door</div>
              <div className="text-sm text-primary">{createdBy}</div>
            </div>
          )}
          {contact?.source && (
            <div className="flex-1">
              <div className="text-[11px] font-semibold text-muted uppercase tracking-[0.07em] mb-1">Bron</div>
              <div className="text-sm text-primary">{contact.source}</div>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="w-full max-w-sm mt-5 flex flex-col gap-2.5">
        <Link
          href="/formulier"
          className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl bg-white text-[#0a0a0a] font-bold text-sm tracking-[0.02em] hover:opacity-90 transition-opacity"
        >
          <Plus size={15} />
          Nieuw contact
        </Link>
        <Link
          href="/leads"
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-border bg-surface text-primary font-medium text-sm hover:bg-active transition-colors"
        >
          <ListChecks size={15} />
          Bekijk leads
        </Link>
      </div>
    </div>
  )
}
