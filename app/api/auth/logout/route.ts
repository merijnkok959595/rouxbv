import { NextResponse } from 'next/server'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.headers.set('Set-Cookie', 'roux_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
  return res
}
