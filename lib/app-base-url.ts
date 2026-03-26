/** Base URL for server-side calls back into this app (webhooks, internal jobs). */
export function appBaseUrl(): string {
  // In local dev use the actual port Next.js bound to (process.env.PORT is set by Next.js)
  if (process.env.NODE_ENV === 'development') {
    const port = process.env.PORT ?? '3000'
    return `http://localhost:${port}`
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, '')
  return 'http://localhost:3000'
}
