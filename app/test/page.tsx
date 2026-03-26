'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import AdminGate from '@/components/AdminGate'

const MONO = "'SF Mono','Fira Code',monospace"

type Status = 'idle' | 'running' | 'ok' | 'error'
interface Result { status: Status; data?: unknown; error?: string; ms?: number }

function fmt(data: unknown) {
  try { return JSON.stringify(data, null, 2) } catch { return String(data) }
}

function Badge({ method }: { method: string }) {
  return (
    <span className={cn(
      'text-[10px] font-bold px-1.5 py-0.5 rounded',
      method === 'GET'  ? 'bg-blue-100 text-blue-700' :
      method === 'POST' ? 'bg-green-100 text-green-700' :
                          'bg-yellow-100 text-yellow-800',
    )} style={{ fontFamily: MONO }}>
      {method}
    </span>
  )
}

function ResultPanel({ r }: { r: Result }) {
  if (r.status === 'idle') return null
  const label = r.status === 'running' ? 'Bezig…'
    : r.status === 'ok'  ? `✓ Geslaagd ${r.ms ? `(${r.ms}ms)` : ''}`
    : `✗ Fout ${r.ms ? `(${r.ms}ms)` : ''}`
  const body = r.error ?? fmt(r.data)
  return (
    <div className="rounded-lg overflow-hidden">
      <div className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold',
        r.status === 'running' ? 'bg-active text-muted' :
        r.status === 'ok'      ? 'bg-green-50 text-green-700' :
                                 'bg-red-50 text-red-600',
      )}>
        {label}
      </div>
      <pre className="bg-[#0a0a0a] text-[#d4d4d4] text-[11px] leading-relaxed p-3 overflow-x-auto max-h-[280px] overflow-y-auto whitespace-pre"
        style={{ fontFamily: MONO }}>
        {body}
      </pre>
    </div>
  )
}

