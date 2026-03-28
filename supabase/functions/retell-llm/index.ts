/**
 * Supabase Edge Function: retell-llm
 *
 * WebSocket server for Retell AI custom-llm integration.
 * Retell connects via wss:// — Deno handles the WebSocket upgrade.
 *
 * Protocol:
 *  Retell → us: { interaction_type, response_id, transcript, call }
 *  Us → Retell: { response_type: "response", response_id, content, content_complete }
 *
 * Deploy: supabase functions deploy retell-llm --no-verify-jwt
 * Update agent llm_websocket_url to this function's URL.
 */

import OpenAI from 'https://deno.land/x/openai@v4.52.0/mod.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const openai   = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY')! })
const ORG_ID   = () => Deno.env.get('DEFAULT_ORGANIZATION_ID') ?? ''
const GHL_KEY  = () => Deno.env.get('GHL_API_KEY') ?? ''
const GHL_LOC  = () => Deno.env.get('GHL_LOCATION_ID') ?? ''

function adminSb() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

// ─── System prompt ────────────────────────────────────────────────────────────
const VOICE_SYSTEM = `Je bent SUUS, de AI sales-assistent van ROUX BV — bereikbaar via telefoon.
Sales reps bellen vanuit de auto, na een klantbezoek of vlak ervoor.

## KRITIEKE REGEL — altijd contact_zoek aanroepen
Zodra de rep een bedrijfsnaam noemt (met of zonder stad): ALTIJD direct contact_zoek aanroepen.
NOOIT zelf beslissen of een contact bestaat of niet.
NOOIT "Ik kan X niet vinden" zeggen zonder eerst contact_zoek te hebben aangeroepen.
Je hebt GEEN kennis van het CRM — alleen contact_zoek weet wat er in staat.
Uitgesproken getallen omzetten: "drieëndertig" → "33", "vijftien" → "15".

## Stijl
- MAX 2 korte zinnen per beurt. Nooit opsommingen, nooit markdown.
- Spreek natuurlijk: "vrijdag de achttiende" niet "18-04".
- Gebruik de naam van de rep maximaal 1x per gesprek.
- Bij "wacht even" of "momentje": wacht stilletjes af.
- Nooit interne IDs uitspreken.

## Begroeting (lege transcript)
Zeg ALTIJD: "Hoi [voornaam]! Met welke klant kan ik je helpen? Geef de bedrijfsnaam en plaatsnaam."
Gebruik de voornaam van de rep uit de sessiecontext.

## Stap 1 — Contact zoeken
Zodra rep bedrijf + stad noemt → DIRECT contact_zoek aanroepen. Geen bevestiging, geen extra vragen.
- Naam zonder stad → vraag "In welke stad?" → dan direct contact_zoek.
- Naam + stad in één zin → direct contact_zoek.

## Vaste zinnen — gebruik deze EXACT, geen variaties

Na contact_zoek count=1:
→ Zeg: "Ik heb [bedrijfsnaam] gevonden in [stad]. Wil je een briefing, notitie, taak of afspraak?"
→ Embed [contactId: xxx] letterlijk in je antwoord.

Na contact_zoek count>1:
→ Zeg: "Ik zie [n] opties: [naam1] of [naam2]. Welke bedoel je?"

Na contact_zoek count=0:
→ Zeg: "Ik kan [naam] niet vinden in het systeem. Zullen we dit contact aanmaken?"

Na "ja" op aanmaken:
→ Zeg EERST: "Is dit een lead of klant?" — wacht op antwoord
→ Dan DIRECT google_zoek_adres aanroepen

Na google_zoek_adres MET resultaat:
→ Zeg: "Ik vond [naam] op [adres]. Klopt dat? [google: naam=X|adres=X|stad=X|postcode=X|tel=X|website=X]"
→ Rep bevestigt → contact_create met Google-data + klantType

Na google_zoek_adres ZONDER resultaat (bevat "Geen adres" of "Geen betrouwbaar"):
→ DIRECT contact_create aanroepen, géén tekst tussendoor
→ Daarna zeg: "Aangemaakt! Wil je POS-materiaal, kortingsafspraken of groothandel vastleggen?"

Na contact_create:
→ Zeg: "Wil je meteen een notitie, taak of afspraak toevoegen?"

Na elke schrijfactie (note, taak, afspraak):
→ Zeg: "Gedaan! Nog iets?"

Bij GHL fout (tool geeft foutmelding terug):
→ Zeg: "Er is iets misgegaan, probeer het opnieuw."

Bij onbekende vraag (niet CRM-gerelateerd):
→ Zeg: "Daar kan ik niet bij helpen, maar ik kan een notitie, taak of afspraak aanmaken."

## Regels
- note_create en task_create: NOOIT bevestiging vragen — direct uitvoeren
- contact_create: ALTIJD bevestigen vóór aanmaken
- Voornaam, telefoon, email NOOIT vragen — Google + klantType zijn voldoende
- Na count=1: contact_id direct gebruiken, embed [contactId: xxx] in antwoord
- Na google_zoek_adres: embed [google: ...] tag letterlijk in antwoord
- Bij contact_create: gebruik [google: ...] en [contactId: ...] tags uit gespreksgeschiedennis`

