/**
 * Shared TwiML helper functions used by /api/voice and /api/voice/gather.
 */

export function twiml(body: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`,
    { headers: { 'Content-Type': 'text/xml' } },
  )
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Say something then immediately listen for next speech turn. */
export function gatherResponse(text: string, gatherAction: string): Response {
  const safe = escapeXml(text)
  return twiml(
    `<Say voice="Polly.Lotte-Neural" language="nl-NL">${safe}</Say>` +
    `<Gather input="speech" action="${gatherAction}" method="POST" ` +
    `speechTimeout="auto" language="nl-NL" enhanced="true">` +
    `</Gather>` +
    `<Redirect method="POST">${gatherAction}</Redirect>`,
  )
}
