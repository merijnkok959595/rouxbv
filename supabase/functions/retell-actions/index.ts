/**
 * retell-actions  –  CRM action dispatcher for Retell AI webhook tools.
 *
 * Called as a Retell webhook tool:
 *   POST /functions/v1/retell-actions
 *   Body: { call: {...}, name: "tool_name", args: {...} }
 *
 * Dispatches on `name` field:
 *   contact_briefing, contact_create, contact_update,
 *   note_create, task_create,
 *   calendar_get_free_slot, calendar_create,
 *   google_zoek_adres, get_team_members, get_caller_info
 *
 * Deploy: supabase functions deploy retell-actions --no-verify-jwt
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

function withTimeout<T>(p: Promise<T>, ms = 8000, label = ''): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`Timeout ${ms}ms${label ? ': ' + label : ''}`)), ms),
    ),
  ])
}

// ── GHL helper ────────────────────────────────────────────────────────────────
async function ghl(path: string, opts: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`https://services.leadconnectorhq.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${GHL_KEY()}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`GHL ${res.status}: ${await res.text().catch(() => res.statusText)}`)
  return res.json()
}

// ── Tool handlers ─────────────────────────────────────────────────────────────
type Args = Record<string, unknown>

async function contact_briefing(args: Args): Promise<string> {
  const id = String(args.contactId ?? '')
  const [contact, notes, tasks] = await Promise.all([
    ghl(`/contacts/${id}`),
    ghl(`/contacts/${id}/notes`),
    ghl(`/contacts/${id}/tasks`),
  ])
  const c    = (contact.contact ?? contact) as Record<string, unknown>
  const parts = [
    `Naam: ${[c.firstName, c.lastName].filter(Boolean).join(' ') || c.companyName}`,
    `Bedrijf: ${c.companyName ?? '—'}`,
    `Type: ${c.type ?? '—'}`,
    `Telefoon: ${c.phone ?? '—'}`,
    `Email: ${c.email ?? '—'}`,
    `Adres: ${[c.address1, c.postalCode, c.city].filter(Boolean).join(', ') || '—'}`,
  ]
  const noteList = ((notes.notes ?? []) as Array<Record<string, unknown>>)
    .slice(0, 3).map(n => `- ${String(n.body ?? '').substring(0, 80)}`)
  if (noteList.length) parts.push(`Recente notities:\n${noteList.join('\n')}`)
  const taskList = ((tasks.tasks ?? []) as Array<Record<string, unknown>>)
    .filter(t => !t.completed).slice(0, 3).map(t => `- ${t.title}`)
  if (taskList.length) parts.push(`Open taken:\n${taskList.join('\n')}`)
  return parts.join('\n')
}

async function contact_create(args: Args): Promise<string> {
  const locId = GHL_LOC()
  if (!locId) return 'Configuratiefout: GHL locatie niet ingesteld.'
  const body: Record<string, unknown> = { locationId: locId, companyName: args.companyName }
  for (const f of ['firstName','lastName','phone','email','address1','city','postalCode','type','source']) {
    if (args[f]) body[f] = args[f]
  }
  console.log('[contact_create] body:', JSON.stringify(body))
  try {
    const res = await withTimeout(ghl('/contacts/', { method: 'POST', body: JSON.stringify(body) }), 8000, 'contact_create')
    const c = (res.contact ?? res) as Record<string, unknown>
    if (!c.id) return 'Er is iets misgegaan, probeer het opnieuw.'
    return `Contact aangemaakt: ${c.companyName ?? c.firstName} (ID: ${c.id})`
  } catch (err) {
    console.error('[contact_create] error:', err)
    return 'Er is iets misgegaan, probeer het opnieuw.'
  }
}

async function contact_update(args: Args): Promise<string> {
  const { contactId, ...fields } = args
  const res = await ghl(`/contacts/${contactId}`, { method: 'PUT', body: JSON.stringify(fields) })
  const c   = (res.contact ?? res) as Record<string, unknown>
  return `Contact bijgewerkt: ${c.companyName ?? c.firstName ?? contactId}`
}

async function note_create(args: Args): Promise<string> {
  await ghl(`/contacts/${args.contactId}/notes`, {
    method: 'POST',
    body:   JSON.stringify({ body: args.body, userId: args.userId }),
  })
  return 'Notitie aangemaakt.'
}

async function task_create(args: Args): Promise<string> {
  await ghl(`/contacts/${args.contactId}/tasks`, {
    method: 'POST',
    body:   JSON.stringify({
      title:      args.title,
      dueDate:    args.dueDate ?? new Date(Date.now() + 86400000).toISOString(),
      assignedTo: args.assignedTo,
      status:     'incompleted',
    }),
  })
  return 'Taak aangemaakt.'
}

async function calendar_get_free_slot(args: Args): Promise<string> {
  const res = await ghl(
    `/calendars/${args.calendarId}/free-slots?startDate=${args.startDate}&endDate=${args.endDate}&timezone=Europe/Amsterdam`
  )
  const slots = (res.slots ?? res.freeSlots ?? []) as Array<Record<string, unknown>>
  if (!slots.length) return 'Geen vrije slots gevonden in deze periode.'
  const first = slots[0]
  return `Eerste vrije slot: ${first.startTime ?? first.start} — ${first.endTime ?? first.end}`
}

async function calendar_create(args: Args): Promise<string> {
  await ghl('/calendars/events/appointments', {
    method: 'POST',
    body:   JSON.stringify({
      calendarId: args.calendarId,
      contactId:  args.contactId,
      title:      args.title,
      startTime:  args.startTime,
      endTime:    args.endTime,
      locationId: GHL_LOC(),
    }),
  })
  return 'Afspraak aangemaakt.'
}

async function google_zoek_adres(args: Args): Promise<string> {
  const naam   = String(args.bedrijfsnaam ?? '').trim()
  const plaats = String(args.plaatsnaam   ?? '').trim()
  const q      = plaats ? `${naam} ${plaats}` : naam

  const gRes = await withTimeout(
    fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': G_KEY(),
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.addressComponents,places.internationalPhoneNumber,places.websiteUri',
      },
      body: JSON.stringify({ textQuery: q, languageCode: 'nl', regionCode: 'NL', maxResultCount: 5 }),
    }).then(r => r.json()) as Promise<{ places?: Array<Record<string, unknown>> }>,
    8000, 'google-adres',
  )

  const places = (gRes.places ?? []).slice(0, 5)
  if (!places.length) {
    return `[BRON: niet gevonden] Geen adres gevonden voor "${q}". Maak het contact aan zonder adres.`
  }

  const list = places.map((p, i) => {
    const n = (p.displayName as { text?: string } | undefined)?.text ?? ''
    return `${i}: ${n} — ${p.formattedAddress ?? ''}`
  }).join('\n')

  const m = await openai.chat.completions.create({
    model: 'gpt-4.1-nano', temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Kies het beste Google Places resultaat. JSON: {"match":true,"index":<n>} of {"match":false}.' },
      { role: 'user',   content: `Zoekopdracht: "${q}"\n\n${list}` },
    ],
  })
  let v: Record<string, unknown> = { match: false }
  try { v = JSON.parse(m.choices[0].message.content ?? '{}') } catch { /* ignore */ }
  if (!v.match) return `[BRON: niet gevonden] Geen betrouwbaar adres voor "${q}". Maak het contact aan zonder adres.`

  const p    = places[Number(v.index ?? 0)] ?? places[0]
  type AC    = { longText?: string; types?: string[] }
  const comps = (p.addressComponents ?? []) as AC[]
  const get   = (t: string) => comps.find(c => c.types?.includes(t))?.longText ?? ''
  const placeName = (p.displayName as { text?: string } | undefined)?.text ?? naam
  const street    = `${get('route')} ${get('street_number')}`.trim()
  const city2     = get('locality') || get('administrative_area_level_2') || plaats
  const postal    = get('postal_code')
  const tel       = String(p.internationalPhoneNumber ?? '')
  const site      = String(p.websiteUri ?? '')

  const tag = `[google: naam=${placeName}|adres=${street}|stad=${city2}|postcode=${postal}${tel ? `|tel=${tel}` : ''}${site ? `|website=${site}` : ''}]`
  return `[BRON: Google] Gevonden: ${placeName} — ${street}, ${postal} ${city2}${tel ? ` | ${tel}` : ''}${site ? ` | ${site}` : ''}\nINSTRUCTIE: Embed deze tag letterlijk: ${tag}`
}

