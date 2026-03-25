/**
 * Supabase Edge Function: suus
 *
 * Handles SUUS AI chat requests.
 * Receives: { message: string, session_id: string, organization_id?: string }
 * Returns: streaming text/plain response
 *
 * Deploy: supabase functions deploy suus
 * URL:    https://<project>.supabase.co/functions/v1/suus
 */

import OpenAI from 'https://deno.land/x/openai@v4.52.0/mod.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY')! })
const MODEL  = 'gpt-4.1'

const SYSTEM_PROMPT = `Je bent SUUS, een AI sales assistent voor B2B teams.
Je helpt sales reps met hun CRM: contacten, notities, taken en afspraken.
Altijd Nederlands. Warm en direct.`

function adminSb() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

async function loadHistory(sessionId: string, orgId: string) {
  try {
    const { data } = await adminSb()
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(15)
    return (data ?? []).reverse().map((r: { role: string; content: string | null }) => ({
      role:    r.role as 'user' | 'assistant',
      content: r.content ?? '',
    }))
  } catch { return [] }
}

async function saveMessage(sessionId: string, orgId: string, role: 'user' | 'assistant', content: string) {
  try {
    await adminSb().from('chat_messages').insert({
      session_id:      sessionId,
      organization_id: orgId,
      surface:         'web',
      role,
      content,
    })
  } catch { /* ignore */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST' } })
  }

  try {
    const { message, session_id, organization_id } = await req.json()
    if (!message || !session_id) {
      return new Response('Missing message or session_id', { status: 400 })
    }

    const orgId = organization_id ?? Deno.env.get('DEFAULT_ORGANIZATION_ID') ?? ''

    await saveMessage(session_id, orgId, 'user', message)
    const history = await loadHistory(session_id, orgId)
    const prior   = history.slice(0, -1)

    const messages = [
      { role: 'system' as const,    content: SYSTEM_PROMPT },
      ...prior,
      { role: 'user'   as const,    content: message },
    ]

    const stream = await openai.chat.completions.create({
      model: MODEL, messages, temperature: 0, max_tokens: 2048, stream: true,
    })

    const encoder = new TextEncoder()
    let fullText  = ''

    const body = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const token = chunk.choices[0]?.delta?.content ?? ''
            if (token) {
              fullText += token
              controller.enqueue(encoder.encode(token))
            }
          }
          await saveMessage(session_id, orgId, 'assistant', fullText)
        } finally {
          controller.close()
        }
      },
    })

    return new Response(body, {
      headers: {
        'Content-Type':                'text/plain; charset=utf-8',
        'Cache-Control':               'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (err) {
    console.error('[suus]', err)
    return new Response('Internal error', { status: 500 })
  }
})
