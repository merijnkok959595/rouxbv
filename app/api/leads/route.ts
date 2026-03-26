import { NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET() {
  try {
    const sb = adminSupabase()
    const orgId = process.env.ORGANIZATION_ID?.trim()
    if (!orgId || orgId === 'your-org-uuid-here' || !UUID_RE.test(orgId)) {
      return NextResponse.json(
        { error: 'ORGANIZATION_ID in .env.local moet een geldige organization-UUID zijn (zie formulier-API fouttekst).' },
        { status: 400 },
      )
    }

    const { data, error } = await sb
      .from('contacts')
      .select(
        'id, company_name, city, type, label, revenue, assigned_to, source, whatsapp, ghl_synced, created_at, custom_fields',
      )
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) throw new Error(error.message)

    return NextResponse.json({ leads: data ?? [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[leads GET]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
