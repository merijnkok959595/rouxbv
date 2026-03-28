import { NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase'
import { requireOrgId, isValidOrgId } from '@/lib/auth/resolveOrg'

export const runtime = 'nodejs'

interface RawContact {
  label:         string | null
  revenue:       number | null
  source:        string | null
  assigned_to:   string | null
  created_at:    string | null
  custom_fields: { created_by?: string; intake_notes?: string } | null
}

export interface RankEntry { naam: string; value: number }

function top3(map: Map<string, number>): RankEntry[] {
  return Array.from(map.entries())
    .map(([naam, value]) => ({ naam, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const sources  = searchParams.getAll('source')
    const from     = searchParams.get('from')   // YYYY-MM-DD
    const to       = searchParams.get('to')     // YYYY-MM-DD

    const orgId = requireOrgId()
    if (!isValidOrgId(orgId)) return NextResponse.json({ error: orgId }, { status: 400 })

    // --- main contacts query (date-filtered) ---
    let q = adminSupabase()
      .from('contacts')
      .select('label, revenue, source, assigned_to, created_at, custom_fields')
      .eq('organization_id', orgId)
      .neq('type', 'employee')

    if (sources.length > 0) q = q.in('source', sources)
    if (from) q = q.gte('created_at', `${from}T00:00:00`)
    if (to)   q = q.lte('created_at', `${to}T23:59:59`)

    const { data, error } = await q.order('created_at', { ascending: false }).limit(2000)
    if (error) throw new Error(error.message)

    const contacts = (data ?? []) as RawContact[]

    // --- unique sources from entire org (for the filter menu) ---
    const srcQ = await adminSupabase()
      .from('contacts')
      .select('source, created_at')
      .eq('organization_id', orgId)
      .neq('type', 'employee')
      .not('source', 'is', null)
      .order('created_at', { ascending: false })
      .limit(2000)

    const seenSrc = new Set<string>()
    const uniqueSources: string[] = []
    for (const r of srcQ.data ?? []) {
      if (r.source && !seenSrc.has(r.source)) { seenSrc.add(r.source); uniqueSources.push(r.source) }
    }

    // ---- award maps ----
    const leadsMap:     Map<string, number> = new Map()  // meeste leads (count)
    const bestLeadMap:  Map<string, number> = new Map()  // beste lead (max single revenue)
    const pijplijnMap:  Map<string, number> = new Map()  // beste pijplijn (sum A/B revenue)
    const notitiesMap:  Map<string, number> = new Map()  // meeste notities
    const teamMap:      Map<string, number> = new Map()  // teamspeler (leads doorgegeven)
    const diefMap:      Map<string, number> = new Map()  // grootste dief (leads gekregen van anderen)

    for (const c of contacts) {
      const maker    = c.custom_fields?.created_by?.trim()
      const assigned = c.assigned_to?.trim()

      if (maker) {
        // Meeste leads
        leadsMap.set(maker, (leadsMap.get(maker) ?? 0) + 1)

        // Beste lead — highest single revenue
        const rev = c.revenue ?? 0
        if (rev > 0) {
          bestLeadMap.set(maker, Math.max(bestLeadMap.get(maker) ?? 0, rev))
        }

        // Beste pijplijn — sum A/B revenue
        if ((c.label === 'A' || c.label === 'B') && (c.revenue ?? 0) > 0) {
          pijplijnMap.set(maker, (pijplijnMap.get(maker) ?? 0) + (c.revenue ?? 0))
        }

        // Meeste notities
        if (c.custom_fields?.intake_notes?.trim()) {
          notitiesMap.set(maker, (notitiesMap.get(maker) ?? 0) + 1)
        }

        // Teamspeler — gave this lead to someone else
        if (assigned && assigned !== maker) {
          teamMap.set(maker, (teamMap.get(maker) ?? 0) + 1)
        }
      }

      // Grootste dief — lead was created by someone else, assigned to you
      if (assigned && maker && assigned !== maker) {
        diefMap.set(assigned, (diefMap.get(assigned) ?? 0) + 1)
      }
    }

    return NextResponse.json({
      sources: uniqueSources,
      total:   contacts.length,
      awards: {
        meeste_leads:    top3(leadsMap),
        beste_lead:      top3(bestLeadMap),
        beste_pijplijn:  top3(pijplijnMap),
        meeste_notities: top3(notitiesMap),
        teamspeler:      top3(teamMap),
        grootste_dief:   top3(diefMap),
      },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
