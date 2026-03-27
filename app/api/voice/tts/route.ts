/**
 * POST /api/voice/tts
 *
 * Converts text to speech using OpenAI TTS-1 (shimmer voice).
 * Used by the browser voice button pipeline.
 * Returns audio/mpeg stream directly.
 *
 * Cost: ~$0.000015 per response (TTS-1 at $15/1M chars)
 */

export const runtime     = 'nodejs'
export const maxDuration = 20

export async function POST(req: Request) {
  try {
    const { text } = await req.json() as { text?: string }
    if (!text?.trim()) {
      return new Response('Missing text', { status: 400 })
    }

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:           'tts-1',
        voice:           'shimmer',
        input:           text.slice(0, 4096),
        response_format: 'mp3',
        speed:           1.0,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[voice/tts]', res.status, err)
      return new Response('TTS failed', { status: 500 })
    }

    return new Response(res.body, {
      headers: {
        'Content-Type':  'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[voice/tts]', err)
    return new Response('TTS error', { status: 500 })
  }
}
