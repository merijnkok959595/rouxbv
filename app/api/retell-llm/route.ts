/**
 * Retell Custom LLM Webhook
 * Configure Retell agent LLM URL → https://your-domain.vercel.app/api/retell-llm
 *
 * Uses Vercel AI SDK generateText with maxSteps for tool calling.
 * Voice-optimized: short sentences, Dutch only.
 */

import { streamText }    from 'ai'
import { openai }         from '@ai-sdk/openai'
import { adminSupabase }  from '@/lib/supabase'
import { suusTools }      from '@/lib/suus-tools'

export const runtime     = 'nodejs'
export const maxDuration = 60

const ORG_ID = () => process.env.ORGANIZATION_ID?.trim() ?? ''

// Static system prompt — cached by OpenAI
const VOICE_SYSTEM = `Je bent SUUS, de AI sales-assistent van ROUX BV — bereikbaar via de telefoon.
Sales reps bellen vanuit de auto, vaak na een klantbezoek of vlak ervoor.

## Stijl
- MAX 2 korte zinnen per beurt. Nooit opsommingen, nooit markdown.
- Spreek natuurlijk: "vrijdag de achttiende" niet "18-04".
- Gebruik de naam van de rep maximaal 1x per gesprek.
- Bij "wacht even" of "momentje": wacht stilletjes af.

## Eerste bericht (lege transcript)
Begroet met dag-deel + naam: "Goedemiddag [naam]! SUUS hier. Waarmee kan ik je helpen?"
Gebruik datum/tijd uit de context voor het juiste dagdeel.

## Flows

### Voor bezoek — briefing
Rep noemt bedrijfsnaam → direct contact_zoek → contact_briefing → samenvatten in 3 zinnen spreektaal.

### Na bezoek — registreren
Rep zegt "ik was net bij [naam]" → contact_zoek → vraag wat je moet vastleggen als niet duidelijk.
Standaard: note_create (bezoek) + optioneel task_create (follow-up).

### Nieuw contact aanmaken
contact_zoek → google_zoek_adres → bevestig adres → contact_create_voice.
Vraag stap voor stap: voornaam → bedrijfsnaam → type (Lead/Klant) → adres via Google.

### Afspraak inplannen
contact_zoek → calendar_get_free_slot → noem 1 optie → bevestig → calendar_create.
Gebruik calendarId en userId uit de context — nooit vragen.

### Interne agenda / blokkade
calendar_block — geen contact nodig.

## Kernregels
- NOOIT een contactId raden — altijd contact_zoek
- Bij count=1: direct doorgaan zonder bevestiging
- Bij count>1: "Ik zie [n] contacten: [naam1] in [stad1] of [naam2] in [stad2] — welke?"
- Bij count=0: herzoek op eerste woord → nog 0 → "Wil je dat ik [naam] aanmaak?"
- Bevestig ALTIJD vóór schrijfactie: "Ik ga een notitie aanmaken voor [naam] — klopt dat?"
- Na actie: "Gedaan! Nog iets anders?"
- Nooit interne IDs uitspreken`

async function resolveEmployeeByPhone(fromNumber: string) {
  try {
    const digits = fromNumber.replace(/\D/g, '')
    const { data } = await adminSupabase()
      .from('team_members')
      .select('naam, functie, ghl_user_id, calendar_id, phone')
      .eq('organization_id', ORG_ID())
      .eq('active', true)
      .not('ghl_user_id', 'is', null)
    if (!data?.length) return null
    return data.find(m => {
      const mp = ((m as { phone?: string }).phone ?? '').replace(/\D/g, '')
      return mp && (mp === digits || mp.slice(-9) === digits.slice(-9))
    }) ?? null
  } catch { return null }
}

