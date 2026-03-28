/**
 * POST /api/voice
 *
 * Twilio Voice webhook — inbound calls to the SUUS phone number.
 * Pipeline: Twilio STT (Deepgram) → GPT-4.1 + tools → OpenAI TTS (shimmer)
 *
 * Twilio Console → Phone Numbers → Manage → Voice & Fax
 *   "A call comes in" → Webhook: https://rouxbv.vercel.app/api/voice  (HTTP POST)
 */

import { adminSupabase }         from '@/lib/supabase'
import { SUUS_VOICE_SYSTEM }     from '@/lib/suus-voice-prompt'
import { initVoiceConv }         from '@/lib/voice-conversation'
import { gatherResponse, playAndHangup } from '@/lib/twilio-twiml'

export const runtime     = 'nodejs'
export const maxDuration = 15

const ORG_ID  = () => process.env.ORGANIZATION_ID?.trim() ?? ''
const APP_URL = () => (process.env.NEXT_PUBLIC_APP_URL ?? 'https://rouxbv.vercel.app').replace(/\/$/, '')

async function resolveEmployeeByPhone(from: string) {
  try {
    const digits = from.replace(/\D/g, '')
    const { data } = await adminSupabase()
      .from('team_members')
      .select('naam, functie, ghl_user_id, calendar_id, phone')
      .eq('organization_id', ORG_ID())
      .eq('active', true)
      .not('ghl_user_id', 'is', null)
    if (!data?.length) return null
    return (
      data.find(m => {
        const mp = ((m as { phone?: string }).phone ?? '').replace(/\D/g, '')
        return mp && (mp === digits || mp.slice(-9) === digits.slice(-9))
      }) ?? null
    )
  } catch { return null }
}

export async function POST(req: Request) {
  try {
    const form    = await req.formData()
    const from    = form.get('From')?.toString()    ?? ''
    const callSid = form.get('CallSid')?.toString() ?? 'unknown'

    if (!from) return playAndHangup('Onbekend nummer.')

    const employee = await resolveEmployeeByPhone(from)
    if (!employee) {
      return playAndHangup(
        'Welkom bij ROUX. Dit nummer is niet gekoppeld aan een medewerker. ' +
        'Neem contact op via WhatsApp.',
      )
    }

    const emp      = employee as { naam: string; ghl_user_id: string; calendar_id?: string }
    const voornaam = emp.naam.split(' ')[0]
    const now      = new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })

    const systemPrompt = [
      SUUS_VOICE_SYSTEM,
      '',
      '## Sessiecontext',
      `Datum/tijd: ${now}`,
      `GHL locatie ID: ${process.env.GHL_LOCATION_ID ?? ''}`,
      `Ingelogde gebruiker: ${emp.naam}`,
      `GHL user ID: ${emp.ghl_user_id}`,
      `Calendar ID: ${emp.calendar_id ?? ''}`,
      '',
      'CHANNEL: Telefoon. Geen formulieren, geen markdown, geen links. Korte zinnen.',
    ].join('\n')

    initVoiceConv(callSid, {
      systemPrompt,
      userId:     emp.ghl_user_id,
      calendarId: emp.calendar_id ?? undefined,
      userNaam:   emp.naam,
    })

    const gatherUrl = `${APP_URL()}/api/voice/gather`
    const greeting  = `Hoi ${voornaam}, hoe kan ik je helpen?`

    console.log(`[voice] inbound call from ${voornaam} (${from}), CallSid=${callSid}`)

    return gatherResponse(greeting, gatherUrl)

  } catch (err) {
    console.error('[voice]', err)
    return playAndHangup('Er ging iets mis. Probeer opnieuw.')
  }
}
