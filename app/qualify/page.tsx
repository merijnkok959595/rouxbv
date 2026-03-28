'use client'

import { useState, useEffect, useCallback } from 'react'
import { Brain, Zap, RefreshCw, ToggleLeft, ToggleRight, Search, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'

interface IntelligenceConfig {
  system_prompt?:    string | null
  knowledge_base?:   string | null
  enrich_websearch?: boolean
  enrich_webcrawl?:  boolean
  enrich_maps?:      boolean
  scoring_prompt?:   string | null
}

interface TestResult {
  contact_id: string
  label?:     string | null
  revenue?:   number | null
  summary?:   string | null
  skipped?:   boolean
  reason?:    string
}

const LABEL_META: Record<string, { bg: string; text: string }> = {
  A: { bg: 'rgba(220,38,38,0.08)',  text: '#DC2626' },
  B: { bg: 'rgba(217,119,6,0.08)',  text: '#D97706' },
  C: { bg: 'rgba(37,99,235,0.08)',  text: '#2563EB' },
  D: { bg: 'rgba(22,163,74,0.08)',  text: '#16A34A' },
}

function Toggle({ value, onChange, label, sub }: { value: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="text-[13px] font-semibold text-primary">{label}</p>
        {sub && <p className="text-[11px] text-muted mt-0.5">{sub}</p>}
      </div>
      <button onClick={() => onChange(!value)} className="bg-transparent border-none cursor-pointer flex items-center"
        style={{ color: value ? 'var(--text)' : 'var(--muted)' }}>
        {value ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
      </button>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-surface border border-border rounded-[10px] overflow-hidden mb-5">{children}</div>
}

function CardHead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
      <span className="text-muted flex">{icon}</span>
      <span className="text-[13px] font-semibold text-primary">{title}</span>
    </div>
  )
}

export default function QualifyPage() {
  const [config,      setConfig]      = useState<IntelligenceConfig>({})
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [enrichAll,   setEnrichAll]   = useState(false)
  const [statusMsg,   setStatusMsg]   = useState<{ text: string; ok: boolean } | null>(null)
  const [testResult,  setTestResult]  = useState<TestResult | null>(null)
  const [testLoading, setTestLoading] = useState(false)
  const [testContactId, setTestContactId] = useState('')

  const flash = (text: string, ok = true) => { setStatusMsg({ text, ok }); setTimeout(() => setStatusMsg(null), 3500) }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/intelligence/config')
      setConfig(await res.json())
    } catch { flash('Fout bij laden', false) }
    finally  { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function save(patch: Partial<IntelligenceConfig>) {
    setSaving(true)
    try {
      const res = await fetch('/api/intelligence/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      if (res.ok) { const updated = await res.json(); setConfig(prev => ({ ...prev, ...updated })); flash('Opgeslagen') }
      else flash('Fout bij opslaan', false)
    } finally { setSaving(false) }
  }

  async function runEnrichAll() {
    setEnrichAll(true)
    try {
      const res = await fetch('/api/intelligence/enrich-all', { method: 'POST' })
      const d   = await res.json()
      flash(`${d.scored ?? 0} van ${d.total ?? 0} contacts verrijkt`)
    } catch { flash('Fout bij verrijken', false) }
    finally { setEnrichAll(false) }
  }

  async function testContact() {
    if (!testContactId.trim()) return
    setTestLoading(true); setTestResult(null)
    try {
      const res = await fetch('/api/intelligence/enrich', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contact_id: testContactId.trim() }) })
      setTestResult(await res.json())
    } catch { flash('Fout bij testen', false) }
    finally { setTestLoading(false) }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <span className="text-sm text-muted">Laden…</span>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg px-5 py-6">
      <div className="max-w-[820px] mx-auto">

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[18px] font-extrabold text-primary tracking-tight">Qualify</h1>
            <p className="text-xs text-muted mt-0.5">AI-verrijking en scoring van leads (A/B/C/D)</p>
          </div>
          <div className="flex gap-2 items-center">
            {statusMsg && (
              <span className={cn('text-xs font-semibold', statusMsg.ok ? 'text-green-600' : 'text-red-600')}>
                {statusMsg.text}
              </span>
            )}
            <button onClick={runEnrichAll} disabled={enrichAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-muted bg-transparent border border-border cursor-pointer disabled:opacity-50 disabled:cursor-default hover:bg-active transition-colors">
              <RefreshCw size={13} className={cn(enrichAll && 'animate-spin')} />
              {enrichAll ? 'Verrijken…' : 'Verrijk alle leads'}
            </button>
          </div>
        </div>

        {/* Verrijkingsbronnen */}
        <Card>
          <CardHead icon={<Zap size={14} />} title="Verrijkingsbronnen" />
          <div className="px-4">
            <div className="border-b border-border">
              <Toggle value={config.enrich_websearch ?? true} onChange={v => save({ enrich_websearch: v })} label="Websearch" sub="OpenAI zoekt bedrijfsinfo op via internet (omzet, branche, medewerkers)" />
            </div>
            <div className="border-b border-border">
              <Toggle value={config.enrich_webcrawl ?? true} onChange={v => save({ enrich_webcrawl: v })} label="Website crawl" sub="Jina AI leest de bedrijfswebsite uit voor concept, capaciteit en menu" />
            </div>
            <Toggle value={config.enrich_maps ?? false} onChange={v => save({ enrich_maps: v })} label="Google Maps" sub="Haalt adres, openingstijden, rating en reviewcount op via Google Places" />
          </div>
        </Card>

        {/* Scoring instructies */}
        <Card>
          <CardHead icon={<Brain size={14} />} title="Scoring instructies (A/B/C/D)" />
          <div className="px-4 py-3.5 flex flex-col gap-2.5">
            <p className="text-xs text-muted leading-relaxed">Beschrijf hoe de AI elke lead moet scoren. Vermeld welke signalen een A-lead maken vs. D-lead.</p>
            <textarea
              rows={8}
              placeholder={`Bijv:\nA-label: Restaurant met €200k+ omzet, zelfstandig concept.\nB-label: Restaurant met €100-200k omzet.\nC-label: Kleine lunchroom, foodtruck of bar.\nD-label: Supermarkt, kantinebeheerder, niet-horeca.`}
              defaultValue={config.scoring_prompt ?? ''}
              onBlur={e => save({ scoring_prompt: e.target.value || null })}
              className="field-input resize-y leading-relaxed"
            />
          </div>
        </Card>

        {/* Systeemprompt */}
        <Card>
          <CardHead icon={<Search size={14} />} title="Bedrijfscontext (voor AI)" />
          <div className="px-4 py-3.5 flex flex-col gap-2.5">
            <p className="text-xs text-muted leading-relaxed">Beschrijf jullie bedrijf en product voor de AI.</p>
            <textarea
              rows={4}
              placeholder="Bijv: Wij zijn ROUX, leverancier van foodservice-ingrediënten voor de horeca."
              defaultValue={config.system_prompt ?? ''}
              onBlur={e => save({ system_prompt: e.target.value || null })}
              className="field-input resize-y leading-relaxed"
            />
          </div>
        </Card>

        {/* Test op contact */}
        <Card>
          <CardHead icon={<Globe size={14} />} title="Test op contact" />
          <div className="px-4 py-3.5 flex flex-col gap-3">
            <p className="text-xs text-muted">Voer een contact-ID in om de verrijking live te testen.</p>
            <div className="flex gap-2">
              <input
                placeholder="Contact UUID"
                value={testContactId}
                onChange={e => setTestContactId(e.target.value)}
                className="field-input max-w-[380px]"
              />
              <button
                onClick={testContact}
                disabled={testLoading || !testContactId.trim()}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-primary text-white border-none cursor-pointer disabled:opacity-50 disabled:cursor-default hover:opacity-90 transition-opacity"
              >
                {testLoading ? 'Testen…' : 'Test'}
              </button>
            </div>

            {testResult && (
              <div className="px-3.5 py-3.5 rounded-lg border border-border bg-bg flex flex-col gap-2">
                {testResult.skipped ? (
                  <p className="text-xs text-muted">Overgeslagen: {testResult.reason}</p>
                ) : (
                  <>
                    {testResult.label && (
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded text-[13px] font-bold"
                          style={{ backgroundColor: LABEL_META[testResult.label]?.bg ?? 'var(--active)', color: LABEL_META[testResult.label]?.text ?? 'var(--text)' }}>
                          {testResult.label}
                        </span>
                        {testResult.revenue != null && (
                          <span className="text-xs text-muted">€{testResult.revenue.toLocaleString('nl-NL')}/jaar</span>
                        )}
                      </div>
                    )}
                    {testResult.summary && (
                      <p className="text-xs text-primary leading-relaxed">{testResult.summary}</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </Card>

        {saving && <p className="text-xs text-muted text-center">Opslaan…</p>}
      </div>
    </div>
  )
}
