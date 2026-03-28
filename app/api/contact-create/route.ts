import { NextRequest, NextResponse } from 'next/server'
import { contactCreate, buildCustomFields } from '@/lib/ghl-client'
import { adminSupabase } from '@/lib/supabase'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      companyName?:       string
      firstName?:         string
      lastName?:          string
      klantType?:         string
      phone?:             string
      email?:             string
      address1?:          string
      postalCode?:        string
      city?:              string
      website?:           string
      openingHours?:      string
      groothandel?:       string
      posMateriaal?:      string
      kortingsafspraken?: string
      producten?:         string
      notes?:             string
    }

    const customFields = buildCustomFields({
      klantType:         body.klantType,
      groothandel:       body.groothandel,
      posMateriaal:      body.posMateriaal,
      kortingsafspraken: body.kortingsafspraken,
      openingstijden:    body.openingHours,
      producten:         body.producten,
    })

    const result = await contactCreate({
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

    const contactId = result?.contact?.id
    if (!contactId) {
      return NextResponse.json({ error: 'Geen contact ID ontvangen van GHL' }, { status: 500 })
    }

    // Mirror to Supabase contacts (leads list)
    const orgId = process.env.ORGANIZATION_ID
    if (orgId) {
      await adminSupabase()
        .from('contacts')
        .insert({
          organization_id: orgId,
          company_name:    body.companyName ?? '',
          first_name:      body.firstName   || null,
          last_name:       body.lastName    || null,
          email:           body.email       || null,
          phone:           body.phone       || null,
          address1:        body.address1    || null,
          postcode:        body.postalCode  || null,
          city:            body.city        || null,
          type:            body.klantType?.toLowerCase() ?? 'lead',
          source:          'suus',
          custom_fields: {
            ghl_id:            contactId,
            groothandel:       body.groothandel       || null,
            pos_materiaal:     body.posMateriaal      || null,
            kortingsafspraken: body.kortingsafspraken || null,
            producten:         body.producten         || null,
            opening_hours:     body.openingHours      || null,
            website:           body.website           || null,
          },
        })
    }

    return NextResponse.json({ contactId, companyName: body.companyName })
  } catch (err) {
    console.error('[contact-create]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Onbekende fout' },
      { status: 500 }
    )
  }
}
