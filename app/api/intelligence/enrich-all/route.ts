import { NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase'
import { appBaseUrl } from '@/lib/app-base-url'

export const runtime = 'nodejs'

export async function POST() {
  const orgId = process.env.ORGANIZATION_ID?.trim() ?? null
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: contacts, error } = await adminSupabase()
    .from('contacts')
    .select('id, company_name, city')
    .eq('organization_id', orgId)
    .not('company_name', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!contacts?.length) return NextResponse.json({ scored: 0 })

  const baseUrl = appBaseUrl()
  let scored = 0
  const errors: string[] = []

  for (const contact of contacts) {
    try {
      const res = await fetch(`${baseUrl}/api/intelligence/enrich`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ contact_id: contact.id, organization_id: orgId }),
      })
      if (res.ok) {
        scored++
      } else {
        const e = await res.json().catch(() => ({}))
        errors.push(`${contact.company_name}: ${(e as { error?: string }).error ?? res.status}`)
      }
    } catch (err) {
      errors.push(`${contact.company_name}: ${String(err)}`)
    }
  }

  return NextResponse.json({ scored, total: contacts.length, errors })
}
