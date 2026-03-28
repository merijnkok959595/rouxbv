/**
 * Single source of truth for org resolution and validation in API routes.
 * ROUX is single-tenant — org comes from ORGANIZATION_ID env var.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function resolveOrgId(): string | null {
  return process.env.ORGANIZATION_ID?.trim() ?? null
}

/**
 * Validates org ID and returns it, or returns an error string to pass to NextResponse.json.
 * Usage:
 *   const orgId = requireOrgId()
 *   if (typeof orgId !== 'string' || orgId.startsWith('ERR:')) return NextResponse.json({ error: orgId }, { status: 400 })
 */
export function requireOrgId(): string {
  const id = process.env.ORGANIZATION_ID?.trim()
  if (!id)                              return 'ORGANIZATION_ID ontbreekt in .env.local'
  if (id === 'your-org-uuid-here')      return 'ORGANIZATION_ID is nog een placeholder — vul de echte UUID in'
  if (!UUID_RE.test(id))                return 'ORGANIZATION_ID moet een geldige UUID zijn (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)'
  return id
}

/** Returns true when the string is a valid UUID-format org ID (not an error message). */
export function isValidOrgId(value: string): boolean {
  return UUID_RE.test(value)
}
