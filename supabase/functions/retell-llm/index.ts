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
const VOICE_SYSTEM = `Je bent SUUS, de AI sales-assistent van ROUX BV — bereikbaar via de telefoon.
Sales reps bellen vanuit de auto, vaak na een klantbezoek of vlak ervoor.

## Stijl
- MAX 2 korte zinnen per beurt. Nooit opsommingen, nooit markdown.
- Spreek natuurlijk: "vrijdag de achttiende" niet "18-04".
- Gebruik de naam van de rep maximaal 1x per gesprek.
- Bij "wacht even" of "momentje": wacht stilletjes af.

## Eerste bericht (lege transcript)
Begroet met dag-deel + naam: "Goedemiddag [naam]! SUUS hier. Waarmee kan ik je helpen?"
Gebruik datum/tijd uit de context voor het juiste dagdeel.

## Flows

### Voor bezoek — briefing
Rep noemt bedrijfsnaam → direct contact_zoek → contact_briefing → samenvatten in 3 zinnen spreektaal.

### Na bezoek — registreren
Rep zegt "ik was net bij [naam]" → contact_zoek → vraag wat je moet vastleggen als niet duidelijk.
Standaard: note_create (bezoek) + optioneel task_create (follow-up).

### Nieuw contact aanmaken
KRITIEK: NOOIT stap-voor-stap vragen om adres, telefoon, postcode. ALTIJD eerst google_zoek_adres aanroepen.

**Scenario A — contact niet gevonden (count=0) na contact_zoek:**
→ Zeg: "Ik kan [naam] niet vinden. Wil je dit als nieuw contact aanmaken?"
→ Rep zegt ja → google_zoek_adres([naam], [stad]) → bevestig adres in 1 zin → contact_create.

**Scenario B — rep vraagt expliciet nieuw contact aan:**
→ Heb je naam + stad? Direct google_zoek_adres([naam], [stad]).
→ Alleen stad ontbreekt? Vraag "In welke stad?" — daarna DIRECT google_zoek_adres.
→ NOOIT contact_zoek aanroepen bij nieuw aanmaken — direct naar google_zoek_adres.

**Na google_zoek_adres:** bevestig adres in 1 zin ("Ik heb [naam] gevonden op [adres]. Klopt dat?") → contact_create.
Vraag daarna ENKEL: "Lead of klant?" als dat onduidelijk is. Niets anders.

### Afspraak inplannen
contact_zoek → calendar_get_free_slot → noem 1 optie → bevestig → calendar_create.
Gebruik calendarId en userId uit de context — nooit vragen.

## Kernregels zoeken
- Verzamel ALTIJD bedrijfsnaam én plaatsnaam vóór je contact_zoek aanroept
- Als de rep alleen een naam noemt zonder stad: vraag eerst "In welke plaats?"
- Als de rep naam + stad in één zin noemt: direct zoeken, niet opnieuw vragen
- Uitgesproken getallen → cijfers: "drieëndertig"→"33", "vijftien"→"15"
- Stuur city mee als parameter bij contact_zoek
- Bij count=1: direct actie, NOOIT bevestiging vragen
- Bij count>1: "Ik zie [n]: [naam1] in [stad1] of [naam2] in [stad2] — welke?"
- Bij count=0: automatische correctie via Google — als dat ook faalt → vraag DIRECT: "Ik kan [naam] niet vinden. Wil je dit als nieuw contact aanmaken?" NOOIT vragen om te spellen.
- Bij correctie van rep: ALTIJD opnieuw contact_zoek — nooit oude naam gebruiken

## Schrijfacties — KRITIEKE REGELS
**note_create en task_create: NOOIT bevestiging vragen — direct uitvoeren.**
Reden: de rep rijdt, een extra vraag is onacceptabel. Vertrouw wat de rep zegt.

Verplichte volgorde in ÉÉN beurt (geen splits over meerdere beurten):
1. contact_zoek("[naam]") — ook als contact eerder al gevonden was
2. schrijfactie(contact_id uit stap 1, ...)
3. Zeg: "Gedaan! [actie] aangemaakt voor [naam]. Nog iets?"

contact_create en calendar_create: WEL bevestigen vóór uitvoeren.

- Na actie: "Gedaan! Nog iets?"
- Nooit interne IDs uitspreken

## Bronvermelding (VERPLICHT)
Tool resultaten bevatten altijd een [BRON:] tag. Gebruik dit in je antwoord:
- [BRON: CRM systeem] → zeg "staat in ons systeem" of "heb ik gevonden in het systeem"
- [BRON: Google — NIET in CRM systeem] → zeg "heb ik gevonden via Google, maar staat nog niet in ons systeem"
- [BRON: niet in systeem] → zeg "kan ik niet vinden in ons systeem"
Spreek de [BRON:] tag zelf nooit uit — alleen de betekenis ervan.`

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
      description: 'Maak een nieuw contact aan in het CRM. Roep eerst google_zoek_adres aan om adres, telefoon en website automatisch op te halen. Vraag de rep alleen om wat Google niet heeft.',
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

