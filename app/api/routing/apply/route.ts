import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { resolveOrgId } from '@/lib/auth/resolveOrg'
import { adminSupabase } from '@/lib/supabase'
import { logContactEvent } from '@/lib/events/logContactEvent'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

interface ContactInput {
  company_name?: string
  first_name?:   string
  last_name?:    string
  email?:        string
  phone?:        string
  city?:         string
  postcode?:     string
  website?:      string
  industry?:     string
}

interface TeamMemberRow {
  id:               string
  naam:             string
  postcode_ranges:  string[]
}

interface RuleRow {
  id:              string
  phase:           string
  condition:       string
  value:           string
  assign_to_id:    string | null
  assign_to_naam?: string | null
  active:          boolean
  position:        number
}

interface ConfigRow {
  pre_routing_prompt:           string | null
  pre_routing_assign_to_id:     string | null
  pre_routing_websearch:        boolean
  fallback_user_id:             string | null
  routing_disabled:             boolean
  skip_pre:                     boolean
  skip_body:                    boolean
}

async function loadRoutingData(orgId: string) {
  const db = adminSupabase()

  const [cfgRes, rulesRes, empsRes] = await Promise.all([
    db.from('routing_config').select('*, team_members!pre_routing_assign_to_id(naam), fallback_tm:team_members!fallback_user_id(naam)')
      .eq('organization_id', orgId).maybeSingle(),
    db.from('routing_rules')
      .select('*, team_members(naam)')
      .eq('organization_id', orgId)
      .eq('active', true)
      .order('position', { ascending: true }),
    db.from('team_members')
      .select('id, naam, postcode_ranges')
      .eq('organization_id', orgId)
      .eq('active', true),
  ])

  // Flatten joined team_member name onto rules
  const rules: (RuleRow & { assign_to_naam: string | null })[] =
    ((rulesRes.data ?? []) as (RuleRow & { team_members?: { naam: string } | null })[]).map(r => ({
      ...r,
      assign_to_naam: r.team_members?.naam ?? null,
    }))

  // Resolve fallback name from config join
  const rawCfg = cfgRes.data as (ConfigRow & {
    team_members?: { naam: string } | null
    fallback_tm?:  { naam: string } | null
  }) | null

  const cfg = rawCfg ? {
    ...rawCfg,
    pre_routing_assign_to_naam: rawCfg.team_members?.naam ?? null,
    fallback_user_naam:         rawCfg.fallback_tm?.naam  ?? null,
  } : null

  return {
    cfg,
    rules,
    employees: (empsRes.data ?? []) as TeamMemberRow[],
  }
}

async function runPreRoutingAI(prompt: string, contact: ContactInput, useWebSearch: boolean): Promise<boolean> {
  const contactSummary = [
    contact.company_name && `Company: ${contact.company_name}`,
    contact.city         && `City: ${contact.city}`,
    contact.postcode     && `Postcode: ${contact.postcode}`,
    contact.industry     && `Industry: ${contact.industry}`,
    contact.website      && `Website: ${contact.website}`,
    contact.email        && `Email: ${contact.email}`,
  ].filter(Boolean).join('\n')

  const systemMsg = `You are a CRM routing classifier. ${prompt}\n\nRespond with ONLY valid JSON: {"match": true} or {"match": false}. No explanation, no markdown.`

  try {
    let userMsg = `Contact info:\n${contactSummary}`

    if (useWebSearch) {
      const searchResult = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `Research assistant: determine if this is a wholesale distributor, large chain, or key account (200+ employees). Return JSON: { "is_key_account": bool, "is_wholesale": bool, "company_type": string }` },
          { role: 'user',   content: `Company: ${contact.company_name}, City: ${contact.city ?? ''}, Website: ${contact.website ?? ''}` },
        ],
      })
      const enriched = searchResult.choices[0]?.message?.content ?? ''
      if (enriched) userMsg += `\n\nEnriched context: ${enriched}`
    }

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user',   content: userMsg },
      ],
    })
    const raw    = resp.choices[0]?.message?.content?.trim() ?? ''
    const parsed = JSON.parse(raw)
    return parsed.match === true
  } catch {
    return false
  }
}

