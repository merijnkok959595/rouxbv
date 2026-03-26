/**
 * Append an immutable event to contact_events.
 * Fire-and-forget — never throws, so it can't break the calling request.
 */

import { adminSupabase } from '@/lib/supabase'

export type ContactEventType = 'create' | 'update' | 'routing' | 'enrichment' | 'scoring'

export async function logContactEvent(opts: {
  organizationId: string
  contactId:      string | null | undefined
  eventType:      ContactEventType
  actor:          string
  metadata?:      Record<string, unknown>
}): Promise<void> {
  try {
    await adminSupabase().from('contact_events').insert({
      organization_id: opts.organizationId,
      contact_id:      opts.contactId ?? null,
      event_type:      opts.eventType,
      actor:           opts.actor,
      metadata:        opts.metadata ?? {},
    })
  } catch (err) {
    console.error('[logContactEvent] failed silently:', err)
  }
}
