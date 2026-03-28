import { NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase'
import { requireOrgId, isValidOrgId } from '@/lib/auth/resolveOrg'

export const runtime = 'nodejs'

const PAGE_SIZE = 100

export async function GET(req: Request) {
  try {
    const sb     = adminSupabase()
    const orgId  = requireOrgId()
    if (!isValidOrgId(orgId)) return NextResponse.json({ error: orgId }, { status: 400 })

    const { searchParams } = new URL(req.url)
    const cursor = searchParams.get('cursor') // ISO timestamp — load rows older than this
    const limit  = Math.min(Number(searchParams.get('limit') ?? PAGE_SIZE), 500)

    let q = sb
      .from('contacts')
      .select('id, company_name, first_name, last_name, phone, address1, postcode, city, type, label, revenue, assigned_to, source, whatsapp, ghl_synced, created_at, custom_fields')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (cursor) q = q.lt('created_at', cursor)

    const { data, error } = await q

    if (error) throw new Error(error.message)

    const leads    = data ?? []
    const nextCursor = leads.length === limit ? leads[leads.length - 1].created_at : null

    return NextResponse.json({ leads, nextCursor })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[leads GET]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