// ─── Tool executor ────────────────────────────────────────────────────────────
async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    if (name === 'contact_zoek') {
      const originalQuery = normaliseQuery(String(args.query ?? ''))
      const city = String(args.city ?? '')

      const ghlSearch = async (q: string) => {
        const r = await ghl(`/contacts/?locationId=${GHL_LOC()}&query=${encodeURIComponent(q)}&limit=5`)
        return (r.contacts ?? []) as Array<Record<string, unknown>>
      }

      const formatContacts = (contacts: Array<Record<string, unknown>>, bron = 'CRM systeem') => {
        const lines = contacts.map((c, i) => {
          const cname   = [c.firstName, c.lastName].filter(Boolean).join(' ')
          const label   = c.companyName ? `${c.companyName}${cname ? ` (${cname})` : ''}` : cname
          const address = [c.address1, c.postalCode, c.city].filter(Boolean).join(', ')
          const contact = [c.phone, c.email].filter(Boolean).join(' | ')
          return `${i + 1}. contact_id="${c.id}" naam="${label}"${address ? ` adres="${address}"` : ''}${contact ? ` contact="${contact}"` : ''}`
        })
        return `[BRON: ${bron}]\n` + lines.join('\n') + (contacts.length > 1 ? '\n\nWelke bedoel je?' : '\n\nGebruik het contact_id hierboven voor vervolgacties.')
      }

      // Step 1: exact query
      let contacts = await ghlSearch(originalQuery)
      if (contacts.length) return formatContacts(contacts)

      // Step 2: prefix fallback (first 4 chars)
      if (originalQuery.length > 4) {
        contacts = await ghlSearch(originalQuery.slice(0, 4))
        if (contacts.length) return formatContacts(contacts, 'CRM systeem — gedeeltelijke naam')
      }

      // Step 3: Outscraper "did you mean?" — Google Maps fuzzy corrects STT errors
      const osQuery = city ? `${originalQuery} ${city}` : originalQuery
      try {
        const osRes = await fetch(
          `https://api.outscraper.cloud/google-maps-search?query=${encodeURIComponent(osQuery)}&limit=5&async=false`,
          { headers: { 'X-API-KEY': Deno.env.get('OUTSCRAPER_API_KEY') ?? '' } }
        ).then(r => r.json())
        const places: Array<Record<string, unknown>> = ((osRes.data ?? [[]])[0] ?? []).slice(0, 5)

        if (places.length) {
          // GPT picks the most plausible match given the misheared query
          const candidates = places.map((p, i) => `${i}: ${p.name} (${p.city ?? ''})`).join('\n')
          const correction = await openai.chat.completions.create({
            model: 'gpt-4.1-nano', temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: 'STT heeft een bedrijfsnaam mogelijk verkeerd getranscribeerd. Kies het meest plausibele Google Maps resultaat als correctie. JSON: {"match": true, "index": <n>, "corrected_name": "<naam>"} of {"match": false}' },
              { role: 'user',   content: `STT zei: "${originalQuery}"\nGoogle Maps kandidaten:\n${candidates}` },
            ],
          })
          let verdict: Record<string, unknown> = { match: false }
          try { verdict = JSON.parse(correction.choices[0].message.content ?? '{}') } catch { /* ignore */ }

          if (verdict.match) {
            const correctedName = String(verdict.corrected_name ?? places[Number(verdict.index ?? 0)].name ?? '')
            contacts = await ghlSearch(correctedName)
            if (contacts.length) return formatContacts(contacts, `CRM systeem — naam gecorrigeerd van "${originalQuery}" naar "${correctedName}"`)
          }
        }
      } catch { /* Outscraper error — fall through to spelling request */ }

      // Step 4: nothing found — offer to create new contact
      return `[BRON: niet gevonden] Geen contact gevonden voor "${originalQuery}". Vraag de rep: "Wil je ${originalQuery} als nieuw contact aanmaken?"`
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
      const body: Record<string, unknown> = {
        locationId:  GHL_LOC(),
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
      const res = await ghl('/contacts/', { method: 'POST', body: JSON.stringify(body) })
      const c   = res.contact ?? res
      return `Contact aangemaakt: ${c.companyName ?? c.firstName} (ID: ${c.id})`
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

      // Step 1: Outscraper Google Maps Search — top 5 results
      const osUrl = `https://api.outscraper.cloud/google-maps-search?query=${encodeURIComponent(queryStr)}&limit=5&async=false`
      const osRes = await fetch(osUrl, {
        headers: { 'X-API-KEY': Deno.env.get('OUTSCRAPER_API_KEY') ?? '' },
      }).then(r => r.json())

      const places: Array<Record<string, unknown>> = ((osRes.data ?? [[]])[0] ?? []).slice(0, 5)
      if (!places.length) return `[BRON: niet gevonden] Geen adres gevonden voor "${queryStr}". Vraag de gebruiker om naam of stad te verduidelijken.`

      // Step 2: GPT-4.1-mini picks the best match
      const candidateList = places.map((p, i) =>
        `${i}: ${p.name} — ${p.address ?? p.street + ', ' + p.postal_code + ' ' + p.city}`
      ).join('\n')

      const verifyRes = await openai.chat.completions.create({
        model:           'gpt-4.1-nano',
        temperature:     0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role:    'system',
            content: `Je krijgt een zoekopdracht en Google Maps resultaten. Kies het BESTE match.
JSON formaat:
- Match: {"match": true, "index": <n>}
- Geen match: {"match": false}
Wees streng: alleen "match: true" als je zeker bent.`,
          },
          {
            role:    'user',
            content: `Zoekopdracht: "${queryStr}"\n\nCandidaten:\n${candidateList}`,
          },
        ],
      })

      let verdict: Record<string, unknown> = { match: false }
      try { verdict = JSON.parse(verifyRes.choices[0].message.content ?? '{}') } catch { /* ignore */ }

      if (!verdict.match) return `[BRON: niet gevonden] Geen betrouwbaar adres gevonden voor "${queryStr}". Vraag de gebruiker om naam of stad te verduidelijken.`

      const p      = places[Number(verdict.index ?? 0)] ?? places[0]
      const name   = String(p.name   ?? '')
      const street = String(p.street ?? (String(p.address ?? '')).split(',')[0] ?? '')
      const city   = String(p.city   ?? plaatsnaam ?? '')
      const postal = String(p.postal_code ?? '')
      const phone  = p.phone ? ` | tel: ${p.phone}` : ''

      return `[BRON: Google — NIET in CRM systeem] Gevonden: ${name} — ${street}, ${postal} ${city}${phone}`.trim()
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

  for (let step = 0; step < maxSteps; step++) {
    const stream = await openai.chat.completions.create({
      model:       'gpt-4.1',
      messages:    history,
      tools:       TOOLS,
      tool_choice: 'auto',
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
  let employee: Record<string, unknown> | null = null
  let contextMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  let isWebCall = false
  let callMetadata: Record<string, string> | null = null

  // Session contact memory — persists found contacts across turns within this call
  const sessionContacts: Array<{ contact_id: string; naam: string; raw: string }> = []

  function onToolResult(name: string, _args: Record<string, unknown>, result: string) {
    if (name === 'contact_zoek' && result.includes('contact_id=')) {
      // Parse all contacts from the result and store in session
      const matches = [...result.matchAll(/contact_id="([^"]+)"\s+naam="([^"]+)"/g)]
      for (const m of matches) {
        const id = m[1], naam = m[2]
        if (!sessionContacts.find(c => c.contact_id === id)) {
          sessionContacts.push({ contact_id: id, naam, raw: result })
          console.log(`[retell-llm] session contact stored: ${naam} (${id})`)
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
          ? `Hoi ${voornaam}, hoe kan ik je helpen?`
          : `Hoi, hoe kan ik je helpen?`
        socket.send(JSON.stringify({ response_type: 'response', response_id: 0, content: greeting, content_complete: true, end_call: false }))
        console.log(`[retell-llm] call_details done, greeting sent, naam=${voornaam || '?'}`)
        return
      }

      // Transcript update only — no response needed
      if (interactionType === 'update_only') {
        return  // no response needed per Retell spec
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
