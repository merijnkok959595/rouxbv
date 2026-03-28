import { NextResponse, type NextRequest } from 'next/server'
import { getSessionToken, verifySessionToken } from '@/lib/auth/serverSession'

/** Routes that require a valid server session */
const PROTECTED = [
  '/api/retell/create-call',
  '/api/suus/transcribe',
  '/api/suus/save-message',
  '/api/suus',
  '/api/settings/seed-users',
  '/api/admin',
  '/api/contact-create',
  '/api/contact-update',
  '/api/contacts',
  '/api/leads',
  '/api/awards',
  '/api/settings/employees',
  '/api/routing',
  '/api/intelligence',
]

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const needsAuth = PROTECTED.some(p => pathname.startsWith(p))
  if (!needsAuth) return NextResponse.next()

  const token = getSessionToken(req.headers.get('cookie'))
  if (!token || !(await verifySessionToken(token))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}
