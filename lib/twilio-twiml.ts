/**
 * Shared TwiML helpers for /api/voice and /api/voice/gather.
 * TTS is served via OpenAI (shimmer voice) through GET /api/voice/tts?text=...
 */

const APP_URL = () => (process.env.NEXT_PUBLIC_APP_URL ?? 'https://rouxbv.vercel.app').replace(/\/$/, '')

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

/** TwiML snippet that plays text via OpenAI TTS (shimmer). */
function playSnippet(text: string): string {
  const url = `${APP_URL()}/api/voice/tts?text=${encodeURIComponent(text.slice(0, 400))}`
  return `<Play>${escapeXml(url)}</Play>`
}

/** Say something, then immediately listen for the next speech turn. */
export function gatherResponse(text: string, gatherAction: string): Response {
  return twiml(
    playSnippet(text) +
    `<Gather input="speech" action="${gatherAction}" method="POST" ` +
    `speechTimeout="auto" language="nl-NL" enhanced="true">` +
    `</Gather>` +
    `<Redirect method="POST">${gatherAction}</Redirect>`,
  )
}

/** Say something then hang up. */
export function playAndHangup(text: string): Response {
  return twiml(`${playSnippet(text)}<Hangup/>`)
}
