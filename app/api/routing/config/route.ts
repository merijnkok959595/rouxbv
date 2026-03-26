import { NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'

const orgId = () => process.env.ORGANIZATION_ID?.trim() ?? null

export async function GET() {
  const oid = orgId()
  if (!oid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const db = adminSupabase()

    const [{ data: cfgRows, error: cfgErr }, { data: rulesRows, error: rulesErr }] = await Promise.all([
      db.from('routing_config')
        .select('*, pre_tm:team_members!pre_routing_assign_to_id(id, naam), fallback_tm:team_members!fallback_user_id(id, naam)')
        .eq('organization_id', oid)
        .limit(1),
      db.from('routing_rules')
        .select('*, team_members(id, naam)')
        .eq('organization_id', oid)
        .order('position', { ascending: true }),
    ])

    if (cfgErr) return NextResponse.json({ error: cfgErr.message }, { status: 500 })
    if (rulesErr) return NextResponse.json({ error: rulesErr.message }, { status: 500 })

    type CfgRaw = Record<string, unknown> & {
      pre_tm?:      { id: string; naam: string } | null
      fallback_tm?: { id: string; naam: string } | null
    }

    const rawCfg = (cfgRows as CfgRaw[])?.[0] ?? null
    const config = rawCfg ? {
      ...rawCfg,
      pre_routing_assign_to_naam: rawCfg.pre_tm?.naam    ?? null,
      fallback_user_naam:         rawCfg.fallback_tm?.naam ?? null,
    } : null

    const rules = (rulesRows ?? []).map((r: Record<string, unknown> & { team_members?: { id: string; naam: string } | null }) => ({
      ...r,
      assign_to_naam: r.team_members?.naam ?? null,
    }))

    return NextResponse.json({ config, rules })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

const WRITABLE = new Set([
  'pre_routing_prompt',
  'pre_routing_assign_to_id',
  'pre_routing_websearch',
  'fallback_user_id',
  'fallback_ai',
  'routing_disabled',
  'skip_pre',
  'skip_body',
])

export async function PUT(req: Request) {
  const oid = orgId()
  if (!oid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const key of Object.keys(body)) {
      if (WRITABLE.has(key)) update[key] = body[key] ?? null
    }
    if (Object.keys(update).length === 1) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })

    const db = adminSupabase()

    // Ensure row exists
    await db.from('routing_config')
      .upsert({ organization_id: oid, updated_at: new Date().toISOString() }, { onConflict: 'organization_id', ignoreDuplicates: true })

    const { data, error } = await db.from('routing_config')
      .update(update)
      .eq('organization_id', oid)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data ?? {})
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
