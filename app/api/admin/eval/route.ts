/**
 * SUUS Eval — streaming SSE endpoint
 *
 * 1. Fetch real WhatsApp messages from Twilio (inbound from reps)
 * 2. Fetch Retell call transcripts (user utterances)
 * 3. GPT-4.1 clusters into ~20 unique test intents
 * 4. Run each intent through SUUS generateText with full toolset
 * 5. Assess: right tool called? GHL returned success?
 * 6. Stream results back as SSE
 */

import { generateText, generateObject } from 'ai'
import { openai }                        from '@ai-sdk/openai'
import { z }                             from 'zod'
import Retell                            from 'retell-sdk'
import twilio                            from 'twilio'
import { buildEvalTools }                from '@/lib/suus-tools'
import { upsertEvalTestContact }         from '@/lib/ghl-client'

export const runtime     = 'nodejs'
export const maxDuration = 300 // 5 min for full eval

const GHL_LOC = () => process.env.GHL_LOCATION_ID ?? ''

// ─── SSE helpers ──────────────────────────────────────────────────────────────

function sseEvent(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`
}

// ─── Fetch Twilio WhatsApp logs ───────────────────────────────────────────────

async function fetchTwilioMessages(limit = 200, since?: Date): Promise<string[]> {
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from  = process.env.TWILIO_WHATSAPP_FROM?.replace('whatsapp:', '')
  if (!sid || !token || !from) return []

  try {
    const client = twilio(sid, token)
    const messages = await client.messages.list({
      to:          `whatsapp:${from}`,
      limit,
      dateSentAfter: since,
    })
    return messages
      .filter(m => m.body && m.body.trim().length > 3)
      .map(m => m.body.trim())
  } catch (err) {
    console.warn('[eval/twilio]', err)
    return []
  }
}

// ─── Fetch Retell call transcripts ───────────────────────────────────────────

async function fetchRetellTranscripts(limit = 50, since?: Date): Promise<string[]> {
  const key = process.env.RETELL_API_KEY
  if (!key) return []

  try {
    const client = new Retell({ apiKey: key })
    const calls  = await client.call.list({ limit })

    const sinceMs = since?.getTime() ?? 0
    const utterances: string[] = []
    for (const call of calls) {
      // Filter by start_timestamp if since is provided
      const ts = (call as { start_timestamp?: number }).start_timestamp ?? 0
      if (sinceMs && ts < sinceMs) continue

      const transcript = (call as { transcript?: { role: string; content: string }[] }).transcript ?? []
      for (const turn of transcript) {
        if (turn.role === 'user' && turn.content?.trim().length > 3) {
          utterances.push(turn.content.trim())
        }
      }
    }
    return utterances
  } catch (err) {
    console.warn('[eval/retell]', err)
    return []
  }
}

// ─── Normalize raw messages to standalone CRM commands ───────────────────────
// Translates vague sales rep shorthand ("Voeg toe", "Maak aan") into complete,
// standalone actionable instructions that SUUS can execute without context.
// Uses gpt-4o-mini in a single batch call to stay within rate limits.

async function normalizeMessages(messages: string[]): Promise<string[]> {
  if (!messages.length) return messages
  try {
    const { object } = await generateObject({
      model:  openai('gpt-4o-mini'),
      system: `Je bent een CRM-vertaler. Je krijgt berichten van sales reps en vertaalt ze naar volledige, zelfstandige CRM-opdrachten in het Nederlands.
Regels:
- Elk bericht moet ZELFSTANDIG begrijpelijk zijn zonder gesprekscontext
- Voeg een contactnaam toe als die ontbreekt (gebruik de naam die in het bericht staat, of "het contact")
- Vertaal vage termen: "voeg toe" → "voeg X toe als GHL contact", "maak aan" → "maak nieuw contact aan voor X", "noteer" → "voeg note toe aan X", "taak" → "maak taak aan voor X"
- Bezoek/aanwezig → "registreer bezoek bij X vandaag"
- Behoud alle concrete info (naam, adres, telefoon, stad) die er al in staat
- Als het bericht al volledig en duidelijk is, laat het dan zo`,
      prompt: `Normaliseer deze ${messages.length} berichten:\n${messages.map((m, i) => `${i + 1}. ${m}`).join('\n')}`,
      schema: z.object({
        normalized: z.array(z.string()).describe('Genormaliseerde versies in dezelfde volgorde'),
      }),
    })
    // Fallback: if lengths don't match, return originals
    if (object.normalized.length !== messages.length) return messages
    return object.normalized
  } catch {
    return messages // on error, pass through unchanged
  }
}

// ─── Cluster into unique test intents ────────────────────────────────────────

async function clusterIntents(messages: string[]): Promise<{ intent: string; example: string; category: string }[]> {
  if (!messages.length) {
    // Fallback: concrete actionable test cases — all include a contact name so tools get called
    return [
      { intent: 'Zoek contact op naam',                  example: 'zoek café de boom',                                                          category: 'contact_zoek' },
      { intent: 'Vage contactnaam — fuzzy',              example: 'die vent van dat cafeetje in alkmaar gisteren',                              category: 'contact_zoek' },
      { intent: 'Briefing over contact',                 example: 'geef me een briefing over café de boom',                                     category: 'contact_briefing' },
      { intent: 'Bezoek registreren (afspraak)',         example: 'ik ben vandaag bij café de boom geweest, kun je dat registreren',            category: 'calendar_create' },
      { intent: 'Bezoekverslag als note',                example: 'voeg bezoekverslag toe aan café de boom: interesse in pils pakket, spraken de eigenaar', category: 'note_create' },
      { intent: 'Taak aanmaken voor contact',            example: 'maak een follow-up taak voor café de boom voor volgende week dinsdag',       category: 'task_create' },
      { intent: 'Afspraak plannen',                      example: 'plan een afspraak met café de boom morgen om 10 uur',                        category: 'calendar_create' },
      { intent: 'Nieuw contact aanmaken',                example: 'maak nieuw contact aan: bakkerij janssen, galileistraat 19 alkmaar, 06-12345678', category: 'contact_create' },
      { intent: 'Contactpersoon toevoegen',              example: 'voeg contactpersoon Jan de Vries toe aan café de boom, 06-87654321',         category: 'contact_create' },
      { intent: 'Telefoonnummer toevoegen aan contact',  example: 'voeg 06-55512345 toe aan café de boom',                                     category: 'contact_update' },
      { intent: 'Label updaten',                         example: 'zet café de boom op label A',                                               category: 'contact_update' },
      { intent: 'Dagplanning opvragen',                  example: 'wat heb ik vandaag op de agenda',                                           category: 'calendar_get_many' },
      { intent: 'Vrije slots zoeken',                    example: 'wanneer ben ik vrij deze week voor een afspraak',                           category: 'calendar_get_free_slot' },
      { intent: 'Agenda blokkeren',                      example: 'blokkeer mijn agenda morgen van 10 tot 12 intern',                          category: 'calendar_block' },
      { intent: 'Leads statistieken',                    example: 'hoeveel leads hebben we vandaag',                                           category: 'get_stats' },
      { intent: 'Teamleden opvragen',                    example: 'wie zijn onze accountmanagers',                                             category: 'get_team_members' },
      { intent: 'Multi-step: zoek + note + taak',        example: 'voeg note toe aan de berrie dat ze getekend hebben en maak follow-up taak', category: 'multi_step' },
      { intent: 'Multi-step: zoek + afspraak',           example: 'plan een afspraak met de berrie in alkmaar volgende week',                  category: 'multi_step' },
      { intent: 'Verwijderen (menselijke actie)',        example: 'verwijder café de boom uit het systeem',                                    category: 'no_tool_required' },
    ]
  }

  const { object } = await generateObject({
    model:  openai('gpt-4o-mini'), // clustering is simple classification — no need for 4.1
    system: `Je analyseert berichten van sales reps aan een AI sales-assistent (SUUS).
Je clustert vergelijkbare berichten in unieke test intents.
BELANGRIJK voor de "example" velden:
- Maak elke example STANDALONE bruikbaar — voeg altijd een contactnaam toe als die ontbreekt (gebruik bijv. "cafe de boom", "de berrie", "bakkerij janssen").
- Vage follow-ups zoals "ja maak aan", "voeg toe", "koppel dat" zijn NIET bruikbaar als standalone voorbeeld — verrijk ze met context.
- Bezoek registreren/koppelen = calendar_create of note_create op een specifiek contact.
- Verwijderen/wissen = menselijke actie (no_tool_required).
- Briefing = contact_briefing op een specifiek contact.`,
    prompt: `Hier zijn ${Math.min(messages.length, 100)} berichten van sales reps:\n\n${messages.slice(0, 100).map(m => m.slice(0, 120)).join('\n')}\n\nGeef maximaal 25 unieke test intents terug met concrete, actionable voorbeeldzinnen die een contactnaam bevatten.`,
    schema: z.object({
      intents: z.array(z.object({
        intent:   z.string().describe('Korte beschrijving van de intent'),
        example:  z.string().describe('Concrete, standalone berichttekst met contactnaam'),
        category: z.string().describe('Tool: contact_zoek | contact_create | contact_update | note_create | task_create | calendar_create | calendar_get_many | calendar_get_free_slot | calendar_block | contact_briefing | get_stats | get_team_members | multi_step | no_tool_required'),
      }))
    }),
  })

  return object.intents
}

// ─── Run single test ──────────────────────────────────────────────────────────

interface TestResult {
  intent:       string
  example:      string
  category:     string
  passed:       boolean
  toolsCalled:  string[]
  ghlSuccess:   boolean
  errorDetail?: string
  responseText: string
  steps:        number
  durationMs:   number
}

interface EvalEmployee {
  id:          string
  naam:        string
  functie:     string
  ghl_user_id: string
  calendar_id: string
}

async function runTest(
  intent: string,
  example: string,
  category: string,
  employee?: EvalEmployee,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evalToolset?: Record<string, any>,
): Promise<TestResult> {
  const start = Date.now()
  const toolsCalled: string[] = []
  let   ghlSuccess = false

  try {
    const now = new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })

    const contextLines = [
      `Datum/tijd: ${now}`,
      `GHL locatie ID: ${GHL_LOC()}`,
      ...(employee ? [
        `Ingelogde gebruiker: ${employee.naam} (${employee.functie})`,
        `GHL user ID: ${employee.ghl_user_id}`,
        `Calendar ID: ${employee.calendar_id}`,
      ] : []),
    ]

    const { text, steps } = await generateText({
      model:  openai('gpt-4.1'),
      system: `Je bent SUUS, de AI sales-assistent van ROUX BV.
Je helpt sales reps met CRM-beheer in GoHighLevel. Altijd Nederlands.

## ⚠️ ABSOLUTE REGEL — NOOIT OVERTREDEN
Na contact_zoek met count≥1: roep ALTIJD direct de gevraagde write-tool aan.
Na contact_zoek met count>1: kies het meest waarschijnlijke contact en ga DIRECT door.
Genereer NOOIT een tekstreactie tussen contact_zoek en de write-tool.
userId en assignedTo zijn OPTIONEEL — blokkeer de actie NOOIT daarvoor.

## EVAL MODUS — OVERIGE REGELS
- Voer ELKE actie direct uit — NOOIT bevestiging vragen
- NOOIT zeggen "Wil je dat ik..." of "Zal ik..." — gewoon doen
- Als informatie ontbreekt: gebruik redelijke aannames en voer toch uit
- Bij count=0 en actie is contact_create: direct aanmaken met confirmed=true
- Bij count=0 en actie is note/task/update: zeg "contact niet gevonden"

## Regels
1. Nooit een ID raden — altijd ophalen via tool
2. Gebruik ALTIJD contact_zoek voor elke contactactie
3. Geen interne IDs tonen

## contact_zoek
- Geef rawQuery mee: de zin precies zoals de gebruiker het zei
- COUNT=1 → roep direct de write-tool aan, geen tussentekst
- COUNT>1 → kies het beste match en roep direct de write-tool aan
- COUNT=0 + create → contact_create met confirmed=true
- COUNT=0 + note/task/update → "contact niet gevonden"

## contact_create
- Ontbrekend e-mail of adres: gewoon weglaten, NIET blokkeren
- Stuur altijd confirmed=true mee
- klantType is altijd "Lead" tenzij anders vermeld

## Note aanmaken
- COUNT≥1: contact_zoek → note_create DIRECT, geen bevestiging, userId weglaten als onbekend
- COUNT=0: antwoord "Contact [naam] niet gevonden in GHL." — roep NOOIT contact_create aan in eval modus

## Afspraak plannen
- contact_zoek → calendar_get_free_slot → calendar_create EERSTE slot DIRECT
- Geen datum in bericht? Gebruik morgen als standaard
- Geen tijdzone? Gebruik Europe/Amsterdam

## Bezoek registreren
- contact_zoek → calendar_create (vandaag, title: "Bezoek [naam]") DIRECT

## Taak voor andere medewerker
- get_team_members → contact_zoek → task_create DIRECT
- Geen contact in bericht? Vraag "voor welk contact?" (task_create vereist contactId)

## Verwijderen
- Kan SUUS niet. Antwoord: "Verwijderen doe je handmatig in GHL."
- Combineer start + 30 min voor endTime`,
      messages: [
        { role: 'user', content: `[Context]\n${contextLines.join('\n')}` },
        { role: 'assistant', content: 'Begrepen.' },
        { role: 'user', content: example },
      ],
      tools:    evalToolset ?? buildEvalTools('__dry_run__'),
      maxSteps: 10,
      temperature: 0,
    })

    const finalText  = text
    const finalSteps = steps.length

    // Analyse tool calls from steps
    for (const step of steps) {
      for (const tc of step.toolCalls ?? []) {
        toolsCalled.push(tc.toolName)
      }
        // Check tool results for GHL success indicators
      for (const tr of step.toolResults ?? []) {
        const result = tr.result as Record<string, unknown>
        // Mocked writes (contact_create, or dry_run fallback) count as success if called correctly
        if (result?.dry_run === true) { ghlSuccess = true; continue }
        // GHL success: has contact/note/task/appointment object without error field
        const hasGhlObject = result?.contact || result?.note || result?.task ||
          result?.appointment || result?.contacts || result?.events
        const hasError = result?.error || (typeof result?.status === 'number' && (result.status as number) >= 400)
        if (hasGhlObject && !hasError) ghlSuccess = true
        // Supabase stats are always "successful" if they return numbers
        if (typeof result?.total === 'number' || typeof result?.members !== 'undefined') ghlSuccess = true
      }
    }

    // Helper: get contact_zoek result count from steps
    const getContactZoekCount = (): number => {
      for (const step of steps) {
        const nameById: Record<string, string> = {}
        for (const tc of step.toolCalls ?? []) nameById[tc.toolCallId] = tc.toolName
        for (const tr of step.toolResults ?? []) {
          const trAny = tr as { toolCallId?: string; result: unknown }
          const trName = trAny.toolCallId ? nameById[trAny.toolCallId] : undefined
          if (trName !== 'contact_zoek') continue
          const r = trAny.result as Record<string, unknown>
          if (typeof r?.count === 'number') return r.count
        }
      }
      return -1 // unknown
    }

    // For write-intent categories: only pass if the WRITE tool was actually called
    const writeCategories: Record<string, string[]> = {
      task_create:      ['task_create'],
      note_create:      ['note_create'],
      contact_create:   ['contact_create'],
      contact_update:   ['contact_update'],
      calendar_create:  ['calendar_create'],
      calendar_block:   ['calendar_block'],
    }
    const requiredTools = writeCategories[category]
    if (requiredTools) {
      ghlSuccess = requiredTools.some(t => toolsCalled.includes(t))

      if (!ghlSuccess && toolsCalled.includes('contact_zoek')) {
        const zoekCount = getContactZoekCount()

        // contact_create: existing contact found → correct, no duplicate = pass
        if (category === 'contact_create' && zoekCount > 0) ghlSuccess = true

        // note_create / calendar_create / contact_update:
        // if contact_zoek found 0 results and SUUS said "niet gevonden" → correct behavior = pass
        if (['note_create', 'calendar_create', 'contact_update'].includes(category) && zoekCount === 0) {
          const lc = text.toLowerCase()
          if (lc.includes('niet gevonden') || lc.includes('geen contact') || lc.includes('vind ik niet')) {
            ghlSuccess = true
          }
        }
      }

      // task_create without contact in message: if SUUS asks "voor welk contact" → correct = pass
      if (!ghlSuccess && category === 'task_create' && toolsCalled.includes('get_team_members')) {
        const lc = text.toLowerCase()
        if (lc.includes('welk contact') || lc.includes('voor wie') || lc.includes('welke klant')) {
          ghlSuccess = true
        }
      }
    } else {
      // Read-only or unknown intent: any tool success is enough
      const readOnlyCategories = ['get_stats', 'get_team_members', 'calendar_get_many', 'calendar_get_free_slot',
        'contact_zoek', 'note_get', 'task_get', 'calendar_get', 'contact_briefing', 'unknown']
      if (!ghlSuccess && toolsCalled.some(t => readOnlyCategories.includes(t))) {
        ghlSuccess = true
      }
    }

    // no_tool_required: SUUS should explain the action is not possible (e.g. verwijderen)
    const isNoToolCategory = category === 'no_tool_required'
    const refusedCorrectly  = isNoToolCategory && toolsCalled.length === 0 &&
      (text.toLowerCase().includes('handmatig') || text.toLowerCase().includes('niet') || text.toLowerCase().includes('mens'))

    const passed = refusedCorrectly || (toolsCalled.length > 0 && ghlSuccess)

    return {
      intent, example, category, passed,
      toolsCalled, ghlSuccess,
      responseText: finalText.slice(0, 200),
      steps:        finalSteps,
      durationMs:   Date.now() - start,
    }
  } catch (err) {
    return {
      intent, example, category, passed: false,
      toolsCalled, ghlSuccess: false,
      errorDetail:  String(err),
      responseText: '',
      steps:        0,
      durationMs:   Date.now() - start,
    }
  }
}

// ─── Fetch employee by ID ─────────────────────────────────────────────────────

async function fetchEmployee(employeeId: string): Promise<EvalEmployee | undefined> {
  try {
    const orgId = process.env.ORGANIZATION_ID?.trim() ?? ''
    const { adminSupabase } = await import('@/lib/supabase')
    const { data } = await adminSupabase()
      .from('team_members')
      .select('id, naam, functie, ghl_user_id, calendar_id')
      .eq('id', employeeId)
      .eq('organization_id', orgId)
      .single()
    return data ?? undefined
  } catch { return undefined }
}

// ─── Convert raw messages to test cases ──────────────────────────────────────

function rawMessagesToTests(messages: string[]): { intent: string; example: string; category: string }[] {
  // Filter out very short / clearly non-actionable messages
  const SKIP = /^(ja|nee|ok|oke|oke|goed|bedankt|dank|thanks|hoi|hallo|hey|.{1,4})$/i
  return messages
    .filter(m => m.length >= 8 && !SKIP.test(m.trim()))
    .map(m => ({ intent: m.slice(0, 80), example: m, category: 'unknown' }))
}

// ─── Shared SSE stream builder ────────────────────────────────────────────────

function buildEvalStream(
  employeeId: string | undefined,
  getTests: (emit: (d: unknown) => void) => Promise<{ intent: string; example: string; category: string }[]>,
) {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      const emit = (data: unknown) => controller.enqueue(encoder.encode(sseEvent(data)))

      try {
        // Resolve employee
        let employee: EvalEmployee | undefined
        if (employeeId) {
          employee = await fetchEmployee(employeeId)
          if (employee) emit({ type: 'status', message: `👤 Chat als: ${employee.naam} (${employee.functie})` })
        }

        // Find or create the dedicated eval test contact in GHL
        emit({ type: 'status', message: '🧪 Test contact ophalen in GHL…' })
        let testContactId = ''
        try {
          testContactId = await upsertEvalTestContact()
          emit({ type: 'status', message: `🧪 Test contact klaar — writes → ${testContactId}` })
        } catch (err) {
          emit({ type: 'status', message: `⚠️ Test contact mislukt (${String(err)}) — dry-run` })
        }
        const evalToolset = buildEvalTools(testContactId || '__dry_run__')

        // Get tests (fetch+cluster or use provided list)
        const tests = await getTests(emit)
        emit({ type: 'intents', intents: tests })

        // ~2K tokens per test, 30K TPM limit → max ~15 tests/min → 6s apart
        const INTER_TEST_DELAY = 6000 // ms

        const results: TestResult[] = []
        for (let i = 0; i < tests.length; i++) {
          const { intent, example, category } = tests[i]
          emit({ type: 'running', index: i, total: tests.length, intent, example })
          const result = await runTest(intent, example, category, employee, evalToolset)
          results.push(result)
          emit({ type: 'result', index: i, result })
          // Pause between tests (skip after last one)
          if (i < tests.length - 1) await new Promise(r => setTimeout(r, INTER_TEST_DELAY))
        }

        const passed = results.filter(r => r.passed).length
        const failed = results.filter(r => !r.passed).length
        const avgMs  = results.length ? Math.round(results.reduce((s, r) => s + r.durationMs, 0) / results.length) : 0
        emit({ type: 'summary', passed, failed, total: results.length, passRate: results.length ? Math.round((passed / results.length) * 100) : 0, avgDurationMs: avgMs, results })
      } catch (err) {
        emit({ type: 'error', message: String(err) })
      } finally {
        controller.close()
      }
    },
  })
}

const SSE_HEADERS = {
  'Content-Type':  'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection':    'keep-alive',
}

// ─── GET — full eval (fetch logs → cluster/raw → test all) ───────────────────

export async function GET(req: Request) {
  const url        = new URL(req.url)
  const employeeId = url.searchParams.get('employee_id') ?? undefined
  const mode       = (url.searchParams.get('mode') ?? 'intents') as 'intents' | 'raw'
  const sinceParam = url.searchParams.get('since') // ISO date string, e.g. 2026-03-01
  const since      = sinceParam ? new Date(sinceParam) : undefined

  const stream = buildEvalStream(employeeId, async (emit) => {
    const sinceLabel = since ? ` vanaf ${since.toLocaleDateString('nl-NL')}` : ''
    emit({ type: 'status', message: `📥 Twilio WhatsApp logs ophalen${sinceLabel}…` })
    const twilioMsgs = await fetchTwilioMessages(500, since)
    emit({ type: 'status', message: `📞 Retell transcripts ophalen${sinceLabel}…`, twilioCount: twilioMsgs.length })
    const retellMsgs = await fetchRetellTranscripts(100, since)
    const allMessages = [...twilioMsgs, ...retellMsgs]
    emit({ type: 'logs', twilioCount: twilioMsgs.length, retellCount: retellMsgs.length, total: allMessages.length })

    if (mode === 'raw') {
      const raw = rawMessagesToTests(allMessages)
      if (raw.length === 0) {
        emit({ type: 'status', message: '⚠️ Geen echte berichten — synthetische fallback' })
        return clusterIntents([])
      }
      // Normalize vague shorthand ("Voeg toe", "Maak aan") into complete CRM commands
      emit({ type: 'status', message: `🔄 ${raw.length} berichten normaliseren…` })
      const normalized = await normalizeMessages(raw.map(t => t.example))
      const tests = raw.map((t, i) => ({ ...t, example: normalized[i] ?? t.example }))
      emit({ type: 'status', message: `🏃 ${tests.length} berichten testen (genormaliseerd)…` })
      return tests
    }

    emit({ type: 'status', message: '🧠 Intents clusteren met GPT-4.1…' })
    const tests = await clusterIntents(allMessages)
    emit({ type: 'status', message: `🏃 ${tests.length} geclusterde intents testen…` })
    return tests
  })

  return new Response(stream, { headers: SSE_HEADERS })
}

// ─── POST — retry specific intents (pass failed tests from previous run) ─────

export async function POST(req: Request) {
  const body       = await req.json().catch(() => ({}))
  const employeeId = body.employee_id as string | undefined
  const intents    = body.intents    as { intent: string; example: string; category: string }[] | undefined

  if (!intents?.length) {
    return new Response(JSON.stringify({ error: 'intents array required' }), { status: 400 })
  }

  const stream = buildEvalStream(employeeId, async (emit) => {
    emit({ type: 'status', message: `🔁 Hertesten: ${intents.length} gefaalde tests…` })
    return intents
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
