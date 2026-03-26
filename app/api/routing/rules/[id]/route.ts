import { NextResponse } from 'next/server'
import { resolveOrgId, adminDb } from '@/lib/auth/resolveOrg'

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const oid = await resolveOrgId()
  if (!oid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { error } = await adminDb()
    .from('routing_rules')
    .delete()
    .eq('id', params.id)
    .eq('organization_id', oid)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
