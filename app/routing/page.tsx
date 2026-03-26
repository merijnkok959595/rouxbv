'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, GitBranch, Users, Settings2, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface TeamMember {
  id:              string
  naam:            string
  email?:          string
  postcode_ranges: string[]
  active:          boolean
}

interface RoutingRule {
  id:             string
  phase:          'pre' | 'body'
  condition:      'name_contains' | 'industry_is' | 'postcode_starts'
  value:          string
  assign_to_id:   string | null
  assign_to_naam: string | null
  position:       number
  active:         boolean
}

interface RoutingConfig {
  organization_id:             string
  pre_routing_prompt:          string | null
  pre_routing_assign_to_id:    string | null
  pre_routing_assign_to_naam:  string | null
  pre_routing_websearch:       boolean
  fallback_user_id:            string | null
  fallback_user_naam:          string | null
  routing_disabled:            boolean
  skip_pre:                    boolean
  skip_body:                   boolean
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ icon, title, action }: { icon: React.ReactNode; title: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: 'var(--muted)', display: 'flex' }}>{icon}</span>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>{title}</span>
      </div>
      {action}
    </div>
  )
}

function Btn({
  label, onClick, variant = 'primary', disabled = false, icon,
}: {
  label: string; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; icon?: React.ReactNode
}) {
  const bg   = variant === 'primary' ? 'var(--text)' : variant === 'danger' ? '#fee2e2' : 'transparent'
  const fg   = variant === 'primary' ? 'var(--surface)' : variant === 'danger' ? '#dc2626' : 'var(--muted)'
  const bord = variant === 'ghost' ? '1px solid var(--border)' : variant === 'danger' ? '1px solid #fecaca' : 'none'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
        backgroundColor: bg, color: fg, border: bord, cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon}{label}
    </button>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: value ? 'var(--text)' : 'var(--muted)', display: 'flex', alignItems: 'center' }}
    >
      {value ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RoutingPage() {
  const [members,    setMembers]    = useState<TeamMember[]>([])
  const [rules,      setRules]      = useState<RoutingRule[]>([])
  const [config,     setConfig]     = useState<RoutingConfig | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [rerunning,  setRerunning]  = useState(false)
  const [statusMsg,  setStatusMsg]  = useState<{ text: string; ok: boolean } | null>(null)

  // New member form state
  const [newNaam,           setNewNaam]           = useState('')
  const [newEmail,          setNewEmail]          = useState('')
  const [newPostcodeRanges, setNewPostcodeRanges] = useState('')

  // New rule form state
  const [newRulePhase,    setNewRulePhase]    = useState<'pre' | 'body'>('body')
  const [newRuleCondition,setNewRuleCondition]= useState<'name_contains' | 'industry_is' | 'postcode_starts'>('name_contains')
  const [newRuleValue,    setNewRuleValue]    = useState('')
  const [newRuleAssignId, setNewRuleAssignId] = useState('')

  const flash = (text: string, ok = true) => { setStatusMsg({ text, ok }); setTimeout(() => setStatusMsg(null), 3500) }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cfgRes, membersRes] = await Promise.all([
        fetch('/api/routing/config').then(r => r.json()),
        fetch('/api/settings/employees').then(r => r.json()),
      ])
      setConfig(cfgRes.config ?? null)
      setRules(cfgRes.rules  ?? [])
      setMembers(Array.isArray(membersRes) ? membersRes : (membersRes.employees ?? []))
    } catch {
      flash('Fout bij laden', false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Team members ────────────────────────────────────────────────────────────

  async function addMember() {
    if (!newNaam.trim()) return
    const postcode_ranges = newPostcodeRanges
      .split(/[,\s]+/)
      .map(s => s.trim())
      .filter(Boolean)
    const res = await fetch('/api/settings/employees', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ naam: newNaam.trim(), email: newEmail.trim() || null, postcode_ranges }),
    })
    if (res.ok) {
      setNewNaam(''); setNewEmail(''); setNewPostcodeRanges('')
      flash('Teamlid toegevoegd')
      load()
    } else {
      flash('Fout bij toevoegen', false)
    }
  }

  async function deleteMember(id: string) {
    if (!confirm('Teamlid verwijderen?')) return
    const res = await fetch(`/api/settings/employees/${id}`, { method: 'DELETE' })
    if (res.ok) { flash('Verwijderd'); load() }
    else flash('Fout bij verwijderen', false)
  }

  // ── Routing rules ───────────────────────────────────────────────────────────

  async function addRule() {
    if (!newRuleValue.trim()) return
    const res = await fetch('/api/routing/rules', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        phase:         newRulePhase,
        condition:     newRuleCondition,
        value:         newRuleValue.trim(),
        assign_to_id:  newRuleAssignId || null,
      }),
    })
    if (res.ok) {
      setNewRuleValue(''); setNewRuleAssignId('')
      flash('Regel toegevoegd')
      load()
    } else {
      flash('Fout bij toevoegen', false)
    }
  }

  async function deleteRule(id: string) {
    const res = await fetch(`/api/routing/rules/${id}`, { method: 'DELETE' })
    if (res.ok) { load() }
    else flash('Fout bij verwijderen', false)
  }

  // ── Config ──────────────────────────────────────────────────────────────────

  async function updateConfig(patch: Partial<RoutingConfig>) {
    setSaving(true)
    try {
      const res = await fetch('/api/routing/config', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(patch),
      })
      if (res.ok) {
        const updated = await res.json()
        setConfig(prev => ({ ...prev!, ...updated }))
        flash('Opgeslagen')
      } else {
        flash('Fout bij opslaan', false)
      }
    } finally {
      setSaving(false)
    }
  }

  async function rerunAll() {
    setRerunning(true)
    try {
      const res = await fetch('/api/routing/apply-all', { method: 'POST' })
      const d   = await res.json()
      flash(`${d.updated ?? 0} van ${d.total ?? 0} contacts gerouteerd`)
      load()
    } catch {
      flash('Fout bij herrouten', false)
    } finally {
      setRerunning(false)
    }
  }

  // ── Styles ──────────────────────────────────────────────────────────────────

  const card: React.CSSProperties = {
    backgroundColor: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: '10px', overflow: 'hidden', marginBottom: '20px',
  }
  const input: React.CSSProperties = {
    padding: '7px 10px', fontSize: '12px', borderRadius: '6px',
    border: '1px solid var(--border)', backgroundColor: 'var(--bg)',
    color: 'var(--text)', outline: 'none',
  }
  const sel: React.CSSProperties = { ...input }
  const TH: React.CSSProperties = {
    fontSize: '11px', fontWeight: 600, color: 'var(--muted)', padding: '8px 14px',
    borderBottom: '1px solid var(--border)', textAlign: 'left',
    textTransform: 'uppercase', letterSpacing: '0.05em',
  }
  const TD = (last: boolean): React.CSSProperties => ({
    fontSize: '12px', padding: '9px 14px', color: 'var(--text)',
    borderBottom: last ? 'none' : '1px solid var(--border)',
  })

  const CONDITION_LABELS: Record<string, string> = {
    name_contains:   'Bedrijfsnaam bevat',
    industry_is:     'Industrie is',
    postcode_starts: 'Postcode begint met',
  }

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
            <h1 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em' }}>Routing</h1>
            <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>Wijs leads automatisch toe aan teamleden</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {statusMsg && (
              <span style={{ fontSize: '12px', color: statusMsg.ok ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                {statusMsg.text}
              </span>
            )}
            <Btn
              label={rerunning ? 'Herrouten…' : 'Herroute alle leads'}
              onClick={rerunAll}
              variant="ghost"
              disabled={rerunning}
              icon={<RefreshCw size={13} />}
            />
          </div>
        </div>

        {/* ── Instellingen ── */}
        <div style={card}>
          <SectionHeader icon={<Settings2 size={14} />} title="Instellingen" />
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

            {/* Routing aan/uit */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>Routing actief</p>
                <p style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>Schakel routing uit om alle toewijzingen te pauzeren</p>
              </div>
              <Toggle
                value={!(config?.routing_disabled ?? false)}
                onChange={v => updateConfig({ routing_disabled: !v })}
              />
            </div>

            {/* Fallback */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>Fallback persoon</p>
                <p style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>Wie krijgt leads die geen regel matchen?</p>
              </div>
              <select
                style={{ ...sel, width: '180px' }}
                value={config?.fallback_user_id ?? ''}
                onChange={e => updateConfig({ fallback_user_id: e.target.value || null })}
              >
                <option value="">— geen —</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.naam}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* ── Teamleden ── */}
        <div style={card}>
          <SectionHeader icon={<Users size={14} />} title="Teamleden" />

          {members.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={TH}>Naam</th>
                  <th style={TH}>Postcodegebieden</th>
                  <th style={{ ...TH, width: '44px' }}></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m, i) => (
                  <tr key={m.id}>
                    <td style={TD(i === members.length - 1)}>
                      <p style={{ fontWeight: 600 }}>{m.naam}</p>
                      {m.email && <p style={{ color: 'var(--muted)', fontSize: '11px' }}>{m.email}</p>}
                    </td>
                    <td style={TD(i === members.length - 1)}>
                      {(m.postcode_ranges ?? []).length > 0
                        ? <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {m.postcode_ranges.map(r => (
                              <span key={r} style={{ padding: '2px 7px', borderRadius: '4px', backgroundColor: 'var(--active)', fontSize: '11px', color: 'var(--text)', border: '1px solid var(--border)' }}>{r}</span>
                            ))}
                          </div>
                        : <span style={{ color: 'var(--muted)', fontSize: '11px' }}>—</span>
                      }
                    </td>
                    <td style={TD(i === members.length - 1)}>
                      <button onClick={() => deleteMember(m.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex' }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Add member form */}
          <div style={{ padding: '12px 16px', borderTop: members.length > 0 ? '1px solid var(--border)' : undefined, display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <input
              placeholder="Naam *"
              value={newNaam}
              onChange={e => setNewNaam(e.target.value)}
              style={{ ...input, width: '140px' }}
            />
            <input
              placeholder="E-mail"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              style={{ ...input, width: '180px' }}
            />
            <input
              placeholder="Postcodes (bijv. 10, 20, 30)"
              value={newPostcodeRanges}
              onChange={e => setNewPostcodeRanges(e.target.value)}
              style={{ ...input, width: '220px' }}
            />
            <Btn label="Toevoegen" onClick={addMember} disabled={!newNaam.trim()} icon={<Plus size={12} />} />
          </div>
        </div>

        {/* ── Routing regels ── */}
        <div style={card}>
          <SectionHeader icon={<GitBranch size={14} />} title="Routing regels" />

          {rules.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={TH}>Fase</th>
                  <th style={TH}>Conditie</th>
                  <th style={TH}>Waarde</th>
                  <th style={TH}>Toewijzen aan</th>
                  <th style={{ ...TH, width: '44px' }}></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r, i) => (
                  <tr key={r.id}>
                    <td style={TD(i === rules.length - 1)}>
                      <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, backgroundColor: r.phase === 'pre' ? 'rgba(99,102,241,0.1)' : 'rgba(16,163,74,0.08)', color: r.phase === 'pre' ? '#6366f1' : '#16a34a', border: `1px solid ${r.phase === 'pre' ? 'rgba(99,102,241,0.2)' : 'rgba(16,163,74,0.15)'}` }}>
                        {r.phase.toUpperCase()}
                      </span>
                    </td>
                    <td style={TD(i === rules.length - 1)}>{CONDITION_LABELS[r.condition] ?? r.condition}</td>
                    <td style={{ ...TD(i === rules.length - 1), fontWeight: 600 }}>{r.value}</td>
                    <td style={TD(i === rules.length - 1)}>{r.assign_to_naam ?? <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                    <td style={TD(i === rules.length - 1)}>
                      <button onClick={() => deleteRule(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex' }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Add rule form */}
          <div style={{ padding: '12px 16px', borderTop: rules.length > 0 ? '1px solid var(--border)' : undefined, display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <select value={newRulePhase} onChange={e => setNewRulePhase(e.target.value as 'pre' | 'body')} style={{ ...sel, width: '90px' }}>
              <option value="pre">PRE</option>
              <option value="body">BODY</option>
            </select>
            <select value={newRuleCondition} onChange={e => setNewRuleCondition(e.target.value as typeof newRuleCondition)} style={{ ...sel, width: '200px' }}>
              <option value="name_contains">Bedrijfsnaam bevat</option>
              <option value="industry_is">Industrie is</option>
              <option value="postcode_starts">Postcode begint met</option>
            </select>
            <input
              placeholder="Waarde *"
              value={newRuleValue}
              onChange={e => setNewRuleValue(e.target.value)}
              style={{ ...input, width: '140px' }}
            />
            <select
              value={newRuleAssignId}
              onChange={e => setNewRuleAssignId(e.target.value)}
              style={{ ...sel, width: '160px' }}
            >
              <option value="">— toewijzen aan —</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.naam}</option>)}
            </select>
            <Btn label="Toevoegen" onClick={addRule} disabled={!newRuleValue.trim()} icon={<Plus size={12} />} />
          </div>
        </div>

        {/* ── AI pre-routing prompt ── */}
        <div style={card}>
          <SectionHeader icon={<GitBranch size={14} />} title="AI pre-routing (optioneel)" />
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.6 }}>
              Gebruik AI om specifieke leads (bijv. groothandels, ketenaccounts) automatisch te herkennen en toe te wijzen vóór de gewone regels worden uitgevoerd.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Prompt voor AI classifier</label>
              <textarea
                rows={4}
                placeholder="Bijv: Wijs toe als het bedrijf een groothandel, keten of cateraar met 200+ medewerkers is."
                defaultValue={config?.pre_routing_prompt ?? ''}
                onBlur={e => updateConfig({ pre_routing_prompt: e.target.value || null })}
                style={{ ...input, width: '100%', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text)' }}>Toewijzen aan</label>
                <select
                  style={{ ...sel, width: '160px' }}
                  value={config?.pre_routing_assign_to_id ?? ''}
                  onChange={e => updateConfig({ pre_routing_assign_to_id: e.target.value || null })}
                >
                  <option value="">— niemand —</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.naam}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Toggle value={config?.pre_routing_websearch ?? false} onChange={v => updateConfig({ pre_routing_websearch: v })} />
                <label style={{ fontSize: '12px', color: 'var(--text)' }}>Websearch gebruiken</label>
              </div>
            </div>
          </div>
        </div>

        {saving && <p style={{ fontSize: '12px', color: 'var(--muted)', textAlign: 'center' }}>Opslaan…</p>}
      </div>
    </div>
  )
}
