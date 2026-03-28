/**
 * retell-contact-zoek  –  Dedicated contact-search endpoint for Retell AI.
 *
 * Called as a Retell webhook tool:
 *   POST /functions/v1/retell-contact-zoek
 *   Body: { call: {...}, name: "contact_zoek", args: { query: string, city?: string } }
 *
 * Pipeline:
 *   1. Normalise Dutch spoken numbers ("drieëndertig" → "33")
 *   2. gpt-4.1-nano parses query → { bedrijfsnaam, stad }
 *   3. Google Places Text Search → STT name correction
 *   4. gpt-4.1-nano picks best Google candidate
 *   5. GHL 4× parallel search (query + advanced, normalised + original)
 *   6. Lenient city filter (first-4-char fallback, never removes all)
 *   7. Returns structured JSON { count, contacts, bron, instructie }
 *
 * Deploy: supabase functions deploy retell-contact-zoek --no-verify-jwt
 */

import OpenAI from 'https://deno.land/x/openai@v4.52.0/mod.ts'

const openai  = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY')! })
const GHL_KEY = () => Deno.env.get('GHL_API_KEY') ?? ''
const GHL_LOC = () => Deno.env.get('GHL_LOCATION_ID') ?? ''
const G_KEY   = () => Deno.env.get('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY') ?? ''

// ── Timeout helper ────────────────────────────────────────────────────────────
function withTimeout<T>(p: Promise<T>, ms = 8000, label = ''): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`Timeout ${ms}ms${label ? ': ' + label : ''}`)), ms),
    ),
  ])
}

// ── Dutch number normaliser ───────────────────────────────────────────────────
const NL: [RegExp, string][] = [
  [/\bnul\b/gi,'0'],[/\één\b|\béén\b|\been\b/gi,'1'],[/\btwee\b/gi,'2'],
  [/\bdrie\b/gi,'3'],[/\bvier\b/gi,'4'],[/\bvijf\b/gi,'5'],
  [/\bzes\b/gi,'6'],[/\bzeven\b/gi,'7'],[/\bacht\b/gi,'8'],
  [/\bnegen\b/gi,'9'],[/\btien\b/gi,'10'],[/\belf\b/gi,'11'],
  [/\btwaalf\b/gi,'12'],[/\bdertien\b/gi,'13'],[/\bveertien\b/gi,'14'],
  [/\bvijftien\b/gi,'15'],[/\bzestien\b/gi,'16'],[/\bzeventien\b/gi,'17'],
  [/\bachttien\b/gi,'18'],[/\bnegentien\b/gi,'19'],[/\btwintig\b/gi,'20'],
  [/\beenentwintig\b/gi,'21'],[/\btweeëntwintig\b/gi,'22'],[/\bdrieëntwintig\b/gi,'23'],
  [/\bvierentwintig\b/gi,'24'],[/\bvijfentwintig\b/gi,'25'],[/\bzesentwintig\b/gi,'26'],
  [/\bzevenentwintig\b/gi,'27'],[/\bachtentwintig\b/gi,'28'],[/\bnegenentwintig\b/gi,'29'],
  [/\bdertig\b/gi,'30'],[/\beenendertig\b/gi,'31'],[/\btweeëndertig\b/gi,'32'],
  [/\bdrieëndertig\b/gi,'33'],[/\bvierendertig\b/gi,'34'],[/\bvijfendertig\b/gi,'35'],
  [/\bzesendertig\b/gi,'36'],[/\bzevenendertig\b/gi,'37'],[/\bachtendertig\b/gi,'38'],
  [/\bnegendertig\b/gi,'39'],[/\bveertig\b/gi,'40'],[/\bvijftig\b/gi,'50'],
  [/\bzestig\b/gi,'60'],[/\bzeventig\b/gi,'70'],[/\btachtig\b/gi,'80'],
  [/\bnegtig\b|\bnegentig\b/gi,'90'],[/\bhonderd\b/gi,'100'],
]

