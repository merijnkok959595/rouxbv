/** Base URL for server-side calls back into this app (webhooks, internal jobs). */
export function appBaseUrl(): string {
  if (process.env.NODE_ENV === 'development') {
    const port = process.env.PORT ?? '3000'
    return `http://localhost:${port}`
  }
  // Prefer explicit production URL over auto-generated Vercel deployment URL
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}
