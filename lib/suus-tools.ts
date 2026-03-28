/**
 * SUUS tool definitions using Vercel AI SDK tool() + Zod
 * Used by /api/suus (streamText) and /api/retell-llm
 *
 * GHL tools mirror the n8n MCP server (Roux | MCP Server.json).
 * Supabase tools handle local ROUX data (team, stats).
 */

import { tool }          from 'ai'
import { z }             from 'zod'
import OpenAI            from 'openai'
import { adminSupabase } from '@/lib/supabase'
import {
  contactSearch, contactSearchAdvanced, normalizeContactQuery,
  contactGet, contactCreate, contactUpdate, buildCustomFields,
  noteList, noteCreate, noteUpdate,
  taskList, taskCreate, taskUpdate,
  calendarGetMany, calendarGetFreeSlots, calendarCreateAppointment,
  calendarBlockSlot, calendarGetAppointment, calendarUpdateAppointment,
  googleZoekAdres,
  type GHLContact, type GHLContactInput,
} from '@/lib/ghl-client'

const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const ORG_ID = () => process.env.ORGANIZATION_ID?.trim() ?? ''

// In-memory cache for contact_briefing — 5-min TTL
// Works within warm Vercel/Node instances. No cross-instance sharing — acceptable tradeoff.
const briefingCache = new Map<string, { data: unknown; ts: number }>()

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatContacts(
  contacts: GHLContact[],
  viaGoogle    = false,
  correctedName?: string | null,
  googleHint?:    string,          // Google-naam als extra context bij meerdere resultaten
) {
  const mapped = contacts
    .slice()
    .sort((a, b) => (a.companyName ?? '').localeCompare(b.companyName ?? '') || (a.firstName ?? '').localeCompare(b.firstName ?? ''))
    .map(c => ({
      contactId:   c.id ?? (c as { contactId?: string }).contactId ?? '',
      firstName:   c.firstName   ?? null,
      lastName:    c.lastName    ?? null,
      companyName: c.companyName ?? null,
      phone:       c.phone       ?? null,
      email:       c.email       ?? null,
      city:        c.city        ?? null,
      address1:    (c as { address1?: string }).address1    ?? null,
      postalCode:  (c as { postalCode?: string }).postalCode ?? null,
    }))

  const lines = mapped.map((c, i) => {
    const name    = [c.firstName, c.lastName].filter(Boolean).join(' ')
    const co      = c.companyName ?? ''
    const label   = [co || name, co && name ? `(${name})` : ''].filter(Boolean).join(' ')
    const address = [c.address1, c.postalCode, c.city].filter(Boolean).join(', ')
    const contact = [c.phone, c.email].filter(Boolean).join(' | ')
    return `${i + 1}. ${label}${address ? ` — ${address}` : c.city ? ` — ${c.city}` : ''}${contact ? ` | ${contact}` : ''}`
  })

  let formatted = lines.join('\n') || 'Geen contacten gevonden.'
  if (mapped.length > 1) formatted += `\n\nWelke bedoel je? (stuur het nummer)`
  if (viaGoogle && correctedName) formatted += `\n_(Spelling gecorrigeerd via Google: "${correctedName}")_`
  if (!viaGoogle && googleHint && mapped.length > 1) formatted += `\n_(Google herkent ook: "${googleHint}")_`

  return { count: mapped.length, contacts: mapped, via_google_correction: viaGoogle, corrected_name: correctedName ?? null, formatted }
}

// ─── Pure-TS briefing formatter (no LLM needed) ───────────────────────────────

function nlDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Amsterdam' })
  } catch { return iso }
}
function nlTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })
  } catch { return '' }
}

function formatBriefing(
  contactName: string,
  notes:        { createdAt: string; body: string }[],
  tasks:        { dueDate: string; title: string; body?: string; completed: boolean }[],
  appointments: { startTime: string; title: string }[],
) {
  const recentNotes = notes.slice(0, 5).reverse()
  const openTasks   = tasks.filter(t => !t.completed)
  const upcomingApt = appointments

  const notesBlock = recentNotes.length
    ? recentNotes.map(n => `- ${nlDate(n.createdAt)} — ${n.body}`).join('\n')
    : 'Geen notities gevonden.'

  const tasksBlock = openTasks.length
    ? openTasks.map(t => `- ${nlDate(t.dueDate)} — ${t.title}${t.body ? ': ' + t.body : ''}`).join('\n')
    : 'Geen open taken.'

  const aptBlock = upcomingApt.length
    ? upcomingApt.map(a => `- ${nlDate(a.startTime)} ${nlTime(a.startTime)} — ${a.title}`).join('\n')
    : 'Geen geplande afspraken.'

  return `## Briefing: ${contactName}

### Recente notities
${notesBlock}

### Open taken
${tasksBlock}

### Aankomende afspraken
${aptBlock}`
}

// ─── GHL Tools ────────────────────────────────────────────────────────────────