async function run(fn: () => Promise<Response>, set: (r: Result) => void) {
  set({ status: 'running' })
  const t0 = Date.now()
  try {
    const res  = await fn()
    const ms   = Date.now() - t0
    const data = await res.json().catch(() => res.text())
    if (!res.ok) set({ status: 'error', error: fmt(data), ms })
    else         set({ status: 'ok',    data, ms })
  } catch (err) {
    set({ status: 'error', error: String(err), ms: Date.now() - t0 })
  }
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-surface border border-border rounded-xl overflow-hidden">{children}</div>
}
function CardHead({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg gap-3">{children}</div>
}
function CardBody({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-3.5 flex flex-col gap-2.5">{children}</div>
}
function TwoCol({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">{children}</div>
}
function FField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold text-muted uppercase tracking-[0.04em]">{label}</label>
      {children}
    </div>
  )
}
function FullCol({ children }: { children: React.ReactNode }) {
  return <div className="col-span-2 max-sm:col-span-1">{children}</div>
}

const inputCls = "px-2.5 py-1.5 rounded-lg border border-border bg-bg text-xs text-primary outline-none w-full box-border focus:border-primary/30 transition-colors"
const btnCls   = "inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg border-none bg-primary text-white text-xs font-semibold cursor-pointer self-start transition-opacity disabled:opacity-40 disabled:cursor-default hover:opacity-90"
const secCls   = "text-[11px] font-extrabold text-muted uppercase tracking-[0.07em] py-1 border-b border-border mb-3"

export default function TestPage() {
  const [leads,   setLeads]   = useState<Result>({ status: 'idle' })
  const [members, setMembers] = useState<Result>({ status: 'idle' })
  const [routing, setRouting] = useState<Result>({ status: 'idle' })
  const [searchQ, setSearchQ] = useState('Venster 33')
  const [searchR, setSearchR] = useState<Result>({ status: 'idle' })
  const [ccCompany, setCcCompany] = useState('Test Bedrijf BV')
  const [ccFirst,   setCcFirst]   = useState('Test')
  const [ccCity,    setCcCity]    = useState('Amsterdam')
  const [ccPhone,   setCcPhone]   = useState('')
  const [ccR,       setCcR]       = useState<Result>({ status: 'idle' })
  const [ccId,      setCcId]      = useState('')
  const [cuId,      setCuId]      = useState('')
  const [cuField,   setCuField]   = useState('groothandel')
  const [cuValue,   setCuValue]   = useState('Bidfood')
  const [cuR,       setCuR]       = useState<Result>({ status: 'idle' })
  const [cgId,      setCgId]      = useState('')
  const [cgR,       setCgR]       = useState<Result>({ status: 'idle' })
  const [fCompany,  setFCompany]  = useState('Café Test')
  const [fFirst,    setFFirst]    = useState('Jan')
  const [fCity,     setFCity]     = useState('Rotterdam')
  const [fR,        setFR]        = useState<Result>({ status: 'idle' })
  const [suusMsg,   setSuusMsg]   = useState('Hoeveel leads hebben we?')
  const [suusR,     setSuusR]     = useState<Result>({ status: 'idle' })

  return (
    <AdminGate>
    <div className="max-w-[860px] mx-auto px-5 pt-7 pb-16">
      <h1 className="text-[18px] font-bold text-primary tracking-tight mb-1">API Endpoint Tests</h1>
      <p className="text-xs text-muted mb-7">Test alle endpoints — verifieert rendering, GHL-data en terugschrijven</p>

      <div className="flex flex-col gap-4">

        {/* ── Supabase ── */}
        <div><div className={secCls}>Supabase</div></div>

        <Card>
          <CardHead><Badge method="GET" /><span className="text-[11px] text-muted flex-1" style={{ fontFamily: MONO }}>/api/leads</span><span className="text-[13px] font-bold text-primary">Leads ophalen</span></CardHead>
          <CardBody>
            <p className="text-xs text-muted">Haalt alle contacten op uit Supabase.</p>
            <button className={btnCls} disabled={leads.status === 'running'} onClick={() => run(() => fetch('/api/leads'), setLeads)}>{leads.status === 'running' ? '…' : 'Test'}</button>
            <ResultPanel r={leads} />
          </CardBody>
        </Card>

        <Card>
          <CardHead><Badge method="GET" /><span className="text-[11px] text-muted flex-1" style={{ fontFamily: MONO }}>/api/team-members</span><span className="text-[13px] font-bold text-primary">Teamleden</span></CardHead>
          <CardBody>
            <p className="text-xs text-muted">Haalt actieve teamleden op inclusief GHL user ID.</p>
            <button className={btnCls} disabled={members.status === 'running'} onClick={() => run(() => fetch('/api/team-members'), setMembers)}>{members.status === 'running' ? '…' : 'Test'}</button>
            <ResultPanel r={members} />
          </CardBody>
        </Card>

        <Card>
          <CardHead><Badge method="GET" /><span className="text-[11px] text-muted flex-1" style={{ fontFamily: MONO }}>/api/routing/config</span><span className="text-[13px] font-bold text-primary">Routing configuratie</span></CardHead>
          <CardBody>
            <p className="text-xs text-muted">Haalt routing-regels en configuratie op.</p>
            <button className={btnCls} disabled={routing.status === 'running'} onClick={() => run(() => fetch('/api/routing/config'), setRouting)}>{routing.status === 'running' ? '…' : 'Test'}</button>
            <ResultPanel r={routing} />
          </CardBody>
        </Card>

        <Card>
          <CardHead><Badge method="POST" /><span className="text-[11px] text-muted flex-1" style={{ fontFamily: MONO }}>/api/formulier</span><span className="text-[13px] font-bold text-primary">Formulier → Supabase</span></CardHead>
          <CardBody>
            <p className="text-xs text-muted">Maakt een nieuw contact aan in Supabase.</p>
            <TwoCol>
              <FField label="Bedrijfsnaam"><input className={inputCls} value={fCompany} onChange={e => setFCompany(e.target.value)} /></FField>
              <FField label="Voornaam"><input className={inputCls} value={fFirst} onChange={e => setFFirst(e.target.value)} /></FField>
              <FField label="Stad"><input className={inputCls} value={fCity} onChange={e => setFCity(e.target.value)} /></FField>
            </TwoCol>
            <button className={btnCls} disabled={fR.status === 'running' || !fCompany.trim()}
              onClick={() => run(() => fetch('/api/formulier', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: fCompany, first_name: fFirst, city: fCity, status: 'lead', channel: 'OFFLINE' }) }), setFR)}>
              {fR.status === 'running' ? '…' : 'Aanmaken in Supabase'}
            </button>
            <ResultPanel r={fR} />
          </CardBody>
        </Card>

        {/* ── GHL ── */}
        <div className="mt-2"><div className={secCls}>GoHighLevel (GHL)</div></div>

        <Card>
          <CardHead><Badge method="GET" /><span className="text-[11px] text-muted flex-1" style={{ fontFamily: MONO }}>/contacts/?query=…</span><span className="text-[13px] font-bold text-primary">Contact zoeken</span></CardHead>
          <CardBody>
            <p className="text-xs text-muted">Zoekt een contact in GHL via de API.</p>
            <TwoCol>
              <FField label="Zoekopdracht"><input className={inputCls} value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="bijv. Café de Boom" /></FField>
            </TwoCol>
            <button className={btnCls} disabled={searchR.status === 'running' || !searchQ.trim()} onClick={() => run(() => fetch(`/api/test/ghl-search?q=${encodeURIComponent(searchQ)}`), setSearchR)}>{searchR.status === 'running' ? '…' : 'Zoeken in GHL'}</button>
            <ResultPanel r={searchR} />
          </CardBody>
        </Card>

        <Card>
          <CardHead><Badge method="POST" /><span className="text-[11px] text-muted flex-1" style={{ fontFamily: MONO }}>/api/contact-create</span><span className="text-[13px] font-bold text-primary">Contact aanmaken</span></CardHead>
          <CardBody>
            <p className="text-xs text-muted">Maakt een nieuw GHL contact aan.</p>
            <TwoCol>
              <FField label="Bedrijfsnaam *"><input className={inputCls} value={ccCompany} onChange={e => setCcCompany(e.target.value)} /></FField>
              <FField label="Voornaam *"><input className={inputCls} value={ccFirst} onChange={e => setCcFirst(e.target.value)} /></FField>
              <FField label="Stad"><input className={inputCls} value={ccCity} onChange={e => setCcCity(e.target.value)} /></FField>
              <FField label="Telefoon"><input className={inputCls} value={ccPhone} onChange={e => setCcPhone(e.target.value)} placeholder="+31..." /></FField>
            </TwoCol>
            <button className={btnCls} disabled={ccR.status === 'running' || !ccCompany.trim() || !ccFirst.trim()}
              onClick={() => run(async () => {
                const r = await fetch('/api/contact-create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyName: ccCompany, firstName: ccFirst, city: ccCity, phone: ccPhone || undefined }) })
                const json = await r.clone().json().catch(() => ({}))
                if (json.contactId) { setCcId(json.contactId); setCuId(json.contactId); setCgId(json.contactId) }
                return r
              }, setCcR)}>
              {ccR.status === 'running' ? '…' : 'Aanmaken in GHL'}
            </button>
            {ccId && <p className="text-[11px] text-green-600" style={{ fontFamily: MONO }}>ContactId bewaard: {ccId}</p>}
            <ResultPanel r={ccR} />
          </CardBody>
        </Card>

        <Card>
          <CardHead><Badge method="GET" /><span className="text-[11px] text-muted flex-1" style={{ fontFamily: MONO }}>/api/test/ghl-get?id=…</span><span className="text-[13px] font-bold text-primary">Contact ophalen</span></CardHead>
          <CardBody>
            <p className="text-xs text-muted">Haalt een contact op via GHL contact-get.</p>
            <TwoCol>
              <FullCol><FField label="Contact ID"><input className={inputCls} value={cgId} onChange={e => setCgId(e.target.value)} placeholder="GHL contact ID" /></FField></FullCol>
            </TwoCol>
            <button className={btnCls} disabled={cgR.status === 'running' || !cgId.trim()} onClick={() => run(() => fetch(`/api/test/ghl-get?id=${encodeURIComponent(cgId)}`), setCgR)}>{cgR.status === 'running' ? '…' : 'Ophalen uit GHL'}</button>
            <ResultPanel r={cgR} />
          </CardBody>
        </Card>

        <Card>
          <CardHead><Badge method="POST" /><span className="text-[11px] text-muted flex-1" style={{ fontFamily: MONO }}>/api/contact-update/[id]</span><span className="text-[13px] font-bold text-primary">Contact bijwerken</span></CardHead>
          <CardBody>
            <p className="text-xs text-muted">Werkt een bestaand GHL contact bij.</p>
            <TwoCol>
              <FullCol><FField label="Contact ID *"><input className={inputCls} value={cuId} onChange={e => setCuId(e.target.value)} placeholder="GHL contact ID" /></FField></FullCol>
              <FField label="Veld">
                <select className={inputCls} value={cuField} onChange={e => setCuField(e.target.value)}>
                  <option value="groothandel">Groothandel</option>
                  <option value="kortingsafspraken">Kortingsafspraken</option>
                  <option value="posMateriaal">POS Materiaal</option>
                  <option value="firstName">Voornaam</option>
                  <option value="city">Stad</option>
                </select>
              </FField>
              <FField label="Waarde"><input className={inputCls} value={cuValue} onChange={e => setCuValue(e.target.value)} /></FField>
            </TwoCol>
            <button className={btnCls} disabled={cuR.status === 'running' || !cuId.trim()}
              onClick={() => run(() => fetch(`/api/contact-update/${cuId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [cuField]: cuValue }) }), setCuR)}>
              {cuR.status === 'running' ? '…' : 'Bijwerken in GHL'}
            </button>
            <ResultPanel r={cuR} />
          </CardBody>
        </Card>

        {/* ── SUUS ── */}
        <div className="mt-2"><div className={secCls}>SUUS AI</div></div>

        <Card>
          <CardHead><Badge method="POST" /><span className="text-[11px] text-muted flex-1" style={{ fontFamily: MONO }}>/api/suus</span><span className="text-[13px] font-bold text-primary">SUUS chat smoke test</span></CardHead>
          <CardBody>
            <p className="text-xs text-muted">Stuurt een bericht naar de SUUS stream API.</p>
            <TwoCol>
              <FullCol><FField label="Bericht"><input className={inputCls} value={suusMsg} onChange={e => setSuusMsg(e.target.value)} /></FField></FullCol>
            </TwoCol>
            <button className={btnCls} disabled={suusR.status === 'running' || !suusMsg.trim()}
              onClick={() => run(async () => {
                const res = await fetch('/api/suus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: suusMsg, session_id: 'test-' + Date.now() }) })
                if (!res.ok || !res.body) return res
                const reader = res.body.getReader(); const dec = new TextDecoder(); let text = ''
                while (true) { const { done, value } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }) }
                return new Response(JSON.stringify({ response: text.replace(/\n__\w+__:.+/g, '').trim(), chars: text.length }), { status: 200, headers: { 'Content-Type': 'application/json' } })
              }, setSuusR)}>
              {suusR.status === 'running' ? '…' : 'Stuur naar SUUS'}
            </button>
            <ResultPanel r={suusR} />
          </CardBody>
        </Card>

      </div>
    </div>
    </AdminGate>
  )
}
