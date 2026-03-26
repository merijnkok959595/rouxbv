'use client'

import { useState, useEffect, useCallback } from 'react'
import { Brain, Zap, RefreshCw, ToggleLeft, ToggleRight, Search, Globe } from 'lucide-react'

interface IntelligenceConfig {
  system_prompt?:         string | null
  knowledge_base?:        string | null
  enrich_websearch?:      boolean
  enrich_webcrawl?:       boolean
  enrich_maps?:           boolean
  scoring_prompt?:        string | null
}

interface TestResult {
  contact_id: string
  label?:     string | null
  revenue?:   number | null
  summary?:   string | null
  skipped?:   boolean
  reason?:    string
}

function Toggle({ value, onChange, label, sub }: { value: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0' }}>
      <div>
        <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>{label}</p>
        {sub && <p style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>{sub}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: value ? 'var(--text)' : 'var(--muted)', display: 'flex', alignItems: 'center' }}
      >
        {value ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
      </button>
    </div>
  )
}

const LABEL_META: Record<string, { bg: string; text: string }> = {
  A: { bg: 'rgba(220,38,38,0.08)',  text: '#DC2626' },
  B: { bg: 'rgba(217,119,6,0.08)',  text: '#D97706' },
  C: { bg: 'rgba(37,99,235,0.08)',  text: '#2563EB' },
  D: { bg: 'rgba(22,163,74,0.08)',  text: '#16A34A' },
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
      const d   = await res.json()
      setConfig(d)
    } catch {
      flash('Fout bij laden', false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function save(patch: Partial<IntelligenceConfig>) {
    setSaving(true)
    try {
      const res = await fetch('/api/intelligence/config', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(patch),
      })
      if (res.ok) {
        const updated = await res.json()
        setConfig(prev => ({ ...prev, ...updated }))
        flash('Opgeslagen')
      } else {
        flash('Fout bij opslaan', false)
      }
    } finally {
      setSaving(false)
    }
  }

  async function runEnrichAll() {
    setEnrichAll(true)
    try {
      const res = await fetch('/api/intelligence/enrich-all', { method: 'POST' })
      const d   = await res.json()
      flash(`${d.scored ?? 0} van ${d.total ?? 0} contacts verrijkt`)
    } catch {
      flash('Fout bij verrijken', false)
    } finally {
      setEnrichAll(false)
    }
  }

  async function testContact() {
    if (!testContactId.trim()) return
    setTestLoading(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/intelligence/enrich', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ contact_id: testContactId.trim() }),
      })
      const d = await res.json()
      setTestResult(d)
    } catch {
      flash('Fout bij testen', false)
    } finally {
      setTestLoading(false)
    }
  }

  const card: React.CSSProperties = {
    backgroundColor: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: '10px', overflow: 'hidden', marginBottom: '20px',
  }
  const inputStyle: React.CSSProperties = {
    padding: '7px 10px', fontSize: '12px', borderRadius: '6px',
    border: '1px solid var(--border)', backgroundColor: 'var(--bg)',
    color: 'var(--text)', outline: 'none', width: '100%', boxSizing: 'border-box',
  }
  const divider: React.CSSProperties = { borderBottom: '1px solid var(--border)' }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--muted)', fontSize: '14px' }}>Laden…</span>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg)', padding: '24px 20px' }}>
      <div style={{ maxWidth: '820px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em' }}>Qualify</h1>
            <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>AI-verrijking en scoring van leads (A/B/C/D)</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {statusMsg && (
              <span style={{ fontSize: '12px', color: statusMsg.ok ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                {statusMsg.text}
              </span>
            )}
            <button
              onClick={runEnrichAll}
              disabled={enrichAll}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                backgroundColor: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)',
                cursor: enrichAll ? 'default' : 'pointer', opacity: enrichAll ? 0.5 : 1,
              }}
            >
              <RefreshCw size={13} style={{ animation: enrichAll ? 'spin 1s linear infinite' : undefined }} />
              {enrichAll ? 'Verrijken…' : 'Verrijk alle leads'}
            </button>
          </div>
        </div>

        {/* ── Verrijkingsbronnen ── */}
        <div style={card}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Zap size={14} style={{ color: 'var(--muted)' }} />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>Verrijkingsbronnen</span>
          </div>
          <div style={{ padding: '0 16px' }}>
            <div style={divider}>
              <Toggle
                value={config.enrich_websearch ?? true}
                onChange={v => save({ enrich_websearch: v })}
                label="Websearch"
                sub="OpenAI zoekt bedrijfsinfo op via internet (omzet, branche, medewerkers)"
              />
            </div>
            <div style={divider}>
              <Toggle
                value={config.enrich_webcrawl ?? true}
                onChange={v => save({ enrich_webcrawl: v })}
                label="Website crawl"
                sub="Jina AI leest de bedrijfswebsite uit voor concept, capaciteit en menu"
              />
            </div>
            <div>
              <Toggle
                value={config.enrich_maps ?? false}
                onChange={v => save({ enrich_maps: v })}
                label="Google Maps"
                sub="Haalt adres, openingstijden, rating en reviewcount op via Outscraper"
              />
            </div>
          </div>
        </div>

        {/* ── Scoring instructies ── */}
        <div style={card}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Brain size={14} style={{ color: 'var(--muted)' }} />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>Scoring instructies (A/B/C/D)</span>
          </div>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <p style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.65 }}>
              Beschrijf hoe de AI elke lead moet scoren. Vermeld welke signalen een A-lead maken (hoogste prioriteit) versus D-lead (laagste). Gebruik concrete criteria: omzetschattingen, bedrijfstype, locatie, concept, enz.
            </p>
            <textarea
              rows={8}
              placeholder={`Bijv:\nA-label: Restaurant met €200k+ omzet, zelfstandig concept, professionele keuken, actief op events.\nB-label: Restaurant met €100-200k omzet of ketenkanton met 2-5 vestigingen.\nC-label: Kleine lunchroom, foodtruck of bar met laag volume.\nD-label: Supermarkt, kantinebeheerder, niet-horeca.`}
              defaultValue={config.scoring_prompt ?? ''}
              onBlur={e => save({ scoring_prompt: e.target.value || null })}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.65 }}
            />
          </div>
        </div>

        {/* ── Systeemprompt (context voor AI) ── */}
        <div style={card}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Search size={14} style={{ color: 'var(--muted)' }} />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>Bedrijfscontext (voor AI)</span>
          </div>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <p style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.65 }}>
              Beschrijf jullie bedrijf en product voor de AI. Dit helpt bij het inschatten van klantfit wanneer geen scoring-instructies zijn ingesteld.
            </p>
            <textarea
              rows={4}
              placeholder="Bijv: Wij zijn ROUX, leverancier van foodservice-ingrediënten voor de horeca. Onze beste klanten zijn zelfstandige restaurants met een omzet van €150k+ per jaar."
              defaultValue={config.system_prompt ?? ''}
              onBlur={e => save({ system_prompt: e.target.value || null })}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.65 }}
            />
          </div>
        </div>

        {/* ── Test op één contact ── */}
        <div style={card}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Globe size={14} style={{ color: 'var(--muted)' }} />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>Test op contact</span>
          </div>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={{ fontSize: '12px', color: 'var(--muted)' }}>
              Voer een contact-ID in (te vinden in de leads pagina) om de verrijking live te testen.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                placeholder="Contact UUID"
                value={testContactId}
                onChange={e => setTestContactId(e.target.value)}
                style={{ ...inputStyle, maxWidth: '380px' }}
              />
              <button
                onClick={testContact}
                disabled={testLoading || !testContactId.trim()}
                style={{
                  padding: '7px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                  backgroundColor: 'var(--text)', color: 'var(--surface)', border: 'none',
                  cursor: testLoading || !testContactId.trim() ? 'default' : 'pointer',
                  opacity: testLoading || !testContactId.trim() ? 0.5 : 1,
                }}
              >
                {testLoading ? 'Testen…' : 'Test'}
              </button>
            </div>

            {testResult && (
              <div style={{ padding: '14px', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {testResult.skipped ? (
                  <p style={{ fontSize: '12px', color: 'var(--muted)' }}>Overgeslagen: {testResult.reason}</p>
                ) : (
                  <>
                    {testResult.label && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          padding: '3px 10px', borderRadius: '5px', fontSize: '13px', fontWeight: 700,
                          backgroundColor: LABEL_META[testResult.label]?.bg ?? 'var(--active)',
                          color:           LABEL_META[testResult.label]?.text ?? 'var(--text)',
                        }}>
                          {testResult.label}
                        </span>
                        {testResult.revenue != null && (
                          <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                            €{testResult.revenue.toLocaleString('nl-NL')}/jaar
                          </span>
                        )}
                      </div>
                    )}
                    {testResult.summary && (
                      <p style={{ fontSize: '12px', color: 'var(--text)', lineHeight: 1.65 }}>{testResult.summary}</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {saving && <p style={{ fontSize: '12px', color: 'var(--muted)', textAlign: 'center' }}>Opslaan…</p>}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}
