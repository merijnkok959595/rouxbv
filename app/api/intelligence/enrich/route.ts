import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { resolveOrgId } from '@/lib/auth/resolveOrg'
import { adminSupabase } from '@/lib/supabase'
import { logContactEvent } from '@/lib/events/logContactEvent'
import { contactUpdate as ghlContactUpdate, buildCustomFields } from '@/lib/ghl-client'

export const runtime     = 'nodejs'
export const maxDuration = 60

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY?.trim() })

/** Web search enrichment via OpenAI */
async function enrichViaWebSearch(company: string, city: string, website?: string): Promise<Record<string, unknown>> {
  const query = `${company} ${city} ${website ?? ''} company info revenue employees industry`
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a business research assistant. Search for information about the given company and return a JSON object with these fields (use null for unknown):
{
  "description": string,
  "industry": string,
  "estimated_revenue": string,
  "employee_count": string,
  "founded_year": number | null,
  "website": string | null,
  "linkedin_url": string | null,
  "key_person": string | null,
  "notes": string
}
Return ONLY valid JSON, no markdown.`,
      },
      { role: 'user', content: `Research this company: ${query}` },
    ],
  })
  try {
    const text  = resp.choices[0]?.message?.content ?? '{}'
    const clean = text.replace(/```json\n?|```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    return { notes: resp.choices[0]?.message?.content ?? 'Could not parse response' }
  }
}

/** Web crawl via Jina AI Reader */
async function enrichViaWebCrawl(url: string): Promise<Record<string, unknown>> {
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`
    const jinaRes = await fetch(`https://r.jina.ai/${normalized}`, {
      headers: { 'Accept': 'text/plain', 'X-Return-Format': 'markdown' },
      signal: AbortSignal.timeout(15000),
    })
    if (!jinaRes.ok) throw new Error(`Jina HTTP ${jinaRes.status}`)
    const markdown = await jinaRes.text()
    if (!markdown || markdown.length < 50) throw new Error('Empty response')

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You extract structured business intelligence from a crawled website. Return a JSON object:
{
  "concept": string | null,
  "cuisine_or_specialty": string | null,
  "capacity_seats": number | null,
  "terras_seats": number | null,
  "kitchen_complexity": "simple" | "moderate" | "complex" | null,
  "price_range": string | null,
  "number_of_locations": number | null,
  "opening_hours": string | null,
  "menu_highlights": string[] | null,
  "team_size_hint": string | null,
  "website_summary": string
}
Return ONLY valid JSON.`,
        },
        { role: 'user', content: `Website content:\n\n${markdown.slice(0, 8000)}` },
      ],
      temperature: 0.1,
    })
    const text  = resp.choices[0]?.message?.content?.trim() ?? '{}'
    const clean = text.replace(/```json\n?|```/g, '').trim()
    return JSON.parse(clean)
  } catch (err) {
    console.warn('[enrich/webcrawl] error:', err)
    return {}
  }
}

/** Google Maps enrichment via Google Places API (New) */
async function enrichViaMaps(company: string, city: string): Promise<Record<string, unknown>> {
  const gKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (gKey) {
    try {
      const query = `${company} ${city}`
      const res   = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type':     'application/json',
          'X-Goog-Api-Key':   gKey,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.regularOpeningHours,places.rating,places.userRatingCount,places.primaryType,places.googleMapsUri',
        },
        body: JSON.stringify({ textQuery: query, languageCode: 'nl', regionCode: 'NL', maxResultCount: 1 }),
      })
      if (!res.ok) throw new Error(`Google Places HTTP ${res.status}`)
      const json  = await res.json() as { places?: Array<Record<string, unknown>> }
      const place = json.places?.[0] ?? null
      if (!place) throw new Error('No results')
      const hours = ((place.regularOpeningHours as { weekdayDescriptions?: string[] } | undefined)?.weekdayDescriptions ?? []).join(', ') || null
      return {
        address:        place.formattedAddress ?? null,
        phone:          place.internationalPhoneNumber ?? null,
        opening_hours:  hours,
        rating:         place.rating ?? null,
        review_count:   place.userRatingCount ?? null,
        place_category: place.primaryType ?? null,
        maps_url:       place.googleMapsUri ?? null,
      }
    } catch (err) {
      console.warn('[enrich/maps] Google Places error:', err)
    }
  }

  return {}
}

/**
 * Score a prospect A/B/C/D using the saved scoring_prompt.
 * Falls back to a generic fit score if no scoring_prompt is configured.
 */
async function scoreProspect(
  contact:            Record<string, unknown>,
  enriched:           Record<string, unknown>,
  scoringPrompt:      string | null,
  assumptions:        string[],
  benchmarkCustomers: unknown[],
  systemPrompt:       string | null,
): Promise<Record<string, unknown>> {
  if (scoringPrompt) {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a B2B sales scoring AI. Using the scoring logic below, assign a prospect label (A, B, C, or D).

## Scoring logic
${scoringPrompt}

Return ONLY valid JSON:
{
  "label": "A" | "B" | "C" | "D",
  "estimated_revenue": number,
  "score_reason": string,
  "summary": string,
  "key_signals": string[],
  "recommended_approach": string
}
"estimated_revenue" must be a single plain integer (euros/year). NO ranges, NO strings, NO null.
"summary" must be a 2–3 sentence intelligence summary of this prospect.`,
        },
        {
          role: 'user',
          content: `Prospect: ${JSON.stringify({ company: contact.company_name, city: contact.city, type: contact.type })}\n\nEnriched data: ${JSON.stringify(enriched)}`,
        },
      ],
      temperature: 0.15,
    })
    try {
      const text  = resp.choices[0]?.message?.content ?? '{}'
      const clean = text.replace(/```json\n?|```/g, '').trim()
      return JSON.parse(clean)
    } catch { return {} }
  }

  // Fallback: generic fit score
  const avgRevenue = benchmarkCustomers.length
    ? (benchmarkCustomers as { revenue?: number }[]).reduce((s, c) => s + (c.revenue ?? 0), 0) / benchmarkCustomers.length
    : null

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a sales intelligence AI. ${systemPrompt ?? ''}

