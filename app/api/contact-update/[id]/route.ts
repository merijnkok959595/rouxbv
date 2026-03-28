import { NextRequest, NextResponse } from 'next/server'
import { contactUpdate, buildCustomFields } from '@/lib/ghl-client'
import { adminSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const contactId = params.id
    if (!contactId) return NextResponse.json({ error: 'Geen contact ID' }, { status: 400 })

    const body = await req.json() as {
      companyName?:       string
      firstName?:         string
      lastName?:          string
      phone?:             string
      email?:             string
      address1?:          string
      postalCode?:        string
      city?:              string
      website?:           string
      openingHours?:      string
      groothandel?:       string
      klantType?:         string
      posMateriaal?:      string
      kortingsafspraken?: string
      producten?:         string
    }

    const customFields = buildCustomFields({
      klantType:         body.klantType,
      groothandel:       body.groothandel,
      posMateriaal:      body.posMateriaal,
      kortingsafspraken: body.kortingsafspraken,
      openingstijden:    body.openingHours,
      producten:         body.producten,
    })

    const result = await contactUpdate(contactId, {
      firstName:   body.firstName   || undefined,
      lastName:    body.lastName    || undefined,
      email:       body.email       || undefined,
      phone:       body.phone       || undefined,
      companyName: body.companyName || undefined,
      address1:    body.address1    || undefined,
      postalCode:  body.postalCode  || undefined,
      city:        body.city        || undefined,
      customFields,
    })

    const updatedId = result?.contact?.id ?? contactId

    // Mirror to Supabase contacts (leads list) — upsert by ghl_id in custom_fields
    const orgId = process.env.ORGANIZATION_ID
    if (orgId) {
      const sb = adminSupabase()
      // Find existing Supabase row by GHL contact ID stored in custom_fields
      const { data: existing } = await sb
        .from('contacts')
        .select('id')
        .eq('organization_id', orgId)
        .eq('custom_fields->>ghl_id', updatedId)
        .maybeSingle()

      const patch = {
        company_name: body.companyName ?? undefined,
        first_name:   body.firstName   || null,
        last_name:    body.lastName    || null,
        email:        body.email       || null,
        phone:        body.phone       || null,
        address1:     body.address1    || null,
        postcode:     body.postalCode  || null,
        city:         body.city        || null,
        ...(body.klantType ? { type: body.klantType.toLowerCase() } : {}),
        custom_fields: {
          ghl_id:            updatedId,
          groothandel:       body.groothandel       || null,
          pos_materiaal:     body.posMateriaal      || null,
          kortingsafspraken: body.kortingsafspraken || null,
          producten:         body.producten         || null,
          opening_hours:     body.openingHours      || null,
          website:           body.website           || null,
        },
      }

      if (existing?.id) {
        await sb.from('contacts').update(patch).eq('id', existing.id)
      } else {
        await sb.from('contacts').insert({ ...patch, organization_id: orgId, source: 'suus' })
      }
    }

    return NextResponse.json({ contactId: updatedId, companyName: body.companyName })
  } catch (err) {
    console.error('[contact-update]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Onbekende fout' },
      { status: 500 },
    )
  }
}
