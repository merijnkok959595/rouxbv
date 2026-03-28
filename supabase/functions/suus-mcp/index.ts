/**
 * suus-mcp  –  MCP server with all SUUS tools for Retell AI Conversation Flow.
 *
 * Implements MCP JSON-RPC 2.0 over HTTP (streamable transport).
 * Retell registers this as an MCP server and auto-discovers all tools.
 *
 * Tools exposed:
 *   contact_zoek        – nano parse → Google Places → GHL 4× parallel
 *   google_zoek_adres   – Google Places address lookup
 *   contact_briefing    – full contact briefing
 *   contact_create      – create new GHL contact
 *   contact_update      – update GHL contact fields
 *   note_create         – add note to contact
 *   task_create         – create task for contact
 *   calendar_get_free_slot – first free agenda slot
 *   calendar_create     – create appointment
 *   get_team_members    – list active team members
 *   get_caller_info     – resolve caller by phone number
 *
 * Deploy: supabase functions deploy suus-mcp --no-verify-jwt
 */

import OpenAI from 'https://deno.land/x/openai@v4.52.0/mod.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const openai  = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY')! })
const GHL_KEY = () => Deno.env.get('GHL_API_KEY') ?? ''
const GHL_LOC = () => Deno.env.get('GHL_LOCATION_ID') ?? ''
const ORG_ID  = () => Deno.env.get('DEFAULT_ORGANIZATION_ID') ?? ''
const G_KEY   = () => Deno.env.get('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY') ?? ''

function adminSb() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}
function withTimeout<T>(p: Promise<T>, ms: number, label = ''): Promise<T> {
  return Promise.race([p, new Promise<never>((_, r) => setTimeout(() => r(new Error(`Timeout ${ms}ms ${label}`)), ms))])
}

// ── GHL helper ────────────────────────────────────────────────────────────────
async function ghl(path: string, opts: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`https://services.leadconnectorhq.com${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${GHL_KEY()}`, Version: '2021-07-28', 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`GHL ${res.status}: ${await res.text().catch(() => res.statusText)}`)
  return res.json()
}

// ── Dutch number normaliser ───────────────────────────────────────────────────
const NL: [RegExp, string][] = [
  [/\bnul\b/gi,'0'],[/\één\b|\béén\b|\been\b/gi,'1'],[/\btwee\b/gi,'2'],[/\bdrie\b/gi,'3'],[/\bvier\b/gi,'4'],
  [/\bvijf\b/gi,'5'],[/\bzes\b/gi,'6'],[/\bzeven\b/gi,'7'],[/\bacht\b/gi,'8'],[/\bnegen\b/gi,'9'],
  [/\btien\b/gi,'10'],[/\belf\b/gi,'11'],[/\btwaalf\b/gi,'12'],[/\bdertien\b/gi,'13'],[/\bveertien\b/gi,'14'],
  [/\bvijftien\b/gi,'15'],[/\bzestien\b/gi,'16'],[/\bzeventien\b/gi,'17'],[/\bachttien\b/gi,'18'],[/\bnegentien\b/gi,'19'],
  [/\btwintig\b/gi,'20'],[/\bdertig\b/gi,'30'],[/\bveertig\b/gi,'40'],[/\bvijftig\b/gi,'50'],
  [/\bzestig\b/gi,'60'],[/\bzeventig\b/gi,'70'],[/\btachtig\b/gi,'80'],[/\bnegentig\b/gi,'90'],[/\bhonderd\b/gi,'100'],
  [/\beenendertig\b/gi,'31'],[/\btweeëndertig\b/gi,'32'],[/\bdrieëndertig\b/gi,'33'],[/\bvierendertig\b/gi,'34'],
  [/\bvijfendertig\b/gi,'35'],[/\bzesendertig\b/gi,'36'],[/\bzevenendertig\b/gi,'37'],[/\bachtendertig\b/gi,'38'],
  [/\bnegendertig\b/gi,'39'],
]
function normalise(q: string): string {
  let s = q
  for (const [re, d] of NL) s = s.replace(re, d)
  s = s.replace(/\b(\d+)\s+(\d+)\b/g, '$1$2')
  s = s.replace(/\s+(van\s+de[rnm]?|van\s+het|van\s+'t|van|de[rnm]?|het|'t)\s+/gi, ' ')
  return s.trim()
}

