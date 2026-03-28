/**
 * Supabase Edge Function: voice
 *
 * Inbound Twilio voice call → Retell AI (SIP)
 * Stable URL: https://sjbcyteoowfafitefcyl.supabase.co/functions/v1/voice
 *
 * Employee context is resolved from the Supabase team_members table via call.from_number,
 * then injected as retell_llm_dynamic_variables (firstname, caller_name, ghl_user_id, calendar_id).
 *
 * Set in Twilio Console:
 *   Phone Numbers → Manage → [ROUX nummer] → Voice & Fax
 *   "A call comes in" → Webhook → POST → URL above
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RETELL_KEY         = Deno.env.get('RETELL_API_KEY')         ?? ''
const RETELL_VOICE_AGENT = Deno.env.get('RETELL_VOICE_AGENT_ID')  ?? Deno.env.get('RETELL_AGENT_ID') ?? ''
const ORG_ID             = Deno.env.get('ORGANIZATION_ID')        ?? ''
const TWILIO_AUTH_TOKEN  = Deno.env.get('TWILIO_AUTH_TOKEN')      ?? ''

/** Validate Twilio signature using Web Crypto (HMAC-SHA1) */
async function validateTwilioSignature(req: Request, rawBody: string): Promise<boolean> {
  if (!TWILIO_AUTH_TOKEN) return true // allow when token not set (local dev)
  const signature = req.headers.get('x-twilio-signature') ?? ''
  const params    = new URLSearchParams(rawBody)
  const sorted    = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
  const toSign    = req.url + sorted.map(([k, v]) => k + v).join('')
  const enc       = new TextEncoder()
  const key       = await crypto.subtle.importKey('raw', enc.encode(TWILIO_AUTH_TOKEN), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const sigBuf    = await crypto.subtle.sign('HMAC', key, enc.encode(toSign))
  const expected  = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
  return expected === signature
}

function supabase() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

function twiml(body: string) {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`,
    { headers: { 'Content-Type': 'text/xml' } },
  )
}

async function resolveEmployee(from: string) {
  const digits = from.replace(/\D/g, '')
  const { data } = await supabase()
    .from('team_members')
    .select('naam, phone')
    .eq('organization_id', ORG_ID)
    .eq('active', true)
    .not('ghl_user_id', 'is', null)
  if (!data?.length) return null
  return data.find((m: { phone?: string }) => {
    const mp = (m.phone ?? '').replace(/\D/g, '')
    return mp && (mp === digits || mp.slice(-9) === digits.slice(-9))
  }) ?? null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  try {
    const rawBody = await req.text()
    if (!(await validateTwilioSignature(req, rawBody))) {
      console.warn('[voice] rejected request: invalid Twilio signature')
      return new Response('Forbidden', { status: 403 })
    }

    const form = new URLSearchParams(rawBody)
    const from = form.get('From') ?? ''
    const to   = form.get('To')   ?? ''

    if (!from) return twiml('<Say language="nl-NL">Onbekend nummer.</Say>')

    const employee = await resolveEmployee(from)

    if (!employee) {
      console.warn(`[voice] blocked unknown number: ${from}`)
      return twiml(
        '<Say language="nl-NL">Dit nummer is niet geautoriseerd. Neem contact op met je beheerder.</Say>',
      )
    }

    const firstname = employee ? (employee.naam as string).split(' ')[0] : ''
    const retellRes = await fetch('https://api.retellai.com/v2/register-phone-call', {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${RETELL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agent_id:    RETELL_VOICE_AGENT,
        from_number: '+' + from.replace('whatsapp:', '').replace(/^\+/, '').replace(/\D/g, ''),
        to_number:   '+' + to.replace('whatsapp:', '').replace(/^\+/, '').replace(/\D/g, ''),
        direction:   'inbound',
        metadata:    { organization_id: ORG_ID },
        retell_llm_dynamic_variables: {
          firstname:   firstname,
          caller_name: employee ? (employee.naam as string) : '',
        },
      }),
    })

    const data = await retellRes.json() as { call_id?: string; error?: string }

    if (!data.call_id) {
      console.error('[voice] Retell error:', data)
      return twiml('<Say language="nl-NL">Verbinding mislukt. Probeer het opnieuw.</Say>')
    }

    return twiml(`<Dial><Sip>sip:${data.call_id}@sip.retellai.com</Sip></Dial>`)

  } catch (err) {
    console.error('[voice]', err)
    return twiml('<Say language="nl-NL">Er ging iets mis. Probeer het opnieuw.</Say>')
  }
})
