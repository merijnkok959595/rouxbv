import { NextResponse } from 'next/server'
import { resolveOrgId, adminDb } from '@/lib/auth/resolveOrg'

const SB_URL = () => process.env.NEXT_PUBLIC_SUPABASE_URL!.trim()
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY!.trim()

async function fetchConfig(oid: string) {
  const url = `${SB_URL()}/rest/v1/intelligence_config?organization_id=eq.${oid}&limit=1`
  const res = await fetch(url, {
    headers: {
      apikey:        SB_KEY(),
      Authorization: `Bearer ${SB_KEY()}`,
      Accept:        'application/json',
    },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const rows = await res.json() as Record<string, unknown>[]
  return rows[0] ?? null
}

export async function GET() {
  const oid = await resolveOrgId()
  if (!oid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const cfg = await fetchConfig(oid)
  return NextResponse.json(cfg ?? {})
}

const WRITABLE = new Set([
  'system_prompt',
  'knowledge_base',
  'enrich_websearch',
  'enrich_webcrawl',
  'enrich_maps',
  'enrich_linkedin',
  'benchmark_assumptions',
  'benchmark_customers',
  'scoring_prompt',
])

export async function PUT(req: Request) {
  const oid = await resolveOrgId()
  if (!oid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body   = await req.json()
  const update: Record<string, unknown> = {}

  for (const key of Object.keys(body)) {
    if (WRITABLE.has(key)) update[key] = body[key] ?? null
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
  }

  const db = adminDb()

  // Ensure row exists
  await db.from('intelligence_config')
    .upsert({ organization_id: oid }, { onConflict: 'organization_id', ignoreDuplicates: true })

  const patchUrl = `${SB_URL()}/rest/v1/intelligence_config?organization_id=eq.${oid}`
  const patchRes = await fetch(patchUrl, {
    method:  'PATCH',
    headers: {
      apikey:         SB_KEY(),
      Authorization:  `Bearer ${SB_KEY()}`,
      'Content-Type': 'application/json',
      Prefer:         'return=representation',
    },
    body: JSON.stringify(update),
    cache: 'no-store',
  })

  if (!patchRes.ok) {
    const err = await patchRes.text()
    return NextResponse.json({ error: err }, { status: 500 })
  }

  const rows = await patchRes.json() as Record<string, unknown>[]
  return NextResponse.json(rows[0] ?? {})
}
