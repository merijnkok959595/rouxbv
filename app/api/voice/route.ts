/**
 * Inbound Twilio Voice → Retell AI
 *
 * Replaces the n8n workflow:
 *   webhook → get_users → If(employee found) → post_voice_agent → respond
 *
 * Configure in Twilio Console:
 *   Phone Numbers → Manage → Voice & Fax → "A call comes in"
 *   Webhook: https://your-domain.vercel.app/api/voice
 *   Method: HTTP POST
 */

import { adminSupabase } from '@/lib/supabase'

export const runtime     = 'nodejs'
export const maxDuration = 15

const RETELL_KEY        = () => process.env.RETELL_API_KEY?.trim()        ?? ''
const RETELL_VOICE_AGENT = () => process.env.RETELL_VOICE_AGENT_ID?.trim() ?? process.env.RETELL_AGENT_ID?.trim() ?? ''
const ORG_ID            = () => process.env.ORGANIZATION_ID?.trim()       ?? ''

function twiml(body: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`, {
    headers: { 'Content-Type': 'text/xml' },
  })
}

function greeting() {
  const h = new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', hour: 'numeric', hour12: false })
  const hour = parseInt(h)
  if (hour >= 6  && hour < 12) return 'Goedemorgen'
  if (hour >= 12 && hour < 18) return 'Goedemiddag'
  return 'Goedenavond'
}

async function resolveEmployeeByPhone(from: string) {
  try {
    // Normalise: strip +, spaces, non-digits — match last 9 digits
    const digits = from.replace(/\D/g, '')
    const { data } = await adminSupabase()
      .from('team_members')
      .select('naam, functie, ghl_user_id, calendar_id, phone, postcode_ranges')
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
    const form  = await req.formData()
    const from  = form.get('From')?.toString() ?? ''
    const to    = form.get('To')?.toString()   ?? ''

    if (!from) return twiml('<Say language="nl-NL">Onbekend nummer. Tot ziens.</Say>')

    const employee = await resolveEmployeeByPhone(from)

    if (!employee) {
      // Unknown caller — polite rejection
      return twiml('<Say language="nl-NL">Welkom bij ROUX. Dit nummer is niet gekoppeld aan een medewerker. Neem contact op via WhatsApp.</Say>')
    }

    // Register call with Retell AI
    const emp = employee as {
      naam: string; functie: string; ghl_user_id: string
      calendar_id?: string; phone?: string; postcode_ranges?: string
    }

    const retellRes = await fetch('https://api.retellai.com/v2/register-phone-call', {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${RETELL_KEY()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agent_id:   RETELL_VOICE_AGENT(),
        from_number: from.startsWith('+') ? from : `+${from}`,
        to_number:   to.startsWith('+')   ? to   : `+${to}`,
        direction:  'inbound',
        metadata:   {},
        retell_llm_dynamic_variables: {
          naam:            emp.naam.split(' ')[0],
          ghl_user_id:     emp.ghl_user_id,
          calendar_id:     emp.calendar_id ?? '',
          phone_number:    emp.phone ?? from,
          functie:         emp.functie,
          postcode_ranges: emp.postcode_ranges ?? '',
          current_date:    new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }),
          greeting:        greeting(),
        },
      }),
    })

    const retellData = await retellRes.json() as { call_id?: string; error?: string }

    if (!retellData.call_id) {
      console.error('[voice] Retell register failed:', retellData)
      return twiml('<Say language="nl-NL">Verbinding mislukt. Probeer het opnieuw.</Say>')
    }

    // SIP dial to Retell
    return twiml(`<Dial><Sip>sip:${retellData.call_id}@sip.retellai.com</Sip></Dial>`)

  } catch (err) {
    console.error('[voice]', err)
    return twiml('<Say language="nl-NL">Er ging iets mis. Probeer het opnieuw.</Say>')
  }
}
