/**
 * Twilio WhatsApp Webhook
 *
 * Configure in Twilio Console:
 *   Messaging → Senders → WhatsApp → Webhook URL:
 *   https://your-domain.vercel.app/api/whatsapp
 *   Method: POST
 *
 * Twilio sends form-encoded POST with:
 *   Body, From (whatsapp:+31...), To, MessageSid, etc.
 *
 * We run SUUS tool-calling and reply via TwiML.
 */

import twilio, { validateRequest } from 'twilio'
import { generateText }  from 'ai'
import { openai }        from '@ai-sdk/openai'
import { adminSupabase } from '@/lib/supabase'
import { suusTools }     from '@/lib/suus-tools'
import { routeMessage }  from '@/lib/suus-router'

export const runtime     = 'nodejs'
export const maxDuration = 60

const ORG_ID = () => process.env.ORGANIZATION_ID?.trim() ?? ''

const SYSTEM_PROMPT = `Je bent SUUS, de AI WhatsApp-assistent van ROUX BV.
Je helpt sales reps met CRM-beheer via WhatsApp. Kort en bondig, dit is WhatsApp.
Sales reps sturen korte losse berichten — interpreteer ruim en handel direct.

## Begroeting
"hey", "hoi", "hallo", "jooo" etc. → reageer gewoon vriendelijk: "Hey [naam]! Waarmee kan ik je helpen?"

## Bevestigingen — DIRECT UITVOEREN, NOOIT OPNIEUW VRAGEN (KRITISCH)
Als jij al een actie hebt voorgesteld/bevestigd gevraagd en de rep stuurt een bevestiging → VOER DIRECT UIT.
Bevestigingen: "ja", "jaa", "doe", "ja doe", "maak aan", "ja maak aan", "jaa maak aan", "prima", "klopt", "oke", "ok", "go", "yes", "doe maar", "jaa doe"
→ Gebruik de contactgegevens/actie EXACT uit jouw vorige bericht. NOOIT opnieuw bevestiging vragen.
→ MAX 1x bevestiging per actie. Daarna direct uitvoeren.

Als contact_zoek suggested_action=contact_intake teruggeeft én gebruiker bevestigt →
DIRECT contact_intake({companyName: suggested_company}) aanroepen.
NOOIT opnieuw contact_zoek aanroepen na een bevestiging.

## Selectie uit vorige lijst (KRITISCH)
- Jij stuurde genummerde lijst + rep stuurt een getal ("1", "2", "20") → selectie. Gebruik die contactId direct.
- "Die ja", "die ene", "die je net zei", "precies", "die" → meest recente contact uit conversatie.
- Nooit opnieuw een lijst sturen als rep al keuze maakte.

## Kernregels
1. Nooit een ID raden — altijd ophalen via tool
2. Gebruik ALTIJD contact_zoek vóór contactactie (tenzij contactId al bekend uit context)
3. Bij count=1: direct doorgaan. Bij count>1: toon lijst + vraag welke. Bij count=0: stel aanmaken voor.
4. Na contact_zoek ALTIJD doorgaan naar de gevraagde actie — nooit halverwege stoppen.

## Nieuw contact aanmaken — VASTE FLOW

1. contact_zoek → 0 resultaten → contact_intake({companyName})
2. contact_intake geeft ask_user terug → stuur dat EXACT aan gebruiker
3. Gebruiker antwoordt met "voornaam, Lead/Klant" formaat (bijv. "Jan, Lead" of "Jan en het is een lead")
   → Parseer: eerste naam = firstName, Lead/Klant = klantType
   → BEWAAR de companyName uit stap 1 — gebruik die altijd, zoek NIET opnieuw
   → contact_intake({companyName: [zelfde bedrijf als stap 1], firstName, klantType})
4. google_zoek_adres({query: companyName + stad}) → adres ophalen
5. contact_create → DIRECT aanmaken

NOOIT opnieuw contact_zoek aanroepen nadat je al weet welk bedrijf het is.
NOOIT "wil je aanmaken?" vragen. Geen optionele velden.

## Andere patronen
- "Is klant / is lead" = contact_update klantType
- Los telefoonnummer sturen = contact_update op huidig contact in context
- "Ik ben hier geweest / koppel bezoek" = contact_zoek → calendar_create (vandaag) + note_create
- "Stuur X een seintje / geef door aan X" = get_team_members → task_create toegewezen aan X
- Lijst van zakennamen = voor elk: volg bovenstaande flow, vraag 1x of snel invoeren of volledig
- "Verwijder" = uitleggen dat dit handmatig in GHL moet
- Google Maps link = vraag of dit het contactadres is
- Meerdere acties in één bericht → alle acties uitvoeren tegelijk

## Tool volgorde
- Contactactie:   contact_zoek → actie
- Nieuw contact:  zie VASTE FLOW hierboven
- Bezoek:         contact_zoek → calendar_create (vandaag) + note_create
- Taak collega:   get_team_members → contact_zoek → task_create`

