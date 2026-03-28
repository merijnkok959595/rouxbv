/**
 * Supabase Edge Function: voice
 *
 * Inbound Twilio voice call → Retell AI (SIP)
 * Stable URL: https://sjbcyteoowfafitefcyl.supabase.co/functions/v1/voice
 *
 * Employee context is resolved inside /api/retell-llm via call.from_number —
 * no dynamic variables needed here, avoids type issues with complex DB fields.
 *
 * Set in Twilio Console:
 *   Phone Numbers → Manage → [ROUX nummer] → Voice & Fax
 *   "A call comes in" → Webhook → POST → URL above
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RETELL_KEY         = Deno.env.get('RETELL_API_KEY')         ?? ''
const RETELL_VOICE_AGENT = Deno.env.get('RETELL_VOICE_AGENT_ID')  ?? Deno.env.get('RETELL_AGENT_ID') ?? ''
const ORG_ID             = Deno.env.get('ORGANIZATION_ID')        ?? ''

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
    const form = await req.formData()
    const from = form.get('From')?.toString() ?? ''
    const to   = form.get('To')?.toString()   ?? ''

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