export const ghlTools = {

  contact_zoek: tool({
    description: `Zoek een contact op in het CRM. Stuur de ruwe zoekvraag — de tool normaliseert, zoekt via Google en kijkt in GHL.
Bij telefoon/email: geef die direct mee als rawQuery.
Bij bedrijfsnaam: geef altijd ook de stad mee. Als de stad ontbreekt: NIET aanroepen, eerst vragen.`,
    parameters: z.object({
      rawQuery: z.string().describe('Ruwe zoekopdracht zoals de gebruiker het zei, bijv. "nars hemelrijck amsterdam" of "+31612345678"'),
      stad:     z.string().nullish().describe('Plaatsnaam — verplicht bij bedrijfsnaam, weglaten bij telefoon/email'),
    }),
    execute: async ({ rawQuery, stad: stadInput }) => {

      const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
        Promise.race([p, new Promise<T>(r => setTimeout(() => r(fallback), ms))])

      const emptyGHL = { contacts: [] as GHLContact[] }

      const dedup = (lists: (GHLContact[] | undefined)[]): GHLContact[] => {
        const seen = new Set<string>()
        const out: GHLContact[] = []
        for (const list of lists) {
          for (const c of list ?? []) {
            const id = c.id ?? (c as { contactId?: string }).contactId ?? ''
            if (id && !seen.has(id)) { seen.add(id); out.push(c) }
          }
        }
        return out
      }

      // ── Step 1: LLM parse — extract bedrijfsnaam, stad, type ─────────────
      interface ParsedQuery {
        bedrijfsnaam: string
        persoonsnaam:  string | null
        stad:          string | null
        zoektype:      'bedrijf' | 'persoon' | 'telefoon' | 'email'
      }

      let parsed: ParsedQuery = {
        bedrijfsnaam: rawQuery,
        persoonsnaam:  null,
        stad:          stadInput?.trim() || null,
        zoektype:      'bedrijf',
      }

      try {
        const parseResp = await oai.chat.completions.create({
          model: 'gpt-4.1-mini',
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'system',
            content: `Je parseert een Nederlandse CRM-zoekopdracht naar JSON.
Uitvoer: { "bedrijfsnaam": string, "persoonsnaam": string|null, "stad": string|null, "zoektype": "bedrijf"|"persoon"|"telefoon"|"email" }
- zoektype "bedrijf": wanneer een bedrijfs- of zaaksnaam wordt gezocht
- zoektype "persoon": wanneer alleen een persoonsnaam zonder bedrijf
- zoektype "telefoon"/"email": directe contact-ID
- Spel getallen uit: "drieëndertig"→"33", "vijftien"→"15"
- Strip beleefdheidswoorden maar bewaar de echte naam
- Als stad al gegeven: gebruik die, anders extraheer uit query`,
          }, {
            role: 'user',
            content: `Query: "${rawQuery}"${stadInput ? `\nStad (opgegeven): "${stadInput}"` : ''}`,
          }],
        })
        const p = JSON.parse(parseResp.choices[0].message.content ?? '{}') as Partial<ParsedQuery>
        parsed = {
          bedrijfsnaam: p.bedrijfsnaam || rawQuery,
          persoonsnaam:  p.persoonsnaam ?? null,
          stad:          p.stad ?? stadInput?.trim() ?? null,
          zoektype:      p.zoektype ?? 'bedrijf',
        }
        console.log('[contact_zoek] parsed:', parsed)
      } catch (err) {
        console.error('[contact_zoek] parse error:', err)
      }

      // ── Path A: telefoon / email — direct GHL lookup ──────────────────────
      if (parsed.zoektype === 'telefoon' || parsed.zoektype === 'email') {
        const norm = normalizeContactQuery(rawQuery)
        if (norm.query) {
          const res = await withTimeout(contactSearchAdvanced({ query: norm.query }), 5000, emptyGHL)
          if ((res.contacts ?? []).length > 0) return formatContacts(res.contacts)
        }
        return { count: 0, contacts: [], formatted: `Geen contact gevonden voor "${rawQuery}".` }
      }

      // ── Path B: bedrijf/persoon — stad verplicht ──────────────────────────
      const naam = parsed.bedrijfsnaam.trim()
      const stad = parsed.stad?.trim() ?? ''

      if (!stad) {
        return { count: 0, contacts: [], formatted: `In welke plaats zit ${naam}?` }
      }

      const searchQuery   = `${naam} ${stad}`
      let   normalizedName  = naam
      let   googleSource    = false
      let   googleAdres: Record<string, string> = {}

      // ── Step 2: Outscraper + Google Places parallel (alleen voor bedrijven) ─
      if (parsed.zoektype === 'bedrijf') {
        try {
          const osUrl = `https://api.outscraper.cloud/google-maps-search?query=${encodeURIComponent(searchQuery)}&limit=5&async=false`

          const [osRes, googleRes] = await Promise.all([
            withTimeout(
              fetch(osUrl, { headers: { 'X-API-KEY': process.env.OUTSCRAPER_API_KEY ?? '' } }).then(r => r.json()),
              6000, { data: [[]] }
            ),
            withTimeout(googleZoekAdres(searchQuery), 6000, { found: false }),
          ])

          // Cache full address data from Google Places for use in render_form
          const gr = googleRes as { found?: boolean; name?: string; address1?: string; postalCode?: string; city?: string; phone?: string; website?: string; openingHours?: string }
          if (gr.found) {
            if (gr.name)         googleAdres.companyName  = gr.name
            if (gr.address1)     googleAdres.address1     = gr.address1
            if (gr.postalCode)   googleAdres.postalCode   = gr.postalCode
            if (gr.city)         googleAdres.city         = gr.city
            if (gr.phone)        googleAdres.phone        = gr.phone
            if (gr.website)      googleAdres.website      = gr.website
            if (gr.openingHours) googleAdres.openingHours = gr.openingHours
          }

          type Candidate = { name: string; city?: string }
          const candidates: Candidate[] = []
          const seenNames = new Set<string>()

          for (const p of (((osRes.data ?? [[]])[0] ?? []).slice(0, 5) as Array<Record<string, unknown>>)) {
            const n = String(p.name ?? '').trim()
            if (n && !seenNames.has(n.toLowerCase())) { seenNames.add(n.toLowerCase()); candidates.push({ name: n, city: String(p.city ?? '') }) }
          }
          if (gr.found && gr.name) {
            const n = gr.name.trim()
            if (!seenNames.has(n.toLowerCase())) { seenNames.add(n.toLowerCase()); candidates.push({ name: n, city: stad }) }
          }

          if (candidates.length) {
            // ── Step 3: LLM pick best match — strict ──────────────────────
            const candidateList = candidates.map((c, i) => `${i}: ${c.name}${c.city ? ` (${c.city})` : ''}`).join('\n')
            const matchResp = await oai.chat.completions.create({
              model: 'gpt-4.1-mini',
              temperature: 0,
              messages: [{
                role: 'system',
                content: `Je bepaalt of een Google Maps kandidaat hetzelfde bedrijf is als de zoekopdracht.
Regels:
- Geef het cijfer ALLEEN als de naam duidelijk hetzelfde bedrijf is (zelfde naam, zelfde type).
- Geef "none" als: de naam lijkt puur toevallig op een ander bedrijf, het een ander type bedrijf is (bijv. cosmeticamerk vs. restaurant), of je twijfelt.
- Voorbeelden van "none": "NARS Cosmetics" voor zoekopdracht "Nars van 't Hemelrijck", "Venster op de Wereld" voor "Venster 33".
Geef ALLEEN het cijfer of "none". Niets anders.`,
              }, {
                role: 'user',
                content: `Zoekopdracht: "${searchQuery}"\n\nKandidaten:\n${candidateList}`,
              }],
            })
            const choice = matchResp.choices[0].message.content?.trim() ?? 'none'
            if (choice !== 'none') {
              const idx = parseInt(choice)
              if (!isNaN(idx) && candidates[idx]) {
                normalizedName = candidates[idx].name
                googleSource   = true
                console.log(`[contact_zoek] google normalized: "${naam}" → "${normalizedName}"`)
              }
            }
          }
        } catch (err) {
          console.error('[contact_zoek] google step error:', err)
        }
      }

      // ── Step 4: GHL search — 4 parallel strategies ───────────────────────
      const normQ    = normalizeContactQuery(`${normalizedName} ${stad}`)
      const normOrig = normalizeContactQuery(`${naam} ${stad}`)
      const { searchTerms: termsNorm = [], cityFilter } = normQ
      const { searchTerms: termsOrig = [] }             = normOrig

      const [r1, r2, r3, r4] = await Promise.all([
        withTimeout(contactSearch(normalizedName, 10), 4000, emptyGHL),
        withTimeout(contactSearchAdvanced({ searchTerms: termsNorm, cityFilter }), 4000, emptyGHL),
        normalizedName !== naam
          ? withTimeout(contactSearch(naam, 10), 4000, emptyGHL)
          : Promise.resolve(emptyGHL),
        JSON.stringify(termsOrig) !== JSON.stringify(termsNorm)
          ? withTimeout(contactSearchAdvanced({ searchTerms: termsOrig, cityFilter }), 4000, emptyGHL)
          : Promise.resolve(emptyGHL),
      ])

      const allContacts = dedup([r1.contacts, r2.contacts, r3.contacts, r4.contacts])
      const stadLower   = stad.toLowerCase()
      const cityMatched = allContacts.filter(c => (c.city ?? '').toLowerCase().includes(stadLower))
      const results     = cityMatched.length > 0 ? cityMatched : allContacts

      if (results.length > 0) {
        return formatContacts(results, googleSource, googleSource ? normalizedName : null)
      }

      // ── Not found ─────────────────────────────────────────────────────────
      const displayName = googleSource ? normalizedName : naam
      const hint        = googleSource ? ` Google kent wel "${normalizedName}" maar het staat niet in het systeem.` : ''
      const prefillNote = Object.keys(googleAdres).length
        ? ` Adres al gevonden via Google: ${[googleAdres.address1, googleAdres.postalCode, googleAdres.city].filter(Boolean).join(', ')}.`
        : ''
      return {
        count:          0,
        contacts:       [],
        via_google:     googleSource,
        google_name:    googleSource ? normalizedName : null,
        google_prefill: Object.keys(googleAdres).length ? googleAdres : null,
        formatted:      `"${naam}" niet gevonden in het systeem.${hint}${prefillNote}\nWil je "${displayName}" als nieuw contact aanmaken?`,
      }
    },
  }),

  contact_update: tool({
    description: 'Wijzig velden van een bestaand GHL contact. Stuur alleen gewijzigde velden mee.',
    parameters: z.object({
      contactId:         z.string().describe('Contact ID uit contact_zoek'),
      firstName:         z.string().nullish(),
      lastName:          z.string().nullish(),
      email:             z.string().nullish(),
      phone:             z.string().nullish().describe('E.164 formaat, bijv. +31612345678'),
      companyName:       z.string().nullish(),
      address1:          z.string().nullish(),
      postalCode:        z.string().nullish(),
      city:              z.string().nullish(),
      country:           z.string().nullish().describe('Landcode, standaard NL'),
      groothandel:       z.string().nullish(),
      klantType:         z.string().nullish().describe('Lead of Klant'),
      klantLabel:        z.string().nullish().describe('A, B, C of D'),
      posMateriaal:      z.string().nullish().describe('Ja of Nee'),
      kortingsafspraken: z.string().nullish().describe('Ja of Nee'),
    }),
    execute: async ({ contactId, groothandel, klantType: rawKlantType, klantLabel: rawLabel, posMateriaal: rawPos, kortingsafspraken: rawKort, ...fields }) => {
      const normalise = (v: string | null | undefined, valid: string[]) =>
        valid.find(x => x.toLowerCase() === v?.toLowerCase()) ?? v ?? undefined
      const klantType         = normalise(rawKlantType, ['Lead', 'Klant']) as 'Lead'|'Klant'|undefined
      const klantLabel        = normalise(rawLabel,     ['A','B','C','D'])  as 'A'|'B'|'C'|'D'|undefined
      const posMateriaal      = normalise(rawPos,       ['Ja','Nee'])       as 'Ja'|'Nee'|undefined
      const kortingsafspraken = normalise(rawKort,      ['Ja','Nee'])       as 'Ja'|'Nee'|undefined
      const cf = buildCustomFields({ groothandel: groothandel ?? undefined, klantType, klantLabel, posMateriaal, kortingsafspraken })
      const body = { ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null)), ...(cf ? { customFields: cf } : {}) }
      return contactUpdate(contactId, body)
    },
  }),

  render_form: tool({
    description: `Toon een invulformulier in de webapp UI voor nieuw contact aanmaken.
Gebruik dit ALTIJD in de webapp als een nieuw contact aangemaakt moet worden.
Als contact_zoek een google_prefill object teruggaf: geef die velden mee als prefill_* parameters — dan hoeft de tool Google niet opnieuw aan te roepen.
Retourneert { action: "render_form", ... } — de frontend rendert dan direct een formulier.`,
    parameters: z.object({
      companyName:     z.string().describe('Bedrijfsnaam — verplicht'),
      city:            z.string().nullish().describe('Stad'),
      prefill_address: z.string().nullish().describe('Adres uit contact_zoek google_prefill.address1'),
      prefill_postal:  z.string().nullish().describe('Postcode uit contact_zoek google_prefill.postalCode'),
      prefill_city:    z.string().nullish().describe('Stad uit contact_zoek google_prefill.city'),
      prefill_phone:   z.string().nullish().describe('Telefoon uit contact_zoek google_prefill.phone'),
      prefill_website: z.string().nullish().describe('Website uit contact_zoek google_prefill.website'),
    }),
    execute: async ({ companyName, city, prefill_address, prefill_postal, prefill_city, prefill_phone, prefill_website }) => {
      const prefilled: Record<string, string> = { companyName }

      // Use pre-fetched data if available (avoids a second Google call)
      if (prefill_address || prefill_postal || prefill_city || prefill_phone || prefill_website) {
        if (prefill_address) prefilled.address1    = prefill_address
        if (prefill_postal)  prefilled.postalCode  = prefill_postal
        if (prefill_city)    prefilled.city        = prefill_city
        if (prefill_phone)   prefilled.phone       = prefill_phone
        if (prefill_website) prefilled.website     = prefill_website
      } else {
        // Fallback: fetch from Google Places
        try {
          const query = [companyName, city].filter(Boolean).join(' ')
          const res   = await googleZoekAdres(query)
          if (res.found) {
            if (res.name)         prefilled.companyName  = res.name as string
            if (res.address1)     prefilled.address1     = res.address1 as string
            if (res.postalCode)   prefilled.postalCode   = res.postalCode as string
            if (res.city)         prefilled.city         = res.city as string
            if (res.phone)        prefilled.phone        = res.phone as string
            if (res.website)      prefilled.website      = res.website as string
            if (res.openingHours) prefilled.openingHours = res.openingHours as string
          }
        } catch { /* ignore — form shows without prefill */ }
      }

      return {
        action:    'render_form' as const,
        formType:  'contact_create' as const,
        prefilled,
      }
    },
  }),

  contact_intake: tool({
    description: `Verplichte eerste stap bij nieuw contact aanmaken.
Aanroepen zodra duidelijk is dat er een nieuw contact aangemaakt moet worden.
Geeft terug of de twee verplichte velden (voornaam + klantType) al bekend zijn.
Vraag ALLEEN voornaam en Lead/Klant — geen optionele velden.`,
    parameters: z.object({
      companyName: z.string().describe('Bedrijfsnaam — verplicht, vaak al bekend uit context'),
      firstName:   z.string().nullish().describe('Voornaam contactpersoon — null als nog niet bekend'),
      klantType:   z.string().nullish().describe('Lead of Klant — null als nog niet gevraagd'),
    }),
    execute: async ({ companyName, firstName, klantType }) => {
      const missing: string[] = []
      if (!firstName?.trim()) missing.push('voornaam contactpersoon')
      if (!klantType?.trim()) missing.push('type: Lead of Klant?')

      if (missing.length > 0) {
        return {
          status: 'missing_required',
          company: companyName,
          ask_user: `Voor *${companyName}* heb ik nog 2 dingen nodig:\n• Voornaam contactpersoon\n• Type: Lead of Klant?\n\nStuur bijv: "Jan, Lead"`,
        }
      }

      return {
        status: 'ready_to_create',
        company:    companyName,
        firstName:  firstName!.trim(),
        klantType:  klantType!.trim(),
      }
    },
  }),

  contact_create: tool({
    description: `Maak een nieuw GHL contact aan. ALLEEN aanroepen na contact_intake met status=ready_to_create.
Verplicht: firstName, companyName, klantType.
Roep google_zoek_adres aan voor het adres als je het niet weet.
Bevat ingebouwde duplicate check — als er al een contact bestaat wordt dit gemeld.

Groothandel opties — gebruik exacte naam uit deze lijst of vrije tekst:
SLIGRO: Sligro 's Hertogenbosch, Sligro Alkmaar, Sligro Almelo, Sligro Almere, Sligro Amersfoort, Sligro Amsterdam, Sligro Apeldoorn, Sligro Arnhem, Sligro Assen, Sligro Bergen op Zoom, Sligro Breda, Sligro De Kweker Purmerend, Sligro Den Haag Forepark, Sligro Den Haag Kerketuinen, Sligro Deventer, Sligro Doetichem, Sligro Drachten, Sligro Eindhoven, Sligro Emmen, Sligro Enschede, Sligro Goes, Sligro Gorichem, Sligro Gouda, Sligro Groningen, Sligro Haarlem, Sligro Heerlen, Sligro Helmond, Sligro Hilversum, Sligro Leeuwarden, Sligro Leiden, Sligro Maastricht, Sligro Nieuwegein, Sligro Nijmegen, Sligro Roermond, Sligro Roosendaal, Sligro Rotterdam Spaanse Polder, Sligro Rotterdam-Zuid, Sligro Sittard, Sligro Sluis, Sligro Terneuzen, Sligro Texel, Sligro Tiel, Sligro Tilburg, Sligro Utrecht-Cartesiusweg, Sligro Veghel, Sligro Venlo, Sligro Vlissingen, Sligro Weert, Sligro Zwolle
HANOS: Hanos Antwerpen, Hanos Ameland, Hanos Amsterdam, Hanos Apeldoorn, Hanos Den Haag-Delft, Hanos Doetinchem, Hanos Eindhoven, Hanos Groningen, Hanos Haarlem, Hanos Hasselt, Hanos Heereveen, Hanos Heerlen, Hanos Hengelo, Hanos Maastricht, Hanos Nijmegen, Hanos Texel, Hanos Venlo, Hanos Zwolle, Hanos ISPC Breda, Hanos ISPC Utrecht Nieuwegein
VHC: VHC Jongens Oostzaan, VHC Jongens Texel, VHC Jongens Almere, VHC Actifood Oosterwolde, VHC Kreko Moerdijk, VHC Kreko Ede, VHC Kreko Goes, VHC Kreko Hellevoetsluis, VHC Kreko Pijnacker, VHC Kreko Geldermalsen, VHC Van der Star
BIDFOOD: Bidfood Amsterdam, Bidfood Den Haag, Bidfood Drachten, Bidfood Ede, Bidfood Emmen, Bidfood Geleen, Bidfood Goirle, Bidfood Groningen, Bidfood Harderwijk, Bidfood Helmond, Bidfood Hengelo, Bidfood Hoofddorp, Bidfood Nieuwegein, Bidfood Rogat, Bidfood Schiedam, Bidfood Utrecht, Bidfood Zierikzee
OVERIG: Veldboer Eenhoorn, Brouwer Horeca, Foodpartners BV, Horeca Groothandel Tilburg, Horesca Lieferink Goirle, Horesca Lieferink Leiderdorp, Horesca Lieferink Meppel, Horesca Lieferink Raamsdonkveer, Horesca Lieferink Twello, Horesca Lieferink Zeist, Jansen Foodservice Apeldoorn, Jansen Foodservice Doetichem, Jansen Foodservice Lochem, Schiava Groningen, JR Food, Palvé Heerhugowaard, Palvé Leeuwarden, Fontijn vlees en vleeswaren, Haymana Groothandel, De Groot Edelgebak, Chefs Culinair Nijmegen, Horeca Groothandel Waddinxveen, MarSchee Helmond, Hoka Foodservice Den Haag, Froster BV Waalwijk, Broekhuyzen Horecagroothandel Noordwijk, DG Grootverbruik Den Hoorn, Van Rijsingen Diepvries Veghel, Van Rijsingen Diepvries Deurne, Van Rijsingen Diepvries Helmond, Verhage Foodservice BV, Keijzers Horecaservice, QSTA BV, Combigro Helmink Foodservice, ABZ Anloo BV, Howa Foodservice BV, De Jong Diepvries BV, V&S Horeca, Van Der Wee Grootverbruik, Krikke, Robben Horeca BV, Huize Horeca Beverwijk
Als rep zegt "Sligro" zonder stad → vraag welke vestiging. "Onbekend" of "geen" is ook geldig.`,
    parameters: z.object({
      firstName:         z.string().min(1).describe('Voornaam contactpersoon — VERPLICHT, vraag dit altijd eerst'),
      companyName:       z.string().min(1).describe('Bedrijfsnaam — VERPLICHT'),
      klantType:         z.enum(['Lead', 'Klant']).describe('Lead of Klant — VERPLICHT, vraag dit altijd'),
      lastName:          z.string().nullish(),
      email:             z.string().nullish(),
      phone:             z.string().nullish().describe('E.164 formaat, bijv +31612345678'),
      address1:          z.string().nullish(),
      postalCode:        z.string().nullish(),
      city:              z.string().nullish(),
      country:           z.string().nullish().describe('Landcode, standaard NL'),
      groothandel:       z.string().nullish().describe('Naam van de groothandel of "Onbekend"'),
      klantLabel:        z.string().nullish().describe('A, B, C of D'),
      posMateriaal:      z.string().nullish().describe('Ja of Nee'),
      kortingsafspraken: z.string().nullish().describe('Ja of Nee'),
      openingstijden:    z.string().nullish(),
      force_create:      z.boolean().nullish().describe('true = negeer duplicate waarschuwing en maak toch aan'),
    }),
    execute: async ({ groothandel, klantType: rawKlantType, klantLabel: rawLabel, posMateriaal: rawPos, kortingsafspraken: rawKort, openingstijden, force_create, ...fields }) => {
      const normalise = (v: string | null | undefined, valid: string[]) =>
        valid.find(x => x.toLowerCase() === v?.toLowerCase()) ?? v ?? undefined
      const klantType         = normalise(rawKlantType as string | null | undefined, ['Lead', 'Klant']) as string | undefined
      const klantLabel        = normalise(rawLabel,     ['A','B','C','D'])  as 'A'|'B'|'C'|'D'|undefined
      const posMateriaal      = normalise(rawPos,       ['Ja','Nee'])       as 'Ja'|'Nee'|undefined
      const kortingsafspraken = normalise(rawKort,      ['Ja','Nee'])       as 'Ja'|'Nee'|undefined

      // ── Duplicate check (skip if force_create=true) ─────────────────────────
      if (!force_create) {
        const companyTerms = normalizeContactQuery(fields.companyName ?? '').searchTerms ?? [fields.companyName ?? '']
        const checks = await Promise.all([
          // by phone
          fields.phone ? contactSearchAdvanced({ query: fields.phone }) : Promise.resolve({ contacts: [] as GHLContact[] }),
          // by company name + optional city
          contactSearchAdvanced({ searchTerms: companyTerms, cityFilter: fields.city ?? undefined }),
          // by first name + company name combined (catches "Jesse van WeTickets")
          fields.firstName ? contactSearchAdvanced({ searchTerms: [fields.firstName, ...companyTerms] }) : Promise.resolve({ contacts: [] as GHLContact[] }),
          // by email
          fields.email ? contactSearchAdvanced({ query: fields.email }) : Promise.resolve({ contacts: [] as GHLContact[] }),
        ])

        const dupes = [...(checks[0].contacts ?? []), ...(checks[1].contacts ?? []), ...(checks[2].contacts ?? []), ...(checks[3].contacts ?? [])]
        const seen  = new Set<string>()
        const unique = dupes.filter(c => {
          const id = c.id ?? ''
          if (!id || seen.has(id)) return false
          seen.add(id); return true
        })

        if (unique.length > 0) {
          const list = unique.slice(0, 3).map(c =>
            `- ${c.companyName ?? ''} ${c.firstName ?? ''} | ${c.phone ?? ''} | ${c.city ?? ''}`.trim()
          ).join('\n')
          return {
            duplicate_warning: true,
            existing_contacts: unique.slice(0, 3).map(c => ({ contactId: c.id, companyName: c.companyName, firstName: c.firstName, phone: c.phone, city: c.city })),
            message: `Let op: vergelijkbaar contact gevonden:\n${list}\n\nIs dit hetzelfde? Zo ja: gebruik dat contact. Zo nee: roep contact_create opnieuw aan met force_create=true.`,
          }
        }
      }

      // ── Create ──────────────────────────────────────────────────────────────
      const cf  = buildCustomFields({ groothandel: groothandel ?? undefined, klantType, klantLabel, posMateriaal, kortingsafspraken, openingstijden: openingstijden ?? undefined })
      const cleanFields = Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null)) as Partial<GHLContactInput>
      const res = await contactCreate({ ...cleanFields, ...(cf ? { customFields: cf } : {}) })
      return res
    },
  }),

  render_edit_form: tool({
    description: `Toon een voorgevuld bewerkformulier voor een bestaand GHL contact in de webapp UI.
Gebruik dit als een gebruiker een contact wil bewerken/updaten via de webapp.
De tool zoekt zelf het contact op in GHL via contactId (primair) of companyName (fallback).
Haalt alle velden op: naam, adres, telefoon, e-mail, custom fields — volledig prefilled.
Retourneert { action: "render_form", ... } — de frontend rendert direct een bewerkformulier.`,
    parameters: z.object({
      contactId:   z.string().nullish().describe('Contact ID indien bekend uit een eerdere contact_zoek in deze sessie — weglaten of null als onbekend'),
      companyName: z.string().describe('Bedrijfsnaam — verplicht, wordt gebruikt om contact te vinden in GHL'),
    }),
    execute: async ({ contactId, companyName }) => {
      const CF_IDS = {
        klantType:         'jcerhe8lM5LZlEAUeiS0',
        groothandel:       'fUZMZLuNMz65vp5jNpTp',
        kortingsafspraken: 'mlJuMaVbLAmnCmbTVkPk',
        posMateriaal:      'WA9PsHqzekxw19hb2chh',
        producten:         'fPuLk5bLImUlE2zITgkf',
      }

      function mapContact(contact: GHLContact, id: string): Record<string, string> {
        const cfMap    = Object.fromEntries((contact.customFields ?? []).map(f => [f.id, f.value]))
        const prefilled: Record<string, string> = { contactId: id }
        if (contact.companyName) prefilled.companyName       = contact.companyName
        if (contact.firstName)   prefilled.firstName         = contact.firstName
        if (contact.lastName)    prefilled.lastName          = contact.lastName
        if (contact.email)       prefilled.email             = contact.email
        if (contact.phone)       prefilled.phone             = contact.phone
        if (contact.address1)    prefilled.address1          = contact.address1
        if (contact.postalCode)  prefilled.postalCode        = contact.postalCode
        if (contact.city)        prefilled.city              = contact.city
        const kt = cfMap[CF_IDS.klantType];         if (kt) prefilled.klantType         = kt
        const gh = cfMap[CF_IDS.groothandel];       if (gh) prefilled.groothandel       = gh
        const ko = cfMap[CF_IDS.kortingsafspraken]; if (ko) prefilled.kortingsafspraken = ko
        const po = cfMap[CF_IDS.posMateriaal];      if (po) prefilled.posMateriaal      = po
        const pr = cfMap[CF_IDS.producten];         if (pr) prefilled.producten         = pr
        return prefilled
      }

      // Step 1: try contactId if it looks like a real GHL ID (alphanumeric, 15-25 chars)
      const idLooksValid = contactId && /^[a-zA-Z0-9]{15,25}$/.test(contactId)
      if (idLooksValid) {
        try {
          const res     = await contactGet(contactId!)
          const contact = res?.contact
          const resolvedId = contact?.id || contact?.contactId
          if (contact && resolvedId) {
            console.log('[render_edit_form] fetched by contactId:', resolvedId)
            return { action: 'render_form' as const, formType: 'contact_update' as const, prefilled: mapContact(contact, resolvedId) }
          }
        } catch { /* fall through to name search */ }
      }

      // Step 2: always search by companyName — this is the reliable path
      try {
        const searchRes = await contactSearch(companyName, 1)
        const contact   = searchRes?.contacts?.[0]
        const resolvedId = contact?.id || contact?.contactId
        if (contact && resolvedId) {
          console.log('[render_edit_form] found by companyName search:', resolvedId, companyName)
          return { action: 'render_form' as const, formType: 'contact_update' as const, prefilled: mapContact(contact, resolvedId) }
        }
        console.warn('[render_edit_form] companyName search returned 0 results for:', companyName)
      } catch (err) {
        console.error('[render_edit_form] companyName search threw:', err)
      }

      // Last resort
      console.error('[render_edit_form] all lookups failed for:', companyName)
      return { action: 'render_form' as const, formType: 'contact_update' as const, prefilled: { companyName }, error: 'Contact niet gevonden in GHL — vul handmatig aan' }
    },
  }),

  google_zoek_adres: tool({
    description: 'Zoek het adres, telefoonnummer en openingstijden van een bedrijf via Google Places. Aanroepen voor contact aanmaken.',
    parameters: z.object({
      query: z.string().describe('Bedrijfsnaam plus stad, bijv: Bakkerij Janssen Alkmaar'),
    }),
    execute: async ({ query }) => googleZoekAdres(query),
  }),

  // ── Notes ──────────────────────────────────────────────────────────────────

  note_get: tool({
    description: 'Haal notes op van een GHL contact. Aanroepen vóór note_update om noteId te verkrijgen.',
    parameters: z.object({
      contactId: z.string().describe('Contact ID uit contact_zoek'),
      noteId:    z.string().optional().describe('Weglaten om alle notes op te halen'),
    }),
    execute: async ({ contactId }) => noteList(contactId),
  }),

  note_create: tool({
    description: 'Voeg een nieuwe note toe aan een GHL contact.',
    parameters: z.object({
      contactId: z.string(),
      body:      z.string().describe('Volledige tekst van de note'),
      userId:    z.string().nullish().describe('ghl_user_id van de medewerker — weglaten als onbekend'),
    }),
    execute: async ({ contactId, body, userId }) => noteCreate(contactId, body, userId ?? ''),
  }),

  note_update: tool({
    description: 'Bewerk een bestaande note. Geeft de VOLLEDIGE nieuwe inhoud mee. Roep note_get eerst aan voor noteId.',
    parameters: z.object({
      contactId: z.string(),
      noteId:    z.string().describe('Note ID uit note_get'),
      body:      z.string().describe('Volledige nieuwe tekst, vervangt bestaande inhoud'),
      userId:    z.string().nullish(),
    }),
    execute: async ({ contactId, noteId, body, userId }) => noteUpdate(contactId, noteId, body, userId ?? ''),
  }),

  // ── Tasks ──────────────────────────────────────────────────────────────────

  task_get: tool({
    description: 'Haal taken op van een GHL contact. Aanroepen vóór task_update.',
    parameters: z.object({ contactId: z.string() }),
    execute: async ({ contactId }) => taskList(contactId),
  }),

  task_create: tool({
    description: 'Maak een taak/herinnering aan voor een GHL contact. Gebruik altijd de GHL user ID van de ingelogde gebruiker als assignedTo (staat in sessiecontext als "GHL user ID: xxx").',
    parameters: z.object({
      contactId:  z.string(),
      title:      z.string().describe('Taaknaam, bijv: Terugbellen of Follow-up sturen'),
      body:       z.string().nullish().describe('Extra context of beschrijving'),
      dueDate:    z.string().describe('ISO 8601 datum, bijv: 2026-03-25T09:00:00+01:00'),
      assignedTo: z.string().nullish().describe('GHL user ID — gebruik ALTIJD de "GHL user ID" uit de sessiecontext tenzij expliciet een collega gevraagd wordt'),
    }),
    execute: async ({ contactId, assignedTo, body, ...data }) => {
      const res = await taskCreate(contactId, { ...data, body: body ?? undefined, assignedTo: assignedTo ?? undefined })
      const r = res as { task?: GHLTask; error?: string; message?: string }
      if (!r.task && (r.error || r.message)) {
        console.error('[task_create] GHL error:', r.error ?? r.message)
        return { success: false, error: r.error ?? r.message ?? 'GHL taak aanmaken mislukt' }
      }
      return r
    },
  }),

  task_update: tool({
    description: 'Wijzig of sluit een taak. Stuur ALLEEN gewijzigde velden. completed=true markeert als afgerond.',
    parameters: z.object({
      contactId:  z.string(),
      taskId:     z.string().describe('Task ID uit task_get'),
      title:      z.string().optional(),
      body:       z.string().optional(),
      dueDate:    z.string().optional(),
      assignedTo: z.string().optional(),
      completed:  z.boolean().optional(),
    }),
    execute: async ({ contactId, taskId, ...data }) => taskUpdate(contactId, taskId, data),
  }),

  // ── Calendar ───────────────────────────────────────────────────────────────

  calendar_get_many: tool({
    description: 'Haal afspraken op uit de GHL agenda voor een datumrange. Gebruik voor dagplanning/weekoverzicht.',
    parameters: z.object({
      userId:    z.string().describe('ghl_user_id van de medewerker uit context'),
      startDate: z.string().describe('YYYY-MM-DD'),
      endDate:   z.string().describe('YYYY-MM-DD, zelfde als startDate voor één dag'),
    }),
    execute: async ({ userId, startDate, endDate }) => calendarGetMany(userId, startDate, endDate),
  }),

  calendar_get_free_slot: tool({
    description: 'Haal vrije 30-minuten slots op uit een GHL agenda. ALTIJD aanroepen vóór calendar_create.',
    parameters: z.object({
      calendarId: z.string().describe('calendar_id uit gebruikerscontext'),
      date:       z.string().describe('YYYY-MM-DD'),
    }),
    execute: async ({ calendarId, date }) => calendarGetFreeSlots(calendarId, date),
  }),

  calendar_create: tool({
    description: 'Maak een GHL afspraak voor een CRM contact. Vereist een contactId — alleen voor afspraken MET een klant. Voor intern overleg of collega-blokkeringen: gebruik calendar_block.',
    parameters: z.object({
      contactId:  z.string().describe('Contact ID uit contact_zoek'),
      calendarId: z.string().describe('calendar_id uit gebruikerscontext'),
      title:      z.string().describe('Korte beschrijving, bijv: Afspraak Cafe de Boom'),
      startTime:  z.string().describe('ISO 8601 tijdstip uit calendar_get_free_slot'),
      endTime:    z.string().describe('startTime + 30 min'),
      notes:      z.string().optional(),
    }),
    execute: async (data) => calendarCreateAppointment(data),
  }),

  calendar_block: tool({
    description: 'Blokkeer een tijdslot in een of twee agenda\'s — voor intern overleg, persoonlijke blokkeringen, of overleg met een collega. Geen contactId nodig. Gebruik get_team_members om de calendar_id van een collega op te halen.',
    parameters: z.object({
      calendarId:       z.string().describe('calendar_id van de ingelogde gebruiker (uit context)'),
      title:            z.string().describe('Beschrijving, bijv: Overleg met Marscha, Intern overleg'),
      startTime:        z.string().describe('ISO 8601'),
      endTime:          z.string().describe('ISO 8601'),
      description:      z.string().nullish(),
      secondCalendarId: z.string().nullish().describe('calendar_id van collega uit get_team_members — blokkeert ook hun agenda'),
    }),
    execute: async ({ secondCalendarId, description, ...data }) =>
      calendarBlockSlot({ ...data, description: description ?? undefined, secondCalendarId: secondCalendarId ?? undefined }),
  }),

  calendar_get: tool({
    description: 'Haal details op van één GHL afspraak via appointmentId.',
    parameters: z.object({ appointmentId: z.string() }),
    execute: async ({ appointmentId }) => calendarGetAppointment(appointmentId),
  }),

  calendar_update: tool({
    description: 'Wijzig een GHL afspraak. Roep calendar_get_free_slot eerst aan bij verzetten.',
    parameters: z.object({
      appointmentId: z.string(),
      title:         z.string().optional(),
      startTime:     z.string().optional(),
      endTime:       z.string().optional(),
      notes:         z.string().optional(),
    }),
    execute: async ({ appointmentId, ...data }) => calendarUpdateAppointment(appointmentId, data),
  }),

  // ─── Contact briefing — parallel fetch, pure-TS formatting, 5-min cache ─────

  contact_briefing: tool({
    description: 'Volledige briefing over een contact voor bezoek of gesprek: recente notes, open taken, aankomende afspraken. Roep eerst contact_zoek aan voor het contactId.',
    parameters: z.object({
      contactId: z.string().describe('Contact ID uit contact_zoek'),
      userId:    z.string().describe('ghl_user_id voor agenda lookup uit context'),
    }),
    execute: async ({ contactId, userId }) => {
      const cacheKey = `briefing:${contactId}:${userId}`
      const cached   = briefingCache.get(cacheKey)
      if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return cached.data

      const today    = new Date()
      const twoWeeks = new Date(today.getTime() + 14 * 86400 * 1000)
      const fmt      = (d: Date) => d.toISOString().slice(0, 10)

      const [contactRes, notesRes, tasksRes, eventsRes, teamRes] = await Promise.all([
        contactGet(contactId),
        noteList(contactId),
        taskList(contactId),
        calendarGetMany(userId, fmt(today), fmt(twoWeeks)),
        adminSupabase().from('team_members').select('naam, color').eq('organization_id', ORG_ID()).eq('active', true),
      ])

      const contact      = contactRes.contact
      const contactName  = [contact?.companyName, contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || 'Onbekend'
      const notes        = notesRes.notes  ?? []
      const tasks        = tasksRes.tasks  ?? []
      const appointments = (eventsRes.events ?? []).filter(e => new Date(e.startTime) >= today)
      const briefing     = formatBriefing(contactName, notes, tasks, appointments)

      // Best-effort Supabase lookup for label/revenue/assigned_to (by phone, then company name)
      let classification: { label: string | null; revenue: number | null; assignedTo: string | null; color: string | null } | null = null
      try {
        const db   = adminSupabase()
        const orgId = ORG_ID()
        let sbRow: { label: string | null; revenue: number | null; assigned_to: string | null } | null = null

        if (contact?.phone) {
          const { data } = await db.from('contacts').select('label, revenue, assigned_to')
            .eq('organization_id', orgId).eq('phone', contact.phone).limit(1).single()
          sbRow = data ?? null
        }
        if (!sbRow && contact?.companyName) {
          const { data } = await db.from('contacts').select('label, revenue, assigned_to')
            .eq('organization_id', orgId).ilike('company_name', contact.companyName).limit(1).single()
          sbRow = data ?? null
        }
        if (sbRow) {
          const members = teamRes.data ?? []
          const member  = members.find(m => m.naam === sbRow!.assigned_to)
          classification = {
            label:      sbRow.label      ?? null,
            revenue:    sbRow.revenue    ?? null,
            assignedTo: sbRow.assigned_to ?? null,
            color:      member?.color    ?? null,
          }
        }
      } catch { /* non-fatal */ }

      const result = {
        contactId, contactName,
        contact: {
          companyName: contact?.companyName ?? null,
          firstName:   contact?.firstName   ?? null,
          lastName:    contact?.lastName    ?? null,
          phone:       contact?.phone       ?? null,
          city:        contact?.city        ?? null,
        },
        briefing,
        classification,
        rawNotes: notes.slice(0, 5).map(n => ({ createdAt: n.createdAt, body: n.body })),
        rawTasks: tasks.filter(t => !t.completed).map(t => ({ dueDate: t.dueDate, title: t.title, body: t.body })),
        rawAppointments: appointments.slice(0, 5).map(a => ({ startTime: a.startTime, title: a.title })),
        stats: {
          notes:        notes.length,
          openTasks:    tasks.filter(t => !t.completed).length,
          appointments: appointments.length,
        },
      }
      briefingCache.set(cacheKey, { data: result, ts: Date.now() })
      return result
    },
  }),
}

