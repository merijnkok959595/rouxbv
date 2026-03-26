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
const MAPS_KEY = () => Deno.env.get('GOOGLE_MAPS_API_KEY') ?? ''

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
contact_zoek → google_zoek_adres → bevestig adres → contact_create.
Vraag stap voor stap: voornaam → bedrijfsnaam → type (Lead/Klant) → adres via Google.

### Afspraak inplannen
contact_zoek → calendar_get_free_slot → noem 1 optie → bevestig → calendar_create.
Gebruik calendarId en userId uit de context — nooit vragen.

## Kernregels
- NOOIT een contactId raden — altijd contact_zoek eerst
- Na contact_zoek met resultaat ALTIJD doorgaan naar de volgende actie
- Bij count=1: direct doorgaan zonder bevestiging
- Bij count>1: "Ik zie [n] contacten: [naam1] in [stad1] of [naam2] in [stad2] — welke?"
- Bij count=0: herzoek op eerste woord → nog 0 → "Wil je dat ik [naam] aanmaak?"
- Bevestig ALTIJD vóór schrijfactie: "Ik ga een notitie aanmaken voor [naam] — klopt dat?"
- Na actie: "Gedaan! Nog iets anders?"
- Nooit interne IDs uitspreken`

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
      description: 'Zoek contacten op naam, bedrijf of stad in het CRM.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Zoekopdracht: bedrijfsnaam, contactnaam of stad' },
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
      description: 'Maak een nieuw contact aan in het CRM.',
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
      description: 'Zoek een bedrijfsadres via Google Places.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Bedrijfsnaam + stad' },
        },
        required: ['query'],
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

// ─── Tool executor ────────────────────────────────────────────────────────────
async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    if (name === 'contact_zoek') {
      const query = String(args.query ?? '')
      const res = await ghl(`/contacts/?locationId=${GHL_LOC()}&query=${encodeURIComponent(query)}&limit=5`)
      const contacts = (res.contacts ?? []) as Array<Record<string, unknown>>
      if (!contacts.length) return 'Geen contacten gevonden.'
      const lines = contacts.map((c, i) => {
        const name    = [c.firstName, c.lastName].filter(Boolean).join(' ')
        const label   = c.companyName ? `${c.companyName}${name ? ` (${name})` : ''}` : name
        const address = [c.address1, c.postalCode, c.city].filter(Boolean).join(', ')
        const contact = [c.phone, c.email].filter(Boolean).join(' | ')
        return `${i + 1}. contactId:${c.id} — ${label}${address ? ` — ${address}` : ''}${contact ? ` | ${contact}` : ''}`
      })
      return lines.join('\n') + (contacts.length > 1 ? '\n\nWelke bedoel je?' : '')
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
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(String(args.query))}&key=${MAPS_KEY()}&language=nl&region=nl`
      const res = await fetch(url).then(r => r.json())
      const place = res.results?.[0]
      if (!place) return 'Geen adres gevonden via Google.'
      const addr = place.formatted_address ?? ''
      return `Gevonden adres: ${addr} (place_id: ${place.place_id})`
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
      history.push({ role: 'tool', tool_call_id: tc.id, content: result })
    }
  }
}

// ─── Stream response helper ───────────────────────────────────────────────────
async function streamResponse(
  socket: WebSocket,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  responseId: number,
) {
  let buffer = ''
  for await (const token of runLLM(messages, () => {})) {
    buffer += token
    const words = buffer.split(' ')
    buffer = words.pop() ?? ''
    for (const word of words) {
      if (!word) continue
      socket.send(JSON.stringify({
        response_type: 'response', response_id: responseId,
        content: word + ' ', content_complete: false,
      }))
    }
  }
  if (buffer.trim()) {
    socket.send(JSON.stringify({
      response_type: 'response', response_id: responseId,
      content: buffer, content_complete: false,
    }))
  }
  socket.send(JSON.stringify({
    response_type: 'response', response_id: responseId,
    content: '', content_complete: true,
  }))
}

// ─── WebSocket handler ────────────────────────────────────────────────────────
function handleWebSocket(socket: WebSocket) {
  let employee: Record<string, unknown> | null = null
  let contextMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []

  console.log('[retell-llm] ws connected')

  socket.onmessage = async (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data)
      const interactionType = msg.interaction_type as string

      // Retell ping
      if (interactionType === 'ping_pong') {
        socket.send(JSON.stringify({ response_type: 'pong' }))
        return
      }

      // First event: Retell sends call details — resolve employee and send greeting
      if (interactionType === 'call_details') {
        const fromNumber = String(msg.call?.from_number ?? '').replace('whatsapp:', '').replace(/^\+/, '')
        employee = await resolveEmployee(fromNumber)
        contextMessages = buildContext(employee)
        console.log(`[retell-llm] call_details from=${fromNumber} employee=${employee?.naam ?? 'unknown'}`)

        if (!employee) {
          // Still send a graceful response — Retell expects a greeting
          socket.send(JSON.stringify({
            response_type: 'response', response_id: 0,
            content: 'Dit nummer is niet geautoriseerd voor SUUS. Tot ziens.',
            content_complete: true,
          }))
          return
        }

        // Send initial greeting (empty transcript → LLM generates greeting from context)
        await streamResponse(socket, contextMessages, 0)
        return
      }

      // Transcript update only — no response needed
      if (interactionType === 'update_only') {
        socket.send(JSON.stringify({
          response_type: 'response', response_id: msg.response_id,
          content: '', content_complete: true,
        }))
        return
      }

      // Response required
      if (interactionType === 'response_required' || interactionType === 'reminder_required') {
        // In case call_details was missed, try to init from this message
        if (!employee) {
          const fromNumber = String(msg.call?.from_number ?? '').replace('whatsapp:', '').replace(/^\+/, '')
          employee = await resolveEmployee(fromNumber)
          contextMessages = buildContext(employee)
        }

        if (!employee) {
          socket.send(JSON.stringify({
            response_type: 'response', response_id: msg.response_id,
            content: 'Dit nummer is niet geautoriseerd voor SUUS.',
            content_complete: true,
          }))
          return
        }

        const transcript: OpenAI.Chat.ChatCompletionMessageParam[] = (msg.transcript ?? []).map(
          (t: { role: string; content: string }) => ({
            role:    t.role === 'agent' ? 'assistant' : 'user',
            content: t.content,
          })
        )

        await streamResponse(socket, [...contextMessages, ...transcript], msg.response_id)
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
