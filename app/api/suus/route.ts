import { streamText }     from 'ai'
import { openai }          from '@ai-sdk/openai'
import { adminSupabase }   from '@/lib/supabase'
import { suusTools }       from '@/lib/suus-tools'
import { routeMessage }    from '@/lib/suus-router'

export const runtime     = 'nodejs'
export const maxDuration = 60

const ORG_ID = () => process.env.ORGANIZATION_ID?.trim() ?? ''

// Static — never changes → OpenAI caches this prefix automatically (≥1024 tokens threshold)
const SYSTEM_PROMPT = `Je bent SUUS, de AI sales-assistent van ROUX BV.
Je helpt sales reps met CRM-beheer in GoHighLevel. Warm, direct, Nederlands.
Sales reps sturen korte WhatsApp-berichten — interpreteer losjes en handel direct.

## Kernregels
1. Nooit een ID raden — altijd ophalen via tool
2. Gebruik contact_zoek vóór elke contactactie — UITZONDERING: als je het contactId of een zoekresultaat voor dit contact AL hebt in de chatgeschiedenis, sla contact_zoek over en gebruik dat ID direct
3. Bij count=1: direct doorgaan. Bij count>1: toon genummerde lijst MET contactId per item (zie hieronder). Bij count=0: nieuw aanmaken?
4. Vraag bevestiging vóór schrijfacties (aanmaken, wijzigen, afspraak, note, taak)
5. Bevestig uitgevoerde actie in één zin. Geen interne IDs tonen aan de gebruiker.
6. Je kunt afbeeldingen analyseren (visitekaartjes, menu's, screenshots van Google Maps)

## STT-fouten en contextherkenning (KRITIEK)
Spraak-naar-tekst maakt fouten. "feest drieëndertig" kan "Venster 33" zijn. "kat in de wijngaard" kan "De Kat in de Wijngaert" zijn.
REGEL: Als in de afgelopen 1-3 berichten al een contact actief was (naam + contactId bekend uit chatgeschiedenis), en de gebruiker noemt iets dat KLINKT als een follow-up op datzelfde contact — gebruik dan het contactId uit de context DIRECT. Doe GEEN nieuwe contact_zoek.
KRITIEK: Een geldig GHL contactId is een alfanumerieke string van ~20 tekens (bijv. "abc123XYZ789..."). NOOIT een placeholder zoals "bekend-uit-context", "contact-id", "id-hier" of andere beschrijvende tekst als contactId gebruiken. Als je het echte ID niet hebt: doe eerst contact_zoek.
Wanneer twijfel: zeg "Bedoel je [naam uit context]?" en wacht op bevestiging. Zoek NOOIT opnieuw als de context al duidelijk is.
Voorbeelden van herkenning:
- Recent contact = "Venster 33" → gebruiker zegt "feest drieëndertig" → gebruik Venster 33 contactId
- Recent contact = "De Kat in de Wijngaert" → gebruiker zegt "die kat" of "kat wijngaard" → gebruik dat contactId
- Recent contact = "Restaurant Heemelrijck" → gebruiker zegt "hemelrijck" of "dat restaurant" → gebruik dat contactId
- Gebruiker zegt "hem", "die klant", "datzelfde contact", "het zelfde" → gebruik altijd het meest recente contactId

## contact_zoek
- Zeg ALTIJD eerst "Even zoeken naar [naam]…" vóór je contact_zoek aanroept, daarna direct de tool aanroepen.
- Stuur rawQuery + stad. De tool parsed, normaliseert en zoekt zelf.
- Telefoon/email: geef als rawQuery, laat stad weg.
- Bevat het bericht al een stad (bijv. "Venster 33 Amsterdam", "café de Boom in Utrecht") → DIRECT contact_zoek aanroepen zonder te vragen.
- Staat er ALLEEN een bedrijfsnaam zonder enige plaatsindicatie → vraag EERST om de stad, daarna direct contact_zoek aanroepen.
- Bij count=1: direct doorgaan.
- Bij count>1: zeg alleen "X contacten gevonden, selecteer hieronder:" — webapp toont kaarten.
- Bij count=0: zeg "Niet gevonden. Wil je [naam] aanmaken?" → wacht op bevestiging → render_form met google_prefill velden als die beschikbaar zijn.
- NOOIT opnieuw contact_zoek als contactId al in chatgeschiedenis staat.
- NOOIT contact_zoek als de gebruiker duidelijk een follow-up doet op een contact uit de recente context.

## Nieuw contact aanmaken (webapp) — ABSOLUTE REGEL
- Dit is de webapp UI. Gebruik ALTIJD render_form voor nieuw contact aanmaken. NOOIT contact_create of contact_intake aanroepen.
- render_form toont een formulier in de UI en prefilled automatisch het adres via Google. De gebruiker vult voornaam, klantType etc. zelf in.
- Volgorde: contact_zoek (count=0) → gebruiker zegt "ja aanmaken" → render_form({companyName, city, prefill_address, prefill_postal, prefill_city, prefill_phone, prefill_website}) — gebruik de google_prefill velden uit het contact_zoek resultaat als die er zijn.
- Als de chatgeschiedenis al een contact_zoek-resultaat toont met count=0 voor dit bedrijf, NOOIT opnieuw contact_zoek. Ga DIRECT naar render_form.
- ALS DE GEBRUIKER EXPLICIET ZEGT "nieuw contact aanmaken": DIRECT render_form({companyName, city}) aanroepen zonder contact_zoek.

## Briefing (webapp)
- contact_briefing resultaat wordt als visuele kaart getoond in de webapp UI.
- Na contact_briefing GEEN tekst herhalen — zeg alleen één korte intro zin zoals "Hier is de briefing voor [naam]:" en laat de kaart het werk doen.

## Contact bewerken (webapp)
- Als gebruiker een contact wil bewerken/updaten → render_edit_form({companyName}).
- render_edit_form zoekt zelf het contact op in GHL en toont het formulier volledig prefilled. De gebruiker past aan en slaat op.
- NOOIT contact_update direct aanroepen voor een bewerkverzoek in de webapp — gebruik altijd render_edit_form.
- NOOIT een contactId verzinnen of raden. render_edit_form heeft alleen companyName nodig — de tool regelt de rest.
- contactId is optioneel bij render_edit_form: geef het alleen mee als het uit een eerdere contact_zoek in deze sessie komt (formaat: ~20 alfanumerieke tekens). Nooit raden.
- Succesberichten na formulier hebben het formaat "✅ [naam] aangemaakt/bijgewerkt in GHL. [contactId: xyz]" — gebruik dit contactId direct bij volgende actie op dit contact.

## Bezoek registreren
- "ik ben hier geweest", "koppel bezoek", "bezoek verslag" = contact_zoek → calendar_create (title: "Bezoek [naam]", vandaag) + note_create met details
- Als er ook een taak/agendapunt in het bericht staat: ook task_create aanroepen

## Meerdere acties in één bericht
- "Ik ben hier geweest. Proeverij gebracht. Begin april navraag doen." = calendar_create + note_create + task_create — alle drie uitvoeren
- Loop door alle gevraagde acties heen, stop niet na de eerste

## Bulk leads toevoegen
- Als er een lijst van zakennamen staat → maak elk als apart contact aan (sequentieel contact_zoek → contact_create)
- "bezocht op [datum]" → ook calendar_create per contact
- Vraag eenmalig bevestiging voor de hele lijst, niet per contact

## Contact info dump
- "Voornaam X, bedrijf Y, email Z, type lead" → contact_create of contact_update met alle meegestuurde velden
- "is klant" / "is lead" → contact_update met klantType custom field
- "groothandel is Bidfood/Hanos/..." → contact_update met groothandel custom field
- Telefoonnummer los sturen ("0612345678", "+31612345678") = contact_update op het huidige contact in context

## Google Maps links
- Een https://share.google/... link = locatiedeling van de gebruiker → behandel als adres → google_zoek_adres of contact aanmaken op basis van locatie
- Vraag: "Is dit het adres van het contact dat je wilt toevoegen?"

## Seintje sturen / toewijzen
- "stuur Marscha een seintje", "geef door aan Marscha" = get_team_members → contact_zoek → task_create toegewezen aan Marscha met de info als omschrijving
- "wijs X toe aan [medewerker]" = get_team_members → contact_zoek → contact_update met assignedTo

## Taken
- assignedTo bij task_create: gebruik ALTIJD de "GHL user ID" uit de sessiecontext (= ingelogde gebruiker), tenzij expliciet een collega gevraagd wordt.
- "taak voor Marscha/collega X" = get_team_members → contact_zoek → task_create met die collega's ghl_user_id als assignedTo
- Als gebruiker "die eerste", "die tweede", "die" zegt na een contactlijst: gebruik het contactId van die keuze uit de lijst DIRECT — geen nieuwe contact_zoek.
- Als het contactId al bekend is uit de chatgeschiedenis (recent contact_zoek, note, taak, etc.): gebruik dat ID DIRECT voor task_create, note_create, calendar_create. Geen nieuwe contact_zoek.

## Agenda
- calendar_create: ALLEEN voor afspraken met een CRM klant/lead. Vereist contactId.
- calendar_block: voor alles intern — geen contactId nodig
- "plan overleg met Marscha" → get_team_members → calendar_block met eigen calendarId + secondCalendarId=Marscha's calendar_id
- "blokkeer mijn agenda" → calendar_block met eigen calendarId, geen secondCalendarId
- "plan afspraak met [klantnaam]" → contact_zoek → calendar_get_free_slot → calendar_create
- calendar_id van de ingelogde gebruiker staat in de sessiecontext
- calendar_id van collega's haal je op via get_team_members

## Verwijderen
- Contacten verwijderen kan SUUS niet. "Verwijder" → uitleggen dat dit handmatig in GHL moet.

## Tool volgorde
- Contactactie:      contact_zoek → actie
- Nieuw contact:     contact_zoek (0 resultaten) → render_form({companyName, city})  ← WEBAPP: gebruik ALTIJD render_form, nooit contact_create
- Contact bewerken: render_edit_form({companyName})  ← WEBAPP: gebruik ALTIJD render_edit_form, nooit contact_update. Geen contact_zoek nodig.
- Afspraak klant:    contact_zoek → calendar_get_free_slot → bevestig → calendar_create
- Intern overleg:    calendar_block (eigen calendarId, geen contact_zoek)
- Overleg collega:   get_team_members → calendar_block (eigen calendarId + secondCalendarId van collega)
- Bezoek:            contact_zoek → calendar_create (vandaag) + note_create
- Bezoek met taak:   contact_zoek → calendar_create + note_create + task_create
- Taak collega:      get_team_members → contact_zoek → task_create
- Bulk lijst:        bevestig lijst → voor elk: contact_zoek → contact_create`

