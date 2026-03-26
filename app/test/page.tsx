'use client'

import { useState } from 'react'

/* ─── types ─────────────────────────────────────────────── */
type Status = 'idle' | 'running' | 'ok' | 'error'
interface Result { status: Status; data?: unknown; error?: string; ms?: number }

/* ─── CSS ────────────────────────────────────────────────── */
const CSS = `
  .t-wrap { max-width:860px; margin:0 auto; padding:28px 20px 60px; }
  .t-h1   { font-size:18px; font-weight:700; color:var(--text); letter-spacing:-.02em; margin-bottom:4px; }
  .t-sub  { font-size:12px; color:var(--muted); margin-bottom:28px; }
  .t-grid { display:flex; flex-direction:column; gap:16px; }
  .t-card { background:var(--surface); border:1px solid var(--border); border-radius:12px; overflow:hidden; }
  .t-card-head { display:flex; align-items:center; justify-content:space-between;
    padding:12px 16px; border-bottom:1px solid var(--border); background:var(--bg); gap:12px; }
  .t-card-title { font-size:13px; font-weight:700; color:var(--text); }
  .t-card-method { font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px;
    font-family:'SF Mono','Fira Code',monospace; }
  .t-card-route { font-size:11px; color:var(--muted); font-family:'SF Mono','Fira Code',monospace; flex:1; }
  .t-card-body { padding:14px 16px; display:flex; flex-direction:column; gap:10px; }
  .t-fields { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .t-field { display:flex; flex-direction:column; gap:3px; }
  .t-label { font-size:10px; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  .t-input { padding:7px 10px; border-radius:7px; border:1px solid var(--border);
    background:var(--bg); font-size:12px; color:var(--text); outline:none;
    transition:border-color .15s; width:100%; box-sizing:border-box; }
  .t-input:focus { border-color:rgba(0,0,0,.3); }
  .t-btn  { padding:7px 16px; border-radius:7px; border:none; background:var(--text); color:#fff;
    font-size:12px; font-weight:600; cursor:pointer; display:flex; align-items:center;
    gap:5px; align-self:flex-start; transition:opacity .15s; }
  .t-btn:disabled { opacity:.4; cursor:default; }
  .t-btn-outline { background:transparent; color:var(--text); border:1px solid var(--border); }
  .t-result { border-radius:8px; overflow:hidden; }
  .t-result-bar { display:flex; align-items:center; gap:8px; padding:7px 12px; font-size:11px; font-weight:600; }
  .t-result-ok  { background:#f0fdf4; color:#16a34a; }
  .t-result-err { background:#fef2f2; color:#dc2626; }
  .t-result-run { background:var(--active); color:var(--muted); }
  .t-code { background:#0a0a0a; color:#d4d4d4; font-size:11px; font-family:'SF Mono','Fira Code',monospace;
    line-height:1.6; padding:12px; overflow-x:auto; max-height:280px; overflow-y:auto; white-space:pre; }
  .t-badge-get  { background:#dbeafe; color:#1d4ed8; }
  .t-badge-post { background:#dcfce7; color:#15803d; }
  .t-badge-put  { background:#fef9c3; color:#92400e; }
  .t-section    { font-size:11px; font-weight:800; color:var(--muted); text-transform:uppercase;
    letter-spacing:.07em; padding:4px 0 8px; border-bottom:1px solid var(--border); margin-bottom:12px; }
  @media (max-width:600px) {
    .t-fields { grid-template-columns:1fr; }
    .t-wrap   { padding:16px 12px 40px; }
  }
`

/* ─── helpers ────────────────────────────────────────────── */
function fmt(data: unknown) {
  try { return JSON.stringify(data, null, 2) }
  catch { return String(data) }
}

function Badge({ method }: { method: string }) {
  const cls = method === 'GET' ? 't-badge-get' : method === 'POST' ? 't-badge-post' : 't-badge-put'
  return <span className={`t-card-method ${cls}`}>{method}</span>
}

function ResultPanel({ r }: { r: Result }) {
  if (r.status === 'idle') return null
  const barCls = r.status === 'running' ? 't-result-run' : r.status === 'ok' ? 't-result-ok' : 't-result-err'
  const label  = r.status === 'running' ? 'Bezig…'
    : r.status === 'ok'  ? `✓ Geslaagd ${r.ms ? `(${r.ms}ms)` : ''}`
    : `✗ Fout ${r.ms ? `(${r.ms}ms)` : ''}`
  const body = r.error ?? fmt(r.data)
  return (
    <div className="t-result">
      <div className={`t-result-bar ${barCls}`}>{label}</div>
      <div className="t-code">{body}</div>
    </div>
  )
}