Benchmark assumptions: ${assumptions.map((a, i) => `${i + 1}. ${a}`).join(' | ')}
Average customer revenue: ${avgRevenue ? `€${Math.round(avgRevenue).toLocaleString()}` : 'unknown'} per year.

Return ONLY valid JSON:
{
  "fit_score": number,
  "fit_label": "excellent" | "good" | "average" | "poor",
  "estimated_revenue": number,
  "key_signals": string[],
  "recommended_approach": string
}
"estimated_revenue" must be a single plain integer (euros/year). NO ranges, NO strings, NO null.`,
      },
      { role: 'user', content: `Contact: ${JSON.stringify(contact)}\nEnriched data: ${JSON.stringify(enriched)}` },
    ],
  })
  try {
    const text  = resp.choices[0]?.message?.content ?? '{}'
    const clean = text.replace(/```json\n?|```/g, '').trim()
    return JSON.parse(clean)
  } catch { return {} }
}

export async function POST(req: Request) {
  const body = await req.json()
  const { contact_id } = body

  const orgId = resolveOrgId()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!contact_id) return NextResponse.json({ error: 'contact_id required' }, { status: 400 })

  const database = adminSupabase()

  const [{ data: contactRow }, { data: cfgRow }] = await Promise.all([
    database.from('contacts').select('*').eq('id', contact_id).eq('organization_id', orgId).maybeSingle(),
    database.from('intelligence_config').select('*').eq('organization_id', orgId).maybeSingle(),
  ])
  const contact = contactRow

  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  const cfg = cfgRow

  const config = cfg ?? {
    enrich_websearch: true,
    enrich_webcrawl:  true,
    enrich_maps:      false,
    enrich_linkedin:  false,
    benchmark_assumptions: [],
    system_prompt:    null,
    scoring_prompt:   null,
  }
  const assumptions: string[] = Array.isArray(config.benchmark_assumptions) ? config.benchmark_assumptions : []

  const company = (contact as Record<string, unknown>).company_name as string ?? ''
  const city    = (contact as Record<string, unknown>).city          as string ?? ''
  const website = (contact as Record<string, unknown>).website       as string ?? ''

  const hasEnoughData = company.trim().length > 0 && (city.trim().length > 0 || website.trim().length > 0)
  if (!hasEnoughData) {
    return NextResponse.json({ contact_id, skipped: true, reason: 'Not enough data — company name + city or website required' })
  }

  const [webData, crawlData, mapsData] = await Promise.all([
    config.enrich_websearch ? enrichViaWebSearch(company, city, website) : Promise.resolve(null),
    config.enrich_webcrawl && website ? enrichViaWebCrawl(website)       : Promise.resolve(null),
    config.enrich_maps      ? enrichViaMaps(company, city)               : Promise.resolve(null),
  ])

  const enriched = {
    ...(webData   ?? {}),
    ...(crawlData && Object.keys(crawlData).length ? { webcrawl: crawlData } : {}),
    ...(mapsData  ? { maps: mapsData } : {}),
  }

  const { data: benchmarkCustomers } = await database
    .from('contacts')
    .select('company_name, revenue, city, type')
    .eq('organization_id', orgId)
    .eq('type', 'customer')
    .not('revenue', 'is', null)
    .limit(50)

  const score = await scoreProspect(
    contact as Record<string, unknown>,
    enriched,
    (config as Record<string, unknown>).scoring_prompt as string | null ?? null,
    assumptions,
    benchmarkCustomers ?? [],
    (config as Record<string, unknown>).system_prompt as string | null ?? null,
  )

  const s = score as Record<string, unknown>
  const currentCustom = ((contact as Record<string, unknown>).custom_fields as Record<string, unknown>) ?? {}
  const intelligenceSummary = s.summary as string | undefined

  const customUpdate: Record<string, unknown> = {
    ...currentCustom,
    _enriched:    enriched,
    _enriched_at: new Date().toISOString(),
    ...(intelligenceSummary ? { _summary: intelligenceSummary } : {}),
  }

  // Store opening hours from maps/crawl into custom_fields
  const openingHours =
    (mapsData  as Record<string, unknown> | null)?.opening_hours ??
    (crawlData as Record<string, unknown> | null)?.opening_hours ?? null
  if (openingHours) customUpdate.openingstijden = openingHours

  const contactUpdate: Record<string, unknown> = {
    custom_fields:  customUpdate,
    last_activity:  new Date().toISOString(),
  }

  // Assign label A/B/C/D
  const assignedLabel = s.label as string | undefined
  if (assignedLabel && ['A', 'B', 'C', 'D'].includes(assignedLabel)) {
    contactUpdate.label = assignedLabel
  } else {
    const fitLabel = s.fit_label as string | undefined
    const labelMap: Record<string, string> = { excellent: 'A', good: 'B', average: 'C', poor: 'D' }
    if (fitLabel && labelMap[fitLabel]) contactUpdate.label = labelMap[fitLabel]
  }

  // Parse revenue
  const rawRevenue = s.estimated_revenue
  if (rawRevenue !== undefined && rawRevenue !== null) {
    let parsed: number
    if (typeof rawRevenue === 'number') {
      parsed = rawRevenue
    } else {
      const str     = String(rawRevenue).split(/[-–]/)[0]
      const cleaned = str.replace(/[^0-9.,]/g, '')
      const normalized = cleaned.includes(',')
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/\./g, '')
      parsed = Number(normalized)
    }
    if (!isNaN(parsed) && parsed >= 0) contactUpdate.revenue = Math.round(parsed)
  }

  await database
    .from('contacts')
    .update(contactUpdate)
    .eq('id', contact_id)
    .eq('organization_id', orgId)

  const sourcesUsed = [
    config.enrich_websearch           && 'web_search',
    config.enrich_webcrawl && website && 'web_crawl',
    config.enrich_maps                && 'google_maps',
  ].filter(Boolean)

  // ── Push label + revenue back to GHL ──────────────────────────────────────
  const ghlContactId = (currentCustom.ghl_contact_id as string | undefined) ?? null
  if (ghlContactId && (contactUpdate.label || contactUpdate.revenue != null)) {
    try {
      const cf = buildCustomFields({
        klantLabel:  contactUpdate.label  as 'A'|'B'|'C'|'D' | undefined,
        klantVolume: contactUpdate.revenue as number | undefined,
      })
      if (cf && cf.length > 0) {
        await ghlContactUpdate(ghlContactId, { customFields: cf })
        console.log(`[enrich] GHL sync → ${ghlContactId} label=${contactUpdate.label} revenue=${contactUpdate.revenue}`)
      }
    } catch (err) {
      console.warn('[enrich] GHL sync failed (non-fatal):', err)
    }
  }

  logContactEvent({
    organizationId: orgId,
    contactId:      contact_id,
    eventType:      'enrichment',
    actor:          'ai',
    metadata:       { sources_used: sourcesUsed, label: assignedLabel ?? null },
  })

  return NextResponse.json({
    contact_id,
    enriched,
    score,
    sources_used: sourcesUsed,
    label:   contactUpdate.label   ?? null,
    revenue: contactUpdate.revenue ?? null,
    summary: intelligenceSummary   ?? null,
  })
}
