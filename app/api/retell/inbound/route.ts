/**
 * Twilio inbound webhook for Retell custom telephony.
 * Twilio calls this when +3197010275858 receives a call.
 * We register the call with Retell and return TwiML to connect audio.
 */
import { validateRequest } from 'twilio'

export const runtime     = 'nodejs'
export const maxDuration = 10

export async function POST(req: Request) {
  try {
    const rawBody = await req.text()
    const params  = Object.fromEntries(new URLSearchParams(rawBody).entries())

    const host      = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
    const signature = req.headers.get('x-twilio-signature') ?? ''

    // Use NEXT_PUBLIC_APP_URL so the URL matches exactly what's configured in Twilio console
    const appBase    = (process.env.NEXT_PUBLIC_APP_URL ?? `https://${host}`).trim().replace(/\/$/, '')
    const webhookUrl = `${appBase}/api/retell/inbound`

    // Validate Twilio signature (skip in local dev / ngrok)
    const isDev = process.env.NODE_ENV === 'development' || host.includes('localhost') || host.includes('ngrok')
    if (!isDev) {
      const authToken = process.env.TWILIO_AUTH_TOKEN ?? ''
      console.log(`[retell/inbound] validating — url="${webhookUrl}" sig="${signature.slice(0, 12)}..." token_set=${!!authToken} param_keys=${Object.keys(params).sort().join(',')}`)
      const isValid = validateRequest(authToken, signature, webhookUrl, params)
      if (!isValid) {
        console.warn(`[retell/inbound] signature FAIL — url="${webhookUrl}"`)
        return new Response('Forbidden', { status: 403 })
      }
    }

    const callSid = params['CallSid'] ?? ''
    const from    = params['From']    ?? ''
    const to      = params['To']      ?? ''

    console.log(`[retell/inbound] CallSid=${callSid} from=${from} to=${to}`)

    // Register call with Retell custom telephony API
    const res = await fetch('https://api.retellai.com/v2/register-phone-call', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RETELL_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        agent_id:    process.env.RETELL_AGENT_ID,
        from_number: from,
        to_number:   to,
        direction:   'inbound',
        metadata: {
          twilio_call_sid: callSid,
          source:          'phone',
        },
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[retell/inbound] register failed:', res.status, err)
      throw new Error(`Retell register failed: ${res.status}`)
    }

    const registered = await res.json() as { call_id: string }
    console.log(`[retell/inbound] registered call_id=${registered.call_id}`)

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://api.retellai.com/audio-websocket/${registered.call_id}" />
  </Connect>
</Response>`

    return new Response(twiml, {
      headers: { 'Content-Type': 'text/xml' },
    })

  } catch (err) {
    console.error('[retell/inbound] error:', err)
    const fallback = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="nl-NL">Er is een technisch probleem. Probeer het later opnieuw.</Say>
  <Hangup/>
</Response>`
    return new Response(fallback, {
      headers: { 'Content-Type': 'text/xml' },
    })
  }
}