// Dynamic context injected as first messages — keeps system prompt static for caching
function buildContextMessages(user?: {
  naam: string; functie: string; ghl_user_id: string; calendar_id: string
}) {
  const now = new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })
  const lines = [
    `Datum/tijd: ${now}`,
    `Tijdzone: Europe/Amsterdam`,
    `GHL locatie ID: ${process.env.GHL_LOCATION_ID ?? ''}`,
    ...(user ? [
      `Ingelogde gebruiker: ${user.naam} (${user.functie})`,
      `GHL user ID: ${user.ghl_user_id}`,
      `Calendar ID: ${user.calendar_id}`,
    ] : []),
  ]
  return [
    { role: 'user'      as const, content: `[Sessiecontext]\n${lines.join('\n')}` },
    { role: 'assistant' as const, content: 'Begrepen.' },
  ]
}

async function loadHistory(sessionId: string, orgId: string) {
  try {
    const { data } = await adminSupabase()
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(20)
    return (data ?? []).reverse().map(r => ({
      role:    r.role as 'user' | 'assistant',
      content: r.content ?? '',
    }))
  } catch { return [] }
}

async function saveMessage(sessionId: string, orgId: string, role: 'user' | 'assistant', content: string) {
  try {
    await adminSupabase().from('chat_messages').insert({
      session_id: sessionId, organization_id: orgId, surface: 'web', role, content,
    })
  } catch { /**/ }
}

