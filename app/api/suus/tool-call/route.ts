/**
 * Voice tool executor — called by the client-side WebRTC handler
 * when OpenAI Realtime API triggers a function call.
 *
 * Handles session tools (session_get, session_set_contact, session_clear_contact)
 * inline, and delegates all other tools to suusTools.
 */

import { NextResponse } from 'next/server'
import { suusTools }   from '@/lib/suus-tools'
import {
  getSession,
  initSession,
  setSelectedContact,
  clearSelectedContact,
  type SelectedContact,
} from '@/lib/voice-session'

export const runtime     = 'nodejs'
export const maxDuration = 30

const BLOCKED = new Set(['render_form', 'render_edit_form'])

type ToolMap = Record<string, {
  execute?: (
    args: Record<string, unknown>,
    opts: { toolCallId: string; messages: unknown[]; abortSignal: AbortSignal }
  ) => Promise<unknown>
}>

export async function POST(req: Request) {
  try {
    const { name, args, session_id } = await req.json() as {
      name: string
      args: Record<string, unknown>
      session_id?: string
    }

    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    if (BLOCKED.has(name)) return NextResponse.json({ error: 'Tool not available in voice context' }, { status: 400 })

    // ── Session tools (handled inline, no suusTools needed) ──────────────────
    if (name === 'session_get') {
      const sid = session_id ?? 'default'
      const session = getSession(sid) ?? initSession(sid)
      return NextResponse.json({
        result: {
          selectedContact: session.selectedContact ?? null,
          userNaam:        session.userNaam ?? null,
          userId:          session.userId   ?? null,
          calendarId:      session.calendarId ?? null,
          phase:           session.phase,
        }
      })
    }

    if (name === 'session_set_contact') {
      const sid = session_id ?? 'default'
      initSession(sid)
      const contact: SelectedContact = {
        id:      String(args.id      ?? ''),
        name:    String(args.name    ?? ''),
        company: String(args.company ?? ''),
        type:    args.type ? String(args.type) : undefined,
      }
      setSelectedContact(sid, contact)
      return NextResponse.json({
        result: { ok: true, selectedContact: contact }
      })
    }

    if (name === 'session_clear_contact') {
      const sid = session_id ?? 'default'
      clearSelectedContact(sid)
      return NextResponse.json({ result: { ok: true, message: 'Contact cleared from session' } })
    }

    // ── Regular suus tools ────────────────────────────────────────────────────
    const tool = (suusTools as unknown as ToolMap)[name]
    if (!tool?.execute) return NextResponse.json({ error: `Unknown tool: ${name}` }, { status: 404 })

    const result = await tool.execute(args, {
      toolCallId:  '',
      messages:    [],
      abortSignal: new AbortController().signal,
    })

    return NextResponse.json({ result })
  } catch (err) {
    console.error('[tool-call]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
