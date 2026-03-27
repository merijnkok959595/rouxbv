import { NextResponse }  from 'next/server'
import { adminSupabase } from '@/lib/supabase'

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

const VOICE_SYSTEM = `Je bent SUUS, de AI voice-assistent van ROUX BV.
Je helpt sales reps met CRM-beheer via spraak. Antwoord altijd kort en bondig — dit is een gesprek.

## Kernregels
1. Nooit een ID raden — altijd ophalen via tool
2. Gebruik contact_zoek vóór elke contactactie (tenzij contactId al bekend)
3. Bij 1 resultaat: direct doorgaan. Bij meerdere: noem de opties kort en vraag welke.
4. Bij 0 resultaten: vraag voornaam + "Lead of Klant" → contact_intake → contact_create
5. Bevestig uitgevoerde acties in één korte zin. Spreek Nederlands.

## Acties
- Nieuw contact:   contact_zoek → 0 resultaten → contact_intake → contact_create
- Bezoek:          contact_zoek → calendar_create (vandaag) + note_create
- Notitie:         contact_zoek → note_create
- Taak:            contact_zoek → task_create
- Taak collega:    get_team_members → contact_zoek → task_create
- Briefing:        contact_zoek → contact_briefing
- Intern overleg:  calendar_block`

// OpenAI Realtime API tool definitions (JSON Schema format, no render_form/render_edit_form)
const VOICE_TOOLS = [
  {
    type: 'function', name: 'contact_zoek',
    description: 'Zoek een contact in GHL. Altijd eerst aanroepen bij elke contactactie.',
    parameters: { type: 'object', properties: {
      rawQuery: { type: 'string', description: 'Zoekterm precies zoals de gebruiker het zei' },
    }, required: ['rawQuery'] },
  },
  {
    type: 'function', name: 'contact_update',
    description: 'Wijzig velden van een bestaand GHL contact. Stuur alleen gewijzigde velden.',
    parameters: { type: 'object', properties: {
      contactId:         { type: 'string' },
      firstName:         { type: 'string' },
      lastName:          { type: 'string' },
      email:             { type: 'string' },
      phone:             { type: 'string', description: 'E.164, bijv +31612345678' },
      companyName:       { type: 'string' },
      city:              { type: 'string' },
      groothandel:       { type: 'string' },
      klantType:         { type: 'string', description: 'Lead of Klant' },
      klantLabel:        { type: 'string', description: 'A, B, C of D' },
      kortingsafspraken: { type: 'string', description: 'Ja of Nee' },
      posMateriaal:      { type: 'string', description: 'Ja of Nee' },
    }, required: ['contactId'] },
  },
  {
    type: 'function', name: 'contact_intake',
    description: 'Eerste stap bij nieuw contact aanmaken. Verzamelt verplichte velden: voornaam en klantType.',
    parameters: { type: 'object', properties: {
      companyName: { type: 'string', description: 'Bedrijfsnaam — verplicht' },
      firstName:   { type: 'string', description: 'Voornaam contactpersoon' },
      klantType:   { type: 'string', description: 'Lead of Klant' },
    }, required: ['companyName'] },
  },
  {
    type: 'function', name: 'contact_create',
    description: 'Maak een nieuw GHL contact aan. Alleen aanroepen na contact_intake met status=ready_to_create.',
    parameters: { type: 'object', properties: {
      firstName:    { type: 'string' },
      companyName:  { type: 'string' },
      klantType:    { type: 'string', enum: ['Lead', 'Klant'] },
      lastName:     { type: 'string' },
      email:        { type: 'string' },
      phone:        { type: 'string', description: 'E.164 formaat' },
      address1:     { type: 'string' },
      postalCode:   { type: 'string' },
      city:         { type: 'string' },
      groothandel:  { type: 'string' },
      force_create: { type: 'boolean', description: 'true = negeer duplicate waarschuwing' },
    }, required: ['firstName', 'companyName', 'klantType'] },
  },
  {
    type: 'function', name: 'contact_briefing',
    description: 'Haal volledige briefing op van een contact: naam, adres, type, recente notities, taken, afspraken.',
    parameters: { type: 'object', properties: {
      contactId: { type: 'string', description: 'Contact ID uit contact_zoek' },
    }, required: ['contactId'] },
  },
  {
    type: 'function', name: 'google_zoek_adres',
    description: 'Zoek adres, telefoonnummer en openingstijden van een bedrijf via Google Places.',
    parameters: { type: 'object', properties: {
      query: { type: 'string', description: 'Bedrijfsnaam plus stad, bijv: Bakkerij Janssen Alkmaar' },
    }, required: ['query'] },
  },
  {
    type: 'function', name: 'note_get',
    description: 'Haal notes op van een GHL contact.',
    parameters: { type: 'object', properties: {
      contactId: { type: 'string' },
    }, required: ['contactId'] },
  },
  {
    type: 'function', name: 'note_create',
    description: 'Voeg een nieuwe note toe aan een GHL contact.',
    parameters: { type: 'object', properties: {
      contactId: { type: 'string' },
      body:      { type: 'string', description: 'Volledige tekst van de note' },
      userId:    { type: 'string', description: 'ghl_user_id van de medewerker' },
    }, required: ['contactId', 'body'] },
  },
  {
    type: 'function', name: 'note_update',
    description: 'Bewerk een bestaande note. Geef de volledige nieuwe inhoud mee.',
    parameters: { type: 'object', properties: {
      contactId: { type: 'string' },
      noteId:    { type: 'string' },
      body:      { type: 'string' },
      userId:    { type: 'string' },
    }, required: ['contactId', 'noteId', 'body'] },
  },
  {
    type: 'function', name: 'task_get',
    description: 'Haal taken op van een GHL contact.',
    parameters: { type: 'object', properties: {
      contactId: { type: 'string' },
    }, required: ['contactId'] },
  },
  {
    type: 'function', name: 'task_create',
    description: 'Maak een taak of herinnering aan voor een GHL contact.',
    parameters: { type: 'object', properties: {
      contactId:  { type: 'string' },
      title:      { type: 'string', description: 'Taaknaam, bijv: Terugbellen of Follow-up sturen' },
      body:       { type: 'string', description: 'Extra context of omschrijving' },
      dueDate:    { type: 'string', description: 'ISO 8601, bijv: 2026-04-01T09:00:00+02:00' },
      assignedTo: { type: 'string', description: 'ghl_user_id van de medewerker' },
    }, required: ['contactId', 'title', 'dueDate'] },
  },
  {
    type: 'function', name: 'task_update',
    description: 'Wijzig of sluit een taak. completed=true markeert als afgerond.',
    parameters: { type: 'object', properties: {
      contactId:  { type: 'string' },
      taskId:     { type: 'string' },
      title:      { type: 'string' },
      body:       { type: 'string' },
      dueDate:    { type: 'string' },
      assignedTo: { type: 'string' },
      completed:  { type: 'boolean' },
    }, required: ['contactId', 'taskId'] },
  },
  {
    type: 'function', name: 'calendar_get_many',
    description: 'Haal afspraken op voor een datumrange. Gebruik voor dagplanning of weekoverzicht.',
    parameters: { type: 'object', properties: {
      userId:    { type: 'string', description: 'ghl_user_id van de medewerker' },
      startDate: { type: 'string', description: 'YYYY-MM-DD' },
      endDate:   { type: 'string', description: 'YYYY-MM-DD, zelfde als startDate voor één dag' },
    }, required: ['userId', 'startDate', 'endDate'] },
  },
  {
    type: 'function', name: 'calendar_get_free_slot',
    description: 'Haal vrije 30-minuten slots op in een agenda. Altijd aanroepen vóór calendar_create.',
    parameters: { type: 'object', properties: {
      calendarId: { type: 'string', description: 'calendar_id uit gebruikerscontext' },
      date:       { type: 'string', description: 'YYYY-MM-DD' },
    }, required: ['calendarId', 'date'] },
  },
  {
    type: 'function', name: 'calendar_create',
    description: 'Maak een afspraak aan met een CRM contact. Vereist contactId.',
    parameters: { type: 'object', properties: {
      contactId:  { type: 'string' },
      calendarId: { type: 'string' },
      title:      { type: 'string' },
      startTime:  { type: 'string', description: 'ISO 8601 uit calendar_get_free_slot' },
      endTime:    { type: 'string', description: 'startTime + 30 min' },
      notes:      { type: 'string' },
    }, required: ['contactId', 'calendarId', 'title', 'startTime', 'endTime'] },
  },
  {
    type: 'function', name: 'calendar_block',
    description: 'Blokkeer een slot in één of twee agenda\'s — voor intern overleg, geen contactId nodig.',
    parameters: { type: 'object', properties: {
      calendarId:       { type: 'string', description: 'calendar_id van de ingelogde gebruiker' },
      title:            { type: 'string' },
      startTime:        { type: 'string', description: 'ISO 8601' },
      endTime:          { type: 'string', description: 'ISO 8601' },
      description:      { type: 'string' },
      secondCalendarId: { type: 'string', description: 'calendar_id van collega uit get_team_members' },
    }, required: ['calendarId', 'title', 'startTime', 'endTime'] },
  },
  {
    type: 'function', name: 'get_team_members',
    description: 'Haal teamleden op met hun naam, ghl_user_id en calendar_id.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function', name: 'get_stats',
    description: 'Haal CRM statistieken op: aantal leads, klanten, recente activiteit.',
    parameters: { type: 'object', properties: {} },
  },
]

export async function POST(req: Request) {
  try {
    const { session_id: _sid, employee_id } = await req.json()
    const orgId = ORG_ID()
    const user  = await resolveUser(orgId, employee_id)

    const now = new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })
    const instructions = [
      VOICE_SYSTEM,
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
        model:        'gpt-4o-realtime-preview',
        instructions,
        tools:        VOICE_TOOLS,
        audio: { voice: 'alloy' },
        turn_detection: {
          type:                'server_vad',
          threshold:           0.5,
          prefix_padding_ms:   300,
          silence_duration_ms: 600,
        },
        input_audio_transcription: { model: 'gpt-4o-transcribe' },
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
