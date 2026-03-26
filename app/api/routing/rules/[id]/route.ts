import { NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'

const orgId = () => process.env.ORGANIZATION_ID?.trim() ?? null

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const oid = orgId()
  if (!oid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { error } = await adminSupabase()
      .from('routing_rules')
      .delete()
      .eq('id', params.id)
      .eq('organization_id', oid)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
