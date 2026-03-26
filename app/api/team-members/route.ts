import { NextResponse }  from 'next/server'
import { adminSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const orgId = process.env.ORGANIZATION_ID?.trim() ?? ''
    const { data, error } = await adminSupabase()
      .from('team_members')
      .select('id, naam, functie, color, ghl_user_id, calendar_id, phone')
      .eq('organization_id', orgId)
      .eq('active', true)
      .not('ghl_user_id', 'is', null)
      .order('naam')

    if (error) throw error
    return NextResponse.json({ members: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