// ══════════════════════════════════════════════════════════════════════════════
// TOOL IMPLEMENTATIONS
// ══════════════════════════════════════════════════════════════════════════════

async function tool_contact_zoek(args: Record<string, unknown>): Promise<string> {
  // Accept bedrijfsnaam/plaatsnaam (new) or query/city (legacy)
  const rawBedrijf = normalise(String(args.bedrijfsnaam ?? args.query ?? '').trim())
  const rawStad    = String(args.plaatsnaam ?? args.city ?? '').trim()

  if (!rawBedrijf) return JSON.stringify({ found: false, reden: 'Geen bedrijfsnaam opgegeven.' })

  // ── Step 1: LLM parse — normalise name + extract city ──────────────────────
  let bedrijf = rawBedrijf
  let stad    = rawStad
  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4.1-nano', temperature: 0, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Normaliseer een Nederlandse bedrijfsnaam voor CRM-zoeken. Zet gesproken getallen om naar cijfers (drieëndertig→33, twaalf→12). Strip beleefd taalgebruik en STT-artefacten. Antwoord: {"bedrijf":"gecorrigeerde naam","stad":"plaatsnaam of null"}' },
        { role: 'user',   content: `Bedrijfsnaam: "${rawBedrijf}"${rawStad ? `\nPlaatsnaam: "${rawStad}"` : ''}` },
      ],
    })
    const p = JSON.parse(r.choices[0].message.content ?? '{}')
    bedrijf = p.bedrijf?.trim()  || rawBedrijf
    stad    = p.stad?.trim()     || rawStad
  } catch { /* fallback to raw input */ }

  // ── Step 2: Google Places — STT correction + reference address ─────────────
  let googleNaam  = bedrijf
  let googleAdres = ''
  let googleStad  = stad
  try {
    const q = stad ? `${bedrijf} ${stad}` : bedrijf
    const gRes = await withTimeout(
      fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': G_KEY(), 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.addressComponents' },
        body: JSON.stringify({ textQuery: q, languageCode: 'nl', regionCode: 'NL', maxResultCount: 3 }),
      }).then(r => r.json()) as Promise<{ places?: Array<Record<string, unknown>> }>,
      4500, 'google',
    )
    const places = (gRes.places ?? []).slice(0, 3)
    if (places.length) {
      type AC = { longText?: string; types?: string[] }
      const candidates = places.map((p, i) => {
        const n = (p.displayName as { text?: string } | undefined)?.text ?? ''
        return `${i}: ${n} — ${p.formattedAddress ?? ''}`
      }).join('\n')
      const m = await openai.chat.completions.create({
        model: 'gpt-4.1-nano', temperature: 0, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'STT-correctie: kies de beste Google-match voor het gezochte bedrijf. JSON: {"match":true,"index":0,"name":"officiële naam"} of {"match":false}.' },
          { role: 'user',   content: `Gezocht: "${bedrijf}"${stad ? ` in ${stad}` : ''}\nGoogle:\n${candidates}` },
        ],
      })
      const v = JSON.parse(m.choices[0].message.content ?? '{}')
      if (v.match) {
        const idx = Number(v.index ?? 0)
        const p   = places[idx] ?? places[0]
        const comps = (p.addressComponents ?? []) as AC[]
        const get   = (t: string) => comps.find(c => c.types?.includes(t))?.longText ?? ''
        googleNaam  = String(v.name ?? (p.displayName as { text?: string } | undefined)?.text ?? bedrijf).trim()
        googleAdres = `${get('route')} ${get('street_number')}`.trim() || String(p.formattedAddress ?? '').split(',')[0]
        googleStad  = get('locality') || get('administrative_area_level_2') || stad
      }
    }
  } catch { /* continue with parsed name */ }

  // ── Step 3: GHL 4× parallel fuzzy search ───────────────────────────────────
  const ghlQ = async (q: string): Promise<Array<Record<string, unknown>>> => {
    try { return ((await withTimeout(ghl(`/contacts/?locationId=${GHL_LOC()}&query=${encodeURIComponent(q)}&limit=10`), 4000)).contacts ?? []) as Array<Record<string, unknown>> }
    catch { return [] }
  }
  const ghlA = async (q: string): Promise<Array<Record<string, unknown>>> => {
    try { return ((await withTimeout(ghl('/contacts/search/duplicate', { method: 'POST', body: JSON.stringify({ locationId: GHL_LOC(), name: q }) }), 4000)).contacts ?? []) as Array<Record<string, unknown>> }
    catch { return [] }
  }
  const [r1, r2, r3, r4] = await withTimeout(
    Promise.all([
      ghlQ(googleNaam),
      googleNaam !== bedrijf ? ghlQ(bedrijf) : Promise.resolve([]),
      ghlA(googleNaam),
      googleNaam !== bedrijf ? ghlA(bedrijf) : Promise.resolve([]),
    ]),
    7000, 'ghl-parallel',
  )

  // Dedup
  const seen = new Set<string>()
  const all: Array<Record<string, unknown>> = []
  for (const list of [r1, r2, r3, r4]) {
    for (const c of list) {
      const id = String(c.id ?? '')
      if (id && !seen.has(id)) { seen.add(id); all.push(c) }
    }
  }

  // Lenient city pre-filter (keeps more candidates for LLM)
  let candidates = all
  if (googleStad && candidates.length > 1) {
    const sl = googleStad.toLowerCase()
    const filtered = candidates.filter(c => { const cl = String(c.city ?? '').toLowerCase(); return cl.includes(sl) || sl.includes(cl.slice(0, 4)) })
    if (filtered.length > 0) candidates = filtered
  }

  if (candidates.length === 0) {
    return JSON.stringify({ found: false, bedrijf_gezocht: googleNaam, stad_gezocht: googleStad || null })
  }

  // ── Step 4: LLM final pick — select the single best match ──────────────────
  let best = candidates[0]
  if (candidates.length > 1) {
    try {
      const rows = candidates.slice(0, 8).map((c, i) => {
        const cn = [c.firstName, c.lastName].filter(Boolean).join(' ')
        return `${i}: ${c.companyName ?? cn} | stad: ${c.city ?? '—'} | adres: ${c.address1 ?? '—'}`
      }).join('\n')
      const pick = await openai.chat.completions.create({
        model: 'gpt-4.1-nano', temperature: 0, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Je bent CRM-assistent. Kies het BESTE overeenkomende contact. Let op bedrijfsnaam (fuzzy), stad en adres. Als geen enkel contact overeenkomt: {"match":false}. Anders: {"match":true,"index":0}' },
          { role: 'user',   content: `Gezocht: "${googleNaam}"${googleStad ? ` in ${googleStad}` : ''}${googleAdres ? `\nGoogle adres: ${googleAdres}` : ''}\n\nKandidaten:\n${rows}` },
        ],
      })
      const pv = JSON.parse(pick.choices[0].message.content ?? '{}')
      if (!pv.match) return JSON.stringify({ found: false, bedrijf_gezocht: googleNaam, stad_gezocht: googleStad || null })
      best = candidates[Number(pv.index ?? 0)] ?? candidates[0]
    } catch { /* fallback to first */ }
  }

  const cn    = [best.firstName, best.lastName].filter(Boolean).join(' ')
  const adres = [best.address1, best.postalCode, best.city].filter(Boolean).join(', ') || googleAdres || null

  return JSON.stringify({
    found: true,
    contact: {
      contact_id: String(best.id ?? ''),
      bedrijf:    String(best.companyName ?? cn ?? googleNaam),
      naam:       cn || null,
      adres,
      stad:       String(best.city ?? googleStad ?? ''),
      telefoon:   best.phone   ?? null,
      email:      best.email   ?? null,
    },
    bron: googleNaam !== rawBedrijf ? `CRM (gecorrigeerd: "${rawBedrijf}" → "${googleNaam}")` : 'CRM',
  })
}

