'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, GitBranch, Users, Settings2, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TeamMember {
  id: string; naam: string; email?: string
  postcode_ranges: string[]; active: boolean
}
interface RoutingConfig {
  organization_id: string; pre_routing_prompt: string | null
  pre_routing_assign_to_id: string | null; pre_routing_assign_to_naam: string | null
  pre_routing_websearch: boolean; fallback_user_id: string | null
  fallback_user_naam: string | null; routing_disabled: boolean
  skip_pre: boolean; skip_body: boolean
}

const inputCls = "px-2.5 py-[7px] text-xs rounded-md border border-border bg-bg text-primary outline-none"

function SectionHeader({ icon, title, action }: { icon: React.ReactNode; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
      <div className="flex items-center gap-2">
        <span className="text-muted flex">{icon}</span>
        <span className="text-[13px] font-semibold text-primary">{title}</span>
      </div>
      {action}
    </div>
  )
}

function Btn({ label, onClick, variant = 'primary', disabled = false, icon }: {
  label: string; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; icon?: React.ReactNode
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer border transition-colors disabled:opacity-50 disabled:cursor-default',
        variant === 'primary' ? 'bg-primary text-white border-transparent hover:opacity-90' :
        variant === 'danger'  ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100' :
                                'bg-transparent text-muted border-border hover:bg-active',
      )}>
      {icon}{label}
    </button>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)}
      className="bg-transparent border-none cursor-pointer flex items-center"
      style={{ color: value ? 'var(--text)' : 'var(--muted)' }}>
      {value ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
    </button>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-surface border border-border rounded-[10px] overflow-hidden mb-5">{children}</div>
}

const TH = "text-[11px] font-semibold text-muted px-3.5 py-2 border-b border-border text-left uppercase tracking-[0.05em]"
const TD = (last: boolean) => cn("text-xs px-3.5 py-2.5 text-primary", !last && "border-b border-border")