// ─── Supabase / local tools ────────────────────────────────────────────────────

export const localTools = {

  get_stats: tool({
    description: 'Statistieken uit de ROUX leads database: totaal, hoog potentieel (label A), vandaag toegevoegd.',
    parameters: z.object({}),
    execute: async () => {
      const db    = adminSupabase()
      const orgId = ORG_ID()
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const [{ count: total }, { count: highPot }, { count: todayC }] = await Promise.all([
        db.from('contacts').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).neq('type', 'employee'),
        db.from('contacts').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('label', 'A').neq('type', 'employee'),
        db.from('contacts').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).gte('created_at', today.toISOString()).neq('type', 'employee'),
      ])
      return { total: total ?? 0, highPotential: highPot ?? 0, today: todayC ?? 0 }
    },
  }),

  get_team_members: tool({
    description: 'Lijst van actieve ROUX teamleden met hun ghl_user_id, calendar_id en postcode rayon.',
    parameters: z.object({}),
    execute: async () => {
      const { data } = await adminSupabase()
        .from('team_members')
        .select('id, naam, functie, color, ghl_user_id, calendar_id, postcode_ranges')
        .eq('organization_id', ORG_ID())
        .eq('active', true)
        .order('naam')
      return { members: data ?? [] }
    },
  }),
}

