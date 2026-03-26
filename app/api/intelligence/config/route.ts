import { NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'

const orgId = () => process.env.ORGANIZATION_ID?.trim() ?? null

export async function GET() {
  const oid = orgId()
  if (!oid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { data, error } = await adminSupabase()
      .from('intelligence_config')
      .select('*')
      .eq('organization_id', oid)
      .limit(1)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data ?? {})
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

const WRITABLE = new Set([
  'system_prompt',
  'knowledge_base',
  'enrich_websearch',
  'enrich_webcrawl',
  'enrich_maps',
  'enrich_linkedin',
  'benchmark_assumptions',
  'benchmark_customers',
  'scoring_prompt',
])

export async function PUT(req: Request) {
  const oid = orgId()
  if (!oid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body   = await req.json()
    const update: Record<string, unknown> = {}

    for (const key of Object.keys(body)) {
      if (WRITABLE.has(key)) update[key] = body[key] ?? null
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
    }

    const db = adminSupabase()

    await db.from('intelligence_config')
      .upsert({ organization_id: oid }, { onConflict: 'organization_id', ignoreDuplicates: true })

    const { data, error } = await db.from('intelligence_config')
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
