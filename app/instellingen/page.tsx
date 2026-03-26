'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Users, GitBranch, Brain, Plus, Trash2, RefreshCw, Pencil, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TeamMember {
  id: string; naam: string; email?: string | null; phone?: string | null
  functie?: string | null; rayon?: string | null; ghl_user_id?: string | null
  calendar_id?: string | null; postcode_ranges: string[]; color?: string | null; active: boolean
}
const COLOR_PALETTE = ['#6366F1','#8B5CF6','#0EA5E9','#64748B','#F59E0B','#EF4444','#EC4899','#14B8A6','#F97316']

interface RoutingConfig {
  organization_id?: string; pre_routing_prompt: string | null
  pre_routing_assign_to_id: string | null; pre_routing_assign_to_naam?: string | null
  pre_routing_websearch: boolean; fallback_user_id: string | null
  fallback_user_naam?: string | null; routing_disabled: boolean; skip_pre: boolean; skip_body: boolean
}
interface IntelligenceConfig {
  system_prompt?: string | null; knowledge_base?: string | null
  enrich_websearch?: boolean; enrich_webcrawl?: boolean; enrich_maps?: boolean
  scoring_prompt?: string | null; benchmark_customers?: BenchmarkCustomer[]
}
type BenchmarkCustomer = { id: number; name: string; city: string; revenue: number; label: 'A'|'B'|'C'|'D'|'' }
const LABEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  A: { bg: 'rgba(220,38,38,0.08)',  text: '#DC2626', border: 'rgba(220,38,38,0.25)' },
  B: { bg: 'rgba(217,119,6,0.08)',  text: '#D97706', border: 'rgba(217,119,6,0.25)' },
  C: { bg: 'rgba(37,99,235,0.08)',  text: '#2563EB', border: 'rgba(37,99,235,0.25)' },
  D: { bg: 'rgba(22,163,74,0.08)',  text: '#16A34A', border: 'rgba(22,163,74,0.25)' },
}
type Tab = 'gebruikers' | 'routing' | 'qualify'

const inputCls = "px-3 py-2 text-sm rounded-lg border border-border bg-surface text-primary outline-none box-border"
const MONO = 'monospace'
const TH = "text-[11px] font-semibold text-muted px-3.5 py-2 text-left uppercase tracking-[0.05em] border-b border-border whitespace-nowrap"
const tdBase = "text-xs px-3.5 py-2.5 text-primary align-middle"

function td(last: boolean) { return cn(tdBase, !last && 'border-b border-border') }

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-surface border border-border rounded-[10px] overflow-hidden mb-4">{children}</div>
}
function CardHeader({ icon, title, action }: { icon: React.ReactNode; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
      <div className="flex items-center gap-1.5">
        <span className="text-muted flex">{icon}</span>
        <span className="text-[13px] font-semibold text-primary">{title}</span>
      </div>
      {action}
    </div>
  )
}
function LF({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-bold text-primary tracking-[0.01em]">{label}</label>
      {children}
    </div>
  )
}
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)}
      className="relative flex-shrink-0 w-[38px] h-[21px] rounded-[11px] border-none cursor-pointer p-0 transition-colors"
      style={{ backgroundColor: value ? '#111' : '#d1d5db' }}>
      <span className="absolute top-[2.5px] w-4 h-4 rounded-full bg-white shadow transition-all"
        style={{ left: value ? '19px' : '2.5px' }} />
    </button>
  )
}
function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span className="px-[7px] py-0.5 rounded text-[11px] font-semibold"
      style={{ backgroundColor: `${color}18`, color, border: `1px solid ${color}30` }}>
      {text}
    </span>
  )
}