export default function RoutingPage() {
  const [members,   setMembers]   = useState<TeamMember[]>([])
  const [config,    setConfig]    = useState<RoutingConfig | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [newNaam,            setNewNaam]            = useState('')
  const [newEmail,           setNewEmail]           = useState('')
  const [newPostcodeRanges,  setNewPostcodeRanges]  = useState('')

  const flash = (text: string, ok = true) => { setStatusMsg({ text, ok }); setTimeout(() => setStatusMsg(null), 3500) }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cfgRes, membersRes] = await Promise.all([
        fetch('/api/routing/config').then(r => r.json()),
        fetch('/api/settings/employees').then(r => r.json()),
      ])
      setConfig(cfgRes.config ?? null)
      setMembers(Array.isArray(membersRes) ? membersRes : (membersRes.employees ?? []))
    } catch { flash('Fout bij laden', false) }
    finally  { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function addMember() {
    if (!newNaam.trim()) return
    const postcode_ranges = newPostcodeRanges.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
    const res = await fetch('/api/settings/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ naam: newNaam.trim(), email: newEmail.trim() || null, postcode_ranges }) })
    if (res.ok) { setNewNaam(''); setNewEmail(''); setNewPostcodeRanges(''); flash('Teamlid toegevoegd'); load() }
    else flash('Fout bij toevoegen', false)
  }

  async function deleteMember(id: string) {
    if (!confirm('Teamlid verwijderen?')) return
    const res = await fetch(`/api/settings/employees/${id}`, { method: 'DELETE' })
    if (res.ok) { flash('Verwijderd'); load() } else flash('Fout', false)
  }

  async function updateConfig(patch: Partial<RoutingConfig>) {
    setSaving(true)
    try {
      const res = await fetch('/api/routing/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      if (res.ok) { setConfig(prev => ({ ...prev!, ...await res.json() })); flash('Opgeslagen') }
      else flash('Fout', false)
    } finally { setSaving(false) }
  }

  async function rerunAll() {
    setRerunning(true)
    try {
      const res = await fetch('/api/routing/apply-all', { method: 'POST' })
      const d   = await res.json()
      flash(`${d.updated ?? 0} van ${d.total ?? 0} contacts gerouteerd`); load()
    } catch { flash('Fout', false) }
    finally { setRerunning(false) }
  }

  if (loading) {
    return <div className="min-h-screen bg-bg flex items-center justify-center"><span className="text-sm text-muted">Laden…</span></div>
  }

  return (
    <div className="min-h-screen bg-bg px-5 py-6">
      <div className="max-w-[820px] mx-auto">

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[18px] font-extrabold text-primary tracking-tight">Routing</h1>
            <p className="text-xs text-muted mt-0.5">Wijs leads automatisch toe aan teamleden</p>
          </div>
          <div className="flex gap-2 items-center">
            {statusMsg && <span className={cn('text-xs font-semibold', statusMsg.ok ? 'text-green-600' : 'text-red-600')}>{statusMsg.text}</span>}
            <Btn label={rerunning ? 'Herrouten…' : 'Herroute alle leads'} onClick={rerunAll} variant="ghost" disabled={rerunning} icon={<RefreshCw size={13} />} />
          </div>
        </div>

        {/* Instellingen */}
        <Card>
          <SectionHeader icon={<Settings2 size={14} />} title="Instellingen" />
          <div className="px-4 py-3.5 flex flex-col gap-3.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-semibold text-primary">Routing actief</p>
                <p className="text-[11px] text-muted mt-0.5">Schakel routing uit om alle toewijzingen te pauzeren</p>
              </div>
              <Toggle value={!(config?.routing_disabled ?? false)} onChange={v => updateConfig({ routing_disabled: !v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-semibold text-primary">Fallback persoon</p>
                <p className="text-[11px] text-muted mt-0.5">Wie krijgt leads die geen regel matchen?</p>
              </div>
              <select className={cn(inputCls, 'w-[180px] cursor-pointer')} value={config?.fallback_user_id ?? ''} onChange={e => updateConfig({ fallback_user_id: e.target.value || null })}>
                <option value="">— geen —</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.naam}</option>)}
              </select>
            </div>
          </div>
        </Card>

        {/* Teamleden */}
        <Card>
          <SectionHeader icon={<Users size={14} />} title="Teamleden" />
          {members.length > 0 && (
            <table className="w-full border-collapse">
              <thead><tr>
                <th className={TH}>Naam</th><th className={TH}>Postcodegebieden</th><th className={cn(TH, 'w-11')}></th>
              </tr></thead>
              <tbody>
                {members.map((m, i) => (
                  <tr key={m.id}>
                    <td className={TD(i === members.length - 1)}>
                      <p className="font-semibold">{m.naam}</p>
                      {m.email && <p className="text-muted text-[11px]">{m.email}</p>}
                    </td>
                    <td className={TD(i === members.length - 1)}>
                      {(m.postcode_ranges ?? []).length > 0
                        ? <div className="flex gap-1 flex-wrap">{m.postcode_ranges.map(r => (
                            <span key={r} className="px-[7px] py-0.5 rounded bg-active text-[11px] text-primary border border-border">{r}</span>
                          ))}</div>
                        : <span className="text-muted text-[11px]">—</span>
                      }
                    </td>
                    <td className={TD(i === members.length - 1)}>
                      <button onClick={() => deleteMember(m.id)} className="bg-transparent border-none cursor-pointer text-muted flex hover:text-red-600 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className={cn('px-4 py-3 flex gap-2 flex-wrap items-end', members.length > 0 && 'border-t border-border')}>
            <input placeholder="Naam *" value={newNaam} onChange={e => setNewNaam(e.target.value)} className={cn(inputCls, 'w-[140px]')} />
            <input placeholder="E-mail" value={newEmail} onChange={e => setNewEmail(e.target.value)} className={cn(inputCls, 'w-[180px]')} />
            <input placeholder="Postcodes (bijv. 10, 20, 30)" value={newPostcodeRanges} onChange={e => setNewPostcodeRanges(e.target.value)} className={cn(inputCls, 'w-[220px]')} />
            <Btn label="Toevoegen" onClick={addMember} disabled={!newNaam.trim()} icon={<Plus size={12} />} />
          </div>
        </Card>

        {/* AI pre-routing */}
        <Card>
          <SectionHeader icon={<GitBranch size={14} />} title="AI pre-routing (optioneel)" />
          <div className="px-4 py-3.5 flex flex-col gap-3">
            <p className="text-xs text-muted leading-relaxed">
              Gebruik AI om specifieke leads automatisch te herkennen en toe te wijzen vóór de gewone regels.
            </p>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-primary">Prompt voor AI classifier</label>
              <textarea rows={4} placeholder="Bijv: Wijs toe als het bedrijf een groothandel, keten of cateraar met 200+ medewerkers is."
                defaultValue={config?.pre_routing_prompt ?? ''}
                onBlur={e => updateConfig({ pre_routing_prompt: e.target.value || null })}
                className="field-input w-full resize-y leading-relaxed" />
            </div>
            <div className="flex gap-3 flex-wrap items-center">
              <div className="flex items-center gap-2">
                <label className="text-xs text-primary">Toewijzen aan</label>
                <select className={cn(inputCls, 'w-[160px] cursor-pointer')} value={config?.pre_routing_assign_to_id ?? ''}
                  onChange={e => updateConfig({ pre_routing_assign_to_id: e.target.value || null })}>
                  <option value="">— niemand —</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.naam}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <Toggle value={config?.pre_routing_websearch ?? false} onChange={v => updateConfig({ pre_routing_websearch: v })} />
                <label className="text-xs text-primary">Websearch gebruiken</label>
              </div>
            </div>
          </div>
        </Card>

        {saving && <p className="text-xs text-muted text-center">Opslaan…</p>}
      </div>
    </div>
  )
}
