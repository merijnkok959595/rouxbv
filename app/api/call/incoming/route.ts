/**
 * POST /api/call/incoming
 *
 * OpenAI webhook for inbound SIP calls (Twilio → OpenAI SIP → this webhook).
 * 1. Verifies the OpenAI webhook signature
 * 2. Accepts the call with SUUS instructions + tools
 * 3. Opens a background WebSocket to handle tool calls for the session
 */

import { NextResponse } from 'next/server'
import { createHmac }   from 'crypto'
import { adminSupabase } from '@/lib/supabase'
import { suusTools }     from '@/lib/suus-tools'
import WebSocket         from 'ws'

export const runtime     = 'nodejs'
export const maxDuration = 300  // 5 min — keep WS alive on Vercel Pro

const API_KEY    = () => process.env.OPENAI_API_KEY!
const ORG_ID     = () => process.env.ORGANIZATION_ID?.trim() ?? ''
const WH_SECRET  = () => process.env.OPENAI_WEBHOOK_SECRET ?? ''

// ── Signature verification ──────────────────────────────────────────────────

function verifySignature(body: string, headers: Headers): boolean {
  const secret = WH_SECRET()
  if (!secret) return true  // skip in dev if not configured

  const msgId        = headers.get('webhook-id') ?? ''
  const msgTimestamp = headers.get('webhook-timestamp') ?? ''
  const msgSig       = headers.get('webhook-signature') ?? ''

  const toSign  = `${msgId}.${msgTimestamp}.${body}`
  const hmac    = createHmac('sha256', secret).update(toSign).digest('base64')
  const computed = `v1,${hmac}`

  return msgSig.split(' ').some(s => s === computed)
}

// ── System prompt (same as /api/call/route.ts) ──────────────────────────────

const VOICE_SYSTEM = `Je bent SUUS, de AI voice-assistent van ROUX BV.
Je helpt sales reps met CRM-beheer via spraak. Antwoord altijd kort en bondig — dit is een gesprek.

## Kernregels
1. Nooit een ID raden — altijd ophalen via tool
2. Gebruik contact_zoek vóór elke contactactie (tenzij contactId al bekend)
3. Bij 1 resultaat: direct doorgaan. Bij meerdere: noem de opties kort en vraag welke.
4. Bij 0 resultaten: vraag voornaam + "Lead of Klant" → contact_intake → contact_create
5. Bevestig uitgevoerde acties in één korte zin. Spreek Nederlands.

## Acties
- Nieuw contact:   contact_zoek → 0 resultaten → contact_intake → contact_create
- Bezoek:          contact_zoek → calendar_create (vandaag) + note_create
- Notitie:         contact_zoek → note_create
- Taak:            contact_zoek → task_create
- Taak collega:    get_team_members → contact_zoek → task_create
- Briefing:        contact_zoek → contact_briefing
- Intern overleg:  calendar_block`

const VOICE_TOOLS = [
  { type: 'function', name: 'contact_zoek',     description: 'Zoek een contact in GHL.',                    parameters: { type: 'object', properties: { rawQuery: { type: 'string' } }, required: ['rawQuery'] } },
  { type: 'function', name: 'contact_briefing', description: 'Volledige briefing van een contact.',          parameters: { type: 'object', properties: { contactId: { type: 'string' } }, required: ['contactId'] } },
  { type: 'function', name: 'contact_intake',   description: 'Eerste stap nieuw contact: naam + klantType.', parameters: { type: 'object', properties: { companyName: { type: 'string' }, firstName: { type: 'string' }, klantType: { type: 'string' } }, required: ['companyName'] } },
  { type: 'function', name: 'contact_create',   description: 'Maak nieuw GHL contact aan.',                  parameters: { type: 'object', properties: { firstName: { type: 'string' }, companyName: { type: 'string' }, klantType: { type: 'string', enum: ['Lead', 'Klant'] }, lastName: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, city: { type: 'string' } }, required: ['firstName', 'companyName', 'klantType'] } },
  { type: 'function', name: 'contact_update',   description: 'Wijzig velden van bestaand contact.',          parameters: { type: 'object', properties: { contactId: { type: 'string' }, firstName: { type: 'string' }, companyName: { type: 'string' }, phone: { type: 'string' }, city: { type: 'string' }, groothandel: { type: 'string' }, klantType: { type: 'string' }, kortingsafspraken: { type: 'string' }, posMateriaal: { type: 'string' } }, required: ['contactId'] } },
  { type: 'function', name: 'note_create',      description: 'Voeg note toe aan GHL contact.',               parameters: { type: 'object', properties: { contactId: { type: 'string' }, body: { type: 'string' }, userId: { type: 'string' } }, required: ['contactId', 'body'] } },
  { type: 'function', name: 'task_create',      description: 'Maak taak aan voor GHL contact.',              parameters: { type: 'object', properties: { contactId: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, dueDate: { type: 'string' }, assignedTo: { type: 'string' } }, required: ['contactId', 'title', 'dueDate'] } },
  { type: 'function', name: 'get_team_members', description: 'Haal teamleden op.',                           parameters: { type: 'object', properties: {} } },
  { type: 'function', name: 'get_stats',        description: 'CRM statistieken.',                            parameters: { type: 'object', properties: {} } },
  { type: 'function', name: 'calendar_create',  description: 'Maak afspraak aan.',                           parameters: { type: 'object', properties: { contactId: { type: 'string' }, calendarId: { type: 'string' }, title: { type: 'string' }, startTime: { type: 'string' }, endTime: { type: 'string' }, notes: { type: 'string' } }, required: ['contactId', 'calendarId', 'title', 'startTime', 'endTime'] } },
  { type: 'function', name: 'calendar_block',   description: 'Blokkeer agenda slot.',                        parameters: { type: 'object', properties: { calendarId: { type: 'string' }, title: { type: 'string' }, startTime: { type: 'string' }, endTime: { type: 'string' }, secondCalendarId: { type: 'string' } }, required: ['calendarId', 'title', 'startTime', 'endTime'] } },
]