export default function InstellingenPage() {
  const [tab,     setTab]     = useState<Tab>('gebruikers')
  const [members, setMembers] = useState<TeamMember[]>([])
  const [rCfg,    setRCfg]    = useState<RoutingConfig | null>(null)
  const [qCfg,    setQCfg]    = useState<IntelligenceConfig>({})
  const [loading, setLoading] = useState(true)
  const [status,  setStatus]  = useState<{ text: string; ok: boolean } | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [rerunR,  setRerunR]  = useState(false)
  const [rerunQ,  setRerunQ]  = useState(false)
  const [mNaam, setMNaam] = useState(''); const [mEmail, setMEmail] = useState('')
  const [mFunctie, setMFunctie] = useState(''); const [mRayon, setMRayon] = useState('')
  const [mPc, setMPc] = useState(''); const [mColor, setMColor] = useState(COLOR_PALETTE[0])
  const [editId, setEditId] = useState<string | null>(null)
  const [editNaam, setEditNaam] = useState(''); const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState(''); const [editFunctie, setEditFunctie] = useState('')
  const [editRayon, setEditRayon] = useState(''); const [editPc, setEditPc] = useState('')
  const [editColor, setEditColor] = useState(''); const [editGhlUserId, setEditGhlUserId] = useState('')
  const [editCalendarId, setEditCalendarId] = useState('')
  const [colorPickerId, setColorPickerId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [benchmarks, setBenchmarks] = useState<BenchmarkCustomer[]>([])
  const [bName, setBName] = useState(''); const [bCity, setBCity] = useState('')
  const [bRev, setBRev] = useState(''); const [bLabel, setBLabel] = useState<BenchmarkCustomer['label']>('')

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
      setRCfg(rcRes.config ?? null); setQCfg(qRes ?? {})
      if (Array.isArray(qRes?.benchmark_customers) && qRes.benchmark_customers.length > 0)
        setBenchmarks(qRes.benchmark_customers as BenchmarkCustomer[])
    } catch { flash('Laadprobleem', false) }
    finally  { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function seedUsers() {
    setSeeding(true)
    try {
      const res = await fetch('/api/settings/seed-users', { method: 'POST' })
      const d   = await res.json()
      if (res.ok) { flash(`${d.inserted} gebruikers geïmporteerd`); load() } else flash(d.error ?? 'Fout', false)
    } finally { setSeeding(false) }
  }

  async function addMember() {
    if (!mNaam.trim()) return
    const postcode_ranges = mPc.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
    const res = await fetch('/api/settings/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ naam: mNaam.trim(), email: mEmail.trim() || null, functie: mFunctie.trim() || null, rayon: mRayon.trim() || null, postcode_ranges, color: mColor }) })
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
    await fetch(`/api/settings/employees/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color }) })
    load()
  }

  function startEdit(m: TeamMember) {
    setEditId(m.id); setEditNaam(m.naam); setEditEmail(m.email ?? ''); setEditPhone(m.phone ?? '')
    setEditFunctie(m.functie ?? ''); setEditRayon(m.rayon ?? ''); setEditPc((m.postcode_ranges ?? []).join(', '))
    setEditColor(m.color ?? COLOR_PALETTE[0]); setEditGhlUserId(m.ghl_user_id ?? ''); setEditCalendarId(m.calendar_id ?? '')
  }

  async function saveMember() {
    if (!editId || !editNaam.trim()) return
    const postcode_ranges = editPc.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
    const res = await fetch(`/api/settings/employees/${editId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ naam: editNaam.trim(), email: editEmail.trim() || null, phone: editPhone.trim() || null, functie: editFunctie.trim() || null, rayon: editRayon.trim() || null, postcode_ranges, color: editColor || null, ghl_user_id: editGhlUserId.trim() || null, calendar_id: editCalendarId.trim() || null }),
    })
    if (res.ok) { setEditId(null); flash('Opgeslagen'); load() } else flash('Fout', false)
  }

  async function saveRCfg(patch: Partial<RoutingConfig>) {
    const res = await fetch('/api/routing/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    if (res.ok) { const d = await res.json(); setRCfg(p => ({ ...p!, ...d })); flash('Opgeslagen') } else flash('Fout', false)
  }


  async function rerunRouting() {
    setRerunR(true)
    const res = await fetch('/api/routing/apply-all', { method: 'POST' })
    const d   = await res.json()
    flash(`${d.updated ?? 0} / ${d.total ?? 0} gerouteerd`); setRerunR(false)
  }

  async function saveQCfg(patch: Partial<IntelligenceConfig>) {
    const res = await fetch('/api/intelligence/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    if (res.ok) { const d = await res.json(); setQCfg(p => ({ ...p, ...d })); flash('Opgeslagen') } else flash('Fout', false)
  }

  async function rerunQualify() {
    setRerunQ(true)
    const res = await fetch('/api/intelligence/enrich-all', { method: 'POST' })
    const d   = await res.json()
    flash(`${d.scored ?? 0} / ${d.total ?? 0} verrijkt`); setRerunQ(false)
  }

  function saveBenchmarks(list: BenchmarkCustomer[]) {
    setBenchmarks(list)
    fetch('/api/intelligence/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ benchmark_customers: list }) })
      .then(() => flash('Benchmark opgeslagen')).catch(() => flash('Fout', false))
  }

  function addBenchmark() {
    if (!bName.trim() || !bLabel) return
    const entry: BenchmarkCustomer = { id: Date.now(), name: bName.trim(), city: bCity.trim(), revenue: parseInt(bRev.replace(/\D/g, ''), 10) || 0, label: bLabel }
    saveBenchmarks([...benchmarks, entry]); setBName(''); setBCity(''); setBRev(''); setBLabel('')
  }

  const FUNCTIE_ABBR: Record<string, string> = { 'Account Manager': 'AM', 'Eigenaar': 'EIG', 'Medewerker': 'MED' }

  return (
    <div className="min-h-[calc(100vh-44px)] bg-bg">

      {/* Tab bar */}
      <div className="bg-surface border-b border-border px-6 flex items-center justify-between h-12">
        <div className="flex items-stretch h-full gap-0.5">
          {(['gebruikers', 'routing', 'qualify'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn('relative px-3.5 h-full bg-transparent border-none cursor-pointer text-[13px] transition-colors',
                tab === t ? 'font-semibold text-primary' : 'font-normal text-muted hover:text-primary')}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
              {tab === t && <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-t-sm bg-primary" />}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2.5">
          {status && <span className={cn('text-xs font-semibold', status.ok ? 'text-green-600' : 'text-red-600')}>{status.text}</span>}
          {tab === 'routing' && (
            <button onClick={rerunRouting} disabled={rerunR}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold text-muted bg-transparent border border-border cursor-pointer disabled:opacity-50 hover:bg-active transition-colors">
              <RefreshCw size={12} className={cn(rerunR && 'animate-spin')} />
              {rerunR ? 'Bezig…' : 'Herroute alle leads'}
            </button>
          )}
          {tab === 'qualify' && (
            <button onClick={rerunQualify} disabled={rerunQ}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold text-muted bg-transparent border border-border cursor-pointer disabled:opacity-50 hover:bg-active transition-colors">
              <RefreshCw size={12} className={cn(rerunQ && 'animate-spin')} />
              {rerunQ ? 'Bezig…' : 'Verrijk alle leads'}
            </button>
          )}
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-6 py-6">
        {loading ? (
          <p className="text-[13px] text-muted text-center mt-16">Laden…</p>
        ) : (
          <>
            {/* ═══════ GEBRUIKERS ═══════ */}
            {tab === 'gebruikers' && (
              <Card>
                <CardHeader icon={<Users size={14} />} title="Teamleden"
                  action={
                    <button onClick={() => setShowAddForm(v => !v)}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold border-none bg-[#111] text-white cursor-pointer hover:opacity-90 transition-opacity">
                      <Plus size={12} /> Nieuw teamlid
                    </button>
                  }
                />
                <table className="w-full border-collapse">
                  <thead><tr>
                    <th className={cn(TH, 'w-8')}></th>
                    <th className={TH}>Naam</th><th className={TH}>Functie</th><th className={TH}>Rayon</th>
                    <th className={TH}>Postcodegebieden</th><th className={TH}>GHL user ID</th>
                    <th className={cn(TH, 'w-16')}></th>
                  </tr></thead>
                  <tbody>
                    {members.length === 0 && (
                      <tr><td colSpan={6} className="text-muted text-center py-5 text-xs border-b border-border">
                        Nog geen teamleden. Klik op &quot;Nieuw teamlid&quot; om te beginnen.
                      </td></tr>
                    )}
                    {members.map((m, i) => {
                      const isLast    = i === members.length - 1
                      const isEditing = editId === m.id
                      const shortFunctie = m.functie ? (FUNCTIE_ABBR[m.functie] ?? m.functie.slice(0, 5)) : null
                      if (isEditing) {
                        return (
                          <tr key={m.id} className="bg-active">
                            <td className={td(isLast)}>
                              <div className="flex flex-col gap-1">
                                {COLOR_PALETTE.map(c => (
                                  <button key={c} onClick={() => setEditColor(c)}
                                    className="w-4 h-4 rounded-full cursor-pointer outline-none p-0 flex-shrink-0 transition-all"
                                    style={{ backgroundColor: c, border: editColor === c ? '2px solid var(--text)' : '2px solid rgba(0,0,0,0.08)' }} />
                                ))}
                              </div>
                            </td>
                            <td className={td(isLast)}>
                              <div className="flex gap-1.5 mb-2">
                                <button onClick={saveMember} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-green-600 border-none cursor-pointer text-white hover:opacity-90">
                                  <Check size={12} /> Opslaan
                                </button>
                                <button onClick={() => setEditId(null)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-transparent border border-border cursor-pointer text-muted hover:bg-active">
                                  <X size={12} /> Annuleer
                                </button>
                              </div>
                              <input value={editNaam}  onChange={e => setEditNaam(e.target.value)}  className={cn(inputCls, 'w-[140px] block')}  placeholder="Naam *" />
                              <input value={editEmail} onChange={e => setEditEmail(e.target.value)} className={cn(inputCls, 'w-[150px] block mt-1')} placeholder="E-mail" />
                            </td>
                            <td className={td(isLast)}>
                              <select value={editFunctie} onChange={e => setEditFunctie(e.target.value)} className={cn(inputCls, 'w-[140px]')}>
                                <option value="">— geen —</option>
                                <option value="Eigenaar">Eigenaar</option>
                                <option value="Account Manager">Account Manager</option>
                                <option value="Medewerker">Medewerker</option>
                              </select>
                            </td>
                            <td className={td(isLast)}>
                              <input value={editRayon} onChange={e => setEditRayon(e.target.value)} className={cn(inputCls, 'w-[130px]')} placeholder="Rayon" />
                            </td>
                            <td className={td(isLast)}>
                              <textarea value={editPc} onChange={e => setEditPc(e.target.value)} rows={4}
                                placeholder={'10, 11, 21\n30, 31\n...'}
                                className={cn(inputCls, 'w-[190px] resize-y leading-relaxed text-[11px]')}
                                style={{ fontFamily: MONO }} />
                              <p className="text-[10px] text-muted mt-0.5">{editPc.split(/[,\s]+/).filter(Boolean).length} gebieden</p>
                            </td>
                            <td className={td(isLast)}>
                              <input value={editGhlUserId}  onChange={e => setEditGhlUserId(e.target.value)}  className={cn(inputCls, 'w-[200px] text-[11px] block')}    placeholder="GHL user ID" style={{ fontFamily: MONO }} />
                              <input value={editCalendarId} onChange={e => setEditCalendarId(e.target.value)} className={cn(inputCls, 'w-[200px] text-[11px] block mt-1')} placeholder="Calendar ID" style={{ fontFamily: MONO }} />
                              <input value={editPhone}      onChange={e => setEditPhone(e.target.value)}      className={cn(inputCls, 'w-[200px] block mt-1')}             placeholder="Telefoon +31..." />
                            </td>
                            <td className={td(isLast)} />
                          </tr>
                        )
                      }
                      return (
                        <tr key={m.id}>
                          <td className={cn(td(isLast), 'relative')}>
                            <button onClick={() => setColorPickerId(colorPickerId === m.id ? null : m.id)} title="Kleur wijzigen"
                              className="w-3.5 h-3.5 rounded-full cursor-pointer outline-none p-0 block transition-transform"
                              style={{ backgroundColor: m.color ?? '#64748b', border: '1.5px solid rgba(0,0,0,0.12)', transform: colorPickerId === m.id ? 'scale(1.3)' : 'scale(1)' }} />
                            {colorPickerId === m.id && (
                              <div className="absolute left-5 top-1/2 -translate-y-1/2 z-10 bg-surface border border-border rounded-[10px] p-2 shadow-panel flex gap-1.5 flex-wrap w-[116px]">
                                {COLOR_PALETTE.map(c => (
                                  <button key={c} onClick={() => quickSetColor(m.id, c)}
                                    className="w-5 h-5 rounded-full cursor-pointer outline-none p-0 transition-all"
                                    style={{ backgroundColor: c, border: (m.color ?? '') === c ? '2px solid var(--text)' : '2px solid transparent' }} />
                                ))}
                              </div>
                            )}
                          </td>
                          <td className={td(isLast)}>
                            <p className="font-bold text-primary uppercase tracking-[0.04em] text-xs">{m.naam}</p>
                            {m.email && <p className="text-muted text-[11px]">{m.email}</p>}
                          </td>
                          <td className={cn(td(isLast), 'whitespace-nowrap')}>
                            {m.functie ? <span title={m.functie}><Badge text={shortFunctie ?? ''} color={m.color ?? '#52525b'} /></span> : <span className="text-muted">—</span>}
                          </td>
                          <td className={td(isLast)}>
                            <span className="text-muted text-xs">{m.rayon ?? '—'}</span>
                          </td>
                          <td className={td(isLast)}>
                            {(m.postcode_ranges ?? []).length > 0 ? (
                              <div className="flex gap-0.5 flex-wrap">
                                {m.postcode_ranges.slice(0, 6).map(r => (
                                  <span key={r} className="px-[5px] py-0 rounded bg-active text-[10px] border border-border">{r}</span>
                                ))}
                                {m.postcode_ranges.length > 6 && (
                                  <span className="px-[5px] py-0 rounded bg-active text-[10px] border border-border text-muted">+{m.postcode_ranges.length - 6}</span>
                                )}
                              </div>
                            ) : <span className="text-[11px] text-muted">Heel NL</span>}
                          </td>
                          <td className={td(isLast)}>
                            <span className="text-[11px] text-muted block" style={{ fontFamily: MONO }}>{m.ghl_user_id ?? '—'}</span>
                            {m.calendar_id && <span className="text-[10px] text-muted block mt-0.5" style={{ fontFamily: MONO }}>📅 {m.calendar_id.slice(0, 16)}…</span>}
                            {m.phone && <span className="text-[10px] text-muted block mt-0.5">📱 {m.phone}</span>}
                          </td>
                          <td className={cn(td(isLast), 'whitespace-nowrap')}>
                            <div className="flex gap-1">
                              <button onClick={() => startEdit(m)} title="Bewerken" className="bg-transparent border-none cursor-pointer text-muted flex p-0.5 hover:text-primary transition-colors"><Pencil size={13} /></button>
                              <button onClick={() => deleteMember(m.id)} title="Verwijderen" className="bg-transparent border-none cursor-pointer text-muted flex p-0.5 hover:text-red-600 transition-colors"><Trash2 size={13} /></button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                {showAddForm && (
                  <div className="px-4 py-4 border-t border-border bg-bg flex flex-col gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted">Kleur:</span>
                      {COLOR_PALETTE.map(c => (
                        <button key={c} onClick={() => setMColor(c)}
                          className="w-3 h-3 rounded-full cursor-pointer outline-none p-0 transition-all"
                          style={{ backgroundColor: c, border: mColor === c ? '2px solid var(--text)' : '1.5px solid rgba(0,0,0,0.1)', transform: mColor === c ? 'scale(1.4)' : 'scale(1)' }} />
                      ))}
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2.5">
                      <LF label="Naam *"><input value={mNaam}    onChange={e => setMNaam(e.target.value)}    className={inputCls} placeholder="Thomas" /></LF>
                      <LF label="Functie"><input value={mFunctie} onChange={e => setMFunctie(e.target.value)} className={inputCls} placeholder="Account Manager" /></LF>
                      <LF label="Rayon"><input value={mRayon}   onChange={e => setMRayon(e.target.value)}   className={inputCls} placeholder="Noord-Holland" /></LF>
                      <LF label="E-mail"><input value={mEmail}   onChange={e => setMEmail(e.target.value)}   className={inputCls} placeholder="thomas@roux.nl" /></LF>
                      <LF label="Postcodes"><input value={mPc} onChange={e => setMPc(e.target.value)} className={inputCls} placeholder="10, 11, 20" /></LF>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={addMember} disabled={!mNaam.trim()}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold bg-primary text-white border-none cursor-pointer disabled:opacity-40 disabled:cursor-default hover:opacity-90 transition-opacity">
                        <Plus size={13} /> Toevoegen
                      </button>
                      <button onClick={() => setShowAddForm(false)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] border border-border bg-surface text-muted cursor-pointer hover:bg-active transition-colors">
                        Annuleer
                      </button>
                    </div>
                  </div>
                )}
              </Card>
            )}

            {/* ═══════ ROUTING ═══════ */}
            {tab === 'routing' && (
              <React.Fragment key={loading ? 'r-loading' : 'r-ready'}>
                <Card>
                  <div className="flex items-center justify-between px-4 py-3.5">
                    <div>
                      <p className="text-[13px] font-bold text-primary">Routing actief</p>
                      <p className="text-xs text-muted mt-0.5">Schakel uit om alle toewijzingen te pauzeren</p>
                    </div>
                    <Toggle value={!(rCfg?.routing_disabled ?? false)} onChange={v => saveRCfg({ routing_disabled: !v })} />
                  </div>
                </Card>

                <Card>
                  <CardHeader icon={<Brain size={14} />} title="AI pre-routing" />
                  <div className="px-4 py-4 flex flex-col gap-3.5">
                    <p className="text-xs text-muted leading-relaxed">
                      Gebruik AI om specifieke leads automatisch te herkennen en toe te wijzen vóór de gewone regels.
                    </p>
                    <LF label="Instructie">
                      <textarea rows={3} placeholder="Bijv: Wijs toe als het bedrijf een groothandel, keten of cateraar met 200+ medewerkers is."
                        defaultValue={rCfg?.pre_routing_prompt ?? ''}
                        onBlur={e => saveRCfg({ pre_routing_prompt: e.target.value || null })}
                        className="field-input resize-y leading-relaxed" />
                    </LF>
                    <div className="flex gap-4 flex-wrap items-end">
                      <LF label="Toewijzen aan">
                        <select className={cn(inputCls, 'w-[200px] cursor-pointer')} value={rCfg?.pre_routing_assign_to_id ?? ''} onChange={e => saveRCfg({ pre_routing_assign_to_id: e.target.value || null })}>
                          <option value="">— niemand —</option>
                          {members.map(m => <option key={m.id} value={m.id}>{m.naam}</option>)}
                        </select>
                      </LF>
                      <div className="flex items-center gap-2 pb-0.5">
                        <Toggle value={rCfg?.pre_routing_websearch ?? false} onChange={v => saveRCfg({ pre_routing_websearch: v })} />
                        <span className="text-[13px] font-bold text-primary">Websearch gebruiken</span>
                      </div>
                    </div>
                  </div>
                </Card>

                <Card>
                  <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
                    <div>
                      <p className="text-[13px] font-bold text-primary">Routeer op postcode</p>
                      <p className="text-xs text-muted mt-0.5">Wijs leads automatisch toe op basis van postcodegebieden per medewerker</p>
                    </div>
                    <Toggle value={!(rCfg?.skip_body ?? false)} onChange={v => saveRCfg({ skip_body: !v })} />
                  </div>
                  <div className="px-4 py-3 flex flex-col gap-2">
                    {members.filter(m => m.active !== false).map(m => {
                      const mc = m.color ?? '#64748b'
                      return (
                        <div key={m.id} className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg bg-bg border border-border">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-[3px]" style={{ backgroundColor: mc }} />
                          <span className="text-[13px] font-bold text-primary min-w-[100px] flex-shrink-0">{m.naam}</span>
                          <div className="flex gap-0.5 flex-wrap">
                            {m.postcode_ranges.length === 0
                              ? <span className="text-[11px] text-muted italic">Heel NL</span>
                              : m.postcode_ranges.map(r => (
                                <span key={r} className="text-[10px] px-[5px] rounded bg-active border border-border text-muted" style={{ fontFamily: MONO }}>{r}</span>
                              ))}
                          </div>
                        </div>
                      )
                    })}
                    {members.length === 0 && <p className="text-xs text-muted">Nog geen medewerkers.</p>}
                  </div>
                </Card>

                <Card>
                  <CardHeader icon={<GitBranch size={14} />} title="Fallback" />
                  <div className="px-4">
                    <div className="flex items-center justify-between py-3.5 border-b border-border">
                      <div>
                        <p className="text-[13px] font-bold text-primary">Fallback persoon</p>
                        <p className="text-xs text-muted mt-0.5">Wie krijgt leads zonder match?</p>
                      </div>
                      <select className={cn(inputCls, 'w-[200px] cursor-pointer')} value={rCfg?.fallback_user_id ?? ''} onChange={e => saveRCfg({ fallback_user_id: e.target.value || null })}>
                        <option value="">— geen —</option>
                        {members.map(m => <option key={m.id} value={m.id}>{m.naam}</option>)}
                      </select>
                    </div>
                  </div>
                </Card>
              </React.Fragment>
            )}

            {/* ═══════ QUALIFY ═══════ */}
            {tab === 'qualify' && (
              <React.Fragment key={loading ? 'q-loading' : 'q-ready'}>
                <Card>
                  <CardHeader icon={<Brain size={14} />} title="Bedrijfscontext" />
                  <div className="px-4 py-4 flex flex-col gap-2.5">
                    <p className="text-xs text-muted leading-relaxed">Beschrijf jullie bedrijf en product. Dit helpt de AI bij het inschatten van klantfit.</p>
                    <textarea rows={3} placeholder="Bijv: Wij zijn ROUX, leverancier van foodservice-ingrediënten voor de horeca. Onze beste klanten zijn zelfstandige restaurants met €150k+ omzet per jaar."
                      defaultValue={qCfg.system_prompt ?? ''}
                      onBlur={e => saveQCfg({ system_prompt: e.target.value || null })}
                      className="field-input resize-y leading-relaxed" />
                  </div>
                </Card>

                <Card>
                  <CardHeader icon={<Brain size={14} />} title="Scoring instructies (A/B/C/D)" />
                  <div className="px-4 py-4 flex flex-col gap-2.5">
                    <p className="text-xs text-muted leading-relaxed">A = hoogste prioriteit, D = laagste. Gebruik concrete signalen: omzetschattingen, bedrijfstype, locatie, concept.</p>
                    <textarea rows={7}
                      placeholder={'A: Restaurant €200k+ omzet, zelfstandig concept.\nB: Restaurant €100-200k.\nC: Kleine lunchroom, foodtruck.\nD: Supermarkt, kantinebeheerder.'}
                      defaultValue={qCfg.scoring_prompt ?? ''}
                      onBlur={e => saveQCfg({ scoring_prompt: e.target.value || null })}
                      className="field-input resize-y leading-relaxed" />
                  </div>
                </Card>

                <Card>
                  <CardHeader icon={<Brain size={14} />} title="Klantbenchmarks" />
                  <table className="w-full border-collapse">
                    <thead><tr>
                      <th className={TH}>Bedrijfsnaam</th><th className={TH}>Stad</th>
                      <th className={TH}>Label</th><th className={TH}># Volume</th><th className={cn(TH, 'w-9')}></th>
                    </tr></thead>
                    <tbody>
                      {benchmarks.length === 0 && (
                        <tr><td colSpan={5} className="text-muted text-center py-5 text-xs border-b border-border">
                          Nog geen benchmark klanten. Voeg bestaande klanten toe als referentie voor de AI scoring.
                        </td></tr>
                      )}
                      {benchmarks.map((b, i) => {
                        const lc = LABEL_COLORS[b.label] ?? {}
                        const isLast = i === benchmarks.length - 1
                        return (
                          <tr key={b.id}>
                            <td className={td(isLast)}><p className="font-semibold">{b.name}</p></td>
                            <td className={td(isLast)}><span className="text-muted text-xs">{b.city || '—'}</span></td>
                            <td className={td(isLast)}>
                              {b.label ? (
                                <span className="px-2 py-0.5 rounded text-[11px] font-bold"
                                  style={{ background: lc.bg, color: lc.text, border: `1px solid ${lc.border}` }}>
                                  {b.label}
                                </span>
                              ) : '—'}
                            </td>
                            <td className={td(isLast)}><span className="text-xs text-muted">{b.revenue > 0 ? b.revenue.toLocaleString('nl-NL') : '—'}</span></td>
                            <td className={td(isLast)}>
                              <button onClick={() => saveBenchmarks(benchmarks.filter(bm => bm.id !== b.id))} className="bg-transparent border-none cursor-pointer text-muted flex p-0.5 hover:text-red-600 transition-colors">
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div className="px-4 py-4 border-t border-border bg-bg flex flex-col gap-3">
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5">
                      <LF label="Bedrijfsnaam *"><input value={bName} onChange={e => setBName(e.target.value)} className={inputCls} placeholder="Restaurant X" /></LF>
                      <LF label="Stad"><input value={bCity} onChange={e => setBCity(e.target.value)} className={inputCls} placeholder="Amsterdam" /></LF>
                      <LF label="Label *">
                        <select value={bLabel} onChange={e => setBLabel(e.target.value as BenchmarkCustomer['label'])} className={inputCls}>
                          <option value="">— kies —</option>
                          {(['A','B','C','D'] as const).map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </LF>
                      <LF label="# Volume"><input value={bRev} onChange={e => setBRev(e.target.value)} className={inputCls} placeholder="500" /></LF>
                    </div>
                    <button onClick={addBenchmark} disabled={!bName.trim() || !bLabel}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold bg-primary text-white border-none cursor-pointer disabled:opacity-40 disabled:cursor-default hover:opacity-90 transition-opacity">
                      <Plus size={13} /> Toevoegen
                    </button>
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
