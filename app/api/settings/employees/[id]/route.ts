import { NextResponse } from 'next/server'
import { resolveOrgId, adminDb } from '@/lib/auth/resolveOrg'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const oid = await resolveOrgId()
  if (!oid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json()
  const update: Record<string, unknown> = {}
  if (body.naam            !== undefined) update.naam             = body.naam
  if (body.email           !== undefined) update.email            = body.email           ?? null
  if (body.phone           !== undefined) update.phone            = body.phone           ?? null
  if (body.functie         !== undefined) update.functie          = body.functie         ?? null
  if (body.rayon           !== undefined) update.rayon            = body.rayon           ?? null
  if (body.postcode_ranges !== undefined) update.postcode_ranges  = body.postcode_ranges ?? []
  if (body.color           !== undefined) update.color            = body.color           ?? null
  if (body.ghl_user_id     !== undefined) update.ghl_user_id      = body.ghl_user_id     ?? null
  if (body.calendar_id     !== undefined) update.calendar_id      = body.calendar_id     ?? null
  if (body.active          !== undefined) update.active           = body.active

  const { data, error } = await adminDb()
    .from('team_members')
    .update(update)
    .eq('id', params.id)
    .eq('organization_id', oid)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const oid = await resolveOrgId()
  if (!oid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await adminDb()
    .from('team_members')
    .update({ active: false })
    .eq('id', params.id)
    .eq('organization_id', oid)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