async function run(
  fn: () => Promise<Response>,
  set: (r: Result) => void,
) {
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

/* ═══════════════════════════════════════════════════════════ */
export default function TestPage() {
  /* ── GET /api/leads ─── */
  const [leads,     setLeads]     = useState<Result>({ status: 'idle' })

  /* ── GET /api/team-members ─── */
  const [members,   setMembers]   = useState<Result>({ status: 'idle' })

  /* ── GET /api/routing/config ─── */
  const [routing,   setRouting]   = useState<Result>({ status: 'idle' })

  /* ── GHL contact-zoek (via SUUS) ─── */
  const [searchQ,   setSearchQ]   = useState('Venster 33')
  const [searchR,   setSearchR]   = useState<Result>({ status: 'idle' })

  /* ── GHL contact-create ─── */
  const [ccCompany, setCcCompany] = useState('Test Bedrijf BV')
  const [ccFirst,   setCcFirst]   = useState('Test')
  const [ccCity,    setCcCity]    = useState('Amsterdam')
  const [ccPhone,   setCcPhone]   = useState('')
  const [ccR,       setCcR]       = useState<Result>({ status: 'idle' })
  const [ccId,      setCcId]      = useState('')   // saved after create

  /* ── GHL contact-update ─── */
  const [cuId,      setCuId]      = useState('')
  const [cuField,   setCuField]   = useState('groothandel')
  const [cuValue,   setCuValue]   = useState('Bidfood')
  const [cuR,       setCuR]       = useState<Result>({ status: 'idle' })

  /* ── GHL contact-get (by ID) ─── */
  const [cgId,      setCgId]      = useState('')
  const [cgR,       setCgR]       = useState<Result>({ status: 'idle' })

  /* ── POST /api/formulier ─── */
  const [fCompany,  setFCompany]  = useState('Café Test')
  const [fFirst,    setFFirst]    = useState('Jan')
  const [fCity,     setFCity]     = useState('Rotterdam')
  const [fR,        setFR]        = useState<Result>({ status: 'idle' })

  /* ── SUUS chat smoke test ─── */
  const [suusMsg,   setSuusMsg]   = useState('Hoeveel leads hebben we?')
  const [suusR,     setSuusR]     = useState<Result>({ status: 'idle' })

  return (
    <div className="t-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h1 className="t-h1">API Endpoint Tests</h1>
      <p className="t-sub">Test alle endpoints — verifieert rendering, GHL-data en terugschrijven</p>

      <div className="t-grid">

        {/* ── SUPABASE ───────────────────────────────────────── */}
        <div><div className="t-section">Supabase</div></div>

        {/* Leads */}
        <div className="t-card">
          <div className="t-card-head">
            <Badge method="GET" />
            <span className="t-card-route">/api/leads</span>
            <span className="t-card-title">Leads ophalen</span>
          </div>
          <div className="t-card-body">
            <p style={{ fontSize: '12px', color: 'var(--muted)' }}>
              Haalt alle contacten op uit Supabase. Verifieert DB-verbinding en ORGANIZATION_ID.
            </p>
            <button className="t-btn" disabled={leads.status === 'running'}
              onClick={() => run(() => fetch('/api/leads'), setLeads)}>
              {leads.status === 'running' ? '…' : 'Test'}
            </button>
            <ResultPanel r={leads} />
          </div>
        </div>

        {/* Team members */}
        <div className="t-card">
          <div className="t-card-head">
            <Badge method="GET" />
            <span className="t-card-route">/api/team-members</span>
            <span className="t-card-title">Teamleden</span>
          </div>
          <div className="t-card-body">
            <p style={{ fontSize: '12px', color: 'var(--muted)' }}>
              Haalt actieve teamleden op inclusief GHL user ID en calendar ID.
            </p>
            <button className="t-btn" disabled={members.status === 'running'}
              onClick={() => run(() => fetch('/api/team-members'), setMembers)}>
              {members.status === 'running' ? '…' : 'Test'}
            </button>
            <ResultPanel r={members} />
          </div>
        </div>

        {/* Routing config */}
        <div className="t-card">
          <div className="t-card-head">
            <Badge method="GET" />
            <span className="t-card-route">/api/routing/config</span>
            <span className="t-card-title">Routing configuratie</span>
          </div>
          <div className="t-card-body">
            <p style={{ fontSize: '12px', color: 'var(--muted)' }}>
              Haalt routing-regels en configuratie op uit Supabase.
            </p>
            <button className="t-btn" disabled={routing.status === 'running'}
              onClick={() => run(() => fetch('/api/routing/config'), setRouting)}>
              {routing.status === 'running' ? '…' : 'Test'}
            </button>
            <ResultPanel r={routing} />
          </div>
        </div>

        {/* Formulier */}
        <div className="t-card">
          <div className="t-card-head">
            <Badge method="POST" />
            <span className="t-card-route">/api/formulier</span>
            <span className="t-card-title">Formulier → Supabase contact</span>
          </div>
          <div className="t-card-body">
            <p style={{ fontSize: '12px', color: 'var(--muted)' }}>
              Maakt een nieuw contact aan in Supabase (beurs-formulier flow). Triggert ook routing + enrich.
            </p>
            <div className="t-fields">
              <div className="t-field"><label className="t-label">Bedrijfsnaam</label>
                <input className="t-input" value={fCompany} onChange={e => setFCompany(e.target.value)} /></div>
              <div className="t-field"><label className="t-label">Voornaam</label>
                <input className="t-input" value={fFirst} onChange={e => setFFirst(e.target.value)} /></div>
              <div className="t-field"><label className="t-label">Stad</label>
                <input className="t-input" value={fCity} onChange={e => setFCity(e.target.value)} /></div>
            </div>
            <button className="t-btn" disabled={fR.status === 'running' || !fCompany.trim()}
              onClick={() => run(() => fetch('/api/formulier', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ company: fCompany, first_name: fFirst, city: fCity, status: 'lead', channel: 'OFFLINE' }),
              }), setFR)}>
              {fR.status === 'running' ? '…' : 'Aanmaken in Supabase'}
            </button>
            <ResultPanel r={fR} />
          </div>
        </div>

        {/* ── GHL ─────────────────────────────────────────────── */}
        <div><div className="t-section" style={{ marginTop: '8px' }}>GoHighLevel (GHL)</div></div>

        {/* Contact zoeken */}
        <div className="t-card">
          <div className="t-card-head">
            <Badge method="GET" />
            <span className="t-card-route">/contacts/?query=…</span>
            <span className="t-card-title">Contact zoeken in GHL</span>
          </div>
          <div className="t-card-body">
            <p style={{ fontSize: '12px', color: 'var(--muted)' }}>
              Zoekt een contact in GHL via de GHL API. Verifieert GHL_API_KEY en GHL_LOCATION_ID.
            </p>
            <div className="t-fields">
              <div className="t-field"><label className="t-label">Zoekopdracht</label>
                <input className="t-input" value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="bijv. Café de Boom" /></div>
            </div>
            <button className="t-btn" disabled={searchR.status === 'running' || !searchQ.trim()}
              onClick={() => run(() => fetch(`/api/test/ghl-search?q=${encodeURIComponent(searchQ)}`), setSearchR)}>
              {searchR.status === 'running' ? '…' : 'Zoeken in GHL'}
            </button>
            <ResultPanel r={searchR} />
          </div>
        </div>

        {/* Contact aanmaken in GHL */}
        <div className="t-card">
          <div className="t-card-head">
            <Badge method="POST" />
            <span className="t-card-route">/api/contact-create</span>
            <span className="t-card-title">Contact aanmaken in GHL</span>
          </div>
          <div className="t-card-body">
            <p style={{ fontSize: '12px', color: 'var(--muted)' }}>
              Maakt een nieuw GHL contact aan en retourneert het contactId. Het contactId wordt hieronder bewaard voor de update-test.
            </p>
            <div className="t-fields">
              <div className="t-field"><label className="t-label">Bedrijfsnaam *</label>
                <input className="t-input" value={ccCompany} onChange={e => setCcCompany(e.target.value)} /></div>
              <div className="t-field"><label className="t-label">Voornaam *</label>
                <input className="t-input" value={ccFirst} onChange={e => setCcFirst(e.target.value)} /></div>
              <div className="t-field"><label className="t-label">Stad</label>
                <input className="t-input" value={ccCity} onChange={e => setCcCity(e.target.value)} /></div>
              <div className="t-field"><label className="t-label">Telefoon</label>
                <input className="t-input" value={ccPhone} onChange={e => setCcPhone(e.target.value)} placeholder="+31..." /></div>
            </div>
            <button className="t-btn" disabled={ccR.status === 'running' || !ccCompany.trim() || !ccFirst.trim()}
              onClick={() => run(async () => {
                const r = await fetch('/api/contact-create', {
                  method:  'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body:    JSON.stringify({ companyName: ccCompany, firstName: ccFirst, city: ccCity, phone: ccPhone || undefined }),
                })
                const json = await r.clone().json().catch(() => ({}))
                if (json.contactId) { setCcId(json.contactId); setCuId(json.contactId); setCgId(json.contactId) }
                return r
              }, setCcR)}>
              {ccR.status === 'running' ? '…' : 'Aanmaken in GHL'}
            </button>
            {ccId && (
              <p style={{ fontSize: '11px', color: '#16a34a', fontFamily: "'SF Mono','Fira Code',monospace" }}>
                ContactId bewaard: {ccId}
              </p>
            )}
            <ResultPanel r={ccR} />
          </div>
        </div>

        {/* Contact ophalen */}
        <div className="t-card">
          <div className="t-card-head">
            <Badge method="GET" />
            <span className="t-card-route">/api/test/ghl-get?id=…</span>
            <span className="t-card-title">Contact ophalen uit GHL</span>
          </div>
          <div className="t-card-body">
            <p style={{ fontSize: '12px', color: 'var(--muted)' }}>
              Haalt een contact op via GHL contact-get. Verifieert dat alle velden (incl. custom fields) correct worden geladen.
            </p>
            <div className="t-fields">
              <div className="t-field" style={{ gridColumn: '1 / -1' }}><label className="t-label">Contact ID</label>
                <input className="t-input" value={cgId} onChange={e => setCgId(e.target.value)} placeholder="GHL contact ID" /></div>
            </div>
            <button className="t-btn" disabled={cgR.status === 'running' || !cgId.trim()}
              onClick={() => run(() => fetch(`/api/test/ghl-get?id=${encodeURIComponent(cgId)}`), setCgR)}>
              {cgR.status === 'running' ? '…' : 'Ophalen uit GHL'}
            </button>
            <ResultPanel r={cgR} />
          </div>
        </div>

        {/* Contact bijwerken */}
        <div className="t-card">
          <div className="t-card-head">
            <Badge method="POST" />
            <span className="t-card-route">/api/contact-update/[id]</span>
            <span className="t-card-title">Contact bijwerken in GHL</span>
          </div>
          <div className="t-card-body">
            <p style={{ fontSize: '12px', color: 'var(--muted)' }}>
              Werkt een bestaand GHL contact bij. Gebruik het contactId uit de aanmaak-test hierboven, of vul een eigen ID in.
            </p>
            <div className="t-fields">
              <div className="t-field" style={{ gridColumn: '1 / -1' }}><label className="t-label">Contact ID *</label>
                <input className="t-input" value={cuId} onChange={e => setCuId(e.target.value)} placeholder="GHL contact ID" /></div>
              <div className="t-field"><label className="t-label">Veld</label>
                <select className="t-input" value={cuField} onChange={e => setCuField(e.target.value)} style={{ cursor: 'pointer' }}>
                  <option value="groothandel">Groothandel</option>
                  <option value="kortingsafspraken">Kortingsafspraken</option>
                  <option value="posMateriaal">POS Materiaal</option>
                  <option value="firstName">Voornaam</option>
                  <option value="city">Stad</option>
                </select>
              </div>
              <div className="t-field"><label className="t-label">Waarde</label>
                <input className="t-input" value={cuValue} onChange={e => setCuValue(e.target.value)} /></div>
            </div>
            <button className="t-btn" disabled={cuR.status === 'running' || !cuId.trim()}
              onClick={() => run(() => fetch(`/api/contact-update/${cuId}`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ [cuField]: cuValue }),
              }), setCuR)}>
              {cuR.status === 'running' ? '…' : 'Bijwerken in GHL'}
            </button>
            <ResultPanel r={cuR} />
          </div>
        </div>

        {/* ── SUUS ─────────────────────────────────────────────── */}
        <div><div className="t-section" style={{ marginTop: '8px' }}>SUUS AI</div></div>

        {/* SUUS smoke test */}
        <div className="t-card">
          <div className="t-card-head">
            <Badge method="POST" />
            <span className="t-card-route">/api/suus</span>
            <span className="t-card-title">SUUS chat smoke test</span>
          </div>
          <div className="t-card-body">
            <p style={{ fontSize: '12px', color: 'var(--muted)' }}>
              Stuurt een bericht naar de SUUS stream API. Verifieert dat de AI reageert (stream buffert tot einde).
            </p>
            <div className="t-fields">
              <div className="t-field" style={{ gridColumn: '1 / -1' }}><label className="t-label">Bericht</label>
                <input className="t-input" value={suusMsg} onChange={e => setSuusMsg(e.target.value)} /></div>
            </div>
            <button className="t-btn" disabled={suusR.status === 'running' || !suusMsg.trim()}
              onClick={() => run(async () => {
                const res = await fetch('/api/suus', {
                  method:  'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body:    JSON.stringify({ message: suusMsg, session_id: 'test-' + Date.now() }),
                })
                if (!res.ok || !res.body) return res
                // Buffer stream
                const reader = res.body.getReader()
                const dec    = new TextDecoder()
                let text     = ''
                while (true) {
                  const { done, value } = await reader.read()
                  if (done) break
                  text += dec.decode(value, { stream: true })
                }
                return new Response(JSON.stringify({ response: text.replace(/\n__\w+__:.+/g, '').trim(), chars: text.length }), {
                  status: 200, headers: { 'Content-Type': 'application/json' },
                })
              }, setSuusR)}>
              {suusR.status === 'running' ? '…' : 'Stuur naar SUUS'}
            </button>
            <ResultPanel r={suusR} />
          </div>
        </div>

      </div>
    </div>
  )
}
