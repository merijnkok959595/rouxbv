import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Singleton — all routes share one client instance and its connection pool.
// This avoids repeated DNS lookups (which can fail if the resolver is flaky)
// and reduces cold-start overhead.
let _client: SupabaseClient | null = null

export function adminSupabase(): SupabaseClient {
  if (_client) return _client

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!url || !svc) {
    throw new Error('Supabase env not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  }
  if (url.includes('xxxx') || !url.startsWith('http')) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL looks like a placeholder — use your real https://….supabase.co URL')
  }

  _client = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } })
  return _client
}
