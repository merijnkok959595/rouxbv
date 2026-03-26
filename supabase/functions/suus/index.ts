/**
 * Supabase Edge Function: suus
 *
 * Handles two modes, auto-detected by request shape:
 *
 *  1. Regular SUUS chat (from Next.js proxy or direct)
 *     Body: { message: string, session_id: string, image_url?: string, organization_id?: string }
 *     Returns: streaming text/plain
 *
 *  2. Retell Custom LLM webhook (voice calls)
 *     Body: Retell's { interaction_type, transcript, call, response_id }
 *     Returns: newline-delimited JSON in Retell's protocol
 *
 * Deploy: supabase functions deploy suus
 * Set env: OPENAI_API_KEY, DEFAULT_ORGANIZATION_ID
 */

import OpenAI from 'https://deno.land/x/openai@v4.52.0/mod.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY')! })
const ORG_ID = () => Deno.env.get('DEFAULT_ORGANIZATION_ID') ?? ''
const MODEL  = 'gpt-4.1'

// ─── Supabase client ──────────────────────────────────────────────────────────
function adminSb() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

// ─── System prompts ───────────────────────────────────────────────────────────
const CHAT_SYSTEM = `Je bent SUUS, de AI sales-assistent van ROUX BV.
Je helpt sales reps met hun CRM: contacten opzoeken, aanmaken, notities toevoegen en statistieken opvragen.
Je kunt ook afbeeldingen analyseren die worden gedeeld.
Antwoord altijd in het Nederlands. Warm, direct en professioneel.
Gebruik tools zodra de gebruiker vraagt om actie. Bevestig altijd wat je gedaan hebt.`

const VOICE_SYSTEM = `Je bent SUUS, de AI telefoon-assistent van ROUX BV.
Je spreekt met een sales rep. Help hen snel en bondig via spraak.
Gebruik korte, heldere zinnen — dit is een telefoongesprek.
Je hebt toegang tot het CRM: contacten opzoeken, aanmaken, notities, statistieken.
Altijd Nederlands.`