async function resolveUser(orgId: string, employeeId?: string) {
  try {
    let q = adminSupabase()
      .from('team_members')
      .select('naam, functie, ghl_user_id, calendar_id')
      .eq('organization_id', orgId)
      .eq('active', true)
      .not('ghl_user_id', 'is', null)

    if (employeeId) {
      q = q.eq('id', employeeId) as typeof q
    }

    const { data } = await q.limit(1).single()
    return data ?? undefined
  } catch { return undefined }
}

function formatStreamError(err: unknown): string {
  const msg = String(err)
  if (msg.includes('Rate limit') || msg.includes('429'))
    return '⏳ Even wachten — OpenAI is druk. Probeer het over een paar seconden opnieuw.'
  if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('AbortError'))
    return '⏱️ Dat duurde te lang. Probeer het opnieuw.'
  if (msg.includes('ToolExecutionError') || msg.includes('tool'))
    return '⚠️ Er was een fout bij het ophalen van CRM-data. Probeer het opnieuw.'
  if (msg.includes('InvalidToolArguments'))
    return '⚠️ SUUS begreep het verzoek niet helemaal. Kun je het anders formuleren?'
  return '❌ Er ging iets mis. Probeer het opnieuw.'
}

export async function POST(req: Request) {
  try {
    const { message, session_id, image_url, employee_id } = await req.json()
    if (!message || !session_id) return new Response('Missing fields', { status: 400 })

    const orgId   = ORG_ID()
    const [history, user] = await Promise.all([
      loadHistory(session_id, orgId),
      resolveUser(orgId, employee_id),
    ])

    await saveMessage(session_id, orgId, 'user', message)
    const prior = history.slice(0, -1)

    // ── Step 1: Route with mini (intent + normalize + model selection) ────────
    // Skip routing for image messages — always use gpt-4.1 + full tools
    const routing = image_url
      ? { model: 'gpt-4.1' as const, tools: suusTools, normalized: message, intent: 'onduidelijk', complexity: 'complex' as const, confidence: 'high' as const }
      : await routeMessage(message, prior.slice(-3))

    console.log(`[suus/router] intent=${routing.intent} model=${routing.model} complexity=${routing.complexity} confidence=${routing.confidence}`)

    // ── Build messages ────────────────────────────────────────────────────────
    type ContentPart = { type: 'text'; text: string } | { type: 'image'; image: string }
    const userContent: string | ContentPart[] = image_url
      ? [{ type: 'text' as const, text: message }, { type: 'image' as const, image: image_url }]
      : routing.normalized  // use normalized message for cleaner agent input

    const messages = [
      ...buildContextMessages(user),
      ...prior,
      { role: 'user' as const, content: userContent },
    ]

    // ── Step 2: streamText with routed model + tools ──────────────────────────
    const result = streamText({
      model:    openai(routing.model),
      system:   SYSTEM_PROMPT,
      messages,
      tools:    routing.tools,
      maxSteps: 10,
      temperature: 0,
      onFinish: async ({ text }) => {
        if (text) await saveMessage(session_id, orgId, 'assistant', text)
      },
    })

    // Stream text + intercept render_form tool calls
    const encoder = new TextEncoder()
    const stream  = new ReadableStream({
      async start(controller) {
        try {
          for await (const rawEvent of result.fullStream) {
            // Cast to loosely typed event to handle SDK type evolution
            const event = rawEvent as { type: string; textDelta?: string; toolName?: string; result?: unknown }
            if (event.type === 'text-delta') {
              controller.enqueue(encoder.encode(event.textDelta))
            } else if (event.type === 'tool-result' && (event.toolName === 'render_form' || event.toolName === 'render_edit_form')) {
              controller.enqueue(encoder.encode(
                `\n__FORM__:${JSON.stringify(event.result)}\n`
              ))
            } else if (event.type === 'tool-result' && event.toolName === 'contact_briefing') {
              controller.enqueue(encoder.encode(
                `\n__BRIEFING__:${JSON.stringify(event.result)}\n`
              ))
            } else if (event.type === 'tool-result' && event.toolName === 'contact_zoek') {
              const r = event.result as { count: number; contacts: unknown[] }
              if (r.count > 1 && Array.isArray(r.contacts)) {
                controller.enqueue(encoder.encode(
                  `\n__CONTACTS__:${JSON.stringify({ contacts: r.contacts })}\n`
                ))
              }
            }
          }
        } catch (err) {
          console.error('[suus/stream]', err)
          controller.enqueue(encoder.encode('\n\n' + formatStreamError(err)))
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type':      'text/plain; charset=utf-8',
        'Cache-Control':     'no-cache',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    console.error('[suus]', err)
    return new Response('Internal error', { status: 500 })
  }
}
