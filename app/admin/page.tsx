'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useEmployee }  from '@/lib/employee-context'
import { cn }           from '@/lib/utils'
import AdminGate        from '@/components/AdminGate'
import { Database, FlaskConical, Bot, RefreshCw, TrendingUp, Zap, Users, FileText } from 'lucide-react'

const MONO = "'SF Mono','Fira Code',monospace"

type AdminTab = 'gebruik' | 'test' | 'eval'

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

function TabBar({ tab, setTab }: { tab: AdminTab; setTab: (t: AdminTab) => void }) {
  const tabs: { id: AdminTab; label: string; icon: React.ReactNode }[] = [
    { id: 'gebruik', label: 'Gebruik',  icon: <TrendingUp size={13} /> },
    { id: 'test',    label: 'Test',     icon: <FlaskConical size={13} /> },
    { id: 'eval',    label: 'Eval',     icon: <Bot size={13} /> },
  ]
  return (
    <div className="flex gap-1 mb-6 border-b border-border">
      {tabs.map(t => (
        <button key={t.id} onClick={() => setTab(t.id)}
          className={cn(
            'inline-flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors cursor-pointer',
            tab === t.id
              ? 'border-primary text-primary'
              : 'border-transparent text-muted hover:text-primary',
          )}>
          {t.icon}{t.label}
        </button>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GEBRUIK tab
// ─────────────────────────────────────────────────────────────────────────────

type UsageData = {
  supabase: {
    contacts: { total: number; leads: number; customers: number; enriched: number }
    events: Record<string, number> & { total_30d: number }
  }
  events_by_day: { date: string; [k: string]: string | number }[]
  openai: null | {
    models: { model: string; label: string; requests: number; input_tokens: number; output_tokens: number; cost_usd: number }[]
  }
  estimated: null | { enrichments: number; ai_routings: number; cost_usd: number; note: string }
}

function fmtCost(usd: number): string {
  if (usd < 0.01) return `$ ${(usd * 100).toFixed(3)} ct`
  return `$ ${usd.toFixed(3)}`
}
function fmtNum(n: number): string { return n.toLocaleString('nl-NL') }

function StatBox({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon?: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-[10px] px-4 py-3.5">
      <div className="flex items-center gap-1.5 mb-1.5 text-muted">{icon}<span className="text-[11px] font-semibold uppercase tracking-[0.05em]">{label}</span></div>
      <div className="text-[22px] font-black text-primary tracking-tight" style={{ fontFamily: MONO }}>{value}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  )
}

function GebruikTab() {
  const [data,    setData]    = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/admin/usage')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json() as UsageData)
    } catch (e) { setError(String(e)) }
    finally     { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading) return <div className="text-sm text-muted animate-pulse">Laden…</div>
  if (error)   return <div className="text-sm text-red-600">Fout: {error}</div>
  if (!data)   return null

  const { supabase: sb, openai, estimated, events_by_day } = data
  const totalCost = openai
    ? openai.models.reduce((s, m) => s + m.cost_usd, 0)
    : estimated?.cost_usd ?? 0

  return (
    <div className="space-y-6">
      {/* Refresh */}
      <div className="flex justify-end">
        <button onClick={() => void load()} disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface text-primary cursor-pointer hover:bg-active transition-colors disabled:opacity-50">
          <RefreshCw size={12} className={cn(loading && 'animate-spin')} />Vernieuwen
        </button>
      </div>

      {/* Supabase stats */}
      <div>
        <p className="text-[11px] font-extrabold text-muted uppercase tracking-[0.07em] mb-3 flex items-center gap-1.5">
          <Database size={12} />Supabase — contacten
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatBox label="Totaal"    value={fmtNum(sb.contacts.total)}    icon={<Users size={12} />} />
          <StatBox label="Leads"     value={fmtNum(sb.contacts.leads)}     icon={<Zap size={12} />} />
          <StatBox label="Klanten"   value={fmtNum(sb.contacts.customers)} icon={<Users size={12} />} />
          <StatBox label="Verrijkt"  value={fmtNum(sb.contacts.enriched)}  sub="met AI label" icon={<Bot size={12} />} />
        </div>
      </div>

      {/* Event counts */}
      <div>
        <p className="text-[11px] font-extrabold text-muted uppercase tracking-[0.07em] mb-3 flex items-center gap-1.5">
          <FileText size={12} />AI events — laatste 30 dagen
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatBox label="Verrijkingen"  value={fmtNum(sb.events['enrichment'] ?? 0)} sub="GPT-4o mini" />
          <StatBox label="Routings"      value={fmtNum(sb.events['routing']    ?? 0)} sub="GPT-4o mini" />
          <StatBox label="Aanmaken"      value={fmtNum(sb.events['create']     ?? 0)} />
          <StatBox label="Totaal events" value={fmtNum(sb.events.total_30d)}          sub="alle types" />
        </div>
      </div>

      {/* OpenAI usage (real or estimated) */}
      <div>
        <p className="text-[11px] font-extrabold text-muted uppercase tracking-[0.07em] mb-3 flex items-center gap-1.5">
          <Bot size={12} />
          {openai ? 'OpenAI gebruik — laatste 30 dagen (exact)' : 'OpenAI kosten — schatting'}
        </p>

        {openai ? (
          <div className="bg-surface border border-border rounded-[10px] overflow-hidden">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border">
                  {['Model', 'Requests', 'Input tokens', 'Output tokens', 'Kosten'].map(h => (
                    <th key={h} className="px-3.5 py-2 text-left text-muted font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openai.models.map(m => (
                  <tr key={m.model} className="border-b border-border last:border-0 hover:bg-active transition-colors">
                    <td className="px-3.5 py-2.5 font-semibold text-primary">{m.label}</td>
                    <td className="px-3.5 py-2.5 text-muted" style={{ fontFamily: MONO }}>{fmtNum(m.requests)}</td>
                    <td className="px-3.5 py-2.5 text-muted" style={{ fontFamily: MONO }}>{fmtNum(m.input_tokens)}</td>
                    <td className="px-3.5 py-2.5 text-muted" style={{ fontFamily: MONO }}>{fmtNum(m.output_tokens)}</td>
                    <td className="px-3.5 py-2.5 font-bold text-primary" style={{ fontFamily: MONO }}>{fmtCost(m.cost_usd)}</td>
                  </tr>
                ))}
                <tr className="bg-active">
                  <td colSpan={4} className="px-3.5 py-2.5 text-xs font-bold text-primary">Totaal</td>
                  <td className="px-3.5 py-2.5 text-sm font-black text-primary" style={{ fontFamily: MONO }}>{fmtCost(totalCost)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : estimated ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatBox label="Verrijkingen" value={fmtNum(estimated.enrichments)} sub="× ~€0,0006" />
              <StatBox label="AI routings"  value={fmtNum(estimated.ai_routings)} sub="× ~€0,0001" />
              <StatBox label="Schatting"    value={fmtCost(estimated.cost_usd)} sub="30 dagen" />
            </div>
            <p className="text-[11px] text-muted bg-active border border-border rounded-lg px-3 py-2">
              ⚠ {estimated.note}
            </p>
          </div>
        ) : null}
      </div>

      {/* Activity chart (text-based) */}
      {events_by_day.length > 0 && (
        <div>
          <p className="text-[11px] font-extrabold text-muted uppercase tracking-[0.07em] mb-3">Activiteit per dag</p>
          <div className="bg-surface border border-border rounded-[10px] overflow-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border">
                  {['Datum', 'Aanmaken', 'Verrijking', 'Routing'].map(h => (
                    <th key={h} className="px-3.5 py-2 text-left text-muted font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...events_by_day].reverse().slice(0, 14).map((row) => (
                  <tr key={row.date} className="border-b border-border last:border-0 hover:bg-active transition-colors">
                    <td className="px-3.5 py-2 font-medium text-primary" style={{ fontFamily: MONO }}>{row.date}</td>
                    <td className="px-3.5 py-2 text-muted" style={{ fontFamily: MONO }}>{(row['create']     as number) || '—'}</td>
                    <td className="px-3.5 py-2 text-muted" style={{ fontFamily: MONO }}>{(row['enrichment'] as number) || '—'}</td>
                    <td className="px-3.5 py-2 text-muted" style={{ fontFamily: MONO }}>{(row['routing']    as number) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST tab (API endpoint tester)
// ─────────────────────────────────────────────────────────────────────────────

type TStatus = 'idle' | 'running' | 'ok' | 'error'
interface TResult { status: TStatus; data?: unknown; error?: string; ms?: number }

function fmt(data: unknown) {
  try { return JSON.stringify(data, null, 2) } catch { return String(data) }
}
function MethodBadge({ method }: { method: string }) {
  return (
    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded',
      method === 'GET'  ? 'bg-blue-100 text-blue-700' :
      method === 'POST' ? 'bg-green-100 text-green-700' :
                          'bg-yellow-100 text-yellow-800',
    )} style={{ fontFamily: MONO }}>{method}</span>
  )
}
function TResultPanel({ r }: { r: TResult }) {
  if (r.status === 'idle') return null
  const label = r.status === 'running' ? 'Bezig…'
    : r.status === 'ok'  ? `✓ Geslaagd ${r.ms ? `(${r.ms}ms)` : ''}`
    : `✗ Fout ${r.ms ? `(${r.ms}ms)` : ''}`
  return (
    <div className="rounded-lg overflow-hidden">
      <div className={cn('flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold',
        r.status === 'running' ? 'bg-active text-muted' :
        r.status === 'ok'      ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600')}>
        {label}
      </div>
      <pre className="bg-[#0a0a0a] text-[#d4d4d4] text-[11px] leading-relaxed p-3 overflow-x-auto max-h-[240px] overflow-y-auto whitespace-pre" style={{ fontFamily: MONO }}>
        {r.error ?? fmt(r.data)}
      </pre>
    </div>
  )
}
async function tRun(fn: () => Promise<Response>, set: (r: TResult) => void) {
  set({ status: 'running' })
  const t0 = Date.now()
  try {
    const res = await fn(); const ms = Date.now() - t0
    const data = await res.json().catch(() => res.text())
    if (!res.ok) set({ status: 'error', error: fmt(data), ms })
    else         set({ status: 'ok',    data, ms })
  } catch (err) { set({ status: 'error', error: String(err), ms: Date.now() - t0 }) }
}
function TCard({ children }: { children: React.ReactNode }) {
  return <div className="bg-surface border border-border rounded-xl overflow-hidden">{children}</div>
}
function TCardHead({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg gap-3">{children}</div>
}
function TCardBody({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-3.5 flex flex-col gap-2.5">{children}</div>
}
function TField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted uppercase tracking-[0.04em]">{label}</label>{children}</div>
}
function TwoCol({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">{children}</div>
}
function FullCol({ children }: { children: React.ReactNode }) {
  return <div className="col-span-2 max-sm:col-span-1">{children}</div>
}
const inCls  = "px-2.5 py-1.5 rounded-lg border border-border bg-bg text-xs text-primary outline-none w-full box-border focus:border-primary/30 transition-colors"
const btnCls = "inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg border-none bg-primary text-white text-xs font-semibold cursor-pointer self-start transition-opacity disabled:opacity-40 disabled:cursor-default hover:opacity-90"
const secCls = "text-[11px] font-extrabold text-muted uppercase tracking-[0.07em] py-1 border-b border-border mb-3"

function TestTab() {
  const [leads,   setLeads]   = useState<TResult>({ status: 'idle' })
  const [members, setMembers] = useState<TResult>({ status: 'idle' })
  const [routing, setRouting] = useState<TResult>({ status: 'idle' })
  const [searchQ, setSearchQ] = useState('Venster 33')
  const [searchR, setSearchR] = useState<TResult>({ status: 'idle' })
  const [ccCompany, setCcCompany] = useState('Test Bedrijf BV')
  const [ccFirst,   setCcFirst]   = useState('Test')
  const [ccCity,    setCcCity]    = useState('Amsterdam')
  const [ccPhone,   setCcPhone]   = useState('')
  const [ccR, setCcR] = useState<TResult>({ status: 'idle' })
  const [ccId, setCcId] = useState('')
  const [cuId, setCuId] = useState('')
  const [cuField, setCuField] = useState('groothandel')
  const [cuValue, setCuValue] = useState('Bidfood')
  const [cuR, setCuR] = useState<TResult>({ status: 'idle' })
  const [cgId, setCgId] = useState('')
  const [cgR, setCgR] = useState<TResult>({ status: 'idle' })
  const [fCompany, setFCompany] = useState('Café Test')
  const [fFirst,   setFFirst]   = useState('Jan')
  const [fCity,    setFCity]    = useState('Rotterdam')
  const [fR, setFR] = useState<TResult>({ status: 'idle' })
  const [suusMsg, setSuusMsg] = useState('Hoeveel leads hebben we?')
  const [suusR,   setSuusR]   = useState<TResult>({ status: 'idle' })

  return (
    <div className="flex flex-col gap-4">
      <div><div className={secCls}>Supabase</div></div>
      <TCard>
        <TCardHead><MethodBadge method="GET" /><span className="text-[11px] text-muted flex-1" style={{ fontFamily: MONO }}>/api/leads</span><span className="text-[13px] font-bold text-primary">Leads ophalen</span></TCardHead>
        <TCardBody>
          <p className="text-xs text-muted">Haalt alle contacten op uit Supabase.</p>
          <button className={btnCls} disabled={leads.status === 'running'} onClick={() => tRun(() => fetch('/api/leads'), setLeads)}>{leads.status === 'running' ? '…' : 'Test'}</button>
          <TResultPanel r={leads} />
        </TCardBody>
      </TCard>
      <TCard>
        <TCardHead><MethodBadge method="GET" /><span className="text-[11px] text-muted flex-1" style={{ fontFamily: MONO }}>/api/settings/employees</span><span className="text-[13px] font-bold text-primary">Teamleden</span></TCardHead>
        <TCardBody>
          <p className="text-xs text-muted">Haalt actieve teamleden op inclusief GHL user ID en kleur.</p>
          <button className={btnCls} disabled={members.status === 'running'} onClick={() => tRun(() => fetch('/api/settings/employees'), setMembers)}>{members.status === 'running' ? '…' : 'Test'}</button>
          <TResultPanel r={members} />
        </TCardBody>
      </TCard>
      <TCard>
        <TCardHead><MethodBadge method="GET" /><span className="text-[11px] text-muted flex-1" style={{ fontFamily: MONO }}>/api/routing/config</span><span className="text-[13px] font-bold text-primary">Routing configuratie</span></TCardHead>
        <TCardBody>
          <p className="text-xs text-muted">Haalt routing-regels en configuratie op.</p>
          <button className={btnCls} disabled={routing.status === 'running'} onClick={() => tRun(() => fetch('/api/routing/config'), setRouting)}>{routing.status === 'running' ? '…' : 'Test'}</button>
          <TResultPanel r={routing} />
        </TCardBody>
      </TCard>
      <TCard>
        <TCardHead><MethodBadge method="POST" /><span className="text-[11px] text-muted flex-1" style={{ fontFamily: MONO }}>/api/formulier</span><span className="text-[13px] font-bold text-primary">Formulier → Supabase</span></TCardHead>
        <TCardBody>
          <TwoCol>
            <TField label="Bedrijfsnaam"><input className={inCls} value={fCompany} onChange={e => setFCompany(e.target.value)} /></TField>
            <TField label="Voornaam"><input className={inCls} value={fFirst} onChange={e => setFFirst(e.target.value)} /></TField>
            <TField label="Stad"><input className={inCls} value={fCity} onChange={e => setFCity(e.target.value)} /></TField>
          </TwoCol>
          <button className={btnCls} disabled={fR.status === 'running' || !fCompany.trim()}
            onClick={() => tRun(() => fetch('/api/formulier', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: fCompany, first_name: fFirst, city: fCity, status: 'lead', channel: 'OFFLINE' }) }), setFR)}>
            {fR.status === 'running' ? '…' : 'Aanmaken in Supabase'}
          </button>
          <TResultPanel r={fR} />
        </TCardBody>
      </TCard>

      <div className="mt-2"><div className={secCls}>GoHighLevel (GHL)</div></div>
      <TCard>
        <TCardHead><MethodBadge method="GET" /><span className="text-[11px] text-muted flex-1" style={{ fontFamily: MONO }}>/contacts/?query=…</span><span className="text-[13px] font-bold text-primary">Contact zoeken</span></TCardHead>
        <TCardBody>
          <TwoCol><TField label="Zoekopdracht"><input className={inCls} value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="bijv. Café de Boom" /></TField></TwoCol>
          <button className={btnCls} disabled={searchR.status === 'running' || !searchQ.trim()} onClick={() => tRun(() => fetch(`/api/test/ghl-search?q=${encodeURIComponent(searchQ)}`), setSearchR)}>{searchR.status === 'running' ? '…' : 'Zoeken in GHL'}</button>
          <TResultPanel r={searchR} />
        </TCardBody>
      </TCard>
      <TCard>
        <TCardHead><MethodBadge method="POST" /><span className="text-[11px] text-muted flex-1" style={{ fontFamily: MONO }}>/api/contact-create</span><span className="text-[13px] font-bold text-primary">Contact aanmaken</span></TCardHead>
        <TCardBody>
          <TwoCol>
            <TField label="Bedrijfsnaam *"><input className={inCls} value={ccCompany} onChange={e => setCcCompany(e.target.value)} /></TField>
            <TField label="Voornaam *"><input className={inCls} value={ccFirst} onChange={e => setCcFirst(e.target.value)} /></TField>
            <TField label="Stad"><input className={inCls} value={ccCity} onChange={e => setCcCity(e.target.value)} /></TField>
            <TField label="Telefoon"><input className={inCls} value={ccPhone} onChange={e => setCcPhone(e.target.value)} placeholder="+31..." /></TField>
          </TwoCol>
          <button className={btnCls} disabled={ccR.status === 'running' || !ccCompany.trim() || !ccFirst.trim()}
            onClick={() => tRun(async () => {
              const r = await fetch('/api/contact-create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyName: ccCompany, firstName: ccFirst, city: ccCity, phone: ccPhone || undefined }) })
              const json = await r.clone().json().catch(() => ({})) as { contactId?: string }
              if (json.contactId) { setCcId(json.contactId); setCuId(json.contactId); setCgId(json.contactId) }
              return r
            }, setCcR)}>
            {ccR.status === 'running' ? '…' : 'Aanmaken in GHL'}
          </button>
          {ccId && <p className="text-[11px] text-green-600" style={{ fontFamily: MONO }}>ContactId bewaard: {ccId}</p>}
          <TResultPanel r={ccR} />
        </TCardBody>
      </TCard>
      <TCard>
        <TCardHead><MethodBadge method="GET" /><span className="text-[11px] text-muted flex-1" style={{ fontFamily: MONO }}>/api/test/ghl-get?id=…</span><span className="text-[13px] font-bold text-primary">Contact ophalen</span></TCardHead>
        <TCardBody>
          <TwoCol><FullCol><TField label="Contact ID"><input className={inCls} value={cgId} onChange={e => setCgId(e.target.value)} placeholder="GHL contact ID" /></TField></FullCol></TwoCol>
          <button className={btnCls} disabled={cgR.status === 'running' || !cgId.trim()} onClick={() => tRun(() => fetch(`/api/test/ghl-get?id=${encodeURIComponent(cgId)}`), setCgR)}>{cgR.status === 'running' ? '…' : 'Ophalen uit GHL'}</button>
          <TResultPanel r={cgR} />
        </TCardBody>
      </TCard>
      <TCard>
        <TCardHead><MethodBadge method="POST" /><span className="text-[11px] text-muted flex-1" style={{ fontFamily: MONO }}>/api/contact-update/[id]</span><span className="text-[13px] font-bold text-primary">Contact bijwerken</span></TCardHead>
        <TCardBody>
          <TwoCol>
            <FullCol><TField label="Contact ID *"><input className={inCls} value={cuId} onChange={e => setCuId(e.target.value)} placeholder="GHL contact ID" /></TField></FullCol>
            <TField label="Veld">
              <select className={inCls} value={cuField} onChange={e => setCuField(e.target.value)}>
                <option value="groothandel">Groothandel</option>
                <option value="kortingsafspraken">Kortingsafspraken</option>
                <option value="posMateriaal">POS Materiaal</option>
                <option value="firstName">Voornaam</option>
                <option value="city">Stad</option>
              </select>
            </TField>
            <TField label="Waarde"><input className={inCls} value={cuValue} onChange={e => setCuValue(e.target.value)} /></TField>
          </TwoCol>
          <button className={btnCls} disabled={cuR.status === 'running' || !cuId.trim()}
            onClick={() => tRun(() => fetch(`/api/contact-update/${cuId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [cuField]: cuValue }) }), setCuR)}>
            {cuR.status === 'running' ? '…' : 'Bijwerken in GHL'}
          </button>
          <TResultPanel r={cuR} />
        </TCardBody>
      </TCard>

      <div className="mt-2"><div className={secCls}>SUUS AI</div></div>
      <TCard>
        <TCardHead><MethodBadge method="POST" /><span className="text-[11px] text-muted flex-1" style={{ fontFamily: MONO }}>/api/suus</span><span className="text-[13px] font-bold text-primary">SUUS chat smoke test</span></TCardHead>
        <TCardBody>
          <TwoCol><FullCol><TField label="Bericht"><input className={inCls} value={suusMsg} onChange={e => setSuusMsg(e.target.value)} /></TField></FullCol></TwoCol>
          <button className={btnCls} disabled={suusR.status === 'running' || !suusMsg.trim()}
            onClick={() => tRun(async () => {
              const res = await fetch('/api/suus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: suusMsg, session_id: 'test-' + Date.now() }) })
              if (!res.ok || !res.body) return res
              const reader = res.body.getReader(); const dec = new TextDecoder(); let text = ''
              while (true) { const { done, value } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }) }
              return new Response(JSON.stringify({ response: text.replace(/\n__\w+__:.+/g, '').trim(), chars: text.length }), { status: 200, headers: { 'Content-Type': 'application/json' } })
            }, setSuusR)}>
            {suusR.status === 'running' ? '…' : 'Stuur naar SUUS'}
          </button>
          <TResultPanel r={suusR} />
        </TCardBody>
      </TCard>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EVAL tab (SUUS evaluator)
// ─────────────────────────────────────────────────────────────────────────────

interface TestResult {
  intent: string; example: string; category: string; passed: boolean
  toolsCalled: string[]; ghlSuccess: boolean; errorDetail?: string
  responseText: string; steps: number; durationMs: number
}
interface SseEvent {
  type: string; message?: string; twilioCount?: number; retellCount?: number
  total?: number; intents?: { intent: string; example: string; category: string }[]
  index?: number; intent?: string; example?: string; result?: TestResult
  passed?: number; failed?: number; passRate?: number; avgDurationMs?: number
  results?: TestResult[]; error?: string
}

function EvalTab() {
  const [running,  setRunning]  = useState(false)
  const [log,      setLog]      = useState<string[]>([])
  const [results,  setResults]  = useState<TestResult[]>([])
  const [summary,  setSummary]  = useState<SseEvent | null>(null)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [mode,     setMode]     = useState<'intents' | 'raw'>('intents')
  const [since,    setSince]    = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() - 14); return d.toISOString().slice(0, 10)
  })
  const abortRef = useRef<AbortController | null>(null)
  const { activeEmployee } = useEmployee()

  function addLog(msg: string) { setLog(p => [...p.slice(-200), msg]) }

  async function runStream(res: Response) {
    if (!res.body) throw new Error('No stream')
    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = ''
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n\n'); buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const evt: SseEvent = JSON.parse(line.slice(6))
          if (evt.type === 'status')  addLog(evt.message ?? '')
          if (evt.type === 'logs')    addLog(`📊 ${evt.twilioCount} Twilio + ${evt.retellCount} Retell = ${evt.total} berichten`)
          if (evt.type === 'intents') addLog(`🎯 ${evt.intents?.length} ${mode === 'raw' ? 'echte berichten' : 'intents'} worden getest`)
          if (evt.type === 'running') {
            setProgress({ current: (evt.index ?? 0) + 1, total: evt.total ?? 0 })
            addLog(`▶ [${(evt.index ?? 0) + 1}/${evt.total}] ${evt.intent}${evt.example ? ` · "${evt.example}"` : ''}`)
          }
          if (evt.type === 'result' && evt.result) {
            setResults(p => {
              const idx = p.findIndex(r => r.intent === evt.result!.intent && r.example === evt.result!.example)
              if (idx >= 0) { const n = [...p]; n[idx] = evt.result!; return n }
              return [...p, evt.result!]
            })
            const r = evt.result
            addLog(`${r.passed ? '✅' : '❌'} ${r.intent} — ${r.toolsCalled.join(' → ') || 'geen tools'} (${r.durationMs}ms)${r.errorDetail ? ` | ${r.errorDetail.slice(0, 80)}` : ''}`)
          }
          if (evt.type === 'summary') {
            setSummary(evt)
            addLog(`\n🏁 Klaar: ${evt.passed}/${evt.total} geslaagd (${evt.passRate}%) — gem ${evt.avgDurationMs}ms`)
          }
          if (evt.type === 'error') addLog(`❌ Error: ${evt.message}`)
        } catch { /**/ }
      }
    }
  }

  async function startEval() {
    setRunning(true); setLog([]); setResults([]); setSummary(null); setProgress({ current: 0, total: 0 })
    abortRef.current = new AbortController()
    try {
      const params = new URLSearchParams({ mode })
      if (activeEmployee) params.set('employee_id', activeEmployee.id)
      if (since) params.set('since', since)
      await runStream(await fetch(`/api/admin/eval?${params}`, { signal: abortRef.current.signal }))
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') addLog(`❌ ${String(err)}`)
    } finally { setRunning(false) }
  }

  async function retryFailed() {
    const failed = results.filter(r => !r.passed); if (!failed.length) return
    setRunning(true); setLog([`🔁 Hertesten: ${failed.length} gefaalde tests…`]); setResults([]); setSummary(null)
    setProgress({ current: 0, total: failed.length })
    abortRef.current = new AbortController()
    try {
      await runStream(await fetch('/api/admin/eval', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intents: failed.map(r => ({ intent: r.intent, example: r.example, category: r.category })), employee_id: activeEmployee?.id }),
        signal: abortRef.current.signal,
      }))
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') addLog(`❌ ${String(err)}`)
    } finally { setRunning(false) }
  }

  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length

  return (
    <div>
      <p className="text-[13px] text-muted mb-5">SUUS Eval — haalt logs op → test door SUUS + GHL (dry-run)</p>

      {activeEmployee && (
        <div className="flex items-center gap-1.5 mb-4 text-xs text-muted">
          Chat als:
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: activeEmployee.color ?? '#888' }} />
          <span className="text-primary font-medium">{activeEmployee.naam}</span>
        </div>
      )}

      <div className="flex gap-2.5 mb-6 items-center flex-wrap">
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <span>Vanaf</span>
          <input type="date" value={since} onChange={e => setSince(e.target.value)} disabled={running}
            className="px-2 py-1 rounded-lg border border-border bg-surface text-primary text-xs outline-none disabled:cursor-default" />
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          {(['intents', 'raw'] as const).map(m => (
            <button key={m} onClick={() => !running && setMode(m)}
              className={cn('px-3.5 py-1.5 border-none cursor-pointer transition-colors',
                mode === m ? 'bg-[#111] text-white font-semibold' : 'bg-transparent text-muted font-normal hover:bg-active')}>
              {m === 'intents' ? '🧠 Intents' : '📨 Echte berichten'}
            </button>
          ))}
        </div>
        <button onClick={startEval} disabled={running}
          className="px-5 py-2 rounded-lg border-none font-semibold text-[13px] cursor-pointer transition-colors disabled:cursor-default"
          style={{ backgroundColor: running ? 'var(--border)' : '#111', color: running ? 'var(--muted)' : '#fff' }}>
          {running ? 'Bezig…' : '▶ Start eval'}
        </button>
        {!running && results.some(r => !r.passed) && (
          <button onClick={retryFailed}
            className="px-4 py-2 rounded-lg border border-red-600 bg-transparent text-red-600 cursor-pointer font-semibold text-[13px] hover:bg-red-50 transition-colors">
            🔁 Hertesten ({results.filter(r => !r.passed).length} gefaald)
          </button>
        )}
        {running && (
          <button onClick={() => { abortRef.current?.abort(); setRunning(false) }}
            className="px-4 py-2 rounded-lg border border-border bg-bg text-red-600 cursor-pointer text-[13px] hover:bg-active transition-colors">
            Stop
          </button>
        )}
        {progress.total > 0 && (
          <span className="text-xs text-muted" style={{ fontFamily: MONO }}>
            {progress.current}/{progress.total}{' — '}
            <span className="text-green-600">{passed} ✅</span>{' '}
            <span className="text-red-500">{failed} ❌</span>
          </span>
        )}
      </div>

      {summary && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Geslaagd',  value: `${summary.passed}/${summary.total}`, color: '#16a34a' },
            { label: 'Gefaald',   value: String(summary.failed),               color: '#dc2626' },
            { label: 'Pass rate', value: `${summary.passRate}%`,               color: summary.passRate! >= 80 ? '#16a34a' : summary.passRate! >= 60 ? '#d97706' : '#dc2626' },
            { label: 'Gem. tijd', value: `${summary.avgDurationMs}ms`,         color: 'var(--text)' },
          ].map(tile => (
            <div key={tile.label} className="px-4 py-3.5 rounded-[10px] border border-border bg-surface">
              <div className="text-xl font-bold" style={{ color: tile.color, fontFamily: MONO }}>{tile.value}</div>
              <div className="text-xs text-muted mt-0.5">{tile.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold text-muted mb-2 uppercase tracking-[0.05em]">Log</p>
          <div className="bg-[#0a0a0a] rounded-[10px] px-3.5 py-3.5 h-[480px] overflow-y-auto text-[#ccc] text-[11px] leading-[1.7]" style={{ fontFamily: MONO }}>
            {log.map((l, i) => (
              <div key={i} style={{ color: l.startsWith('✅') ? '#4ade80' : l.startsWith('❌') ? '#f87171' : l.startsWith('▶') ? '#93c5fd' : '#ccc' }}>{l}</div>
            ))}
            {running && <div className="text-[#555] animate-pulse">▌</div>}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted mb-2 uppercase tracking-[0.05em]">Resultaten</p>
          <div className="border border-border rounded-[10px] overflow-hidden max-h-[480px] overflow-y-auto">
            {results.length === 0 ? (
              <div className="px-6 py-6 text-center text-muted text-[13px]">Nog geen resultaten</div>
            ) : (
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-surface">
                    {['', 'Intent', 'Tools', 'ms'].map(h => (
                      <th key={h} className="px-2.5 py-2 text-left text-muted font-semibold border-b border-border whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className={cn('border-b border-border', i % 2 === 0 ? 'bg-bg' : 'bg-surface')}>
                      <td className="px-2.5 py-1.5 text-sm">{r.passed ? '✅' : '❌'}</td>
                      <td className="px-2.5 py-1.5 text-primary max-w-[180px]">
                        <div className="font-medium overflow-hidden text-ellipsis whitespace-nowrap">{r.intent}</div>
                        {r.errorDetail && <div className="text-red-400 text-[10px] mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">{r.errorDetail.slice(0, 60)}</div>}
                        {r.responseText && !r.errorDetail && <div className="text-muted text-[10px] mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">{r.responseText}</div>}
                      </td>
                      <td className="px-2.5 py-1.5 text-muted text-[10px] whitespace-nowrap" style={{ fontFamily: MONO }}>{r.toolsCalled.join(' → ') || '—'}</td>
                      <td className="px-2.5 py-1.5 text-muted text-right whitespace-nowrap" style={{ fontFamily: MONO }}>{r.durationMs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {results.filter(r => !r.passed).length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-semibold text-red-600 mb-3 uppercase tracking-[0.05em]">❌ Gefaalde tests — detail</p>
          <div className="flex flex-col gap-2">
            {results.filter(r => !r.passed).map((r, i) => (
              <div key={i} className="px-3.5 py-3 rounded-lg border border-red-200 bg-red-50">
                <div className="font-semibold text-[13px] text-red-600 mb-1">{r.intent}</div>
                <div className="text-xs text-[#555] mb-1">Input: <em>&quot;{r.example}&quot;</em></div>
                <div className="text-[11px] text-[#666]" style={{ fontFamily: MONO }}>
                  Tools: {r.toolsCalled.join(' → ') || 'geen'} | Steps: {r.steps} | {r.durationMs}ms
                </div>
                {r.errorDetail && <div className="text-[11px] text-red-600 mt-1" style={{ fontFamily: MONO }}>{r.errorDetail.slice(0, 200)}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main admin page
// ─────────────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('gebruik')

  return (
    <AdminGate>
      <div className="px-4 sm:px-6 py-4 sm:py-6 max-w-[1100px] mx-auto">
        <h1 className="text-[18px] font-bold text-primary mb-4">Admin</h1>
        <TabBar tab={tab} setTab={setTab} />
        {tab === 'gebruik' && <GebruikTab />}
        {tab === 'test'    && <TestTab />}
        {tab === 'eval'    && <EvalTab />}
      </div>
    </AdminGate>
  )
}
