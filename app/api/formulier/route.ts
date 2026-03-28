import { NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabase'
import { appBaseUrl } from '@/lib/app-base-url'
import { contactCreate, contactUpdate, contactSearchAdvanced, buildCustomFields, noteCreate } from '@/lib/ghl-client'
import { requireOrgId, isValidOrgId } from '@/lib/auth/resolveOrg'

export async function POST(req: Request) {
  try {
    const body  = await req.json()
    const sb    = adminSupabase()
    const orgId = requireOrgId()
    if (!isValidOrgId(orgId)) return NextResponse.json({ error: orgId }, { status: 400 })

    const {
      company, first_name, last_name, email, phone,
      address, city, postcode, country,
      assigned_to, status, notes, source, channel, opening_hours, created_by, groothandel,
    } = body as {
      company: string; first_name?: string; last_name?: string; email?: string; phone?: string
      address?: string; city?: string; postcode?: string; country?: string
      assigned_to?: string; status?: string; notes?: string; source?: string; channel?: string
      opening_hours?: unknown; created_by?: string; groothandel?: string
    }

    if (!company) return NextResponse.json({ error: 'company required' }, { status: 400 })

    // Create contact
    const { data: contact, error } = await sb
      .from('contacts')
      .insert({
        organization_id: orgId,
        company_name:    company,
        first_name:      first_name  || null,
        last_name:       last_name   || null,
        email:           email       || null,
        phone:           phone       || null,
        address1:        address     || null,
        city:            city        || null,
        postcode:        postcode    || null,
        country:         country?.trim() || 'Nederland',
        assigned_to:     assigned_to || null,
        type:            status      || 'lead',
        source:          source      || null,
        channel:         channel     || 'OFFLINE',
        custom_fields:   {
          created_by:    created_by  || null,
          intake_notes:  notes       || null,
          groothandel:   groothandel || null,
        },
        opening_hours:   opening_hours || null,
      })
      .select('id, assigned_to')
      .single()

    if (error || !contact) throw new Error(error?.message ?? 'Contact insert failed')
    const contactId         = contact.id
    const contactAssignedTo = contact.assigned_to

    // ── Sync to GHL (awaited in parallel with routing + enrich below) ──────────
    async function syncToGHL() {
      // Look up GHL user ID for assigned employee (by name match in team_members)
      let assignedToGhlId: string | undefined
      if (assigned_to) {
        const { data: member } = await adminSupabase()
          .from('team_members')
          .select('ghl_user_id')
          .eq('organization_id', orgId)
          .or(`naam.eq.${assigned_to},id.eq.${assigned_to}`)
          .maybeSingle()
        assignedToGhlId = (member as { ghl_user_id?: string } | null)?.ghl_user_id ?? undefined
      }

      // Look up GHL user ID for creator (for note attribution)
      let createdByGhlId: string | undefined
      if (created_by) {
        const { data: creator } = await adminSupabase()
          .from('team_members')
          .select('ghl_user_id')
          .eq('organization_id', orgId)
          .or(`naam.eq.${created_by},id.eq.${created_by}`)
          .maybeSingle()
        createdByGhlId = (creator as { ghl_user_id?: string } | null)?.ghl_user_id ?? undefined
      }

      const klantType   = status === 'klant' ? 'Klant' : 'Lead'
      const klantSource = source || undefined

      const ghlData = {
        firstName:    first_name  || undefined,
        lastName:     last_name   || undefined,
        email:        email       || undefined,
        phone:        phone       || undefined,
        companyName:  company,
        address1:     address     || undefined,
        postalCode:   postcode    || undefined,
        city:         city        || undefined,
        country:      country?.trim() || 'NL',
        source:       klantSource,
        assignedTo:   assignedToGhlId,
        customFields: buildCustomFields({
          klantType,
          klantSource,
          groothandel:    groothandel || undefined,
          openingstijden: typeof opening_hours === 'string' ? opening_hours : undefined,
        }),
      }

      // Check for duplicate by company name + optional email/phone
      const existing = await contactSearchAdvanced({
        searchTerms: [company],
        ...(city ? { cityFilter: city } : {}),
      })
      const duplicate = existing?.contacts?.find(c =>
        c.companyName?.toLowerCase().trim() === company.toLowerCase().trim() ||
        (email && c.email === email) ||
        (phone && c.phone?.replace(/\D/g, '') === phone.replace(/\D/g, ''))
      )

      let ghlId: string | null = null
      if (duplicate?.id) {
        await contactUpdate(duplicate.id, ghlData)
        ghlId = duplicate.id
        console.log(`[formulier] GHL updated contact ${ghlId} (${company})`)
      } else {
        const created = await contactCreate(ghlData)
        ghlId = created?.contact?.id ?? null
        console.log(`[formulier] GHL created contact ${ghlId} (${company})`)
      }

      // Create intake note in GHL if notes were provided
      if (ghlId && notes?.trim()) {
        const noteUserId = createdByGhlId || assignedToGhlId || ''
        const noteBody = [
          `📋 Intake notitie — ${source || 'Formulier'}`,
          '',
          notes.trim(),
          '',
          `Aangemaakt door: ${created_by || '—'}`,
          `Toegewezen aan: ${assigned_to || '—'}`,
        ].join('\n')
        await noteCreate(ghlId, noteBody, noteUserId)
        console.log(`[formulier] GHL note created for ${ghlId}`)
      }

      if (ghlId) {
        const sb2 = adminSupabase()
        const { data: cur } = await sb2.from('contacts').select('custom_fields').eq('id', contactId).single()
        const existingCF = (cur as { custom_fields?: Record<string, unknown> } | null)?.custom_fields ?? {}
        await sb2
          .from('contacts')
          .update({
            ghl_synced:    true,
            custom_fields: {
              ...existingCF,
              intake_notes:   notes        || null,
              created_by:     created_by   || null,
              groothandel:    groothandel  || null,
              ghl_contact_id: ghlId,
            },
          })
          .eq('id', contactId)
      }
    }

    // Run routing + enrich in parallel, awaited so they complete before the serverless
    // function is terminated (fire-and-forget is killed on Vercel after response is sent).
    // Both have their own internal timeouts; we cap the combined wait at 55s.
    const base    = appBaseUrl()
    const payload = { contact_id: contactId, organization_id: orgId }

    const run = (path: string) =>
      fetch(`${base}${path}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(55_000),
      }).catch(e => console.error(`[formulier] ${path} failed:`, e))

    const [, routingRes, enrichRes] = await Promise.allSettled([
      syncToGHL().catch(e => console.error('[formulier] GHL sync failed (non-fatal):', e)),
      run('/api/routing/apply'),
      run('/api/intelligence/enrich'),
    ])

    // Pull assigned_to from routing if it updated
    let finalAssignedTo = contactAssignedTo
    if (routingRes.status === 'fulfilled' && routingRes.value) {
      try {
        const rd = await (routingRes.value as Response).json() as { assigned_to?: string | null }
        if (rd.assigned_to) finalAssignedTo = rd.assigned_to
      } catch { /* ignore */ }
    }

    // Pull label + revenue from enrich for immediate response (avoids first poll round-trip)
    let enrichLabel: string | null   = null
    let enrichRevenue: number | null = null
    if (enrichRes.status === 'fulfilled' && enrichRes.value) {
      try {
        const ed = await (enrichRes.value as Response).json() as { label?: string | null; revenue?: number | null }
        enrichLabel   = ed.label   ?? null
        enrichRevenue = ed.revenue ?? null
      } catch { /* ignore */ }
    }

    return NextResponse.json({
      id:          contactId,
      assigned_to: finalAssignedTo,
      label:       enrichLabel,
      revenue:     enrichRevenue,
    })
  } catch (err) {
    let msg = err instanceof Error ? err.message : String(err)
    if (msg === 'fetch failed' || msg.includes('fetch failed')) {
      msg =
        'Geen verbinding met Supabase (fetch failed). Controleer NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY en internet; geen placeholder-URL (xxxx) gebruiken.'
    }
    console.error('[formulier]', err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
