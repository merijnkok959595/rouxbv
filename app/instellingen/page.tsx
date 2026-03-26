'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  Users, GitBranch, Brain,
  Plus, Trash2, RefreshCw, Pencil, Check, X,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TeamMember {
  id:              string
  naam:            string
  email?:          string | null
  phone?:          string | null
  functie?:        string | null
  rayon?:          string | null
  ghl_user_id?:    string | null
  calendar_id?:    string | null
  postcode_ranges: string[]
  color?:          string | null
  active:          boolean
}

const COLOR_PALETTE = [
  '#6366F1', '#8B5CF6', '#0EA5E9', '#64748B',
  '#F59E0B', '#EF4444', '#EC4899', '#14B8A6', '#F97316',
]

interface RoutingRule {
  id:              string
  phase:           'pre' | 'body'
  condition:       'name_contains' | 'industry_is' | 'postcode_starts'
  value:           string
  assign_to_id:    string | null
  assign_to_naam:  string | null
  position:        number
}

interface RoutingConfig {
  organization_id?:            string
  pre_routing_prompt:          string | null
  pre_routing_assign_to_id:    string | null
  pre_routing_assign_to_naam?: string | null
  pre_routing_websearch:       boolean
  fallback_user_id:            string | null
  fallback_user_naam?:         string | null
  routing_disabled:            boolean
  skip_pre:                    boolean
  skip_body:                   boolean
}

interface IntelligenceConfig {
  system_prompt?:        string | null
  knowledge_base?:       string | null
  enrich_websearch?:     boolean
  enrich_webcrawl?:      boolean
  enrich_maps?:          boolean
  scoring_prompt?:       string | null
  benchmark_customers?:  BenchmarkCustomer[]
}

type BenchmarkCustomer = {
  id:      number
  name:    string
  city:    string
  revenue: number
  label:   'A' | 'B' | 'C' | 'D' | ''
}

const LABEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  A: { bg: 'rgba(220,38,38,0.08)',  text: '#DC2626', border: 'rgba(220,38,38,0.25)'  },
  B: { bg: 'rgba(217,119,6,0.08)',  text: '#D97706', border: 'rgba(217,119,6,0.25)'  },
  C: { bg: 'rgba(37,99,235,0.08)',  text: '#2563EB', border: 'rgba(37,99,235,0.25)'  },
  D: { bg: 'rgba(22,163,74,0.08)',  text: '#16A34A', border: 'rgba(22,163,74,0.25)'  },
}

type Tab = 'gebruikers' | 'routing' | 'qualify'

// ── Shared primitives ─────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  padding: '9px 12px', fontSize: '14px', borderRadius: '7px',
  border: '1px solid var(--border)', backgroundColor: 'var(--surface)',
  color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
}

const lbl: React.CSSProperties = {
  fontSize: '13px', fontWeight: 700, color: 'var(--text)', letterSpacing: '0.01em',
}

function LF({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      <label style={lbl}>{label}</label>
      {children}
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        position: 'relative', flexShrink: 0,
        width: '38px', height: '21px', borderRadius: '11px',
        backgroundColor: value ? '#111' : '#d1d5db',
        border: 'none', cursor: 'pointer',
        transition: 'background-color 0.15s',
        padding: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: '2.5px',
        left: value ? '19px' : '2.5px',
        width: '16px', height: '16px', borderRadius: '50%',
        backgroundColor: '#fff',
        transition: 'left 0.15s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        display: 'block',
      }} />
    </button>
  )
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ padding: '2px 7px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, backgroundColor: `${color}18`, color, border: `1px solid ${color}30` }}>
      {text}
    </span>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden', marginBottom: '16px' }}>
      {children}
    </div>
  )
}

function CardHeader({ icon, title, action }: { icon: React.ReactNode; title: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <span style={{ color: 'var(--muted)', display: 'flex' }}>{icon}</span>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>{title}</span>
      </div>
      {action}
    </div>
  )
}

const TH: React.CSSProperties = {
  fontSize: '11px', fontWeight: 600, color: 'var(--muted)', padding: '8px 14px',
  textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em',
  borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
}
const TD = (last: boolean): React.CSSProperties => ({
  fontSize: '12px', padding: '9px 14px', color: 'var(--text)', verticalAlign: 'middle',
  borderBottom: last ? 'none' : '1px solid var(--border)',
})

// ── Main page ─────────────────────────────────────────────────────────────────

