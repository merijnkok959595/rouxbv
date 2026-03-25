import { createClient } from '@supabase/supabase-js'

export function adminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !svc) throw new Error('Supabase env not configured')
  return createClient(url, svc)
}