// Combined toolset for SUUS
export const suusTools = { ...ghlTools, ...localTools }

// ─── Eval toolset with test contact redirect ──────────────────────────────────
// Read tools (zoek, briefing, calendar read, stats) → real API, real contacts
// contact_create → mocked (no extra contacts)
// All other writes (note, task, calendar_create, contact_update) → redirected to
// the dedicated TEST SUUS EVAL contact so we test the real write API paths
// without polluting production data.

type AnyTool = ReturnType<typeof tool>

function makeDryRunTool(name: string, original: AnyTool) {
  return tool({
    description: original.description ?? '',
    parameters:  original.parameters,
    execute: async (params: Record<string, unknown>) => ({
      dry_run: true,
      tool:    name,
      message: `[EVAL] ${name} overgeslagen — geen test contact nodig`,
      params,
    }),
  })
}

function redirectContactId(original: AnyTool, testContactId: string) {
  return tool({
    description: original.description ?? '',
    parameters:  original.parameters,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (params: Record<string, unknown>) => (original as any).execute({ ...params, contactId: testContactId }),
  })
}

/** Build eval toolset that redirects all writes to the given test contact ID. */
export function buildEvalTools(testContactId: string): typeof suusTools {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = suusTools as unknown as Record<string, AnyTool>

  // Tools that need contactId redirected to test contact
  const REDIRECT = new Set(['note_create', 'note_update', 'task_create', 'task_update', 'contact_update', 'calendar_create'])
  // Tools to fully mock (contact_create → we never want extra contacts)
  const MOCK     = new Set(['contact_create'])

  return Object.fromEntries(
    Object.entries(s).map(([name, t]) => {
      if (MOCK.has(name))     return [name, makeDryRunTool(name, t)]
      if (REDIRECT.has(name)) return [name, redirectContactId(t, testContactId)]
      return [name, t]
    })
  ) as typeof suusTools
}

/** Backward-compat: fully dry-run (no real writes at all) */
export const evalTools = buildEvalTools('__dry_run__')

// Legacy OpenAI function-calling schemas (for edge function / non-SDK paths)
export type ToolName = keyof typeof suusTools