// ── Tool executor ───────────────────────────────────────────────────────────

type ToolMap = Record<string, { execute?: (args: Record<string, unknown>, opts: { toolCallId: string; messages: unknown[]; abortSignal: AbortSignal }) => Promise<unknown> }>
const BLOCKED = new Set(['render_form', 'render_edit_form'])

async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (BLOCKED.has(name)) return { error: 'Tool not available in voice context' }
  const tool = (suusTools as ToolMap)[name]
  if (!tool?.execute) return { error: `Unknown tool: ${name}` }
  return tool.execute(args, { toolCallId: '', messages: [], abortSignal: new AbortController().signal })
}

// ── WebSocket monitor (background — handles tool calls) ────────────────────

function startCallMonitor(callId: string) {
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?call_id=${callId}`, {
    headers: { Authorization: `Bearer ${API_KEY()}` },
  })

  ws.on('open', () => {
    console.log(`[sip] WebSocket open for call ${callId}`)
    ws.send(JSON.stringify({ type: 'response.create' }))
  })

  ws.on('message', async (raw) => {
    try {
      const ev = JSON.parse(raw.toString()) as { type: string; item?: { type: string; call_id: string; name: string; arguments: string } }
      if (ev.type !== 'response.output_item.done') return
      if (ev.item?.type !== 'function_call') return

      const { call_id: toolCallId, name, arguments: argsStr } = ev.item
      const args = JSON.parse(argsStr || '{}') as Record<string, unknown>

      console.log(`[sip] tool call: ${name}`, args)
      const result = await executeTool(name, args)

      ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: toolCallId, output: JSON.stringify(result) },
      }))
      ws.send(JSON.stringify({ type: 'response.create' }))
    } catch (err) {
      console.error('[sip] ws message error', err)
    }
  })

  ws.on('error', (err) => console.error(`[sip] WebSocket error for ${callId}`, err))
  ws.on('close', () => console.log(`[sip] WebSocket closed for ${callId}`))
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function resolveUser(orgId: string) {
  try {
    const { data } = await adminSupabase()
      .from('team_members')
      .select('naam, functie, ghl_user_id, calendar_id')
      .eq('organization_id', orgId)
      .eq('active', true)
      .limit(1)
      .single()
    return data ?? undefined
  } catch { return undefined }
}

async function acceptCall(callId: string) {
  const orgId = ORG_ID()
  const user  = await resolveUser(orgId)
  const now   = new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })

  const instructions = [
    VOICE_SYSTEM, '',
    '## Sessiecontext',
    `Datum/tijd: ${now}`,
    `GHL locatie ID: ${process.env.GHL_LOCATION_ID ?? ''}`,
    ...(user ? [
      `Ingelogde gebruiker: ${user.naam} (${user.functie})`,
      `GHL user ID: ${user.ghl_user_id}`,
      `Calendar ID: ${user.calendar_id ?? ''}`,
    ] : []),
  ].join('\n')

  const res = await fetch(`https://api.openai.com/v1/realtime/calls/${callId}/accept`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${API_KEY()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type:         'realtime',
      model:        'gpt-4o-realtime-preview',
      voice:        'alloy',
      instructions,
      tools:        VOICE_TOOLS,
      turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 600 },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`accept failed: ${res.status} ${err}`)
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = await req.text()

    if (!verifySignature(body, req.headers)) {
      console.warn('[sip] invalid webhook signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }

    const event = JSON.parse(body) as { type: string; data?: { call_id: string } }

    if (event.type !== 'realtime.call.incoming') {
      return NextResponse.json({ ok: true })
    }

    const callId = event.data?.call_id
    if (!callId) return NextResponse.json({ error: 'No call_id' }, { status: 400 })

    console.log(`[sip] incoming call ${callId}`)

    await acceptCall(callId)
    console.log(`[sip] call ${callId} accepted`)

    // Start WebSocket monitor in background (handles tool calls)
    startCallMonitor(callId)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[sip/incoming]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
