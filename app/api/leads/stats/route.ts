import { NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET() {
  try {
    const sb    = adminSupabase()
    const orgId = process.env.ORGANIZATION_ID?.trim()
    if (!orgId || !UUID_RE.test(orgId)) return NextResponse.json({ error: 'invalid org' }, { status: 400 })

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [{ count: total }, pipelineRes, { count: today }] = await Promise.all([
      sb.from('contacts').select('*', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .neq('type', 'employee'),

      sb.from('contacts').select('revenue')
        .eq('organization_id', orgId)
        .in('label', ['A', 'B'])
        .neq('type', 'employee')
        .not('revenue', 'is', null),

      sb.from('contacts').select('*', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .gte('created_at', todayStart.toISOString())
        .neq('type', 'employee'),
    ])

    const pipeline = (pipelineRes.data ?? []).reduce((sum, r) => sum + (r.revenue ?? 0), 0)

    return NextResponse.json({ total: total ?? 0, pipeline, today: today ?? 0 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
