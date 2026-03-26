import { NextRequest, NextResponse } from 'next/server'
import { contactUpdate, buildCustomFields } from '@/lib/ghl-client'

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
      posMateriaal?:      string
      kortingsafspraken?: string
      producten?:         string
    }

    const customFields = buildCustomFields({
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
    return NextResponse.json({ contactId: updatedId, companyName: body.companyName })
  } catch (err) {
    console.error('[contact-update]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Onbekende fout' },
      { status: 500 },
    )
  }
}