// Identify employee by phone number (strip whatsapp: prefix and leading +)
async function resolveEmployeeByPhone(from: string, orgId: string) {
  try {
    // from = "whatsapp:+31612345678" → "31612345678"
    const digits = from.replace('whatsapp:', '').replace(/^\+/, '').replace(/\D/g, '')
    const { data } = await adminSupabase()
      .from('team_members')
      .select('id, naam, functie, ghl_user_id, calendar_id, phone, color')
      .eq('organization_id', orgId)
      .eq('active', true)
      .not('ghl_user_id', 'is', null)
    if (!data?.length) return null
    // Match last 9 digits to handle country code variations
    return data.find(m => {
      const mp = (m.phone ?? '').replace(/\D/g, '')
      return mp && (mp === digits || mp.slice(-9) === digits.slice(-9))
    }) ?? null
  } catch { return null }
}

function twimlResponse(message: string): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>${message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Message></Response>`
  return new Response(xml, {
    headers: { 'Content-Type': 'text/xml' },
  })
}

async function loadWaHistory(from: string, orgId: string): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  try {
    const { data } = await adminSupabase()
      .from('chat_messages')
      .select('role, content')
      .eq('organization_id', orgId)
      .eq('surface', 'whatsapp')
      .filter('metadata->>from', 'eq', from)
      .gte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(12)
    return (data ?? []).reverse().map(r => ({
      role:    r.role as 'user' | 'assistant',
      content: r.content ?? '',
    }))
  } catch { return [] }
}

async function saveWaMessage(from: string, orgId: string, role: 'user' | 'assistant', content: string) {
  try {
    await adminSupabase().from('chat_messages').insert({
      organization_id: orgId,
      session_id:      `wa_${from}`,
      surface:         'whatsapp',
      role,
      content,
      metadata:        { from },
    })
  } catch { /* ignore */ }
}

function twilioAuthHeader() {
  return 'Basic ' + Buffer.from(
    `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
  ).toString('base64')
}

async function transcribeAudio(mediaUrl: string): Promise<string> {
  const audioRes = await fetch(mediaUrl, { headers: { Authorization: twilioAuthHeader() } })
  if (!audioRes.ok) throw new Error(`Audio download failed: ${audioRes.status}`)

  const audioBuffer = await audioRes.arrayBuffer()
  const contentType = audioRes.headers.get('content-type') ?? 'audio/ogg'
  const ext = contentType.includes('mp4') ? 'mp4' : contentType.includes('mpeg') ? 'mp3' : 'ogg'

  // whisper-1 with verbose_json + nl prompt = highest accuracy for Dutch sales reps
  const form = new FormData()
  form.append('file', new Blob([audioBuffer], { type: contentType }), `audio.${ext}`)
  form.append('model', 'gpt-4o-transcribe')
  form.append('language', 'nl')
  form.append('response_format', 'json')
  form.append('prompt', 'Sales rep, CRM, GoHighLevel, ROUX, lead, klant, afspraak, notitie, taak, bezoek, groothandel, Sligro, Hanos, Bidfood.')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body:    form,
  })
  if (!res.ok) throw new Error(`Transcription failed: ${res.status}`)
  const data = await res.json() as { text: string }
  return data.text.trim()
}

async function downloadImage(mediaUrl: string): Promise<{ buffer: Uint8Array; mimeType: string }> {
  const res = await fetch(mediaUrl, { headers: { Authorization: twilioAuthHeader() } })
  if (!res.ok) throw new Error(`Image download failed: ${res.status}`)
  return {
    buffer:   new Uint8Array(await res.arrayBuffer()),
    mimeType: res.headers.get('content-type') ?? 'image/jpeg',
  }
}

export async function POST(req: Request) {
  try {
    const host      = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
    const signature = req.headers.get('x-twilio-signature') ?? ''
    const webhookUrl = `https://${host}/api/whatsapp`

    // ── Twilio signature validation (skip in local dev) ───────────────────────
    const isDev = process.env.NODE_ENV === 'development' || host.includes('localhost') || host.includes('ngrok')
    if (!isDev) {
      const rawBody  = await req.text()
      const params   = Object.fromEntries(new URLSearchParams(rawBody).entries())
      const isValid  = validateRequest(
        process.env.TWILIO_AUTH_TOKEN ?? '',
        signature,
        webhookUrl,
        params,
      )
      if (!isValid) {
        console.warn(`[whatsapp] invalid signature from ${req.headers.get('cf-connecting-ip') ?? 'unknown'}`)
        return new Response('Forbidden', { status: 403 })
      }
      // Re-attach body as FormData after validation
      const formData  = new URLSearchParams(rawBody)
      return handleWhatsApp(req, formData, host)
    }

    // Dev: parse directly
    const rawFormData = await req.formData()
    const devParams   = new URLSearchParams()
    rawFormData.forEach((v, k) => devParams.set(k, v.toString()))
    return handleWhatsApp(req, devParams, host)

  } catch (err) {
    console.error('[whatsapp]', err)
    return twimlResponse('Er ging iets mis. Probeer het opnieuw.')
  }
}