export async function POST(req: Request) {
  const body  = await req.json()
  // Always use server env — never trust client-supplied organization_id
  const orgId = resolveOrgId()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let contact: ContactInput
  let contactId: string | null = body.contact_id ?? null

  if (contactId) {
    const { data: row } = await adminSupabase()
      .from('contacts')
      .select('id, company_name, first_name, last_name, email, phone, city, postcode, website, industry')
      .eq('id', contactId)
      .eq('organization_id', orgId)
      .single()
    if (!row) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    contact = row as ContactInput
  } else if (body.contact) {
    contact = body.contact as ContactInput
  } else {
    return NextResponse.json({ error: 'contact or contact_id required' }, { status: 400 })
  }

  const { cfg, rules, employees } = await loadRoutingData(orgId)

  let assignedTo: string | null = null
  let phase: 'pre' | 'body' | 'post' = 'post'
  let reason = 'No rule matched'

  if (cfg?.routing_disabled) {
    return NextResponse.json({ assigned_to: null, phase: 'post', reason: 'Routing disabled' })
  }

  // ── PHASE 1: PRE-ROUTING ──────────────────────────────────────────────────
  if (!cfg?.skip_pre) {
    for (const rule of rules.filter(r => r.phase === 'pre')) {
      const company = (contact.company_name ?? '').toLowerCase()
      if (rule.condition === 'name_contains' && company.includes(rule.value.toLowerCase())) {
        assignedTo = rule.assign_to_naam ?? null
        phase      = 'pre'
        reason     = `Pre-routing: company name contains "${rule.value}"`
        break
      }
    }

    if (!assignedTo && cfg?.pre_routing_prompt && cfg?.pre_routing_assign_to_naam) {
      const isMatch = await runPreRoutingAI(cfg.pre_routing_prompt, contact, cfg.pre_routing_websearch ?? false)
      if (isMatch) {
        assignedTo = cfg.pre_routing_assign_to_naam as string
        phase      = 'pre'
        reason     = `AI pre-routing${cfg.pre_routing_websearch ? ' (met websearch)' : ''}`
      }
    }
  }

  // ── PHASE 2: BODY ROUTING ─────────────────────────────────────────────────
  if (!assignedTo && !cfg?.skip_body) {
    for (const rule of rules.filter(r => r.phase === 'body')) {
      const company  = (contact.company_name ?? '').toLowerCase()
      const postcode = (contact.postcode ?? '').replace(/\s/g, '').toLowerCase()
      const industry = (contact.industry ?? '').toLowerCase()

      let matched = false
      if (rule.condition === 'name_contains')   matched = company.includes(rule.value.toLowerCase())
      if (rule.condition === 'industry_is')     matched = industry.includes(rule.value.toLowerCase())
      if (rule.condition === 'postcode_starts') matched = postcode.startsWith(rule.value.toLowerCase())

      if (matched) {
        assignedTo = rule.assign_to_naam ?? null
        phase      = 'body'
        reason     = `Regel: ${rule.condition} "${rule.value}"`
        break
      }
    }

    // Postcode territory matching from team_members
    // Supports: "1000-1199" (numeric range), "17" (prefix), "*" (skip — means unassigned)
    if (!assignedTo) {
      const postcode = (contact.postcode ?? '').replace(/\s/g, '')
      const digits   = parseInt(postcode.slice(0, 4), 10)
      if (postcode && !isNaN(digits)) {
        for (const emp of employees) {
          const ranges = (emp.postcode_ranges ?? []).filter(r => r !== '*')
          const hit = ranges.find(r => {
            const rangeParts = r.replace(/\s/g, '').split('-')
            if (rangeParts.length === 2) {
              // Range format: "1000-1199"
              const lo = parseInt(rangeParts[0], 10)
              const hi = parseInt(rangeParts[1], 10)
              return !isNaN(lo) && !isNaN(hi) && digits >= lo && digits <= hi
            }
            // Prefix format: "17" matches 1700-1799
            return postcode.toLowerCase().startsWith(r.replace(/\s/g, '').toLowerCase())
          })
          if (hit) {
            assignedTo = emp.naam
            phase      = 'body'
            reason     = `Postcodegebied: ${hit} → ${emp.naam}`
            break
          }
        }
      }
    }
  }

  // ── PHASE 3: POST-ROUTING (fallback) ─────────────────────────────────────
  if (!assignedTo) {
    const fallbackNaam = (cfg as Record<string, unknown> | null)?.fallback_user_naam as string | null
    if (fallbackNaam) {
      assignedTo = fallbackNaam
      phase      = 'post'
      reason     = `Fallback: "${fallbackNaam}"`
    } else {
      reason = 'Geen match — niet toegewezen'
    }
  }

  // Write assigned_to back to the contact
  if (contactId && assignedTo !== null) {
    await adminSupabase()
      .from('contacts')
      .update({ assigned_to: assignedTo })
      .eq('id', contactId)
      .eq('organization_id', orgId)
  }

  if (contactId) {
    logContactEvent({
      organizationId: orgId,
      contactId,
      eventType:      'routing',
      actor:          'ai',
      metadata:       { assigned_to: assignedTo, phase, reason },
    })
  }

  return NextResponse.json({ assigned_to: assignedTo, phase, reason })
}
