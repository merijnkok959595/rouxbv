import { NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'

const orgId = () => process.env.ORGANIZATION_ID?.trim() ?? null

export async function GET() {
  const oid = orgId()
  if (!oid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await adminSupabase()
    .from('team_members')
    .select('id, naam, email, phone, functie, rayon, ghl_user_id, calendar_id, postcode_ranges, color, active')
    .eq('organization_id', oid)
    .eq('active', true)
    .order('naam', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: Request) {
  const oid = orgId()
  if (!oid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  if (!body.naam?.trim()) return NextResponse.json({ error: 'naam required' }, { status: 400 })

  const { data, error } = await adminSupabase()
    .from('team_members')
    .insert({
      organization_id: oid,
      naam:            body.naam.trim(),
      email:           body.email?.trim()    || null,
      phone:           body.phone?.trim()    || null,
      functie:         body.functie?.trim()  || null,
      rayon:           body.rayon?.trim()    || null,
      ghl_user_id:     body.ghl_user_id     || null,
      calendar_id:     body.calendar_id     || null,
      postcode_ranges: Array.isArray(body.postcode_ranges) ? body.postcode_ranges : [],
      color:           body.color || null,
      active:          true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