async function tool_google_zoek_adres(args: Record<string, unknown>): Promise<string> {
  const naam   = String(args.bedrijfsnaam ?? '').trim()
  const plaats = String(args.plaatsnaam   ?? '').trim()
  const q      = plaats ? `${naam} ${plaats}` : naam
  const gRes = await withTimeout(
    fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': G_KEY(), 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.addressComponents,places.internationalPhoneNumber,places.websiteUri' },
      body: JSON.stringify({ textQuery: q, languageCode: 'nl', regionCode: 'NL', maxResultCount: 5 }),
    }).then(r => r.json()) as Promise<{ places?: Array<Record<string, unknown>> }>,
    8000, 'google-adres',
  )
  const places = (gRes.places ?? []).slice(0, 5)
  if (!places.length) return `[BRON: niet gevonden] Geen adres voor "${q}". Maak contact aan zonder adres.`
  const list = places.map((p, i) => `${i}: ${(p.displayName as { text?: string } | undefined)?.text ?? ''} — ${p.formattedAddress ?? ''}`).join('\n')
  const m = await openai.chat.completions.create({
    model: 'gpt-4.1-nano', temperature: 0, response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: 'Kies beste Google Places resultaat. JSON: {"match":true,"index":n} of {"match":false}.' }, { role: 'user', content: `Zoekopdracht: "${q}"\n${list}` }],
  })
  let v: Record<string, unknown> = { match: false }
  try { v = JSON.parse(m.choices[0].message.content ?? '{}') } catch { /* ignore */ }
  if (!v.match) return `[BRON: niet gevonden] Geen betrouwbaar adres voor "${q}". Maak contact aan zonder adres.`
  const p = places[Number(v.index ?? 0)] ?? places[0]
  type AC = { longText?: string; types?: string[] }
  const comps = (p.addressComponents ?? []) as AC[]
  const get   = (t: string) => comps.find(c => c.types?.includes(t))?.longText ?? ''
  const placeName = (p.displayName as { text?: string } | undefined)?.text ?? naam
  const street = `${get('route')} ${get('street_number')}`.trim()
  const city2  = get('locality') || get('administrative_area_level_2') || plaats
  const postal = get('postal_code')
  const tel    = String(p.internationalPhoneNumber ?? '')
  const site   = String(p.websiteUri ?? '')
  const tag    = `[google: naam=${placeName}|adres=${street}|stad=${city2}|postcode=${postal}${tel ? `|tel=${tel}` : ''}${site ? `|website=${site}` : ''}]`
  return `[BRON: Google] ${placeName} — ${street}, ${postal} ${city2}${tel ? ` | ${tel}` : ''}${site ? ` | ${site}` : ''}\nTag: ${tag}`
}

