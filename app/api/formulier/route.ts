import { NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const sb = adminSupabase()

    const orgId = process.env.ORGANIZATION_ID
    if (!orgId) return NextResponse.json({ error: 'ORGANIZATION_ID not set' }, { status: 500 })

    const {
      company, first_name, last_name, email, phone,
      address, city, postcode, country,
      assigned_to, status, notes, source, channel, opening_hours,
    } = body

    if (!company) return NextResponse.json({ error: 'company required' }, { status: 400 })

    // Create contact
    const { data: contact, error } = await sb
      .from('contacts')
      .insert({
        organization_id: orgId,
        company_name:    company,
        first_name:      first_name  || null,
        last_name:       last_name   || null,
        email:           email       || null,
        phone:           phone       || null,
        address1:        address     || null,
        city:            city        || null,
        postcode:        postcode    || null,
        country:         country     || 'NL',
        assigned_to:     assigned_to || null,
        type:            status      || 'lead',
        source:          source      || null,
        channel:         channel     || 'OFFLINE',
        custom_fields:   notes ? { intake_notes: notes } : null,
        opening_hours:   opening_hours || null,
      })
      .select('id, assigned_to')
      .single()

    if (error) throw new Error(error.message)

    // Fire intelligence + routing in parallel (non-blocking)
    const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000'

    const fire = (path: string, b: object) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(b),
      }).catch(() => {})

    fire('/api/intelligence/enrich', { contact_id: contact.id, organization_id: orgId })
    fire('/api/routing/apply',       { contact_id: contact.id, organization_id: orgId })

    return NextResponse.json({ id: contact.id, assigned_to: contact.assigned_to })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[formulier]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
