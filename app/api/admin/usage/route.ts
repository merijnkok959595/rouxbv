import { NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'

const PRICING: Record<string, { input: number; output: number; label: string }> = {
  'gpt-4o-mini':                 { input: 0.15,  output: 0.60,   label: 'GPT-4o mini'          },
  'gpt-4o':                      { input: 2.50,  output: 10.00,  label: 'GPT-4o'               },
  'gpt-4o-realtime-preview':     { input: 5.00,  output: 20.00,  label: 'GPT-4o Realtime'      },
  'gpt-4o-transcribe':           { input: 3.00,  output: 0,      label: 'GPT-4o Transcribe'    },
  'whisper-1':                   { input: 0.006, output: 0,      label: 'Whisper'               },
}

function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model] ?? { input: 2.50, output: 10.00 }
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000
}

export async function GET() {
  try {
    const sb    = adminSupabase()
    const orgId = process.env.ORGANIZATION_ID?.trim()
    if (!orgId) return NextResponse.json({ error: 'no org' }, { status: 500 })

    const since30d = new Date()
    since30d.setDate(since30d.getDate() - 30)
    const sinceStr = since30d.toISOString()

    // ── Supabase stats ────────────────────────────────────────────────────────
    const [
      { count: totalContacts },
      { count: totalLeads },
      { count: totalCustomers },
      enrichedRes,
      eventsRes,
      eventsByDayRes,
    ] = await Promise.all([
      sb.from('contacts').select('*', { count: 'exact', head: true }).eq('organization_id', orgId),
      sb.from('contacts').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('type', 'lead'),
      sb.from('contacts').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('type', 'customer'),
      sb.from('contacts').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).not('label', 'is', null),
      sb.from('contact_events').select('event_type').eq('organization_id', orgId).gte('created_at', sinceStr),
      sb.from('contact_events').select('event_type, created_at').eq('organization_id', orgId).gte('created_at', sinceStr).order('created_at', { ascending: true }),
    ])

    // Group events by type
    const eventCounts: Record<string, number> = {}
    for (const ev of eventsRes.data ?? []) {
      eventCounts[ev.event_type] = (eventCounts[ev.event_type] ?? 0) + 1
    }

    // Group events by day
    const byDay: Record<string, Record<string, number>> = {}
    for (const ev of eventsByDayRes.data ?? []) {
      const day = ev.created_at.slice(0, 10)
      if (!byDay[day]) byDay[day] = {}
      byDay[day][ev.event_type] = (byDay[day][ev.event_type] ?? 0) + 1
    }
    const eventsByDay = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }))

    // ── OpenAI usage (try admin API, fall back gracefully) ───────────────────
    let openaiUsage: null | { models: { model: string; label: string; requests: number; input_tokens: number; output_tokens: number; cost_usd: number }[] } = null

    const adminKey = process.env.OPENAI_ADMIN_KEY ?? process.env.OPENAI_API_KEY
    if (adminKey) {
      try {
        const startTime = Math.floor(since30d.getTime() / 1000)
        const endTime   = Math.floor(Date.now() / 1000)
        const res = await fetch(
          `https://api.openai.com/v1/organization/usage/completions?start_time=${startTime}&end_time=${endTime}&bucket_width=1d&limit=30`,
          { headers: { Authorization: `Bearer ${adminKey}` }, signal: AbortSignal.timeout(8000) }
        )
        if (res.ok) {
          const json = await res.json() as { data?: { results?: { model_id?: string; num_model_requests?: number; input_tokens?: number; output_tokens?: number }[] }[] }
          const modelMap: Record<string, { requests: number; input_tokens: number; output_tokens: number }> = {}
          for (const bucket of json.data ?? []) {
            for (const r of bucket.results ?? []) {
              const m = r.model_id ?? 'unknown'
              if (!modelMap[m]) modelMap[m] = { requests: 0, input_tokens: 0, output_tokens: 0 }
              modelMap[m].requests    += r.num_model_requests ?? 0
              modelMap[m].input_tokens  += r.input_tokens ?? 0
              modelMap[m].output_tokens += r.output_tokens ?? 0
            }
          }
          openaiUsage = {
            models: Object.entries(modelMap)
              .map(([model, v]) => ({
                model,
                label: PRICING[model]?.label ?? model,
                ...v,
                cost_usd: costUsd(model, v.input_tokens, v.output_tokens),
              }))
              .sort((a, b) => b.cost_usd - a.cost_usd),
          }
        }
      } catch { /* graceful — no usage data */ }
    }

    // ── Estimated costs from events (fallback when no admin key) ─────────────
    const enrichCount = eventCounts['enrichment'] ?? 0
    const chatCount   = eventCounts['routing']    ?? 0  // routing uses AI
    // Rough: enrichment ~2500 in + 600 out gpt-4o-mini; routing ~800 in + 200 out gpt-4o-mini
    const estimatedCost = (
      enrichCount * costUsd('gpt-4o-mini', 2500, 600) +
      chatCount   * costUsd('gpt-4o-mini', 800, 200)
    )

    return NextResponse.json({
      supabase: {
        contacts:   { total: totalContacts ?? 0, leads: totalLeads ?? 0, customers: totalCustomers ?? 0, enriched: enrichedRes.count ?? 0 },
        events:     { ...eventCounts, total_30d: (eventsRes.data ?? []).length },
      },
      events_by_day: eventsByDay,
      openai: openaiUsage,
      estimated: openaiUsage ? null : {
        enrichments: enrichCount,
        ai_routings: chatCount,
        cost_usd:    estimatedCost,
        note: 'Geschatte kosten op basis van event-tellingen. Voeg OPENAI_ADMIN_KEY toe voor exacte token-data.',
      },
    })
  } catch (err) {
    console.error('[admin/usage]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