async function tool_contact_briefing(args: Record<string, unknown>): Promise<string> {
  const id = String(args.contactId ?? '')
  const [contact, notes, tasks] = await Promise.all([ghl(`/contacts/${id}`), ghl(`/contacts/${id}/notes`), ghl(`/contacts/${id}/tasks`)])
  const c = (contact.contact ?? contact) as Record<string, unknown>
  const parts = [`Naam: ${[c.firstName, c.lastName].filter(Boolean).join(' ') || c.companyName}`, `Bedrijf: ${c.companyName ?? '—'}`, `Type: ${c.type ?? '—'}`, `Tel: ${c.phone ?? '—'}`, `Email: ${c.email ?? '—'}`, `Adres: ${[c.address1, c.postalCode, c.city].filter(Boolean).join(', ') || '—'}`]
  const noteList = ((notes.notes ?? []) as Array<Record<string, unknown>>).slice(0, 3).map(n => `- ${String(n.body ?? '').substring(0, 80)}`)
  if (noteList.length) parts.push(`Notities:\n${noteList.join('\n')}`)
  const taskList = ((tasks.tasks ?? []) as Array<Record<string, unknown>>).filter(t => !t.completed).slice(0, 3).map(t => `- ${t.title}`)
  if (taskList.length) parts.push(`Taken:\n${taskList.join('\n')}`)
  return parts.join('\n')
}

