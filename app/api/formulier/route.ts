import { NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase'
import { appBaseUrl } from '@/lib/app-base-url'
import { contactCreate, contactUpdate, contactSearchAdvanced, buildCustomFields, CF } from '@/lib/ghl-client'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const sb = adminSupabase()

    const orgId = process.env.ORGANIZATION_ID?.trim()
    if (!orgId) {
      return NextResponse.json({ error: 'ORGANIZATION_ID ontbreekt in .env.local' }, { status: 500 })
    }
    if (orgId === 'your-org-uuid-here' || !UUID_RE.test(orgId)) {
      return NextResponse.json(
        {
          error:
            'ORGANIZATION_ID moet een echte UUID zijn (geen placeholder). In Supabase: SQL Editor → `select id from organizations limit 1;` of Table Editor → organizations → kolom id. Zet die waarde in .env.local en herstart npm run dev.',
        },
        { status: 400 },
      )
    }

    const {
      company, first_name, last_name, email, phone,
      address, city, postcode, country,
      assigned_to, status, notes, source, channel, opening_hours, created_by,
    } = body as {
      company: string; first_name?: string; last_name?: string; email?: string; phone?: string
      address?: string; city?: string; postcode?: string; country?: string
      assigned_to?: string; status?: string; notes?: string; source?: string; channel?: string
      opening_hours?: unknown; created_by?: string
    }

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
        country:         country?.trim() || 'Nederland',
        assigned_to:     assigned_to || null,
        type:            status      || 'lead',
        source:          source      || null,
        channel:         channel     || 'OFFLINE',
        custom_fields:   (notes || created_by) ? { ...(notes ? { intake_notes: notes } : {}), ...(created_by ? { created_by } : {}) } : null,
        opening_hours:   opening_hours || null,
      })
      .select('id, assigned_to')
      .single()

    if (error) throw new Error(error.message)

    // ── Sync to GHL (fire-and-forget, non-blocking) ──────────────────────────
    void (async () => {
      try {
        const ghlData = {
          firstName:    first_name  || undefined,
          lastName:     last_name   || undefined,
          email:        email       || undefined,
          phone:        phone       || undefined,
          companyName:  company,
          address1:     address     || undefined,
          postalCode:   postcode    || undefined,
          city:         city        || undefined,
          country:      country?.trim() || 'NL',
          customFields: buildCustomFields({ klantType: status === 'klant' ? 'Klant' : 'Lead' }),
        }

        // Check for duplicate by company name (+ phone/email if available)
        const existing = await contactSearchAdvanced({ searchTerms: [company], ...(city ? { cityFilter: city } : {}) })
        const duplicate = existing?.contacts?.find(c =>
          c.companyName?.toLowerCase().trim() === company.toLowerCase().trim() ||
          (email && c.email === email) ||
          (phone && c.phone?.replace(/\D/g, '') === phone.replace(/\D/g, ''))
        )

        let ghlId: string | null = null
        if (duplicate?.id) {
          // Update existing GHL contact
          await contactUpdate(duplicate.id, ghlData)
          ghlId = duplicate.id
          console.log(`[formulier] GHL updated existing contact ${ghlId} (${company})`)
        } else {
          // Create new GHL contact
          const created = await contactCreate(ghlData)
          ghlId = created?.contact?.id ?? null
          console.log(`[formulier] GHL created contact ${ghlId} (${company})`)
        }

        if (ghlId) {
          await adminSupabase()
            .from('contacts')
            .update({
              ghl_synced:    true,
              custom_fields: { intake_notes: notes || null, created_by: created_by || null, ghl_contact_id: ghlId },
            })
            .eq('id', contact.id)
        }
      } catch (ghlErr) {
        console.error('[formulier] GHL sync failed (non-fatal):', ghlErr)
      }
    })()

    // Fire-and-forget: route + enrich every new contact automatically
    const base    = appBaseUrl()
    const payload = { contact_id: contact.id, organization_id: orgId }
    void fetch(`${base}/api/routing/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {})
    void fetch(`${base}/api/intelligence/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {})

    return NextResponse.json({ id: contact.id, assigned_to: contact.assigned_to })
  } catch (err) {
    let msg = err instanceof Error ? err.message : String(err)
    if (msg === 'fetch failed' || msg.includes('fetch failed')) {
      msg =
        'Geen verbinding met Supabase (fetch failed). Controleer NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY en internet; geen placeholder-URL (xxxx) gebruiken.'
    }
    console.error('[formulier]', err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