async function handleWhatsApp(req: Request, formData: URLSearchParams, host: string) {
  try {
    const from      = formData.get('From') ?? ''
    const numMedia  = parseInt(formData.get('NumMedia')?.toString() ?? '0')
    const mediaUrl  = formData.get('MediaUrl0')?.toString() ?? ''
    const mediaType = formData.get('MediaContentType0')?.toString() ?? ''
    let   message   = formData.get('Body')?.toString().trim() ?? ''

    if (!from) return twimlResponse('Geen bericht ontvangen.')

    const isAudio = numMedia > 0 && mediaType.startsWith('audio/')
    const isImage = numMedia > 0 && mediaType.startsWith('image/')
    const orgId   = ORG_ID()

    // ── Parallel: employee lookup + history + media processing ───────────────
    const [employee, history, mediaResult] = await Promise.all([
      resolveEmployeeByPhone(from, orgId),
      loadWaHistory(from, orgId),
      isAudio ? transcribeAudio(mediaUrl).catch((err) => { console.error('[whatsapp] transcription failed:', err); return null })
      : isImage ? downloadImage(mediaUrl).catch((err)  => { console.error('[whatsapp] image download failed:', err); return null })
      : Promise.resolve(null),
    ])

    if (!employee) {
      console.warn(`[whatsapp] blocked unknown number: ${from}`)
      return twimlResponse('Dit nummer is niet geautoriseerd voor SUUS. Neem contact op met je beheerder.')
    }

    // Apply media results
    if (isAudio) {
      if (!mediaResult) return twimlResponse('Ik kon je voicebericht niet verstaan. Probeer het opnieuw.')
      message = (mediaResult as string) || message
      console.log(`[whatsapp] transcribed: "${message}"`)
    }

    const imageData = isImage && mediaResult ? mediaResult as { buffer: Uint8Array; mimeType: string } : null
    if (isImage && imageData) console.log(`[whatsapp] image — ${imageData.mimeType} ${imageData.buffer.length}b`)

    if (!message && !imageData) return twimlResponse('Geen bericht ontvangen.')

    await saveWaMessage(from, orgId, 'user', message || '[afbeelding]')

    const now = new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })
    const contextLines = [
      `Datum/tijd: ${now}`,
      `GHL locatie ID: ${process.env.GHL_LOCATION_ID ?? ''}`,
      `Ingelogde gebruiker: ${employee.naam} (${employee.functie})`,
      `GHL user ID: ${employee.ghl_user_id}`,
      `Calendar ID: ${employee.calendar_id ?? ''}`,
    ]

    // ── Route: image always gpt-4.1, others via router ────────────────────────
    const imagePrompt = message
      ? message  // user added text caption to image → use that
      : `Analyseer deze afbeelding stap voor stap:
1. Bevat het papier met handgeschreven of gedrukte tekst? → Lees alle tekst zo nauwkeurig mogelijk uit (namen, adressen, telefoonnummers, e-mails, notities).
2. Is het een visitekaartje, bon, brief of document? → Extraheer alle relevante gegevens.
3. Is het iets anders (foto, screenshot, locatie)? → Beschrijf wat je ziet in 1-2 zinnen.
Sluit af met: "Klopt dit? Wat wil je dat ik hiermee doe?" — stel GEEN actie voor, wacht op instructie van de gebruiker.`

    const routing = imageData
      ? { model: 'gpt-4.1' as const, tools: suusTools, normalized: imagePrompt }
      : await routeMessage(message, history.slice(-6))
    console.log(`[whatsapp/router] intent=${'intent' in routing ? routing.intent : 'image'} model=${routing.model}`)

    // Build user content
    type ContentPart = { type: 'text'; text: string } | { type: 'image'; image: Uint8Array; mimeType: string }
    const userContent: string | ContentPart[] = imageData
      ? [
          { type: 'text'  as const, text: routing.normalized },
          { type: 'image' as const, image: imageData.buffer, mimeType: imageData.mimeType },
        ]
      : routing.normalized

    // ── generateText (non-streaming — TwiML needs full response) ─────────────
    const { text } = await generateText({
      model:    openai(routing.model),
      system:   SYSTEM_PROMPT,
      messages: [
        { role: 'user',      content: `[Context]\n${contextLines.join('\n')}` },
        { role: 'assistant', content: 'Begrepen.' },
        ...history,
        { role: 'user', content: userContent },
      ],
      tools:    routing.tools as typeof suusTools,
      maxSteps: 12,
      temperature: 0,
    })

    const reply = text || 'Begrepen.'
    await saveWaMessage(from, orgId, 'assistant', reply)
    return twimlResponse(reply)
  } catch (err) {
    console.error('[whatsapp]', err)
    const msg = String(err)
    if (msg.includes('Rate limit') || msg.includes('429'))
      return twimlResponse('Even wachten, OpenAI is druk. Stuur je bericht zo opnieuw.')
    if (msg.includes('timeout') || msg.includes('ETIMEDOUT'))
      return twimlResponse('Dat duurde te lang. Stuur het opnieuw.')
    return twimlResponse('Er ging iets mis. Probeer het opnieuw.')
  }
}