function buildVoiceContext(employee?: {
  naam: string; functie: string; ghl_user_id: string; calendar_id?: string
} | null) {
  const now  = new Date()
  const hour = Number(now.toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', hour: 'numeric', hour12: false }))
  const dagdeel = hour < 12 ? 'Goedemorgen' : hour < 18 ? 'Goedemiddag' : 'Goedenavond'
  const datetime = now.toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', dateStyle: 'full', timeStyle: 'short' })
  const voornaam = employee?.naam?.split(' ')[0] ?? ''
  const lines = [
    `Datum/tijd: ${datetime}`,
    `Dagdeel begroeting: ${dagdeel}`,
    `GHL locatie ID: ${process.env.GHL_LOCATION_ID ?? ''}`,
    ...(employee ? [
      `Naam rep: ${employee.naam} (voornaam: ${voornaam})`,
      `Functie: ${employee.functie}`,
      `GHL user ID: ${employee.ghl_user_id}`,
      `Calendar ID: ${employee.calendar_id ?? ''}`,
    ] : ['Onbekende medewerker — verzoek beleefd weigeren']),
  ]
  return [
    { role: 'user'      as const, content: `[Context]\n${lines.join('\n')}` },
    { role: 'assistant' as const, content: 'Begrepen.' },
  ]
}

interface RetellRequest {
  interaction_type: 'response_required' | 'reminder_required' | 'update_only'
  response_id:      number
  call:             {
    from_number?:   string
    metadata?:      { session_id?: string; org_id?: string; organization_id?: string }
  }
  transcript:       { role: 'agent' | 'user'; content: string }[]
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as RetellRequest

    if (body.interaction_type === 'update_only') {
      return Response.json({
        response_type:    'response',
        response_id:      body.response_id,
        content:          '',
        content_complete: true,
      })
    }

    // Resolve employee — only registered team members may use SUUS voice
    const fromNumber = body.call?.from_number ?? ''
    const employee   = fromNumber ? await resolveEmployeeByPhone(fromNumber) : null

    if (!employee) {
      console.warn(`[retell-llm] blocked unknown number: ${fromNumber}`)
      return Response.json({
        response_type:    'response',
        response_id:      body.response_id,
        content:          'Dit nummer is niet geautoriseerd voor SUUS.',
        content_complete: true,
      })
    }

    const messages = [
      ...buildVoiceContext(employee),   // dynamic context as messages
      ...body.transcript.map(m => ({
        role:    (m.role === 'agent' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: m.content,
      })),
    ]

    // streamText — starts sending tokens immediately, reduces Retell timeout risk
    const result = streamText({
      model:       openai('gpt-4.1'),
      system:      VOICE_SYSTEM,
      messages,
      tools:       suusTools,
      maxSteps:    12,
      temperature: 0,
    })

    const encoder = new TextEncoder()
    const stream  = new ReadableStream({
      async start(controller) {
        let buffer = ''
        try {
          for await (const chunk of result.textStream) {
            buffer += chunk
            // Send word-by-word for natural TTS pacing
            const parts = buffer.split(' ')
            buffer = parts.pop() ?? ''
            for (const word of parts) {
              if (!word) continue
              controller.enqueue(encoder.encode(JSON.stringify({
                response_type: 'response', response_id: body.response_id,
                content: word + ' ', content_complete: false,
              }) + '\n'))
            }
          }
          // Flush remaining buffer
          if (buffer.trim()) {
            controller.enqueue(encoder.encode(JSON.stringify({
              response_type: 'response', response_id: body.response_id,
              content: buffer, content_complete: false,
            }) + '\n'))
          }
        } catch (err) {
          console.error('[retell-llm/stream]', err)
        } finally {
          controller.enqueue(encoder.encode(JSON.stringify({
            response_type: 'response', response_id: body.response_id,
            content: '', content_complete: true,
          }) + '\n'))
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type':      'application/json',
        'Transfer-Encoding': 'chunked',
        'Cache-Control':     'no-cache',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    console.error('[retell-llm]', err)
    return new Response('Internal error', { status: 500 })
  }
}
