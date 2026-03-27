import { NextResponse }  from 'next/server'
import { adminSupabase } from '@/lib/supabase'
import { SUUS_VOICE_SYSTEM, VOICE_TOOLS_FULL } from '@/lib/suus-voice-prompt'
import { initSession } from '@/lib/voice-session'

export const runtime     = 'nodejs'
export const maxDuration = 15

const ORG_ID = () => process.env.ORGANIZATION_ID?.trim() ?? ''

async function resolveUser(orgId: string, employeeId?: string) {
  try {
    let q = adminSupabase()
      .from('team_members')
      .select('naam, functie, ghl_user_id, calendar_id')
      .eq('organization_id', orgId)
      .eq('active', true)
      .not('ghl_user_id', 'is', null)
    if (employeeId) q = q.eq('id', employeeId) as typeof q
    const { data } = await q.limit(1).single()
    return data ?? undefined
  } catch { return undefined }
}


export async function POST(req: Request) {
  try {
    const { session_id, employee_id } = await req.json() as { session_id?: string; employee_id?: string }
    const orgId = ORG_ID()
    const user  = await resolveUser(orgId, employee_id)

    // Init session so tool-call route can access user context
    if (session_id) {
      initSession(session_id, {
        userId:     user?.ghl_user_id ?? undefined,
        calendarId: user?.calendar_id ?? undefined,
        userNaam:   user?.naam        ?? undefined,
      })
    }

    const now = new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })
    const instructions = [
      SUUS_VOICE_SYSTEM,
      '',
      '## Sessiecontext',
      `Datum/tijd: ${now}`,
      `GHL locatie ID: ${process.env.GHL_LOCATION_ID ?? ''}`,
      ...(user ? [
        `Ingelogde gebruiker: ${user.naam} (${user.functie})`,
        `GHL user ID: ${user.ghl_user_id}`,
        `Calendar ID: ${user.calendar_id ?? ''}`,
      ] : []),
    ].join('\n')

    const res = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:        'gpt-4o-mini-realtime-preview',
        voice:        'shimmer',
        instructions,
        tools:        VOICE_TOOLS_FULL,
        temperature:  0.6,
        turn_detection: {
          type:                'server_vad',
          threshold:           0.5,
          prefix_padding_ms:   300,
          silence_duration_ms: 900,
        },
        input_audio_transcription: { model: 'gpt-4o-transcribe', language: 'nl' },
      }),
    })

    const data = await res.json() as { client_secret?: { value: string }; error?: unknown }
    if (!data.client_secret?.value) {
      console.error('[call] OpenAI Realtime session failed:', data)
      return NextResponse.json({ error: 'OpenAI Realtime session creation failed' }, { status: 500 })
    }

    return NextResponse.json({ client_secret: data.client_secret })
  } catch (err) {
    console.error('[call]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
