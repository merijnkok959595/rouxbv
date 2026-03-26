import { NextRequest, NextResponse } from 'next/server'
import { contactCreate, buildCustomFields } from '@/lib/ghl-client'

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

    return NextResponse.json({ contactId, companyName: body.companyName })
  } catch (err) {
    console.error('[contact-create]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Onbekende fout' },
      { status: 500 }
    )
  }
}