async function get_team_members(): Promise<string> {
  const { data } = await adminSb()
    .from('team_members')
    .select('naam, functie, ghl_user_id, calendar_id')
    .eq('organization_id', ORG_ID())
    .eq('active', true)
  if (!data?.length) return 'Geen teamleden gevonden.'
  return data.map(m => `${m.naam} (${m.functie}) — GHL: ${m.ghl_user_id}${m.calendar_id ? ` | Cal: ${m.calendar_id}` : ''}`).join('\n')
}

async function get_caller_info(fromNumber: string): Promise<string> {
  if (!fromNumber) return 'Onbekend nummer.'
  const digits = fromNumber.replace(/\D/g, '')
  const { data } = await adminSb()
    .from('team_members')
    .select('naam, functie, ghl_user_id, calendar_id, phone')
    .eq('organization_id', ORG_ID())
    .eq('active', true)
    .not('ghl_user_id', 'is', null)
  if (!data?.length) return 'Geen medewerkers gevonden.'
  const emp = data.find(m => {
    const mp = (m.phone ?? '').replace(/\D/g, '')
    return mp && (mp === digits || mp.slice(-9) === digits.slice(-9))
  })
  if (!emp) return 'Niet-geautoriseerd nummer. Weiger beleefd toegang.'
  const now     = new Date()
  const hour    = Number(new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: 'numeric', hour12: false }).format(now))
  const dagdeel = hour < 12 ? 'goedemorgen' : hour < 18 ? 'goedemiddag' : 'goedenavond'
  const voornaam = emp.naam.split(' ')[0]
  return JSON.stringify({
    naam:        emp.naam,
    voornaam,
    functie:     emp.functie,
    ghl_user_id: emp.ghl_user_id,
    calendar_id: emp.calendar_id ?? null,
    dagdeel,
    instructie:  `Begroet de rep: "Hoi ${voornaam}, ${dagdeel}! Met welke klant kan ik je helpen?"`,
  })
}

