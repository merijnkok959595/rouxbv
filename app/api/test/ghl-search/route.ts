import { NextRequest, NextResponse } from 'next/server'
import { contactSearch } from '@/lib/ghl-client'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? ''
  if (!q.trim()) return NextResponse.json({ error: 'q param required' }, { status: 400 })
  try {
    const result = await contactSearch(q, 20)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
