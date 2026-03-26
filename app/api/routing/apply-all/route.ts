import { NextResponse } from 'next/server'
import { resolveOrgId, adminDb } from '@/lib/auth/resolveOrg'
import { logContactEvent } from '@/lib/events/logContactEvent'

export async function POST() {
  const orgId = await resolveOrgId()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = adminDb()

  const { data: contacts } = await db
    .from('contacts')
    .select('id, company_name, city, postcode, industry')
    .eq('organization_id', orgId)

  // Load routing data: config + rules + employee territories (Supabase JS only)
  const [cfgRes, rulesRes, empsRes] = await Promise.all([
    db.from('routing_config').select('*, fallback_tm:team_members!fallback_user_id(naam)')
      .eq('organization_id', orgId).maybeSingle(),
    db.from('routing_rules')
      .select('phase, condition, value, assign_to_id, team_members(naam)')
      .eq('organization_id', orgId)
      .eq('active', true)
      .order('position', { ascending: true }),
    db.from('team_members')
      .select('naam, postcode_ranges')
      .eq('organization_id', orgId)
      .eq('active', true),
  ])

  type RuleRaw = { phase: string; condition: string; value: string; assign_to_id: string | null; team_members?: { naam: string } | { naam: string }[] | null }
  type RuleWithNaam = { phase: string; condition: string; value: string; assign_to_naam: string | null }
  const rules: RuleWithNaam[] = ((rulesRes.data ?? []) as unknown as RuleRaw[])
    .map(r => {
      const tm = r.team_members
      const naam = Array.isArray(tm) ? (tm[0]?.naam ?? null) : (tm as { naam: string } | null)?.naam ?? null
      return { phase: r.phase, condition: r.condition, value: r.value, assign_to_naam: naam }
    })

  type CfgRaw = Record<string, unknown> & { fallback_tm?: { naam: string } | null }
  const rawCfg = cfgRes.data as CfgRaw | null
  const cfg = rawCfg ? ({ ...rawCfg, fallback_user_naam: rawCfg.fallback_tm?.naam ?? null } as CfgRaw & { fallback_user_naam: string | null }) : null

  const empTerritories = (empsRes.data ?? []) as { naam: string; postcode_ranges: string[] }[]

  if (cfg?.routing_disabled) {
    return NextResponse.json({ updated: 0, total: contacts?.length ?? 0, skipped: 'routing_disabled' })
  }

  const preRules  = rules.filter(r => r.phase === 'pre')
  const bodyRules = rules.filter(r => r.phase === 'body')
  const fallback  = (cfg?.fallback_user_naam as string | null) ?? null

  let updated = 0
  const total = contacts?.length ?? 0

  for (const contact of (contacts ?? [])) {
    let assignedTo: string | null = null

    if (!cfg?.skip_pre) {
      for (const rule of preRules) {
        const company = (contact.company_name ?? '').toLowerCase()
        if (rule.condition === 'name_contains' && company.includes(rule.value.toLowerCase())) {
          assignedTo = rule.assign_to_naam
          break
        }
      }
    }

    if (!assignedTo && !cfg?.skip_body) {
      for (const rule of bodyRules) {
        const company  = (contact.company_name ?? '').toLowerCase()
        const postcode = (contact.postcode ?? '').replace(/\s/g, '').toLowerCase()
        const industry = (contact.industry ?? '').toLowerCase()

        let matched = false
        if (rule.condition === 'name_contains')   matched = company.includes(rule.value.toLowerCase())
        if (rule.condition === 'industry_is')     matched = industry.includes(rule.value.toLowerCase())
        if (rule.condition === 'postcode_starts') matched = postcode.startsWith(rule.value.toLowerCase())

        if (matched) { assignedTo = rule.assign_to_naam; break }
      }

      if (!assignedTo && empTerritories.length > 0) {
        const postcode = (contact.postcode ?? '').replace(/\s/g, '').toLowerCase()
        if (postcode) {
          for (const emp of empTerritories) {
            const hit = (emp.postcode_ranges ?? []).find(r =>
              postcode.startsWith(r.replace(/\s/g, '').toLowerCase())
            )
            if (hit) { assignedTo = emp.naam; break }
          }
        }
      }
    }

    if (!assignedTo) assignedTo = fallback

    if (assignedTo) {
      await db.from('contacts').update({ assigned_to: assignedTo }).eq('id', contact.id)
      logContactEvent({
        organizationId: orgId,
        contactId:      contact.id,
        eventType:      'routing',
        actor:          'system',
        metadata:       { assigned_to: assignedTo, bulk: true },
      })
      updated++
    }
  }

  return NextResponse.json({ updated, total })
}