function normalise(q: string): string {
  let s = q
  for (const [re, d] of NL) s = s.replace(re, d)
  s = s.replace(/\b(\d+)\s+(\d+)\b/g, '$1$2')
  s = s.replace(/\s+(van\s+de[rnm]?|van\s+het|van\s+'t|van|de[rnm]?|het|'t)\s+/gi, ' ')
  return s.trim()
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

// ── Main search ───────────────────────────────────────────────────────────────
async function contactZoek(rawQuery: string, cityInput: string): Promise<Record<string, unknown>> {
  const query = normalise(rawQuery)

  // ── Step 1: nano parses query ──────────────────────────────────────────────
  interface Parsed { bedrijfsnaam: string; stad: string | null }
  let parsed: Parsed = { bedrijfsnaam: query, stad: cityInput || null }
  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4.1-nano', temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Parseer Nederlandse CRM-zoekopdracht (telefonisch) naar JSON.\nUitvoer: {"bedrijfsnaam":string,"stad":string|null}\n- Getallen uitspellen naar cijfers\n- Strip beleefdheidstaal, bewaar echte naam\n- Als stad al gegeven: gebruik die, anders extraheer uit query' },
        { role: 'user',   content: `Query: "${query}"${cityInput ? `\nStad: "${cityInput}"` : ''}` },
      ],
    })
    const p = JSON.parse(r.choices[0].message.content ?? '{}') as Partial<Parsed>
    parsed = { bedrijfsnaam: p.bedrijfsnaam?.trim() || query, stad: p.stad?.trim() || cityInput || null }
  } catch { /* use normalised query as fallback */ }

  const naam = parsed.bedrijfsnaam
  const stad = parsed.stad ?? ''

  // ── Step 2: Google Places → STT name correction ────────────────────────────
  let normalizedName = naam
  try {
    const searchQ = stad ? `${naam} ${stad}` : naam
    const gRes = await withTimeout(
      fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': G_KEY(),
          'X-Goog-FieldMask': 'places.displayName,places.addressComponents',
        },
        body: JSON.stringify({ textQuery: searchQ, languageCode: 'nl', regionCode: 'NL', maxResultCount: 5 }),
      }).then(r => r.json()) as Promise<{ places?: Array<Record<string, unknown>> }>,
      6000, 'google-normalize',
    )
    const places = (gRes.places ?? []).slice(0, 5)
    if (places.length) {
      type AC = { longText?: string; types?: string[] }
      const candidates = places.map((p, i) => {
        const n = (p.displayName as { text?: string } | undefined)?.text ?? ''
        const comps = (p.addressComponents ?? []) as AC[]
        const city  = comps.find(x => x.types?.includes('locality'))?.longText ?? ''
        return `${i}: ${n}${city ? ` (${city})` : ''}`
      }).join('\n')

      const m = await openai.chat.completions.create({
        model: 'gpt-4.1-nano', temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'STT-correctie: kies het meest plausibele Google Places resultaat voor de zoekopdracht. JSON: {"match":true,"index":<n>,"corrected_name":"<naam>"} of {"match":false}. Wees streng.' },
          { role: 'user',   content: `STT: "${naam}"\nGoogle:\n${candidates}` },
        ],
      })
      let v: Record<string, unknown> = { match: false }
      try { v = JSON.parse(m.choices[0].message.content ?? '{}') } catch { /* ignore */ }
      if (v.match) {
        const idx = Number(v.index ?? 0)
        const corrected = String(v.corrected_name ?? (places[idx]?.displayName as { text?: string } | undefined)?.text ?? naam)
        normalizedName = corrected.trim()
      }
    }
  } catch { /* Google error — continue with naam */ }

  // ── Step 3: GHL 4× parallel search ────────────────────────────────────────
  const ghlQuery = async (q: string): Promise<Array<Record<string, unknown>>> => {
    try {
      const r = await withTimeout(ghl(`/contacts/?locationId=${GHL_LOC()}&query=${encodeURIComponent(q)}&limit=10`), 6000, 'ghl-query')
      return (r.contacts ?? []) as Array<Record<string, unknown>>
    } catch { return [] }
  }
  const ghlAdvanced = async (q: string): Promise<Array<Record<string, unknown>>> => {
    try {
      const r = await withTimeout(ghl('/contacts/search/duplicate', { method: 'POST', body: JSON.stringify({ locationId: GHL_LOC(), name: q }) }), 5000, 'ghl-advanced')
      return (r.contacts ?? []) as Array<Record<string, unknown>>
    } catch { return [] }
  }

  const [r1, r2, r3, r4] = await withTimeout(
    Promise.all([
      ghlQuery(normalizedName),
      normalizedName !== naam ? ghlQuery(naam) : Promise.resolve([]),
      ghlAdvanced(normalizedName),
      normalizedName !== naam ? ghlAdvanced(naam) : Promise.resolve([]),
    ]),
    9000, 'ghl-parallel',
  )

  // dedup by id
  const seen = new Set<string>()
  let contacts: Array<Record<string, unknown>> = []
  for (const list of [r1, r2, r3, r4]) {
    for (const c of list) {
      const id = String(c.id ?? '')
      if (id && !seen.has(id)) { seen.add(id); contacts.push(c) }
    }
  }

  // ── Step 4: lenient city filter ────────────────────────────────────────────
  if (stad && contacts.length > 0) {
    const sl = stad.toLowerCase()
    const filtered = contacts.filter(c => {
      const cl = String(c.city ?? '').toLowerCase()
      return cl.includes(sl) || sl.includes(cl.slice(0, 4))
    })
    if (filtered.length > 0) contacts = filtered
  }

  // ── Format output ──────────────────────────────────────────────────────────
  if (contacts.length === 0) {
    return {
      count: 0,
      contacts: [],
      bron: 'niet gevonden',
      naam_gezocht: naam,
      stad_gezocht: stad || null,
      instructie: `Zeg: "Ik kan ${naam}${stad ? ` in ${stad}` : ''} niet vinden. Zullen we dit contact aanmaken?"`,
    }
  }

  const bron = normalizedName !== naam
    ? `CRM — naam gecorrigeerd van "${naam}" naar "${normalizedName}"`
    : 'CRM systeem'

  return {
    count: contacts.length,
    contacts: contacts.map(c => {
      const cname = [c.firstName, c.lastName].filter(Boolean).join(' ')
      const label = c.companyName ? `${c.companyName}${cname ? ` (${cname})` : ''}` : cname
      return {
        contact_id: String(c.id ?? ''),
        naam:       label,
        bedrijf:    c.companyName ?? null,
        stad:       c.city        ?? null,
        telefoon:   c.phone       ?? null,
        email:      c.email       ?? null,
        adres:      [c.address1, c.postalCode, c.city].filter(Boolean).join(', ') || null,
      }
    }),
    bron,
    instructie: contacts.length === 1
      ? 'Gebruik dit contact_id direct voor vervolgacties.'
      : 'Vraag welke optie bedoeld wordt.',
  }
}

// ── HTTP handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
  }

  // Health check
  if (req.method === 'GET') {
    return Response.json({ ok: true, service: 'retell-contact-zoek' })
  }

  try {
    const body = await req.json() as {
      call?: Record<string, unknown>
      name?: string
      args?: { query?: string; city?: string }
    }

    const query = String(body.args?.query ?? '').trim()
    const city  = String(body.args?.city  ?? '').trim()

    if (!query) return Response.json({ error: 'query is required' }, { status: 400 })

    console.log(`[contact-zoek] query="${query}" city="${city}"`)
    const result = await contactZoek(query, city)
    console.log(`[contact-zoek] result count=${result.count}`)

    return Response.json(result)
  } catch (err) {
    console.error('[contact-zoek] error:', err)
    return Response.json({
      count: 0, contacts: [], bron: 'fout',
      instructie: 'Er is iets misgegaan, probeer opnieuw.',
    }, { status: 500 })
  }
})
