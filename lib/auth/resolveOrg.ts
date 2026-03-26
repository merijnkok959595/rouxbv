/**
 * Single source of truth for org resolution in API routes.
 * ROUX is single-tenant — no auth required, org comes from env var.
 */

import { createClient } from '@supabase/supabase-js'

export function adminDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export async function resolveOrgId(): Promise<string | null> {
  return process.env.ORGANIZATION_ID?.trim() ?? null
}
