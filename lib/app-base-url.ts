/** Base URL for server-side calls back into this app (webhooks, internal jobs). */
export function appBaseUrl(): string {
  // In local dev always call ourselves on localhost — never route to the deployed URL
  if (process.env.NODE_ENV === 'development') return 'http://localhost:3000'
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, '')
  return 'http://localhost:3000'
}
