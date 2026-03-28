import { NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase'
import { appBaseUrl } from '@/lib/app-base-url'
import { requireOrgId, isValidOrgId } from '@/lib/auth/resolveOrg'

export const runtime     = 'nodejs'
export const maxDuration = 300 // 5 min — batch enrichment takes time

const CONCURRENCY = 5 // max parallel enrich calls

export async function POST() {
  const orgId = requireOrgId()
  if (!isValidOrgId(orgId)) return NextResponse.json({ error: orgId }, { status: 400 })

  const { data: contacts, error } = await adminSupabase()
    .from('contacts')
    .select('id, company_name, city')
    .eq('organization_id', orgId)
    .not('company_name', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!contacts?.length) return NextResponse.json({ scored: 0, total: 0 })

  const baseUrl = appBaseUrl()
  let scored = 0
  const errors: string[] = []

  // Run in batches of CONCURRENCY to avoid hammering OpenAI + Outscraper
  for (let i = 0; i < contacts.length; i += CONCURRENCY) {
    const batch = contacts.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(contact =>
        fetch(`${baseUrl}/api/intelligence/enrich`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ contact_id: contact.id, organization_id: orgId }),
          signal:  AbortSignal.timeout(60_000),
        }),
      ),
    )

    for (let j = 0; j < results.length; j++) {
      const result  = results[j]
      const contact = batch[j]
      if (result.status === 'fulfilled' && result.value.ok) {
        scored++
      } else {
        const msg = result.status === 'rejected'
          ? String(result.reason)
          : await result.value.json().then((e: { error?: string }) => e.error ?? result.value.status).catch(() => result.value.status)
        errors.push(`${contact.company_name}: ${msg}`)
      }
    }
  }

  return NextResponse.json({ scored, total: contacts.length, errors })
}