// ─── Tool schemas ─────────────────────────────────────────────────────────────
const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'search_contacts',
      description: 'Zoek contacten op bedrijfsnaam, stad of naam.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Zoekopdracht' },
          limit: { type: 'number', description: 'Max resultaten (standaard 5)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_contact',
      description: 'Maak een nieuw contact aan.',
      parameters: {
        type: 'object',
        properties: {
          company_name: { type: 'string' },
          first_name:   { type: 'string' },
          last_name:    { type: 'string' },
          phone:        { type: 'string' },
          email:        { type: 'string' },
          city:         { type: 'string' },
          postcode:     { type: 'string' },
          type:         { type: 'string', enum: ['lead', 'customer', 'employee'] },
          source:       { type: 'string' },
          notes:        { type: 'string' },
        },
        required: ['company_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_contact',
      description: 'Haal details op van een contact.',
      parameters: {
        type: 'object',
        properties: { contact_id: { type: 'string' } },
        required: ['contact_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_note',
      description: 'Voeg een notitie toe aan een contact.',
      parameters: {
        type: 'object',
        properties: {
          contact_id: { type: 'string' },
          note:       { type: 'string' },
        },
        required: ['contact_id', 'note'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assign_contact',
      description: 'Wijs een contact toe aan een teamlid.',
      parameters: {
        type: 'object',
        properties: {
          contact_id:  { type: 'string' },
          team_member: { type: 'string' },
        },
        required: ['contact_id', 'team_member'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_stats',
      description: 'Statistieken: totaal leads, hoog potentieel, vandaag.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_team_members',
      description: 'Lijst van actieve teamleden.',
      parameters: { type: 'object', properties: {} },
    },
  },
]

// ─── Tool executor ────────────────────────────────────────────────────────────
async function executeTool(name: string, args: Record<string, unknown>, orgId: string) {
  const db = adminSb()
  try {
    switch (name) {
      case 'search_contacts': {
        const q = String(args.query ?? '').trim()
        const limit = Number(args.limit ?? 5)
        const { data } = await db.from('contacts')
          .select('id, company_name, first_name, last_name, city, type, label, assigned_to')
          .eq('organization_id', orgId)
          .or(`company_name.ilike.%${q}%,city.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
          .limit(limit)
        return { ok: true, data: data ?? [], message: `${data?.length ?? 0} resultaat(en)` }
      }
      case 'create_contact': {
        const { data } = await db.from('contacts').insert({
          organization_id: orgId,
          company_name:    String(args.company_name),
          first_name:      args.first_name  ? String(args.first_name)  : null,
          last_name:       args.last_name   ? String(args.last_name)   : null,
          phone:           args.phone       ? String(args.phone)       : null,
          email:           args.email       ? String(args.email)       : null,
          city:            args.city        ? String(args.city)        : null,
          postcode:        args.postcode    ? String(args.postcode)    : null,
          type:            args.type        ? String(args.type)        : 'lead',
          source:          args.source      ? String(args.source)      : null,
          channel:         'SUUS',
          custom_fields:   args.notes ? { intake_notes: String(args.notes) } : null,
        }).select('id, company_name').single()
        return { ok: true, data, message: `Contact "${args.company_name}" aangemaakt` }
      }
      case 'get_contact': {
        const { data } = await db.from('contacts')
          .select('id, company_name, first_name, last_name, email, phone, city, postcode, type, label, revenue, assigned_to, source, created_at')
          .eq('id', String(args.contact_id))
          .eq('organization_id', orgId)
          .single()
        return { ok: !!data, data, message: data ? `Contact: ${data.company_name}` : 'Niet gevonden' }
      }
      case 'add_note': {
        const { data: existing } = await db.from('contacts')
          .select('custom_fields').eq('id', String(args.contact_id)).eq('organization_id', orgId).single()
        const cf = (existing?.custom_fields as Record<string, unknown>) ?? {}
        const notes = Array.isArray(cf._notes) ? cf._notes : []
        notes.push({ text: String(args.note), at: new Date().toISOString(), via: 'suus' })
        await db.from('contacts').update({ custom_fields: { ...cf, _notes: notes }, last_activity: new Date().toISOString() })
          .eq('id', String(args.contact_id)).eq('organization_id', orgId)
        return { ok: true, message: 'Notitie toegevoegd' }
      }
      case 'assign_contact': {
        await db.from('contacts').update({ assigned_to: String(args.team_member), last_activity: new Date().toISOString() })
          .eq('id', String(args.contact_id)).eq('organization_id', orgId)
        return { ok: true, message: `Toegewezen aan ${args.team_member}` }
      }
      case 'get_stats': {
        const today = new Date(); today.setHours(0, 0, 0, 0)
        const [{ count: total }, { count: highPot }, { count: todayCount }] = await Promise.all([
          db.from('contacts').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).neq('type', 'employee'),
          db.from('contacts').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('label', 'A').neq('type', 'employee'),
          db.from('contacts').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).gte('created_at', today.toISOString()).neq('type', 'employee'),
        ])
        return { ok: true, data: { total, highPotential: highPot, today: todayCount }, message: `Totaal: ${total}, A-label: ${highPot}, Vandaag: ${todayCount}` }
      }
      case 'list_team_members': {
        const { data } = await db.from('team_members')
          .select('id, naam, functie, color').eq('organization_id', orgId).eq('active', true).order('naam')
        return { ok: true, data: data ?? [], message: `${data?.length ?? 0} teamlid(en)` }
      }
      default:
        return { ok: false, message: `Onbekend tool: ${name}` }
    }
  } catch (err) {
    return { ok: false, message: String(err) }
  }
}

// ─── Chat history helpers ─────────────────────────────────────────────────────
async function loadHistory(sessionId: string, orgId: string) {
  try {
    const { data } = await adminSb().from('chat_messages')
      .select('role, content').eq('session_id', sessionId).eq('organization_id', orgId)
      .order('created_at', { ascending: false }).limit(15)
    return (data ?? []).reverse().map((r: { role: string; content: string | null }) => ({
      role: r.role as 'user' | 'assistant', content: r.content ?? '',
    }))
  } catch { return [] }
}

async function saveMessage(sessionId: string, orgId: string, role: 'user' | 'assistant', content: string) {
  try {
    await adminSb().from('chat_messages').insert({
      session_id: sessionId, organization_id: orgId, surface: 'web', role, content,
    })
  } catch { /* ignore */ }
}

// ─── Agentic loop (shared) ────────────────────────────────────────────────────
type OAIMessage = { role: string; content: unknown; tool_calls?: unknown[]; tool_call_id?: string; name?: string }

async function* agentLoop(messages: OAIMessage[], orgId: string): AsyncGenerator<string> {
  while (true) {
    const response = await openai.chat.completions.create({
      model: MODEL, messages: messages as never, tools: TOOL_SCHEMAS as never,
      tool_choice: 'auto', stream: true, temperature: 0, max_tokens: 1024,
    })

    let currentText = ''
    // deno-lint-ignore no-explicit-any
    const toolCalls: any[] = []

    for await (const chunk of response) {
      // deno-lint-ignore no-explicit-any
      const delta = (chunk as any).choices?.[0]?.delta
      if (!delta) continue

      if (delta.content) {
        currentText += delta.content
        yield delta.content
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          if (!toolCalls[idx]) toolCalls[idx] = { index: idx, id: tc.id ?? '', type: 'function', function: { name: tc.function?.name ?? '', arguments: '' } }
          if (tc.function?.name)      toolCalls[idx].function.name      += tc.function.name
          if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments
        }
      }
    }

    messages.push({
      role: 'assistant', content: currentText || null,
      ...(toolCalls.length ? { tool_calls: toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } })) } : {}),
    })

    if (!toolCalls.length) break

    for (const tc of toolCalls) {
      let toolArgs: Record<string, unknown> = {}
      try { toolArgs = JSON.parse(tc.function.arguments) } catch { /**/ }
      const result = await executeTool(tc.function.name, toolArgs, orgId)
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) })
    }
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }

  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  try {
    const body = await req.json()
    const orgId = body.call?.metadata?.org_id ?? body.organization_id ?? ORG_ID()

    // ── MODE 2: Retell LLM webhook ──────────────────────────────────────────
    if (body.interaction_type !== undefined) {
      const responseId = body.response_id ?? 0

      if (body.interaction_type === 'update_only') {
        return new Response(
          JSON.stringify({ response_type: 'response', response_id: responseId, content: '', content_complete: true }) + '\n',
          { headers: { ...cors, 'Content-Type': 'application/json' } },
        )
      }

      // Convert Retell transcript: Retell uses "agent" role, OpenAI uses "assistant"
      const messages: OAIMessage[] = [
        { role: 'system', content: VOICE_SYSTEM },
        // deno-lint-ignore no-explicit-any
        ...(body.transcript ?? []).map((m: any) => ({
          role:    m.role === 'agent' ? 'assistant' : 'user',
          content: m.content ?? '',
        })),
      ]

      const encoder = new TextEncoder()

      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const token of agentLoop(messages, orgId)) {
              const chunk = JSON.stringify({
                response_type: 'response', response_id: responseId,
                content: token, content_complete: false,
              })
              controller.enqueue(encoder.encode(chunk + '\n'))
            }
            const done = JSON.stringify({
              response_type: 'response', response_id: responseId,
              content: '', content_complete: true,
            })
            controller.enqueue(encoder.encode(done + '\n'))
          } catch (err) {
            console.error('[suus/retell]', err)
            const errChunk = JSON.stringify({
              response_type: 'response', response_id: responseId,
              content: 'Er ging iets mis.', content_complete: true,
            })
            controller.enqueue(encoder.encode(errChunk + '\n'))
          } finally {
            controller.close()
          }
        },
      })

      return new Response(stream, {
        headers: { ...cors, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked', 'Cache-Control': 'no-cache' },
      })
    }

    // ── MODE 1: Regular chat ────────────────────────────────────────────────
    const { message, session_id, image_url } = body
    if (!message || !session_id) return new Response('Missing message or session_id', { status: 400, headers: cors })

    await saveMessage(session_id, orgId, 'user', message)
    const history = await loadHistory(session_id, orgId)
    const prior   = history.slice(0, -1)

    // Build user content — add image if provided
    // deno-lint-ignore no-explicit-any
    const userContent: any = image_url
      ? [{ type: 'text', text: message }, { type: 'image_url', image_url: { url: image_url, detail: 'auto' } }]
      : message

    const messages: OAIMessage[] = [
      { role: 'system', content: CHAT_SYSTEM },
      ...prior,
      { role: 'user', content: userContent },
    ]

    const encoder = new TextEncoder()
    let fullText  = ''

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const token of agentLoop(messages, orgId)) {
            fullText += token
            controller.enqueue(encoder.encode(token))
          }
          await saveMessage(session_id, orgId, 'assistant', fullText.trim())
        } catch (err) {
          console.error('[suus/chat]', err)
          controller.enqueue(encoder.encode('\n\nEr ging iets mis. Probeer het opnieuw.'))
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
    })
  } catch (err) {
    console.error('[suus]', err)
    return new Response('Internal error', { status: 500, headers: cors })
  }
})
