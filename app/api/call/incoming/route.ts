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
import { SUUS_VOICE_SYSTEM, VOICE_TOOLS_FULL } from '@/lib/suus-voice-prompt'
import {
  initSession,
  getSession,
  setSelectedContact,
  clearSelectedContact,
  type SelectedContact,
} from '@/lib/voice-session'
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

  // Svix secrets are base64-encoded after the "whsec_" prefix
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const toSign      = `${msgId}.${msgTimestamp}.${body}`
  const hmac        = createHmac('sha256', secretBytes).update(toSign).digest('base64')
  const computed    = `v1,${hmac}`

  return msgSig.split(' ').some(s => s === computed)
}


// ── Tool executor ───────────────────────────────────────────────────────────

type ToolMap = Record<string, { execute?: (args: Record<string, unknown>, opts: { toolCallId: string; messages: unknown[]; abortSignal: AbortSignal }) => Promise<unknown> }>
const BLOCKED = new Set(['render_form', 'render_edit_form'])

async function executeTool(name: string, args: Record<string, unknown>, sessionId: string): Promise<unknown> {
  if (BLOCKED.has(name)) return { error: 'Tool not available in voice context' }

  // ── Session tools ──────────────────────────────────────────────────────────
  if (name === 'session_get') {
    const session = getSession(sessionId) ?? initSession(sessionId)
    return {
      selectedContact: session.selectedContact ?? null,
      userNaam:        session.userNaam    ?? null,
      userId:          session.userId      ?? null,
      calendarId:      session.calendarId  ?? null,
      phase:           session.phase,
    }
  }
  if (name === 'session_set_contact') {
    initSession(sessionId)
    const contact: SelectedContact = {
      id:      String(args.id      ?? ''),
      name:    String(args.name    ?? ''),
      company: String(args.company ?? ''),
      type:    args.type ? String(args.type) : undefined,
    }
    setSelectedContact(sessionId, contact)
    return { ok: true, selectedContact: contact }
  }
  if (name === 'session_clear_contact') {
    clearSelectedContact(sessionId)
    return { ok: true, message: 'Contact cleared from session' }
  }

  // ── Regular tools ──────────────────────────────────────────────────────────
  const tool = (suusTools as unknown as ToolMap)[name]
  if (!tool?.execute) return { error: `Unknown tool: ${name}` }
  return tool.execute(args, { toolCallId: '', messages: [], abortSignal: new AbortController().signal })
}

// ── WebSocket monitor (background — handles tool calls) ────────────────────

function startCallMonitor(callId: string) {
  // Model is already set via the accept endpoint — no ?model= or session.update needed
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?call_id=${callId}`, {
    headers: { Authorization: `Bearer ${API_KEY()}` },
  })

  ws.on('open', () => {
    console.log(`[sip] WebSocket open for call ${callId}`)
  })

  let greetingScheduled = false

  ws.on('message', async (raw) => {
    try {
      const ev = JSON.parse(raw.toString()) as { type: string; item?: { type: string; call_id: string; name: string; arguments: string } }

      // Wait for session.created — confirms audio is ready — then greet after 1s
      if (ev.type === 'session.created' && !greetingScheduled) {
        greetingScheduled = true
        console.log(`[sip] session ready, scheduling greeting for ${callId}`)
        setTimeout(() => {
          ws.send(JSON.stringify({
            type: 'response.create',
            response: { instructions: 'Zeg nu je openingsgroet.' },
          }))
        }, 1000)
        return
      }

      if (ev.type !== 'response.output_item.done') return
      if (ev.item?.type !== 'function_call') return

      const { call_id: toolCallId, name, arguments: argsStr } = ev.item
      const args = JSON.parse(argsStr || '{}') as Record<string, unknown>

      console.log(`[sip] tool call: ${name}`, args)
      const result = await executeTool(name, args, callId)

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

async function acceptCall(callId: string): Promise<void> {
  const orgId = ORG_ID()
  const user  = await resolveUser(orgId)
  const now   = new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })

  // Init session keyed by call_id so tool calls can use it
  initSession(callId, {
    userId:      user?.ghl_user_id ?? undefined,
    calendarId:  user?.calendar_id ?? undefined,
    userNaam:    user?.naam        ?? undefined,
  })

  const instructions = [
    SUUS_VOICE_SYSTEM, '',
    '## Sessiecontext',
    `Datum/tijd: ${now}`,
    `GHL locatie ID: ${process.env.GHL_LOCATION_ID ?? ''}`,
    ...(user ? [
      `Ingelogde gebruiker: ${user.naam} (${user.functie})`,
      `GHL user ID: ${user.ghl_user_id}`,
      `Calendar ID: ${user.calendar_id ?? ''}`,
    ] : []),
  ].join('\n')

  // Accept endpoint takes full session config — same params as create client secret
  const res = await fetch(`https://api.openai.com/v1/realtime/calls/${callId}/accept`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${API_KEY()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type:         'realtime',
      model:        'gpt-4o-mini-realtime-preview',
      instructions,
      tools:        VOICE_TOOLS_FULL,
      temperature:  0.6,
      audio:        { output: { voice: 'alloy' } },
      input_audio_transcription: { model: 'gpt-4o-transcribe', language: 'nl' },
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

    // Open WebSocket to handle tool calls during the session
    startCallMonitor(callId)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[sip/incoming]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
