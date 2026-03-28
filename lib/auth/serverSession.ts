/**
 * Server-side session helpers.
 * Uses Web Crypto HMAC to create/verify session tokens stored in httpOnly cookies.
 * APP_SECRET is a non-public env var — never shipped in the client bundle.
 */

const COOKIE_NAME = 'roux_session'
const MAX_AGE     = 60 * 60 * 24 * 30 // 30 days

function secret(): string {
  return process.env.APP_SECRET ?? 'dev-only-change-in-prod'
}

async function hmac(data: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  )
  const sig  = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function createSessionToken(): Promise<string> {
  const ts  = String(Date.now())
  const sig = await hmac(ts)
  return `${ts}.${sig}`
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const dot  = token.lastIndexOf('.')
    if (dot < 0) return false
    const ts   = token.slice(0, dot)
    const sig  = token.slice(dot + 1)
    const expected = await hmac(ts)
    return expected === sig
  } catch {
    return false
  }
}

/** Cookie string for Set-Cookie header */
export function sessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
}

/** Extract session token from Cookie header */
export function getSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`))
  return match ? match[1] : null
}

/** Returns true if the current request has a valid session */
export async function hasValidSession(req: Request): Promise<boolean> {
  const token = getSessionToken(req.headers.get('cookie'))
  if (!token) return false
  return verifySessionToken(token)
}
