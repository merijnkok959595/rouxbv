import { NextRequest, NextResponse } from 'next/server'
import { contactGet } from '@/lib/ghl-client'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id.trim()) return NextResponse.json({ error: 'id param required' }, { status: 400 })
  try {
    const result = await contactGet(id)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