// ── Dispatcher ────────────────────────────────────────────────────────────────
async function dispatch(
  toolName: string,
  args: Args,
  call?: Record<string, unknown>,
): Promise<string> {
  console.log(`[retell-actions] tool=${toolName}`, JSON.stringify(args).slice(0, 200))
  try {
    switch (toolName) {
      case 'contact_briefing':       return await contact_briefing(args)
      case 'contact_create':         return await contact_create(args)
      case 'contact_update':         return await contact_update(args)
      case 'note_create':            return await note_create(args)
      case 'task_create':            return await task_create(args)
      case 'calendar_get_free_slot': return await calendar_get_free_slot(args)
      case 'calendar_create':        return await calendar_create(args)
      case 'google_zoek_adres':      return await google_zoek_adres(args)
      case 'get_team_members':       return await get_team_members()
      case 'get_caller_info': {
        const fromNumber = String(
          args.from_number
          ?? (call?.from_number)
          ?? (call as Record<string,unknown> | undefined)?.['from_number']
          ?? ''
        )
        return await get_caller_info(fromNumber)
      }
      default: return `Onbekende actie: ${toolName}`
    }
  } catch (err) {
    console.error(`[retell-actions] ${toolName} error:`, err)
    return `Er is iets misgegaan bij ${toolName}. Probeer opnieuw.`
  }
}

// ── HTTP handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
  }
  if (req.method === 'GET') {
    return Response.json({ ok: true, service: 'retell-actions' })
  }

  try {
    const body = await req.json() as {
      call?: Record<string, unknown>
      name?: string
      args?: Args
    }

    const toolName = String(body.name ?? '').trim()
    const args     = (body.args ?? {}) as Args

    if (!toolName) return Response.json({ error: 'name is required' }, { status: 400 })

    const result = await dispatch(toolName, args, body.call)
    // Retell expects the response as a plain string in a `result` field
    return Response.json({ result })
  } catch (err) {
    console.error('[retell-actions] handler error:', err)
    return Response.json({ result: 'Er is iets misgegaan. Probeer opnieuw.' }, { status: 500 })
  }
})
