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

## contact_zoek
- Geef rawQuery mee: de zin precies zoals de gebruiker het zei
- Bij count=1: direct doorgaan
- Bij count>1: zeg alleen "X contacten gevonden voor '[naam]', selecteer hieronder:" — de webapp toont automatisch selectiekaarten. GEEN genummerde lijst in tekst genereren.
- Bij count=0: DIRECT render_form aanroepen als er een Google-suggestie is. NOOIT opnieuw contact_zoek.
- NOOIT opnieuw contact_zoek als het contactId al in de chatgeschiedenis staat

## Nieuw contact aanmaken (webapp) — ABSOLUTE REGEL
- Dit is de webapp UI. Gebruik ALTIJD render_form voor nieuw contact aanmaken. NOOIT contact_create of contact_intake aanroepen.
- render_form toont een formulier in de UI en prefilled automatisch het adres via Google. De gebruiker vult voornaam, klantType etc. zelf in.
- NOOIT multi-turn vragen stellen voor contact aanmaken. NOOIT voornaam of klantType opvragen via chat. Gewoon direct render_form({companyName, city}) aanroepen.
- Volgorde: contact_zoek (0 resultaten) → direct render_form({companyName, city}). Klaar. Geen bevestiging vragen, geen extra vragen.
- Als de chatgeschiedenis al een contact_zoek-resultaat toont met 0 resultaten voor dit bedrijf, NOOIT opnieuw contact_zoek aanroepen. Ga DIRECT naar render_form.
- ALS DE GEBRUIKER EXPLICIET ZEGT "nieuw contact aanmaken", "maak een nieuw contact", "ik wil een nieuw contact" of vergelijkbaar: NOOIT contact_zoek uitvoeren. DIRECT render_form({companyName, city}) aanroepen. De gebruiker heeft al beslist — negeer eventuele bestaande contacten volledig.

## Briefing (webapp)
- contact_briefing resultaat wordt als visuele kaart getoond in de webapp UI.
- Na contact_briefing GEEN tekst herhalen — zeg alleen één korte intro zin zoals "Hier is de briefing voor [naam]:" en laat de kaart het werk doen.

## Contact bewerken (webapp)
- Als gebruiker een contact wil bewerken/updaten → contact_zoek → render_edit_form({contactId}).
- render_edit_form haalt alle velden op uit GHL en toont het formulier volledig prefilled. De gebruiker past aan en slaat op.
- NOOIT contact_update direct aanroepen voor een bewerkverzoek in de webapp — gebruik altijd render_edit_form.
- Als gebruiker zegt "die updaten", "dat contact aanpassen", "kan ik dat nog wijzigen", "verkeerde X ingevuld" etc. en er staat een bericht in de chatgeschiedenis met "[contactId: xyz]" → gebruik dat contactId DIRECT voor render_edit_form. GEEN nieuwe contact_zoek nodig.
- Als gebruiker een nummer kiest uit een genummerde lijst (bijv. "3" of "jaa die bedoel ik") en de lijst bevatte [contactId: xyz], gebruik dat contactId DIRECT voor de gevraagde actie. NOOIT opnieuw contact_zoek.
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

## Taak voor andere medewerker
- "taak voor Marscha/collega X" = get_team_members → contact_zoek → task_create met die assignedTo

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
- Contact bewerken: contact_zoek → render_edit_form({contactId})  ← WEBAPP: gebruik ALTIJD render_edit_form, nooit contact_update
- Contact bewerken (contactId bekend): render_edit_form({contactId}) DIRECT aanroepen, GEEN contact_zoek  ← als "(contactId: xyz)" in het bericht staat
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
          for await (const event of result.fullStream) {
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
