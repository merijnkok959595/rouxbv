import { NextResponse }                        from 'next/server'
import { createSessionToken, sessionCookie }  from '@/lib/auth/serverSession'

export const runtime = 'nodejs'

const APP_PASSWORD   = process.env.APP_PASSWORD   ?? process.env.NEXT_PUBLIC_APP_PASSWORD   ?? 'roux'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? process.env.NEXT_PUBLIC_ADMIN_PASSWORD ?? 'admin'

export async function POST(req: Request) {
  const { password, scope } = await req.json() as { password?: string; scope?: 'app' | 'admin' }

  const expected = scope === 'admin' ? ADMIN_PASSWORD : APP_PASSWORD
  if (!expected || password !== expected) {
    return NextResponse.json({ error: 'Onjuiste code' }, { status: 401 })
  }

  const token = await createSessionToken()
  const res   = NextResponse.json({ ok: true, scope: scope ?? 'app' })
  res.headers.set('Set-Cookie', sessionCookie(token))
  return res
}
