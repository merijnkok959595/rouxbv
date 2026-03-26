import { NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const sb    = adminSupabase()
  const orgId = process.env.ORGANIZATION_ID?.trim()
  if (!orgId) return NextResponse.json({ error: 'no org' }, { status: 500 })

  const { data, error } = await sb
    .from('contacts')
    .select('id, label, revenue, assigned_to')
    .eq('id', params.id)
    .eq('organization_id', orgId)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