async function tool_contact_create(args: Record<string, unknown>): Promise<string> {
  const locId = GHL_LOC()
  if (!locId) return 'Configuratiefout: GHL locatie niet ingesteld.'
  const body: Record<string, unknown> = { locationId: locId, companyName: args.companyName }
  for (const f of ['firstName','lastName','phone','email','address1','city','postalCode','type','source']) { if (args[f]) body[f] = args[f] }
  try {
    const res = await withTimeout(ghl('/contacts/', { method: 'POST', body: JSON.stringify(body) }), 8000)
    const c = (res.contact ?? res) as Record<string, unknown>
    if (!c.id) return 'Er is iets misgegaan bij aanmaken.'
    return `Contact aangemaakt: ${c.companyName ?? c.firstName} (ID: ${c.id})`
  } catch (err) { return `Fout: ${err instanceof Error ? err.message : String(err)}` }
}

async function tool_contact_update(args: Record<string, unknown>): Promise<string> {
  const { contactId, ...fields } = args
  const res = await ghl(`/contacts/${contactId}`, { method: 'PUT', body: JSON.stringify(fields) })
  const c = (res.contact ?? res) as Record<string, unknown>
  return `Contact bijgewerkt: ${c.companyName ?? c.firstName ?? contactId}`
}

async function tool_note_create(args: Record<string, unknown>): Promise<string> {
  await ghl(`/contacts/${args.contactId}/notes`, { method: 'POST', body: JSON.stringify({ body: args.body, userId: args.userId }) })
  return 'Notitie aangemaakt.'
}

async function tool_task_create(args: Record<string, unknown>): Promise<string> {
  await ghl(`/contacts/${args.contactId}/tasks`, { method: 'POST', body: JSON.stringify({ title: args.title, dueDate: args.dueDate ?? new Date(Date.now() + 86400000).toISOString(), assignedTo: args.assignedTo, status: 'incompleted' }) })
  return 'Taak aangemaakt.'
}

async function tool_calendar_get_free_slot(args: Record<string, unknown>): Promise<string> {
  const res = await ghl(`/calendars/${args.calendarId}/free-slots?startDate=${args.startDate}&endDate=${args.endDate}&timezone=Europe/Amsterdam`)
  const slots = (res.slots ?? res.freeSlots ?? []) as Array<Record<string, unknown>>
  if (!slots.length) return 'Geen vrije slots gevonden.'
  const first = slots[0]
  return `Eerste vrije slot: ${first.startTime ?? first.start} — ${first.endTime ?? first.end}`
}

async function tool_calendar_create(args: Record<string, unknown>): Promise<string> {
  await ghl('/calendars/events/appointments', { method: 'POST', body: JSON.stringify({ calendarId: args.calendarId, contactId: args.contactId, title: args.title, startTime: args.startTime, endTime: args.endTime, locationId: GHL_LOC() }) })
  return 'Afspraak aangemaakt.'
}

async function tool_get_team_members(): Promise<string> {
  const { data } = await adminSb().from('team_members').select('naam,functie,ghl_user_id,calendar_id').eq('organization_id', ORG_ID()).eq('active', true)
  if (!data?.length) return 'Geen teamleden gevonden.'
  return data.map(m => `${m.naam} (${m.functie}) — GHL: ${m.ghl_user_id}${m.calendar_id ? ` | Cal: ${m.calendar_id}` : ''}`).join('\n')
}

