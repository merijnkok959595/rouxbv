import { NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'

const orgId = () => process.env.ORGANIZATION_ID?.trim() ?? null

export async function POST(req: Request) {
  const oid = orgId()
  if (!oid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const db   = adminSupabase()

    const { count } = await db
      .from('routing_rules')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', oid)

    const { data, error } = await db
      .from('routing_rules')
      .insert({
        organization_id: oid,
        phase:           body.phase      ?? 'body',
        condition:       body.condition  ?? 'name_contains',
        value:           body.value      ?? '',
        assign_to_id:    body.assign_to_id ?? null,
        position:        count           ?? 0,
        active:          true,
      })
      .select('*, team_members(naam)')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    type RuleRaw = Record<string, unknown> & { team_members?: { naam: string } | null }
    const rule = { ...(data as RuleRaw), assign_to_naam: (data as RuleRaw).team_members?.naam ?? null }
    delete (rule as Record<string, unknown>).team_members

    return NextResponse.json(rule)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
