import { NextResponse } from 'next/server'
import OpenAI           from 'openai'
import { toFile }       from 'openai'

export const runtime     = 'nodejs'
export const maxDuration = 30

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const audio    = formData.get('audio')

    if (!audio || !(audio instanceof Blob)) {
      return NextResponse.json({ error: 'audio field (Blob) required' }, { status: 400 })
    }

    const buffer   = Buffer.from(await audio.arrayBuffer())
    const mimeType = audio.type || 'audio/webm'
    // Pick an extension Whisper accepts based on mime type
    const ext      = mimeType.includes('mp4') ? 'mp4'
                   : mimeType.includes('ogg') ? 'ogg'
                   : mimeType.includes('wav') ? 'wav'
                   : mimeType.includes('mp3') ? 'mp3'
                   : 'webm'

    const file = await toFile(buffer, `recording.${ext}`, { type: mimeType })

    const transcription = await openai.audio.transcriptions.create({
      file,
      model:    'whisper-1',
      language: 'nl',
    })

    return NextResponse.json({ text: transcription.text })
  } catch (err) {
    console.error('[suus/transcribe]', err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
