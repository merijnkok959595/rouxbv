/**
 * Voice tool executor — called by the client-side WebRTC handler
 * when OpenAI Realtime API triggers a function call.
 *
 * Executes suusTools server-side (keeps GHL/Supabase secrets on the server).
 * render_form and render_edit_form are blocked — they are web-UI-only tools.
 */

import { NextResponse } from 'next/server'
import { suusTools }   from '@/lib/suus-tools'

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
    const { name, args } = await req.json() as { name: string; args: Record<string, unknown> }

    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    if (BLOCKED.has(name)) return NextResponse.json({ error: 'Tool not available in voice context' }, { status: 400 })

    const tool = (suusTools as ToolMap)[name]
    if (!tool?.execute) return NextResponse.json({ error: `Unknown tool: ${name}` }, { status: 404 })

    const result = await tool.execute(args, {
      toolCallId:  '',
      messages:    [],
      abortSignal: new AbortController().signal,
    })

    return NextResponse.json({ result })
  } catch (err) {
    console.error('[suus/tool-call]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