export default function InstellingenPage() {
  const [tab,     setTab]     = useState<Tab>('gebruikers')
  const [members, setMembers] = useState<TeamMember[]>([])
  const [rules,   setRules]   = useState<RoutingRule[]>([])
  const [rCfg,    setRCfg]    = useState<RoutingConfig | null>(null)
  const [qCfg,    setQCfg]    = useState<IntelligenceConfig>({})
  const [loading, setLoading] = useState(true)
  const [status,  setStatus]  = useState<{ text: string; ok: boolean } | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [rerunR,  setRerunR]  = useState(false)
  const [rerunQ,  setRerunQ]  = useState(false)

  // add-member form
  const [mNaam,    setMNaam]    = useState('')
  const [mEmail,   setMEmail]   = useState('')
  const [mFunctie, setMFunctie] = useState('')
  const [mRayon,   setMRayon]   = useState('')
  const [mPc,      setMPc]      = useState('')

  // edit-member inline
  const [editId,         setEditId]         = useState<string | null>(null)
  const [editNaam,       setEditNaam]       = useState('')
  const [editEmail,      setEditEmail]      = useState('')
  const [editPhone,      setEditPhone]      = useState('')
  const [editFunctie,    setEditFunctie]    = useState('')
  const [editRayon,      setEditRayon]      = useState('')
  const [editPc,         setEditPc]         = useState('')
  const [editColor,      setEditColor]      = useState('')
  const [editGhlUserId,  setEditGhlUserId]  = useState('')
  const [editCalendarId, setEditCalendarId] = useState('')
  const [mColor,      setMColor]      = useState(COLOR_PALETTE[0])
  const [colorPickerId, setColorPickerId] = useState<string | null>(null)
  const [showAddForm,   setShowAddForm]   = useState(false)

  // benchmark state
  const [benchmarks, setBenchmarks] = useState<BenchmarkCustomer[]>([])
  const [bName,  setBName]  = useState('')
  const [bCity,  setBCity]  = useState('')
  const [bRev,   setBRev]   = useState('')
  const [bLabel, setBLabel] = useState<BenchmarkCustomer['label']>('')

  // add-rule form
  const [rPhase, setRPhase] = useState<'pre' | 'body'>('body')
  const [rCond,  setRCond]  = useState<'name_contains' | 'industry_is' | 'postcode_starts'>('name_contains')
  const [rVal,   setRVal]   = useState('')
  const [rAssign,setRAssign]= useState('')

  const flash = (text: string, ok = true) => { setStatus({ text, ok }); setTimeout(() => setStatus(null), 3000) }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [mRes, rcRes, qRes] = await Promise.all([
        fetch('/api/settings/employees').then(r => r.json()),
        fetch('/api/routing/config').then(r => r.json()),
        fetch('/api/intelligence/config').then(r => r.json()),
      ])
      setMembers(Array.isArray(mRes) ? mRes : [])
      setRules(rcRes.rules ?? [])
      setRCfg(rcRes.config ?? null)
      setQCfg(qRes ?? {})
      if (Array.isArray(qRes?.benchmark_customers) && qRes.benchmark_customers.length > 0) {
        setBenchmarks(qRes.benchmark_customers as BenchmarkCustomer[])
      }
    } catch {
      flash('Laadprobleem', false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Gebruikers actions ───────────────────────────────────────────────────────

  async function seedUsers() {
    setSeeding(true)
    try {
      const res = await fetch('/api/settings/seed-users', { method: 'POST' })
      const d   = await res.json()
      if (res.ok) { flash(`${d.inserted} gebruikers geïmporteerd`); load() }
      else flash(d.error ?? 'Fout', false)
    } finally {
      setSeeding(false)
    }
  }

  async function addMember() {
    if (!mNaam.trim()) return
    const postcode_ranges = mPc.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
    const res = await fetch('/api/settings/employees', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ naam: mNaam.trim(), email: mEmail.trim() || null, functie: mFunctie.trim() || null, rayon: mRayon.trim() || null, postcode_ranges, color: mColor }),
    })
    if (res.ok) { setMNaam(''); setMEmail(''); setMFunctie(''); setMRayon(''); setMPc(''); setMColor(COLOR_PALETTE[0]); setShowAddForm(false); flash('Toegevoegd'); load() }
    else flash('Fout', false)
  }

  async function deleteMember(id: string) {
    if (!confirm('Verwijderen?')) return
    const res = await fetch(`/api/settings/employees/${id}`, { method: 'DELETE' })
    if (res.ok) { flash('Verwijderd'); load() } else flash('Fout', false)
  }

  async function quickSetColor(id: string, color: string) {
    setColorPickerId(null)
    await fetch(`/api/settings/employees/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ color }),
    })
    load()
  }

  function startEdit(m: TeamMember) {
    setEditId(m.id)
    setEditNaam(m.naam)
    setEditEmail(m.email ?? '')
    setEditPhone(m.phone ?? '')
    setEditFunctie(m.functie ?? '')
    setEditRayon(m.rayon ?? '')
    setEditPc((m.postcode_ranges ?? []).join(', '))
    setEditColor(m.color ?? COLOR_PALETTE[0])
    setEditGhlUserId(m.ghl_user_id ?? '')
    setEditCalendarId(m.calendar_id ?? '')
  }

  async function saveMember() {
    if (!editId || !editNaam.trim()) return
    const postcode_ranges = editPc.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
    const res = await fetch(`/api/settings/employees/${editId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        naam:             editNaam.trim(),
        email:            editEmail.trim()      || null,
        phone:            editPhone.trim()      || null,
        functie:          editFunctie.trim()    || null,
        rayon:            editRayon.trim()      || null,
        postcode_ranges,
        color:            editColor             || null,
        ghl_user_id:      editGhlUserId.trim()  || null,
        calendar_id:      editCalendarId.trim() || null,
      }),
    })
    if (res.ok) { setEditId(null); flash('Opgeslagen'); load() }
    else flash('Fout', false)
  }

  // ── Routing actions ──────────────────────────────────────────────────────────

  async function saveRCfg(patch: Partial<RoutingConfig>) {
    const res = await fetch('/api/routing/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (res.ok) { const d = await res.json(); setRCfg(p => ({ ...p!, ...d })); flash('Opgeslagen') }
    else flash('Fout', false)
  }

  async function addRule() {
    if (!rVal.trim()) return
    const res = await fetch('/api/routing/rules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase: rPhase, condition: rCond, value: rVal.trim(), assign_to_id: rAssign || null }),
    })
    if (res.ok) { setRVal(''); setRAssign(''); flash('Regel toegevoegd'); load() }
    else flash('Fout', false)
  }

  async function deleteRule(id: string) {
    const res = await fetch(`/api/routing/rules/${id}`, { method: 'DELETE' })
    if (res.ok) { load() } else { flash('Fout', false) }
  }

  async function rerunRouting() {
    setRerunR(true)
    const res = await fetch('/api/routing/apply-all', { method: 'POST' })
    const d   = await res.json()
    flash(`${d.updated ?? 0} / ${d.total ?? 0} gerouteerd`)
    setRerunR(false)
  }

  // ── Qualify actions ──────────────────────────────────────────────────────────

  async function saveQCfg(patch: Partial<IntelligenceConfig>) {
    const res = await fetch('/api/intelligence/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (res.ok) { const d = await res.json(); setQCfg(p => ({ ...p, ...d })); flash('Opgeslagen') }
    else flash('Fout', false)
  }

  async function rerunQualify() {
    setRerunQ(true)
    const res = await fetch('/api/intelligence/enrich-all', { method: 'POST' })
    const d   = await res.json()
    flash(`${d.scored ?? 0} / ${d.total ?? 0} verrijkt`)
    setRerunQ(false)
  }

  function saveBenchmarks(list: BenchmarkCustomer[]) {
    setBenchmarks(list)
    fetch('/api/intelligence/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ benchmark_customers: list }),
    }).then(() => flash('Benchmark opgeslagen')).catch(() => flash('Fout', false))
  }

  function addBenchmark() {
    if (!bName.trim() || !bLabel) return
    const entry: BenchmarkCustomer = {
      id: Date.now(),
      name:    bName.trim(),
      city:    bCity.trim(),
      revenue: parseInt(bRev.replace(/\D/g, ''), 10) || 0,
      label:   bLabel,
    }
    const next = [...benchmarks, entry]
    saveBenchmarks(next)
    setBName(''); setBCity(''); setBRev(''); setBLabel('')
  }

  function removeBenchmark(id: number) {
    saveBenchmarks(benchmarks.filter(b => b.id !== id))
  }

  const CONDITION_LABELS: Record<string, string> = {
    name_contains:   'Naam bevat',
    industry_is:     'Industrie is',
    postcode_starts: 'Postcode begint',
  }

  const FUNCTIE_COLORS: Record<string, string> = {
    'Eigenaar':         '#52525b',
    'Account Manager':  '#52525b',
    'Medewerker':       '#52525b',
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: 'calc(100vh - 44px)', backgroundColor: 'var(--bg)' }}>

      {/* Top bar */}
      <div style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '48px' }}>
        <div style={{ display: 'flex', alignItems: 'stretch', height: '100%', gap: '2px' }}>
          {(['gebruikers', 'routing', 'qualify'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '0 14px', height: '100%',
                fontSize: '13px',
                fontWeight: tab === t ? 600 : 400,
                color: tab === t ? 'var(--text)' : 'var(--muted)',
                position: 'relative',
                transition: 'color 0.1s',
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
              {tab === t && (
                <span style={{ position: 'absolute', bottom: 0, left: '8px', right: '8px', height: '2px', borderRadius: '2px 2px 0 0', backgroundColor: 'var(--text)' }} />
              )}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {status && (
            <span style={{ fontSize: '12px', fontWeight: 600, color: status.ok ? '#16a34a' : '#dc2626' }}>
              {status.text}
            </span>
          )}
          {tab === 'routing' && (
            <button
              onClick={rerunRouting}
              disabled={rerunR}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 11px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--muted)', backgroundColor: 'transparent', border: '1px solid var(--border)', cursor: rerunR ? 'default' : 'pointer', opacity: rerunR ? 0.5 : 1 }}
            >
              <RefreshCw size={12} />
              {rerunR ? 'Bezig…' : 'Herroute alle leads'}
            </button>
          )}
          {tab === 'qualify' && (
            <button
              onClick={rerunQualify}
              disabled={rerunQ}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 11px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--muted)', backgroundColor: 'transparent', border: '1px solid var(--border)', cursor: rerunQ ? 'default' : 'pointer', opacity: rerunQ ? 0.5 : 1 }}
            >
              <RefreshCw size={12} />
              {rerunQ ? 'Bezig…' : 'Verrijk alle leads'}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px 24px' }}>
        {loading ? (
          <p style={{ fontSize: '13px', color: 'var(--muted)', textAlign: 'center', marginTop: '60px' }}>Laden…</p>
        ) : (
          <>
            {/* ════════════════ GEBRUIKERS ════════════════ */}
            {tab === 'gebruikers' && (
              <>
                <Card>
                  <CardHeader
                    icon={<Users size={14} />}
                    title="Teamleden"
                    action={
                      <button
                        onClick={() => setShowAddForm(v => !v)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '5px 11px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, border: 'none', backgroundColor: '#111111', color: '#ffffff', cursor: 'pointer' }}
                      >
                        <Plus size={12} /> Nieuw teamlid
                      </button>
                    }
                  />
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ ...TH, width: '32px' }}></th>
                        <th style={TH}>Naam</th>
                        <th style={TH}>Functie</th>
                        <th style={TH}>Rayon</th>
                        <th style={TH}>Postcodegebieden</th>
                        <th style={TH}>GHL user ID</th>
                        <th style={{ ...TH, width: '60px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.length === 0 && (
                        <tr>
                          <td colSpan={6} style={{ ...TD(true), color: 'var(--muted)', textAlign: 'center', padding: '20px' }}>
                            Nog geen teamleden. Klik op &quot;Nieuw teamlid&quot; om te beginnen.
                          </td>
                        </tr>
                      )}
                      {members.map((m, i) => {
                        const isLast    = i === members.length - 1
                        const isEditing = editId === m.id
                        const FUNCTIE_ABBR: Record<string, string> = { 'Account Manager': 'AM', 'Eigenaar': 'EIG', 'Medewerker': 'MED' }
                        const shortFunctie = m.functie ? (FUNCTIE_ABBR[m.functie] ?? m.functie.slice(0, 5)) : null
                        if (isEditing) {
                          return (
                            <tr key={m.id} style={{ backgroundColor: 'var(--active)' }}>
                              {/* Color column — swatches in edit mode */}
                              <td style={{ ...TD(isLast), verticalAlign: 'top' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  {COLOR_PALETTE.map(c => (
                                    <button key={c} onClick={() => setEditColor(c)} style={{ width: '16px', height: '16px', borderRadius: '50%', backgroundColor: c, border: editColor === c ? '2px solid var(--text)' : '2px solid rgba(0,0,0,0.08)', cursor: 'pointer', outline: 'none', padding: 0, flexShrink: 0, transition: 'border 0.1s' }} />
                                  ))}
                                </div>
                              </td>
                              <td style={{ ...TD(isLast), verticalAlign: 'top' }}>
                                {/* Save / cancel */}
                                <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                                  <button onClick={saveMember} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '5px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: '#16a34a', border: 'none', cursor: 'pointer', color: '#fff' }}>
                                    <Check size={12} /> Opslaan
                                  </button>
                                  <button onClick={() => setEditId(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '5px 10px', borderRadius: '6px', fontSize: '12px', background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--muted)' }}>
                                    <X size={12} /> Annuleer
                                  </button>
                                </div>
                                <input value={editNaam} onChange={e => setEditNaam(e.target.value)} style={{ ...inp, width: '140px' }} placeholder="Naam *" />
                                <input value={editEmail} onChange={e => setEditEmail(e.target.value)} style={{ ...inp, width: '150px', marginTop: '4px' }} placeholder="E-mail" />
                              </td>
                              <td style={{ ...TD(isLast), verticalAlign: 'top' }}>
                                <select value={editFunctie} onChange={e => setEditFunctie(e.target.value)} style={{ ...inp, width: '140px' }}>
                                  <option value="">— geen —</option>
                                  <option value="Eigenaar">Eigenaar</option>
                                  <option value="Account Manager">Account Manager</option>
                                  <option value="Medewerker">Medewerker</option>
                                </select>
                              </td>
                              <td style={{ ...TD(isLast), verticalAlign: 'top' }}>
                                <input value={editRayon} onChange={e => setEditRayon(e.target.value)} style={{ ...inp, width: '130px' }} placeholder="Rayon" />
                              </td>
                              <td style={{ ...TD(isLast), verticalAlign: 'top' }}>
                                <textarea
                                  value={editPc}
                                  onChange={e => setEditPc(e.target.value)}
                                  rows={4}
                                  placeholder={'10, 11, 21, 22\n30, 31, 32\n...'}
                                  style={{ ...inp, width: '190px', resize: 'vertical', lineHeight: 1.6, fontFamily: 'monospace', fontSize: '11px' }}
                                />
                                <p style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '3px' }}>
                                  {editPc.split(/[,\s]+/).filter(Boolean).length} gebieden
                                </p>
                              </td>
                              <td style={{ ...TD(isLast), verticalAlign: 'top' }}>
                                <input value={editGhlUserId}  onChange={e => setEditGhlUserId(e.target.value)}  style={{ ...inp, width: '200px', fontFamily: 'monospace', fontSize: '11px' }} placeholder="GHL user ID" />
                                <input value={editCalendarId} onChange={e => setEditCalendarId(e.target.value)} style={{ ...inp, width: '200px', fontFamily: 'monospace', fontSize: '11px', marginTop: '4px' }} placeholder="Calendar ID" />
                                <input value={editPhone}      onChange={e => setEditPhone(e.target.value)}      style={{ ...inp, width: '200px', marginTop: '4px' }} placeholder="Telefoon +31..." />
                              </td>
                              <td style={TD(isLast)} />
                            </tr>
                          )
                        }
                        return (
                          <tr key={m.id}>
                            {/* Color dot column */}
                            <td style={{ ...TD(isLast), position: 'relative' }}>
                              <button
                                onClick={() => setColorPickerId(colorPickerId === m.id ? null : m.id)}
                                title="Kleur wijzigen"
                                style={{ width: '14px', height: '14px', borderRadius: '50%', backgroundColor: m.color ?? '#64748b', border: '1.5px solid rgba(0,0,0,0.12)', cursor: 'pointer', outline: 'none', padding: 0, display: 'block', transition: 'transform 0.1s', transform: colorPickerId === m.id ? 'scale(1.3)' : 'scale(1)' }}
                              />
                              {colorPickerId === m.id && (
                                <div style={{ position: 'absolute', left: '20px', top: '50%', transform: 'translateY(-50%)', zIndex: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', display: 'flex', gap: '5px', flexWrap: 'wrap', width: '116px' }}>
                                  {COLOR_PALETTE.map(c => (
                                    <button key={c} onClick={() => quickSetColor(m.id, c)} style={{ width: '20px', height: '20px', borderRadius: '50%', backgroundColor: c, border: (m.color ?? '') === c ? '2px solid var(--text)' : '2px solid transparent', cursor: 'pointer', outline: 'none', padding: 0, transition: 'border 0.1s' }} />
                                  ))}
                                </div>
                              )}
                            </td>
                            <td style={TD(isLast)}>
                              <p style={{ fontWeight: 700, margin: 0, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '12px' }}>{m.naam}</p>
                              {m.email && <p style={{ color: 'var(--muted)', fontSize: '11px', margin: 0 }}>{m.email}</p>}
                            </td>
                            <td style={{ ...TD(isLast), whiteSpace: 'nowrap' }}>
                              {m.functie
                                ? <span title={m.functie}><Badge text={shortFunctie ?? ''} color={m.color ?? FUNCTIE_COLORS[m.functie] ?? '#52525b'} /></span>
                                : <span style={{ color: 'var(--muted)' }}>—</span>
                              }
                            </td>
                            <td style={TD(isLast)}>
                              <span style={{ color: 'var(--muted)', fontSize: '12px' }}>{m.rayon ?? '—'}</span>
                            </td>
                            <td style={TD(isLast)}>
                              {(m.postcode_ranges ?? []).length > 0 ? (
                                <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                                  {m.postcode_ranges.slice(0, 6).map(r => (
                                    <span key={r} style={{ padding: '1px 5px', borderRadius: '3px', backgroundColor: 'var(--active)', fontSize: '10px', border: '1px solid var(--border)' }}>{r}</span>
                                  ))}
                                  {m.postcode_ranges.length > 6 && (
                                    <span style={{ padding: '1px 5px', borderRadius: '3px', backgroundColor: 'var(--active)', fontSize: '10px', border: '1px solid var(--border)', color: 'var(--muted)' }}>+{m.postcode_ranges.length - 6}</span>
                                  )}
                                </div>
                              ) : (
                                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Heel NL</span>
                              )}
                            </td>
                            <td style={TD(isLast)}>
                              <span style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'monospace', display: 'block' }}>{m.ghl_user_id ?? '—'}</span>
                              {m.calendar_id && <span style={{ fontSize: '10px', color: 'var(--muted)', fontFamily: 'monospace', display: 'block', marginTop: '2px' }}>📅 {m.calendar_id.slice(0, 16)}…</span>}
                              {m.phone && <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', marginTop: '2px' }}>📱 {m.phone}</span>}
                            </td>
                            <td style={{ ...TD(isLast), whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', gap: '4px' }}>
                                <button onClick={() => startEdit(m)} title="Bewerken" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex', padding: '2px' }}>
                                  <Pencil size={13} />
                                </button>
                                <button onClick={() => deleteMember(m.id)} title="Verwijderen" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex', padding: '2px' }}>
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>

                  {showAddForm && (
                    <div style={{ padding: '16px', borderTop: '1px solid var(--border)', backgroundColor: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {/* Tiny color picker */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Kleur:</span>
                        {COLOR_PALETTE.map(c => (
                          <button key={c} onClick={() => setMColor(c)} style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: c, border: mColor === c ? '2px solid var(--text)' : '1.5px solid rgba(0,0,0,0.1)', cursor: 'pointer', outline: 'none', padding: 0, transition: 'border 0.1s', transform: mColor === c ? 'scale(1.4)' : 'scale(1)' }} />
                        ))}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
                        <LF label="Naam *"><input value={mNaam}    onChange={e => setMNaam(e.target.value)}    style={inp} placeholder="Thomas" /></LF>
                        <LF label="Functie"><input value={mFunctie} onChange={e => setMFunctie(e.target.value)} style={inp} placeholder="Account Manager" /></LF>
                        <LF label="Rayon"><input value={mRayon}   onChange={e => setMRayon(e.target.value)}   style={inp} placeholder="Noord-Holland" /></LF>
                        <LF label="E-mail"><input value={mEmail}   onChange={e => setMEmail(e.target.value)}   style={inp} placeholder="thomas@roux.nl" /></LF>
                        <LF label="Postcodes"><input value={mPc} onChange={e => setMPc(e.target.value)} style={inp} placeholder="10, 11, 20" /></LF>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={addMember}
                          disabled={!mNaam.trim()}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 16px', borderRadius: '7px', fontSize: '13px', fontWeight: 600, backgroundColor: 'var(--text)', color: 'var(--surface)', border: 'none', cursor: mNaam.trim() ? 'pointer' : 'default', opacity: mNaam.trim() ? 1 : 0.4 }}
                        >
                          <Plus size={13} /> Toevoegen
                        </button>
                        <button
                          onClick={() => setShowAddForm(false)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: '7px', fontSize: '13px', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--muted)', cursor: 'pointer' }}
                        >
                          Annuleer
                        </button>
                      </div>
                    </div>
                  )}
                </Card>
              </>
            )}

            {/* ════════════════ ROUTING ════════════════ */}
            {tab === 'routing' && (
              <React.Fragment key={loading ? 'r-loading' : 'r-ready'}>
                {/* 0. Routing actief — top toggle */}
                <Card>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px' }}>
                    <div>
                      <p style={lbl}>Routing actief</p>
                      <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '3px', marginBottom: 0 }}>Schakel uit om alle toewijzingen te pauzeren</p>
                    </div>
                    <Toggle value={!(rCfg?.routing_disabled ?? false)} onChange={v => saveRCfg({ routing_disabled: !v })} />
                  </div>
                </Card>

                {/* 1. Pre-routing */}
                <Card>
                  <CardHeader icon={<Brain size={14} />} title="AI pre-routing" />
                  <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <p style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.65, margin: 0 }}>
                      Gebruik AI om specifieke leads (bijv. groothandels, ketenaccounts) automatisch te herkennen en toe te wijzen vóór de gewone regels.
                    </p>
                    <LF label="Instructie">
                      <textarea
                        rows={3}
                        placeholder="Bijv: Wijs toe als het bedrijf een groothandel, keten of cateraar met 200+ medewerkers is."
                        defaultValue={rCfg?.pre_routing_prompt ?? ''}
                        onBlur={e => saveRCfg({ pre_routing_prompt: e.target.value || null })}
                        style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }}
                      />
                    </LF>
                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <LF label="Toewijzen aan">
                        <select style={{ ...inp, width: '200px' }} value={rCfg?.pre_routing_assign_to_id ?? ''} onChange={e => saveRCfg({ pre_routing_assign_to_id: e.target.value || null })}>
                          <option value="">— niemand —</option>
                          {members.map(m => <option key={m.id} value={m.id}>{m.naam}</option>)}
                        </select>
                      </LF>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '2px' }}>
                        <Toggle value={rCfg?.pre_routing_websearch ?? false} onChange={v => saveRCfg({ pre_routing_websearch: v })} />
                        <span style={lbl}>Websearch gebruiken</span>
                      </div>
                    </div>
                  </div>
                </Card>

                {/* 2. Routing regels — altijd op postcode */}
                <Card>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <p style={lbl}>Routeer op postcode</p>
                      <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '3px', marginBottom: 0 }}>
                        Wijs leads automatisch toe op basis van de postcodegebieden ingesteld per medewerker
                      </p>
                    </div>
                    <Toggle value={!(rCfg?.skip_body ?? false)} onChange={v => saveRCfg({ skip_body: !v })} />
                  </div>
                  {/* Read-only postcode overview */}
                  <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {members.filter(m => m.active !== false).map(m => {
                      const mc = m.color ?? '#64748b'
                      return (
                        <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '8px 10px', borderRadius: '7px', backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
                          <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: mc, flexShrink: 0, marginTop: '3px' }} />
                          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)', minWidth: '100px', flexShrink: 0 }}>{m.naam}</span>
                          <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                            {m.postcode_ranges.length === 0
                              ? <span style={{ fontSize: '11px', color: 'var(--muted)', fontStyle: 'italic' }}>Heel NL</span>
                              : m.postcode_ranges.map(r => (
                                <span key={r} style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px', backgroundColor: 'var(--active)', border: '1px solid var(--border)', color: 'var(--muted)', fontFamily: 'monospace' }}>{r}</span>
                              ))}
                          </div>
                        </div>
                      )
                    })}
                    {members.length === 0 && (
                      <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0 }}>Nog geen medewerkers. Voeg ze toe via het Gebruikers tabblad.</p>
                    )}
                  </div>
                </Card>

                {/* 3. Fallback + routing actief */}
                <Card>
                  <CardHeader icon={<GitBranch size={14} />} title="Fallback" />
                  <div style={{ padding: '0 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
                      <div>
                        <p style={lbl}>Fallback persoon</p>
                        <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '3px' }}>Wie krijgt leads zonder match?</p>
                      </div>
                      <select
                        style={{ ...inp, width: '200px' }}
                        value={rCfg?.fallback_user_id ?? ''}
                        onChange={e => saveRCfg({ fallback_user_id: e.target.value || null })}
                      >
                        <option value="">— geen —</option>
                        {members.map(m => <option key={m.id} value={m.id}>{m.naam}</option>)}
                      </select>
                    </div>
                  </div>
                </Card>
              </React.Fragment>
            )}

            {/* ════════════════ QUALIFY ════════════════ */}
            {tab === 'qualify' && (
              <React.Fragment key={loading ? 'q-loading' : 'q-ready'}>
                {/* 1. Bedrijfscontext */}
                <Card>
                  <CardHeader icon={<Brain size={14} />} title="Bedrijfscontext" />
                  <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <p style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.65, margin: 0 }}>
                      Beschrijf jullie bedrijf en product. Dit helpt de AI bij het inschatten van klantfit.
                    </p>
                    <textarea
                      rows={3}
                      placeholder="Bijv: Wij zijn ROUX, leverancier van foodservice-ingrediënten voor de horeca. Onze beste klanten zijn zelfstandige restaurants met €150k+ omzet per jaar."
                      defaultValue={qCfg.system_prompt ?? ''}
                      onBlur={e => saveQCfg({ system_prompt: e.target.value || null })}
                      style={{ ...inp, resize: 'vertical', lineHeight: 1.65 }}
                    />
                  </div>
                </Card>

                {/* 2. Scoring instructies */}
                <Card>
                  <CardHeader icon={<Brain size={14} />} title="Scoring instructies (A/B/C/D)" />
                  <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <p style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.65, margin: 0 }}>
                      Beschrijf hoe de AI leads scoort. A = hoogste prioriteit, D = laagste. Gebruik concrete signalen: omzetschattingen, bedrijfstype, locatie, concept.
                    </p>
                    <textarea
                      rows={7}
                      placeholder={'A: Restaurant €200k+ omzet, zelfstandig concept, professionele keuken.\nB: Restaurant €100-200k of kleine keten 2-5 vestigingen.\nC: Kleine lunchroom, foodtruck of bar.\nD: Supermarkt, kantinebeheerder, niet-horeca.'}
                      defaultValue={qCfg.scoring_prompt ?? ''}
                      onBlur={e => saveQCfg({ scoring_prompt: e.target.value || null })}
                      style={{ ...inp, resize: 'vertical', lineHeight: 1.65 }}
                    />
                  </div>
                </Card>

                {/* 3. Klantbenchmarks */}
                <Card>
                  <CardHeader icon={<Brain size={14} />} title="Klantbenchmarks" />
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={TH}>Bedrijfsnaam</th>
                        <th style={TH}>Stad</th>
                        <th style={TH}>Label</th>
                        <th style={TH}># Volume</th>
                        <th style={{ ...TH, width: '36px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {benchmarks.length === 0 && (
                        <tr>
                          <td colSpan={5} style={{ ...TD(true), color: 'var(--muted)', textAlign: 'center', padding: '20px' }}>
                            Nog geen benchmark klanten. Voeg bestaande klanten toe als referentie voor de AI scoring.
                          </td>
                        </tr>
                      )}
                      {benchmarks.map((b, i) => {
                        const lc = LABEL_COLORS[b.label] ?? {}
                        const isLast = i === benchmarks.length - 1
                        return (
                          <tr key={b.id}>
                            <td style={TD(isLast)}><p style={{ fontWeight: 600 }}>{b.name}</p></td>
                            <td style={TD(isLast)}><span style={{ color: 'var(--muted)', fontSize: '12px' }}>{b.city || '—'}</span></td>
                            <td style={TD(isLast)}>
                              {b.label ? (
                                <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, background: lc.bg, color: lc.text, border: `1px solid ${lc.border}` }}>
                                  {b.label}
                                </span>
                              ) : '—'}
                            </td>
                            <td style={TD(isLast)}>
                              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                                {b.revenue > 0 ? b.revenue.toLocaleString('nl-NL') : '—'}
                              </span>
                            </td>
                            <td style={TD(isLast)}>
                              <button onClick={() => removeBenchmark(b.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex', padding: '2px' }}>
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {/* Add benchmark form */}
                  <div style={{ padding: '16px', borderTop: '1px solid var(--border)', backgroundColor: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' }}>
                      <LF label="Bedrijfsnaam *"><input value={bName} onChange={e => setBName(e.target.value)} style={inp} placeholder="Restaurant X" /></LF>
                      <LF label="Stad"><input value={bCity} onChange={e => setBCity(e.target.value)} style={inp} placeholder="Amsterdam" /></LF>
                      <LF label="Label *">
                        <select value={bLabel} onChange={e => setBLabel(e.target.value as BenchmarkCustomer['label'])} style={inp}>
                          <option value="">— kies —</option>
                          {(['A','B','C','D'] as const).map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </LF>
                      <LF label="# Volume"><input value={bRev} onChange={e => setBRev(e.target.value)} style={inp} placeholder="500" /></LF>
                    </div>
                    <div>
                      <button onClick={addBenchmark} disabled={!bName.trim() || !bLabel} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 16px', borderRadius: '7px', fontSize: '13px', fontWeight: 600, border: 'none', backgroundColor: 'var(--text)', color: 'var(--surface)', cursor: (!bName.trim() || !bLabel) ? 'default' : 'pointer', opacity: (!bName.trim() || !bLabel) ? 0.4 : 1 }}>
                        <Plus size={13} /> Toevoegen
                      </button>
                    </div>
                  </div>
                </Card>

              </React.Fragment>
            )}
          </>
        )}
      </div>
    </div>
  )
}