async function tool_get_caller_info(args: Record<string, unknown>): Promise<string> {
  const from = String(args.from_number ?? '').replace(/\D/g, '')
  if (!from) return 'Geen telefoonnummer opgegeven.'
  const { data } = await adminSb().from('team_members').select('naam,functie,ghl_user_id,calendar_id,phone').eq('organization_id', ORG_ID()).eq('active', true).not('ghl_user_id', 'is', null)
  if (!data?.length) return 'Geen medewerkers gevonden.'
  const emp = data.find(m => { const mp = (m.phone ?? '').replace(/\D/g, ''); return mp && (mp === from || mp.slice(-9) === from.slice(-9)) })
  if (!emp) return 'Niet-geautoriseerd nummer.'
  const voornaam = emp.naam.split(' ')[0]
  return JSON.stringify({ naam: emp.naam, voornaam, functie: emp.functie, ghl_user_id: emp.ghl_user_id, calendar_id: emp.calendar_id ?? null, instructie: `Begroet: "Hoi ${voornaam}!"` })
}

// ══════════════════════════════════════════════════════════════════════════════
// MCP TOOL DEFINITIONS
// ══════════════════════════════════════════════════════════════════════════════
const MCP_TOOLS = [
  { name: 'contact_zoek', description: 'Zoek een klant/bedrijf in het CRM. Roept Google Places aan voor STT-correctie en kiest automatisch het beste match. Geeft 1 contact terug (found:true) of niet gevonden (found:false). ALTIJD aanroepen zodra een bedrijfsnaam wordt genoemd.', inputSchema: { type: 'object', properties: { bedrijfsnaam: { type: 'string', description: 'Naam van het bedrijf — gesproken getallen omzetten naar cijfers (drieëndertig → 33)' }, plaatsnaam: { type: 'string', description: 'Stad of plaatsnaam (optioneel maar sterk aanbevolen)' } }, required: ['bedrijfsnaam'] } },
  { name: 'google_zoek_adres', description: 'Zoek het adres van een bedrijf via Google Places. Gebruik voor nieuwe contacten.', inputSchema: { type: 'object', properties: { bedrijfsnaam: { type: 'string' }, plaatsnaam: { type: 'string' } }, required: ['bedrijfsnaam'] } },
  { name: 'contact_briefing', description: 'Volledige briefing van een contact: gegevens, recente notities en open taken.', inputSchema: { type: 'object', properties: { contactId: { type: 'string', description: 'GHL contact ID' } }, required: ['contactId'] } },
  { name: 'contact_create', description: 'Maak een nieuw contact aan. Alleen companyName is verplicht. Vraag nooit om telefoon of email.', inputSchema: { type: 'object', properties: { companyName: { type: 'string' }, firstName: { type: 'string' }, city: { type: 'string' }, address1: { type: 'string' }, postalCode: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, type: { type: 'string', enum: ['lead', 'customer'] } }, required: ['companyName'] } },
  { name: 'contact_update', description: 'Velden van een bestaand contact bijwerken.', inputSchema: { type: 'object', properties: { contactId: { type: 'string' }, companyName: { type: 'string' }, firstName: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, address1: { type: 'string' }, city: { type: 'string' }, type: { type: 'string', enum: ['lead', 'customer'] } }, required: ['contactId'] } },
  { name: 'note_create', description: 'Notitie toevoegen aan een contact.', inputSchema: { type: 'object', properties: { contactId: { type: 'string' }, body: { type: 'string', description: 'Inhoud van de notitie' }, userId: { type: 'string' } }, required: ['contactId', 'body'] } },
  { name: 'task_create', description: 'Taak of herinnering aanmaken voor een contact.', inputSchema: { type: 'object', properties: { contactId: { type: 'string' }, title: { type: 'string' }, dueDate: { type: 'string', description: 'ISO datum bijv. 2025-04-18T10:00:00Z' }, assignedTo: { type: 'string' } }, required: ['contactId', 'title'] } },
  { name: 'calendar_get_free_slot', description: 'Eerste vrije agendaslot ophalen.', inputSchema: { type: 'object', properties: { calendarId: { type: 'string' }, startDate: { type: 'string', description: 'YYYY-MM-DD' }, endDate: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['calendarId', 'startDate', 'endDate'] } },
  { name: 'calendar_create', description: 'Afspraak aanmaken in de agenda.', inputSchema: { type: 'object', properties: { calendarId: { type: 'string' }, contactId: { type: 'string' }, title: { type: 'string' }, startTime: { type: 'string', description: 'ISO datetime' }, endTime: { type: 'string', description: 'ISO datetime' } }, required: ['calendarId', 'contactId', 'title', 'startTime', 'endTime'] } },
  { name: 'get_team_members', description: 'Actieve teamleden ophalen (naam, functie, GHL ID, calendar ID).', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_caller_info', description: 'Medewerker opzoeken op basis van telefoonnummer.', inputSchema: { type: 'object', properties: { from_number: { type: 'string', description: 'Telefoonnummer van de beller' } }, required: ['from_number'] } },
]

// ══════════════════════════════════════════════════════════════════════════════
// DISPATCHER
// ══════════════════════════════════════════════════════════════════════════════
async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  console.log(`[suus-mcp] tool=${name}`, JSON.stringify(args).slice(0, 150))
  switch (name) {
    case 'contact_zoek':            return await tool_contact_zoek(args)
    case 'google_zoek_adres':       return await tool_google_zoek_adres(args)
    case 'contact_briefing':        return await tool_contact_briefing(args)
    case 'contact_create':          return await tool_contact_create(args)
    case 'contact_update':          return await tool_contact_update(args)
    case 'note_create':             return await tool_note_create(args)
    case 'task_create':             return await tool_task_create(args)
    case 'calendar_get_free_slot':  return await tool_calendar_get_free_slot(args)
    case 'calendar_create':         return await tool_calendar_create(args)
    case 'get_team_members':        return await tool_get_team_members()
    case 'get_caller_info':         return await tool_get_caller_info(args)
    default: return `Onbekende tool: ${name}`
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MCP JSON-RPC HTTP HANDLER
// ══════════════════════════════════════════════════════════════════════════════
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  // Health / discovery
  if (req.method === 'GET') {
    return Response.json({ ok: true, service: 'suus-mcp', tools: MCP_TOOLS.map(t => t.name) }, { headers: CORS })
  }

  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return new Response('Bad JSON', { status: 400 }) }

  const id     = body.id ?? null
  const method = String(body.method ?? '')

  const ok = (result: unknown) => Response.json({ jsonrpc: '2.0', id, result }, { headers: CORS })
  const err = (code: number, msg: string) => Response.json({ jsonrpc: '2.0', id, error: { code, message: msg } }, { headers: CORS })

  try {
    switch (method) {
      case 'initialize':
        return ok({
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'suus-mcp', version: '1.0.0' },
        })

      case 'tools/list':
        return ok({ tools: MCP_TOOLS })

      case 'tools/call': {
        const params = (body.params ?? {}) as Record<string, unknown>
        const toolName = String(params.name ?? '')
        // Retell double-serialises arguments — unwrap until we get an object
        let rawArgs: unknown = params.arguments ?? {}
        let safety = 0
        while (typeof rawArgs === 'string' && safety++ < 5) {
          try { rawArgs = JSON.parse(rawArgs) } catch { rawArgs = {}; break }
        }
        if (typeof rawArgs !== 'object' || rawArgs === null) rawArgs = {}
        const toolArgs = rawArgs as Record<string, unknown>
        if (!toolName) return err(-32602, 'name is required')
        console.log(`[suus-mcp] tools/call: ${toolName}`, JSON.stringify(toolArgs))
        const result = await callTool(toolName, toolArgs)
        console.log(`[suus-mcp] result (${toolName}):`, result.slice(0, 200))
        return ok({ content: [{ type: 'text', text: result }] })
      }

      case 'notifications/initialized':
        return ok({})

      default:
        return err(-32601, `Method not found: ${method}`)
    }
  } catch (e) {
    console.error('[suus-mcp] error:', e)
    return err(-32603, e instanceof Error ? e.message : String(e))
  }
})
