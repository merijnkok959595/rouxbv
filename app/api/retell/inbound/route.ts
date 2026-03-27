/**
 * Twilio inbound webhook for Retell custom telephony.
 * Twilio calls this when +3197010275858 receives a call.
 * We register the call with Retell and return TwiML to connect audio.
 */
export const runtime     = 'nodejs'
export const maxDuration = 10

export async function POST(req: Request) {
  try {
    const body    = await req.formData()
    const callSid = String(body.get('CallSid') ?? '')
    const from    = String(body.get('From')    ?? '')
    const to      = String(body.get('To')      ?? '')

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

    // TwiML: stream audio to Retell via WebSocket Media Streams
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
