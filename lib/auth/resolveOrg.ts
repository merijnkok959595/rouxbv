/**
 * Single source of truth for org resolution in API routes.
 * ROUX is single-tenant — no auth required, org comes from env var.
 */

export function resolveOrgId(): string | null {
  return process.env.ORGANIZATION_ID?.trim() ?? null
}
