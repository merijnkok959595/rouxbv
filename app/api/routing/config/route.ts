import { NextResponse } from 'next/server'
import { resolveOrgId } from '@/lib/auth/resolveOrg'

const SB_URL = () => process.env.NEXT_PUBLIC_SUPABASE_URL!.trim()
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY!.trim()

function sbFetch(path: string, init?: RequestInit) {
  return fetch(`${SB_URL()}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SB_KEY(),
      Authorization: `Bearer ${SB_KEY()}`,
      'Content-Type': 'application/json',
      Accept:        'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })
}

export async function GET() {
  const orgId = await resolveOrgId()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [cfgRes, rulesRes] = await Promise.all([
    sbFetch(`routing_config?organization_id=eq.${orgId}&select=*,pre_tm:team_members!pre_routing_assign_to_id(id,naam),fallback_tm:team_members!fallback_user_id(id,naam)&limit=1`),
    sbFetch(`routing_rules?organization_id=eq.${orgId}&select=*,team_members(id,naam)&order=position.asc`),
  ])

  type CfgRaw = Record<string, unknown> & {
    pre_tm?:      { id: string; naam: string } | null
    fallback_tm?: { id: string; naam: string } | null
  }
  const cfgRows  = cfgRes.ok  ? (await cfgRes.json()  as CfgRaw[])                        : []
  const rulesRows = rulesRes.ok ? (await rulesRes.json() as (Record<string, unknown> & { team_members?: { id: string; naam: string } | null })[]) : []

  const rawCfg = cfgRows[0] ?? null
  const config = rawCfg ? {
    ...rawCfg,
    pre_routing_assign_to_naam: rawCfg.pre_tm?.naam    ?? null,
    fallback_user_naam:         rawCfg.fallback_tm?.naam ?? null,
  } : null

  const rules = rulesRows.map(r => ({ ...r, assign_to_naam: r.team_members?.naam ?? null }))

  return NextResponse.json({ config, rules })
}

const WRITABLE = new Set([
  'pre_routing_prompt',
  'pre_routing_assign_to_id',
  'pre_routing_websearch',
  'fallback_user_id',
  'fallback_ai',
  'routing_disabled',
  'skip_pre',
  'skip_body',
])

export async function PUT(req: Request) {
  const orgId = await resolveOrgId()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of Object.keys(body)) {
    if (WRITABLE.has(key)) update[key] = body[key] ?? null
  }
  if (Object.keys(update).length === 1) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })

  // Ensure row exists
  await sbFetch(`routing_config?on_conflict=organization_id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ organization_id: orgId, updated_at: new Date().toISOString() }),
  })

  const patchRes = await sbFetch(`routing_config?organization_id=eq.${orgId}`, {
    method:  'PATCH',
    headers: { Prefer: 'return=representation' },
    body:    JSON.stringify(update),
  })

  if (!patchRes.ok) return NextResponse.json({ error: await patchRes.text() }, { status: 500 })
  const rows = await patchRes.json() as Record<string, unknown>[]
  return NextResponse.json(rows[0] ?? {})
}
