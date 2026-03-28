/**
 * /api/voice/tts
 *
 * POST { text } — used by the browser STT→LLM→TTS pipeline
 * GET  ?text=…  — used by Twilio <Play> in the phone call pipeline
 *
 * Both return audio/mpeg (OpenAI TTS-1, shimmer voice).
 * Cost: ~$0.000015 per response ($15/1M chars)
 */

export const runtime     = 'nodejs'
export const maxDuration = 20

async function generateSpeech(text: string): Promise<Response> {
  if (!text.trim()) return new Response('Missing text', { status: 400 })

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
}

// Browser pipeline: POST { text: string }
export async function POST(req: Request) {
  try {
    const { text } = await req.json() as { text?: string }
    return generateSpeech(text ?? '')
  } catch (err) {
    console.error('[voice/tts/post]', err)
    return new Response('TTS error', { status: 500 })
  }
}

// Twilio <Play> pipeline: GET ?text=...
export async function GET(req: Request) {
  try {
    const text = new URL(req.url).searchParams.get('text') ?? ''
    return generateSpeech(text)
  } catch (err) {
    console.error('[voice/tts/get]', err)
    return new Response('TTS error', { status: 500 })
  }
}
