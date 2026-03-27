/**
 * POST /api/voice
 *
 * Twilio Voice webhook — inbound calls to the SUUS phone number.
 * With OpenAI SIP Trunking the call is routed directly Twilio → OpenAI SIP,
 * so this webhook is a fallback/safety net (e.g. when SIP trunk is not active).
 *
 * Configure in Twilio Console:
 *   Phone Numbers → Manage → Voice & Fax → "A call comes in"
 *   Webhook: https://rouxbv.vercel.app/api/voice
 *   Method: HTTP POST
 */

import { adminSupabase } from '@/lib/supabase'

export const runtime     = 'nodejs'
export const maxDuration = 15

const ORG_ID = () => process.env.ORGANIZATION_ID?.trim() ?? ''

function twiml(body: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`, {
    headers: { 'Content-Type': 'text/xml' },
  })
}

async function resolveEmployeeByPhone(from: string) {
  try {
    const digits = from.replace(/\D/g, '')
    const { data } = await adminSupabase()
      .from('team_members')
      .select('naam, functie, ghl_user_id, calendar_id, phone')
      .eq('organization_id', ORG_ID())
      .eq('active', true)
      .not('ghl_user_id', 'is', null)
    if (!data?.length) return null
    return data.find(m => {
      const mp = ((m as { phone?: string }).phone ?? '').replace(/\D/g, '')
      return mp && (mp === digits || mp.slice(-9) === digits.slice(-9))
    }) ?? null
  } catch { return null }
}

export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const from = form.get('From')?.toString() ?? ''

    if (!from) return twiml('<Say language="nl-NL">Onbekend nummer. Tot ziens.</Say>')

    const employee = await resolveEmployeeByPhone(from)

    if (!employee) {
      return twiml('<Say language="nl-NL">Welkom bij ROUX. Dit nummer is niet gekoppeld aan een medewerker. Neem contact op via WhatsApp.</Say>')
    }

    const emp = employee as { naam: string }
    const voornaam = emp.naam.split(' ')[0]

    console.log(`[voice] inbound call from ${voornaam} (${from}) — SIP trunk should handle this`)

    // SIP trunk routes this call directly to OpenAI Realtime.
    // If this webhook fires, the trunk may not be active — play a holding message.
    return twiml(
      `<Say language="nl-NL">Goedendag ${voornaam}, je wordt doorverbonden met SUUS.</Say>` +
      `<Pause length="2"/>` +
      `<Say language="nl-NL">Een moment alsjeblieft.</Say>`
    )

  } catch (err) {
    console.error('[voice]', err)
    return twiml('<Say language="nl-NL">Er ging iets mis. Probeer het opnieuw.</Say>')
  }
}
