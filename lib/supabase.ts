import { createClient } from '@supabase/supabase-js'

export function adminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !svc) {
    throw new Error('Supabase env not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  }
  if (url.includes('xxxx') || !url.startsWith('http')) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL looks like a placeholder — use your real https://….supabase.co URL')
  }
  return createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } })
}