// ─── GHL helpers ──────────────────────────────────────────────────────────────
async function ghl(path: string, opts: RequestInit = {}) {
  const res = await fetch(`https://services.leadconnectorhq.com${path}`, {
    ...opts,
    headers: {
      Authorization:  `Bearer ${GHL_KEY()}`,
      Version:        '2021-07-28',
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText)
    throw new Error(`GHL ${res.status}: ${txt}`)
  }
  return res.json()
}

// ─── Tool definitions ─────────────────────────────────────────────────────────
const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'contact_zoek',
      description: 'Zoek contacten op naam of bedrijf in het CRM. Gebruik ALLEEN de bedrijfsnaam of persoonsnaam. Converteer uitgesproken getallen naar cijfers: "drieëndertig" → "33". Geef city mee als de rep een stad noemde — dit helpt bij STT-correctie.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Bedrijfsnaam of contactnaam. Getallen in cijfers.' },
          city:  { type: 'string', description: 'Stad die de rep noemde (optioneel, helpt bij correctie)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'contact_briefing',
      description: 'Geef een volledige briefing van een contact: details, notities, taken en agenda.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'GHL contact ID' },
        },
        required: ['contactId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'contact_create',
      description: 'Maak een nieuw contact aan in het CRM. ALLEEN companyName is verplicht. Voornaam (firstName) is OPTIONEEL — vraag er NOOIT naar. Adres, telefoon en email komen van google_zoek_adres of worden leeg gelaten. Vul altijd klantType in (lead of customer). Als Google niets vindt: maak het contact aan met alleen companyName, city en klantType.',
      parameters: {
        type: 'object',
        properties: {
          companyName: { type: 'string' },
          firstName:   { type: 'string' },
          lastName:    { type: 'string' },
          phone:       { type: 'string' },
          email:       { type: 'string' },
          address1:    { type: 'string' },
          city:        { type: 'string' },
          postalCode:  { type: 'string' },
          type:        { type: 'string', enum: ['lead', 'customer', 'employee'] },
          source:      { type: 'string' },
        },
        required: ['companyName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'contact_update',
      description: 'Update velden van een bestaand contact.',
      parameters: {
        type: 'object',
        properties: {
          contactId:   { type: 'string' },
          companyName: { type: 'string' },
          firstName:   { type: 'string' },
          lastName:    { type: 'string' },
          phone:       { type: 'string' },
          email:       { type: 'string' },
          address1:    { type: 'string' },
          city:        { type: 'string' },
          postalCode:  { type: 'string' },
          type:        { type: 'string', enum: ['lead', 'customer', 'employee'] },
        },
        required: ['contactId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'note_create',
      description: 'Voeg een notitie toe aan een contact.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          body:      { type: 'string', description: 'Inhoud van de notitie' },
          userId:    { type: 'string', description: 'GHL user ID van de medewerker' },
        },
        required: ['contactId', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_create',
      description: 'Maak een taak aan voor een contact.',
      parameters: {
        type: 'object',
        properties: {
          contactId:  { type: 'string' },
          title:      { type: 'string' },
          dueDate:    { type: 'string', description: 'ISO datum bijv. 2025-04-18T10:00:00Z' },
          assignedTo: { type: 'string', description: 'GHL user ID van de toegewezen medewerker' },
        },
        required: ['contactId', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_get_free_slot',
      description: 'Zoek het eerstvolgende vrije tijdslot in de agenda.',
      parameters: {
        type: 'object',
        properties: {
          calendarId: { type: 'string' },
          startDate:  { type: 'string', description: 'Startdatum (YYYY-MM-DD)' },
          endDate:    { type: 'string', description: 'Einddatum (YYYY-MM-DD)' },
        },
        required: ['calendarId', 'startDate', 'endDate'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_create',
      description: 'Maak een afspraak aan in de agenda voor een CRM contact.',
      parameters: {
        type: 'object',
        properties: {
          calendarId: { type: 'string' },
          contactId:  { type: 'string' },
          title:      { type: 'string' },
          startTime:  { type: 'string', description: 'ISO datetime' },
          endTime:    { type: 'string', description: 'ISO datetime' },
        },
        required: ['calendarId', 'contactId', 'title', 'startTime', 'endTime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'google_zoek_adres',
      description: 'Zoek het exacte adres van een bedrijf via Google Places. Geef bedrijfsnaam + stad mee. Retourneert het beste match-adres of "niet gevonden".',
      parameters: {
        type: 'object',
        properties: {
          bedrijfsnaam: { type: 'string', description: 'Naam van het bedrijf zoals de gebruiker het noemde' },
          plaatsnaam:   { type: 'string', description: 'Stad of gemeente' },
        },
        required: ['bedrijfsnaam'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_team_members',
      description: 'Haal teamleden op voor taakoverdracht of toewijzing.',
      parameters: { type: 'object', properties: {} },
    },
  },
]

// ─── Dutch spoken-number → digit normaliser ───────────────────────────────────
const NL_NUMBERS: [RegExp, string][] = [
  [/\bnul\b/gi, '0'], [/\één\b|\béén\b|\been\b/gi, '1'], [/\btwee\b/gi, '2'],
  [/\bdrie\b/gi, '3'], [/\bvier\b/gi, '4'], [/\bvijf\b/gi, '5'],
  [/\bzes\b/gi, '6'], [/\bzeven\b/gi, '7'], [/\bacht\b/gi, '8'],
  [/\bnegen\b/gi, '9'], [/\btien\b/gi, '10'], [/\belf\b/gi, '11'],
  [/\btwaalf\b/gi, '12'], [/\bdertien\b/gi, '13'], [/\bveertien\b/gi, '14'],
  [/\bvijftien\b/gi, '15'], [/\bzestien\b/gi, '16'], [/\bzestien\b/gi, '16'],
  [/\bzeventien\b/gi, '17'], [/\bachttien\b/gi, '18'], [/\bnegentien\b/gi, '19'],
  [/\btwintig\b/gi, '20'], [/\beenentwintig\b/gi, '21'], [/\btweeëntwintig\b/gi, '22'],
  [/\bdrieëntwintig\b/gi, '23'], [/\bvierentwintig\b/gi, '24'], [/\bvijfentwintig\b/gi, '25'],
  [/\bzesentwintig\b/gi, '26'], [/\bzevenentwintig\b/gi, '27'], [/\bachtentwintig\b/gi, '28'],
  [/\bnegenentwintig\b/gi, '29'], [/\bdertig\b/gi, '30'], [/\beenendertig\b/gi, '31'],
  [/\btweeëndertig\b/gi, '32'], [/\bdrieëndertig\b/gi, '33'], [/\bvierendertig\b/gi, '34'],
  [/\bvijfendertig\b/gi, '35'], [/\bzesendertig\b/gi, '36'], [/\bzevenendertig\b/gi, '37'],
  [/\bachtendertig\b/gi, '38'], [/\bnegendertig\b/gi, '39'], [/\bveertig\b/gi, '40'],
  [/\bvijftig\b/gi, '50'], [/\bzestig\b/gi, '60'], [/\bzeventig\b/gi, '70'],
  [/\btachtig\b/gi, '80'], [/\bnegtig\b|\bnegentig\b/gi, '90'],
  [/\bhonderd\b/gi, '100'],
]

function normaliseQuery(q: string): string {
  let s = q
  // Convert spoken Dutch numbers to digits
  for (const [re, digit] of NL_NUMBERS) s = s.replace(re, digit)
  // Collapse consecutive digit tokens: "3 3" → "33"
  s = s.replace(/\b(\d+)\s+(\d+)\b/g, '$1$2')
  // Strip Dutch tussenvoegsels in the MIDDLE of a query (not at the start)
  // e.g. "Nars van het Hemelrijk" → "Nars Hemelrijk"
  s = s.replace(/\s+(van\s+de[rnm]?|van\s+het|van\s+'t|van|de[rnm]?|het|'t)\s+/gi, ' ')
  return s.trim()
}

// ─── Timeout helper ───────────────────────────────────────────────────────────
function withTimeout<T>(promise: Promise<T>, ms = 8000, label = ''): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout na ${ms}ms${label ? ': ' + label : ''}`)), ms)
  )
  return Promise.race([promise, timeout])
}

// ─── Tool executor ────────────────────────────────────────────────────────────
async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    if (name === 'contact_zoek') {
      const rawQuery  = normaliseQuery(String(args.query ?? ''))
      const cityInput = String(args.city ?? '').trim()
      const gKey      = Deno.env.get('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY') ?? ''

      // ── helpers ────────────────────────────────────────────────────────────
      const ghlSearch = async (q: string) => {
        const r = await withTimeout(
          ghl(`/contacts/?locationId=${GHL_LOC()}&query=${encodeURIComponent(q)}&limit=10`),
          6000, 'ghl-query'
        )
        return (r.contacts ?? []) as Array<Record<string, unknown>>
      }

      // Advanced search — graceful fallback if GHL plan doesn't support it
      const ghlSearchAdvanced = async (q: string): Promise<Array<Record<string, unknown>>> => {
        try {
          const r = await withTimeout(
            ghl('/contacts/search/duplicate', {
              method: 'POST',
              body: JSON.stringify({ locationId: GHL_LOC(), name: q }),
            }),
            5000, 'ghl-advanced'
          )
          return (r.contacts ?? []) as Array<Record<string, unknown>>
        } catch (err) {
          console.warn('[ghlSearchAdvanced] fallback to empty:', err)
          return []
        }
      }

      const dedup = (lists: Array<Record<string, unknown>[]>): Array<Record<string, unknown>> => {
        const seen = new Set<string>()
        const out: Array<Record<string, unknown>> = []
        for (const list of lists) {
          for (const c of list) {
            const id = String(c.id ?? '')
            if (id && !seen.has(id)) { seen.add(id); out.push(c) }
          }
        }
        return out
      }

      const formatContacts = (contacts: Array<Record<string, unknown>>, bron = 'CRM systeem') => {
        return JSON.stringify({
          count:    contacts.length,
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
            : contacts.length > 1
              ? 'Vraag de rep welke optie bedoeld wordt.'
              : 'Niet gevonden.',
        })
      }

      // ── Step 1: nano parseert query → {bedrijfsnaam, stad} ────────────────
      interface Parsed { bedrijfsnaam: string; stad: string | null }
      let parsed: Parsed = { bedrijfsnaam: rawQuery, stad: cityInput || null }
      try {
        const parseResp = await openai.chat.completions.create({
          model: 'gpt-4.1-nano', temperature: 0,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'system',
            content: `Je parseert een Nederlandse CRM-zoekopdracht (uitgesproken via telefoon) naar JSON.
Uitvoer: { "bedrijfsnaam": string, "stad": string|null }
- Spel getallen uit: "drieëndertig"→"33", "vijftien"→"15"
- Strip beleefdheidswoorden maar bewaar de echte naam
- Als stad al gegeven: gebruik die, anders extraheer uit query`,
          }, {
            role: 'user',
            content: `Query: "${rawQuery}"${cityInput ? `\nStad (opgegeven): "${cityInput}"` : ''}`,
          }],
        })
        const p = JSON.parse(parseResp.choices[0].message.content ?? '{}') as Partial<Parsed>
        parsed = {
          bedrijfsnaam: p.bedrijfsnaam?.trim() || rawQuery,
          stad:         p.stad?.trim() || cityInput || null,
        }
      } catch { /* use rawQuery fallback */ }

      const naam = parsed.bedrijfsnaam
      const stad = parsed.stad ?? ''

      // ── Step 2: Google Places → naam normaliseren (STT correctie) ─────────
      let normalizedName = naam
      try {
        const searchQ = stad ? `${naam} ${stad}` : naam
        const gRes = await withTimeout(
          fetch('https://places.googleapis.com/v1/places:searchText', {
            method: 'POST',
            headers: {
              'Content-Type':     'application/json',
              'X-Goog-Api-Key':   gKey,
              'X-Goog-FieldMask': 'places.displayName,places.addressComponents',
            },
            body: JSON.stringify({ textQuery: searchQ, languageCode: 'nl', regionCode: 'NL', maxResultCount: 5 }),
          }).then(r => r.json()) as Promise<{ places?: Array<Record<string, unknown>> }>,
          6000, 'google-places-normalize'
        )

        const places = (gRes.places ?? []).slice(0, 5)
        if (places.length) {
          const candidates = places.map((p, i) => {
            const n = (p.displayName as { text?: string } | undefined)?.text ?? ''
            type AC = { longText?: string; types?: string[] }
            const comps = (p.addressComponents ?? []) as AC[]
            const c = comps.find(x => x.types?.includes('locality'))?.longText ?? ''
            return `${i}: ${n}${c ? ` (${c})` : ''}`
          }).join('\n')

          const matchResp = await openai.chat.completions.create({
            model: 'gpt-4.1-nano', temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: 'STT heeft een bedrijfsnaam mogelijk verkeerd getranscribeerd. Kies het meest plausibele Google Places resultaat. JSON: {"match": true, "index": <n>, "corrected_name": "<naam>"} of {"match": false}. Wees streng: geef "none" als het een ander type bedrijf of duidelijk ander bedrijf is.' },
              { role: 'user',   content: `STT zei: "${naam}"\nGoogle kandidaten:\n${candidates}` },
            ],
          })
          let verdict: Record<string, unknown> = { match: false }
          try { verdict = JSON.parse(matchResp.choices[0].message.content ?? '{}') } catch { /* ignore */ }

          if (verdict.match) {
            const idx = Number(verdict.index ?? 0)
            const corrected = String(verdict.corrected_name
              ?? (places[idx]?.displayName as { text?: string } | undefined)?.text
              ?? naam)
            normalizedName = corrected.trim()
          }
        }
      } catch { /* Google error — use naam as-is */ }

      // ── Step 3: GHL zoeken — 4x parallel (query + advanced, normalized + original)
      const [r1, r2, r3, r4] = await withTimeout(
        Promise.all([
          ghlSearch(normalizedName),
          normalizedName !== naam ? ghlSearch(naam)         : Promise.resolve([]),
          ghlSearchAdvanced(normalizedName),
          normalizedName !== naam ? ghlSearchAdvanced(naam) : Promise.resolve([]),
        ]),
        9000, 'ghl-parallel-search'
      )
      let contacts = dedup([r1, r2, r3, r4])

      // City filter — lenient: also match on first 4 chars, never filter ALL results away
      if (stad && contacts.length > 0) {
        const stadLower = stad.toLowerCase()
        const cityMatched = contacts.filter(c => {
          const cCity = String(c.city ?? '').toLowerCase()
          return cCity.includes(stadLower) ||
            stadLower.includes(cCity.slice(0, 4))  // 's-Hertogenbosch vs Den Bosch
        })
        if (cityMatched.length > 0) contacts = cityMatched
        // else: geen filter — geef alle resultaten terug
      }

      if (contacts.length > 0) {
        const bron = normalizedName !== naam
          ? `CRM systeem — naam gecorrigeerd van "${naam}" naar "${normalizedName}"`
          : 'CRM systeem'
        return formatContacts(contacts, bron)
      }

      // ── Step 4: niets gevonden → nieuw contact aanbieden ──────────────────
      return JSON.stringify({
        count:     0,
        contacts:  [],
        bron:      'niet gevonden',
        naam_gezocht: naam,
        stad_gezocht: stad || null,
        instructie: `Zeg: "Ik kan ${naam}${stad ? ` in ${stad}` : ''} niet vinden. Wil je dit als nieuw contact aanmaken?"`,
      })
    }

    if (name === 'contact_briefing') {
      const id = String(args.contactId ?? '')
      const [contact, notes, tasks] = await Promise.all([
        ghl(`/contacts/${id}`),
        ghl(`/contacts/${id}/notes`),
        ghl(`/contacts/${id}/tasks`),
      ])
      const c    = contact.contact ?? contact
      const parts = [
        `Naam: ${[c.firstName, c.lastName].filter(Boolean).join(' ') || c.companyName}`,
        `Bedrijf: ${c.companyName ?? '—'}`,
        `Type: ${c.type ?? '—'}`,
        `Telefoon: ${c.phone ?? '—'}`,
        `Email: ${c.email ?? '—'}`,
        `Adres: ${[c.address1, c.postalCode, c.city].filter(Boolean).join(', ') || '—'}`,
      ]
      const noteList = (notes.notes ?? []).slice(0, 3).map((n: Record<string, unknown>) => `- ${String(n.body ?? '').substring(0, 80)}`)
      if (noteList.length) parts.push(`Recente notities:\n${noteList.join('\n')}`)
      const taskList = (tasks.tasks ?? []).filter((t: Record<string, unknown>) => !t.completed).slice(0, 3)
        .map((t: Record<string, unknown>) => `- ${t.title}`)
      if (taskList.length) parts.push(`Open taken:\n${taskList.join('\n')}`)
      return parts.join('\n')
    }

    if (name === 'contact_create') {
      const locId = GHL_LOC()
      if (!locId) {
        console.error('[contact_create] GHL_LOCATION_ID is leeg!')
        return 'Configuratiefout: locatie niet ingesteld. Neem contact op met de beheerder.'
      }
      const body: Record<string, unknown> = {
        locationId:  locId,
        companyName: args.companyName,
      }
      if (args.firstName)  body.firstName  = args.firstName
      if (args.lastName)   body.lastName   = args.lastName
      if (args.phone)      body.phone      = args.phone
      if (args.email)      body.email      = args.email
      if (args.address1)   body.address1   = args.address1
      if (args.city)       body.city       = args.city
      if (args.postalCode) body.postalCode = args.postalCode
      if (args.type)       body.type       = args.type
      if (args.source)     body.source     = args.source
      console.log('[contact_create] body:', JSON.stringify(body))
      try {
        const res = await withTimeout(
          ghl('/contacts/', { method: 'POST', body: JSON.stringify(body) }),
          8000, 'contact_create'
        )
        const c = res.contact ?? res
        if (!c.id) {
          console.error('[contact_create] unexpected GHL response:', JSON.stringify(res))
          return 'Er is iets misgegaan, probeer het opnieuw.'
        }
        return `Contact aangemaakt: ${c.companyName ?? c.firstName} (ID: ${c.id})`
      } catch (err) {
        console.error('[contact_create] GHL error:', err)
        return 'Er is iets misgegaan, probeer het opnieuw.'
      }
    }

    if (name === 'contact_update') {
      const { contactId, ...fields } = args
      const res = await ghl(`/contacts/${contactId}`, { method: 'PUT', body: JSON.stringify(fields) })
      const c   = res.contact ?? res
      return `Contact bijgewerkt: ${c.companyName ?? c.firstName ?? contactId}`
    }

    if (name === 'note_create') {
      await ghl(`/contacts/${args.contactId}/notes`, {
        method: 'POST',
        body:   JSON.stringify({ body: args.body, userId: args.userId }),
      })
      return 'Notitie aangemaakt.'
    }

    if (name === 'task_create') {
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

    if (name === 'calendar_get_free_slot') {
      const res = await ghl(
        `/calendars/${args.calendarId}/free-slots?startDate=${args.startDate}&endDate=${args.endDate}&timezone=Europe/Amsterdam`
      )
      const slots = res.slots ?? res.freeSlots ?? []
      if (!slots.length) return 'Geen vrije slots gevonden in deze periode.'
      const first = slots[0]
      return `Eerste vrije slot: ${first.startTime ?? first.start} — ${first.endTime ?? first.end}`
    }

    if (name === 'calendar_create') {
      await ghl(`/calendars/events/appointments`, {
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

    if (name === 'google_zoek_adres') {
      const bedrijfsnaam = normaliseQuery(String(args.bedrijfsnaam ?? ''))
      const plaatsnaam   = String(args.plaatsnaam ?? '')
      const queryStr     = plaatsnaam ? `${bedrijfsnaam} ${plaatsnaam}` : bedrijfsnaam
      const gKey         = Deno.env.get('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY') ?? ''

      // Google Places Text Search (New) — single call, ordered by relevance
      const gRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type':     'application/json',
          'X-Goog-Api-Key':   gKey,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.addressComponents,places.internationalPhoneNumber,places.websiteUri',
        },
        body: JSON.stringify({ textQuery: queryStr, languageCode: 'nl', regionCode: 'NL', maxResultCount: 5 }),
      }).then(r => r.json()) as { places?: Array<Record<string, unknown>> }

      const places = (gRes.places ?? []).slice(0, 5)
      if (!places.length) return `[BRON: niet gevonden] Geen adres gevonden voor "${queryStr}". Maak het contact aan zonder adres — vraag de gebruiker NIET om naam of adres te verduidelijken.`

      // nano picks the best match
      const candidateList = places.map((p, i) => {
        const n = (p.displayName as { text?: string } | undefined)?.text ?? ''
        return `${i}: ${n} — ${p.formattedAddress ?? ''}`
      }).join('\n')

      const verifyRes = await openai.chat.completions.create({
        model: 'gpt-4.1-nano', temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Kies het beste Google Places resultaat voor de zoekopdracht. JSON: {"match": true, "index": <n>} of {"match": false}. Wees streng.' },
          { role: 'user',   content: `Zoekopdracht: "${queryStr}"\n\nCandidaten:\n${candidateList}` },
        ],
      })

      let verdict: Record<string, unknown> = { match: false }
      try { verdict = JSON.parse(verifyRes.choices[0].message.content ?? '{}') } catch { /* ignore */ }
      if (!verdict.match) return `[BRON: niet gevonden] Geen betrouwbaar adres gevonden voor "${queryStr}". Maak het contact aan zonder adres — vraag de gebruiker NIET om naam of adres te verduidelijken.`

      const p    = places[Number(verdict.index ?? 0)] ?? places[0]
      type AC    = { longText?: string; shortText?: string; types?: string[] }
      const comps = (p.addressComponents ?? []) as AC[]
      const get   = (type: string) => comps.find(c => c.types?.includes(type))?.longText ?? ''
      const placeName = (p.displayName as { text?: string } | undefined)?.text ?? bedrijfsnaam
      const street    = `${get('route')} ${get('street_number')}`.trim()
      const city2     = get('locality') || get('administrative_area_level_2') || plaatsnaam
      const postal    = get('postal_code')
      const phone     = p.internationalPhoneNumber ? ` | tel: ${p.internationalPhoneNumber}` : ''
      const website   = p.websiteUri ? ` | ${p.websiteUri}` : ''

      const telVal  = String(p.internationalPhoneNumber ?? '')
      const siteVal = String(p.websiteUri ?? '')
      const googleTag = `[google: naam=${placeName}|adres=${street}|stad=${city2}|postcode=${postal}${telVal ? `|tel=${telVal}` : ''}${siteVal ? `|website=${siteVal}` : ''}]`
      return `[BRON: Google — NIET in CRM systeem] Gevonden: ${placeName} — ${street}, ${postal} ${city2}${telVal ? ` | tel: ${telVal}` : ''}${siteVal ? ` | ${siteVal}` : ''}
INSTRUCTIE: Embed deze tag letterlijk in je antwoord: ${googleTag}`.trim()
    }

    if (name === 'get_team_members') {
      const { data } = await adminSb()
        .from('team_members')
        .select('naam, functie, ghl_user_id')
        .eq('organization_id', ORG_ID())
        .eq('active', true)
      if (!data?.length) return 'Geen teamleden gevonden.'
      return data.map(m => `${m.naam} (${m.functie}) — GHL ID: ${m.ghl_user_id}`).join('\n')
    }

    return `Onbekende tool: ${name}`
  } catch (err) {
    return `Fout bij ${name}: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ─── Employee resolver ────────────────────────────────────────────────────────
async function resolveEmployee(fromNumber: string) {
  try {
    const digits = fromNumber.replace(/\D/g, '')
    const { data } = await adminSb()
      .from('team_members')
      .select('naam, functie, ghl_user_id, calendar_id, phone')
      .eq('organization_id', ORG_ID())
      .eq('active', true)
      .not('ghl_user_id', 'is', null)
    if (!data?.length) return null
    return data.find(m => {
      const mp = (m.phone ?? '').replace(/\D/g, '')
      return mp && (mp === digits || mp.slice(-9) === digits.slice(-9))
    }) ?? null
  } catch { return null }
}

async function resolveEmployeeById(id: string) {
  try {
    const { data } = await adminSb()
      .from('team_members')
      .select('naam, functie, ghl_user_id, calendar_id, phone')
      .eq('id', id)
      .single()
    return data ?? null
  } catch { return null }
}

// ─── Context builder ──────────────────────────────────────────────────────────
function buildContext(employee: Record<string, unknown> | null): OpenAI.Chat.ChatCompletionMessageParam[] {
  const now      = new Date()
  const hour     = Number(new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: 'numeric', hour12: false }).format(now))
  const dagdeel  = hour < 12 ? 'Goedemorgen' : hour < 18 ? 'Goedemiddag' : 'Goedenavond'
  const datetime = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', dateStyle: 'full', timeStyle: 'short' }).format(now)
  const voornaam = (employee?.naam as string | undefined)?.split(' ')[0] ?? ''
  const lines = [
    `Datum/tijd: ${datetime}`,
    `Dagdeel begroeting: ${dagdeel}`,
    `GHL locatie ID: ${GHL_LOC()}`,
    ...(employee ? [
      `Naam rep: ${employee.naam} (voornaam: ${voornaam})`,
      `Functie: ${employee.functie}`,
      `GHL user ID: ${employee.ghl_user_id}`,
      `Calendar ID: ${employee.calendar_id ?? ''}`,
    ] : ['Onbekende medewerker — verzoek beleefd weigeren']),
  ]
  return [
    { role: 'user',      content: `[Context]\n${lines.join('\n')}` },
    { role: 'assistant', content: 'Begrepen.' },
  ]
}

// ─── LLM call with tool loop ──────────────────────────────────────────────────
async function* runLLM(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  onToken: (t: string) => void,
  onToolResult: (name: string, args: Record<string, unknown>, result: string) => void = () => {},
  maxSteps = 12,
): AsyncGenerator<string> {
  const systemMsg: OpenAI.Chat.ChatCompletionMessageParam = { role: 'system', content: VOICE_SYSTEM }
  let history = [systemMsg, ...messages]

  // Force contact_zoek on the very first step if no tool has been called yet in this conversation.
  // This prevents the LLM from skipping the tool and answering directly (e.g. for "venster 33 Amsterdam").
  const hasAnyToolInHistory = messages.some(m => m.role === 'tool')

  for (let step = 0; step < maxSteps; step++) {
    const tool_choice: OpenAI.Chat.ChatCompletionToolChoiceOption =
      (step === 0 && !hasAnyToolInHistory)
        ? { type: 'function', function: { name: 'contact_zoek' } }
        : 'auto'

    const stream = await openai.chat.completions.create({
      model:       'gpt-4.1',
      messages:    history,
      tools:       TOOLS,
      tool_choice,
      temperature: 0,
      stream:      true,
    })

    let text       = ''
    let finishReason = ''
    const toolCalls: Array<{ id: string; name: string; argsJson: string }> = []

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      finishReason = chunk.choices[0]?.finish_reason ?? finishReason

      if (delta?.content) {
        text += delta.content
        onToken(delta.content)
        yield delta.content
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          if (!toolCalls[idx]) toolCalls[idx] = { id: tc.id ?? '', name: tc.function?.name ?? '', argsJson: '' }
          if (tc.function?.name)      toolCalls[idx].name     = tc.function.name
          if (tc.function?.arguments) toolCalls[idx].argsJson += tc.function.arguments
          if (tc.id)                  toolCalls[idx].id        = tc.id
        }
      }
    }

    if (finishReason !== 'tool_calls' || !toolCalls.length) break

    // Execute tools
    history.push({
      role:       'assistant',
      content:    text || null,
      tool_calls: toolCalls.map(tc => ({
        id:       tc.id,
        type:     'function' as const,
        function: { name: tc.name, arguments: tc.argsJson },
      })),
    })

    for (const tc of toolCalls) {
      let parsedArgs: Record<string, unknown> = {}
      try { parsedArgs = JSON.parse(tc.argsJson) } catch { /* ignore */ }
      const result = await executeTool(tc.name, parsedArgs)
      onToolResult(tc.name, parsedArgs, result)
      history.push({ role: 'tool', tool_call_id: tc.id, content: result })
    }
  }
}

// ─── Stream response helper ───────────────────────────────────────────────────
async function streamResponse(
  socket: WebSocket,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  responseId: number,
  onToolResult: (name: string, args: Record<string, unknown>, result: string) => void = () => {},
) {
  for await (const token of runLLM(messages, () => {}, onToolResult)) {
    socket.send(JSON.stringify({
      response_type:    'response',
      response_id:      responseId,
      content:          token,
      content_complete: false,
      end_call:         false,
    }))
  }
  // Final complete marker
  socket.send(JSON.stringify({
    response_type:    'response',
    response_id:      responseId,
    content:          '',
    content_complete: true,
    end_call:         false,
  }))
  console.log(`[retell-llm] streamResponse done, id=${responseId}`)
}

// ─── WebSocket handler ────────────────────────────────────────────────────────
function handleWebSocket(socket: WebSocket) {
  console.log('[retell-llm] env check:', {
    hasGhlKey: !!GHL_KEY(),
    hasGhlLoc: !!GHL_LOC(),
    hasOrgId:  !!ORG_ID(),
    ghlLocVal: GHL_LOC(),
  })

  let employee: Record<string, unknown> | null = null
  let contextMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  let isWebCall = false
  let callMetadata: Record<string, string> | null = null

  // Session contact memory — persists found contacts across turns within this call
  const sessionContacts: Array<{ contact_id: string; naam: string; raw: string }> = []

  function onToolResult(name: string, _args: Record<string, unknown>, result: string) {
    if (name === 'contact_zoek') {
      try {
        const parsed = JSON.parse(result) as { contacts?: Array<{ contact_id: string; naam: string }> }
        for (const c of parsed.contacts ?? []) {
          if (c.contact_id && !sessionContacts.find(x => x.contact_id === c.contact_id)) {
            sessionContacts.push({ contact_id: c.contact_id, naam: c.naam, raw: result })
            console.log(`[retell-llm] session contact stored: ${c.naam} (${c.contact_id})`)
          }
        }
      } catch {
        // Legacy string fallback
        const matches = [...result.matchAll(/contact_id="([^"]+)"\s+naam="([^"]+)"/g)]
        for (const m of matches) {
          const id = m[1], naam = m[2]
          if (!sessionContacts.find(c => c.contact_id === id)) {
            sessionContacts.push({ contact_id: id, naam, raw: result })
            console.log(`[retell-llm] session contact stored (legacy): ${naam} (${id})`)
          }
        }
      }
    }
  }

  function buildSessionContext(): OpenAI.Chat.ChatCompletionMessageParam[] {
    if (!sessionContacts.length) return []
    const lines = sessionContacts.map(c => `contact_id="${c.contact_id}" naam="${c.naam}"`)
    return [
      { role: 'user',      content: `[Contacten gevonden eerder in dit gesprek]\n${lines.join('\n')}\nGebruik deze contact_id's direct voor schrijfacties — geen nieuwe contact_zoek nodig tenzij gevraagd.` },
      { role: 'assistant', content: 'Begrepen, ik gebruik deze contact_id\'s.' },
    ]
  }

  // Send config when socket opens — must wait for OPEN state in Deno
  socket.onopen = () => {
    socket.send(JSON.stringify({
      response_type: 'config',
      config: { auto_reconnect: true, call_details: true },
    }))
    console.log('[retell-llm] socket open, config sent')
  }

  socket.onmessage = async (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data)
      const interactionType = msg.interaction_type as string

      // Retell ping
      if (interactionType === 'ping_pong') {
        socket.send(JSON.stringify({ response_type: 'ping_pong', timestamp: msg.timestamp }))
        return
      }

      // First event: Retell sends call details
      if (interactionType === 'call_details') {
        const callType = msg.call?.call_type as string
        const metadata = msg.call?.metadata as Record<string, string> | undefined
        isWebCall    = callType === 'web_call'
        callMetadata = metadata ?? null

        if (isWebCall) {
          employee = {
            naam:        metadata?.employee_naam ?? '',
            functie:     null,
            ghl_user_id: metadata?.ghl_user_id   ?? null,
            calendar_id: metadata?.calendar_id   ?? null,
            phone:       null,
          }
          contextMessages = buildContext(employee)
        } else {
          const fromNumber = String(msg.call?.from_number ?? '').replace('whatsapp:', '').replace(/^\+/, '')
          employee = await resolveEmployee(fromNumber)
          contextMessages = buildContext(employee)
        }

        // Send greeting on response_id: 0 — this is how the official Retell demo works
        const voornaam = ((employee as Record<string,unknown>)?.naam as string ?? '').split(' ')[0]
        const greeting = voornaam
          ? `Hoi ${voornaam}! Met welke klant kan ik je helpen? Geef de bedrijfsnaam en plaatsnaam.`
          : `Hoi! Met welke klant kan ik je helpen? Geef de bedrijfsnaam en plaatsnaam.`
        socket.send(JSON.stringify({ response_type: 'response', response_id: 0, content: greeting, content_complete: true, end_call: false }))
        console.log(`[retell-llm] call_details done, greeting sent, naam=${voornaam || '?'}`)
        return
      }

      // Transcript update only — no response needed
      if (interactionType === 'update_only') {
        return  // no response needed per Retell spec
      }

      // Reminder — user is silent, give a short nudge without re-running the LLM
      if (interactionType === 'reminder_required') {
        const transcript = (msg.transcript ?? []) as Array<{ role: string; content: string }>
        // If still on first turn (no user message yet), just nudge
        const hasUserTurn = transcript.some(t => t.role === 'user')
        if (!hasUserTurn) {
          socket.send(JSON.stringify({ response_type: 'response', response_id: msg.response_id, content: 'Welk bedrijf kan ik voor je zoeken?', content_complete: true }))
          return
        }
        // Otherwise fall through to normal LLM response
      }

      // Response required
      if (interactionType === 'response_required' || interactionType === 'reminder_required') {
        // Fallback: call_details might have been missed
        if (!employee) {
          if (isWebCall && callMetadata) {
            employee = { naam: callMetadata.employee_naam ?? '', functie: null, ghl_user_id: callMetadata.ghl_user_id ?? null, calendar_id: callMetadata.calendar_id ?? null, phone: null }
          } else if (!isWebCall) {
            const fromNumber = String(msg.call?.from_number ?? '').replace('whatsapp:', '').replace(/^\+/, '')
            employee = await resolveEmployee(fromNumber)
            if (!employee) {
              socket.send(JSON.stringify({ response_type: 'response', response_id: msg.response_id, content: 'Dit nummer is niet geautoriseerd voor SUUS.', content_complete: true }))
              return
            }
          }
          contextMessages = buildContext(employee)
        }

        const transcript: OpenAI.Chat.ChatCompletionMessageParam[] = (msg.transcript ?? []).map(
          (t: { role: string; content: string }) => ({
            role:    t.role === 'agent' ? 'assistant' : 'user',
            content: t.content,
          })
        )

        const sessionCtx = buildSessionContext()
        console.log(`[retell-llm] → openai, naam=${(employee as Record<string,unknown>)?.naam ?? '?'}, turns=${transcript.length}, session_contacts=${sessionContacts.length}, id=${msg.response_id}`)
        try {
          await streamResponse(
            socket,
            [...contextMessages, ...sessionCtx, ...transcript],
            msg.response_id,
            onToolResult,
          )
        } catch (llmErr) {
          console.error('[retell-llm] streamResponse failed:', llmErr)
          socket.send(JSON.stringify({ response_type: 'response', response_id: msg.response_id, content: 'Er is iets misgegaan, probeer opnieuw.', content_complete: true }))
        }
      }

    } catch (err) {
      console.error('[retell-llm] message error:', err)
    }
  }

  socket.onclose = () => console.log('[retell-llm] ws closed')
  socket.onerror = (e) => console.error('[retell-llm] ws error:', e)
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const upgrade = req.headers.get('upgrade') ?? ''

  if (upgrade.toLowerCase() === 'websocket') {
    const { socket, response } = Deno.upgradeWebSocket(req)
    handleWebSocket(socket)
    return response
  }

  // Health check
  return new Response(JSON.stringify({ ok: true, service: 'retell-llm' }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
