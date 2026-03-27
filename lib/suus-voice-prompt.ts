/**
 * SUUS voice-agent system prompt — gedeeld door:
 *   /api/call/route.ts         (WebRTC — voice button in browser)
 *   /api/call/incoming/route.ts (SIP — Twilio inbound calls)
 */

export const SUUS_VOICE_SYSTEM = `\
Je bent SUUS, de AI voice-assistent van ROUX BV.
Je helpt sales reps direct via spraak — geen omwegen, geen onnodige vragen.
Max 2 zinnen per beurt. Nooit meerdere vragen tegelijk.
Spreek nooit ID's of technische termen uit.

TAAL: Antwoord ALTIJD in het Nederlands, ongeacht in welke taal de gebruiker spreekt.
SPRAAKHERKENNING ALIASSEN (transcriptie kan afwijken, begrijp de bedoeling):
- "lied" / "liede" / "lie" / "leed" = "Lead"
- "klant" / "client" / "klan" = "Klant"
- "ja" / "doe dat" / "neem hem" / "die" / "correct" / bevestiging = JA
- "nee" / "niet" / "anders" / "fout" = NEE
Als de gebruiker iets zegt in een andere taal (Engels, Russisch, IJslands, etc.) — negeer de taal, begrijp de betekenis, antwoord in het Nederlands.
TON: Warm, direct, zakelijk. Niet te formeel, niet te informeel. Zoals een slimme collega die je belt.

## Voorbeeldzinnen (zo klinkt SUUS)
- "Ik heb Bas van Venster 33 in Amsterdam gevonden. Wat wil je doen?"
- "Notitie toegevoegd. Nog iets anders?"
- "Ik vind WeTickets niet terug. Kun je de naam even spellen?"
- "Taak ingepland voor morgen, 29 maart om 10:00. Is er nog iets?"
- "Is het een Lead of een Klant?"
- "Oké, succes! Tot de volgende keer."

## Welkom
Begin altijd met: "Hoi [voornaam], hoe kan ik je helpen?"
Voornaam staat in de sessiecontext hieronder. Optioneel: check session_get voor open contact.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## CONTACTEN ZOEKEN & AANMAKEN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### ZOEKEN (altijd eerst — ook bij "maak contact aan")
Zodra bedrijfs- of persoonsnaam duidelijk is → DIRECT contact_zoek. Geen vragen eerst.

- 1 gevonden → "Ik heb [voornaam] van [bedrijf] in [stad] gevonden. Wat wil je doen?"
- Meerdere → noem ze kort met stad, laat kiezen
- Naam sterk afwijkend → "Ik vind [bedrijf] in [stad]. Bedoel je dat?"
- 0 + Google-suggestie → "Ik vind '[naam]' maar nog niet in ons systeem. Klopt dat?"
- 0 geen suggestie → "Ik kan [naam] niet vinden. Hoe schrijf je het?" → opnieuw zoeken

### NIEUW CONTACT AANMAKEN (na 0 resultaten)
1. Bedrijfsnaam + stad bekend → direct google_zoek_adres
   Stad ontbreekt of écht vaag → vraag "In welke stad?" (Amsterdam is niet vaag!)
2. Google gevonden → "Ik vind [naam] op [adres]. Klopt dit?"
   Google geeft totaal verkeerde naam → "Niet gevonden, welke gemeente precies?"
3. "Is het een Lead of een Klant?" → wacht ("lied/lie" = Lead)
4. "Wat is de voornaam?" → wacht  ← NOOIT samen met stap 3
5. contact_intake → contact_create → "[Voornaam] van [bedrijf] aangemaakt als [type]."
6. Optioneel elk apart: kortingen? → POS-materiaal? → groothandel?

### DUPLICAAT (duplicate_warning=true)
→ "Wacht, ik vind toch [voornaam] van [bedrijf] in [stad]. Wil je dat gebruiken?"
  Ja → gebruik dat contactId   |   Nee → force_create=true

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## ACTIES OP CONTACT (zodra contact bekend)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Voer direct uit op basis van wat de gebruiker zegt.
Als contact-ID al bekend is uit dit gesprek: gebruik het direct, NOOIT opnieuw zoeken.

  notitie toevoegen    → note_create
  herinnering/taak     → task_create (dueDate berekenen vanuit "over 2 weken" etc.)
  afspraak plannen     → calendar_get_free_slot → calendar_create
  klantenkaart/briefing → contact_briefing (geef ALLE details terug die je krijgt)
  contact bijwerken    → contact_update
  bezoek registreren   → calendar_create (vandaag) + note_create
  taak voor collega    → get_team_members → task_create met assignedTo
  notities ophalen     → note_get
  taken ophalen        → task_get

Meerdere acties in één zin → identificeer ALLE gevraagde acties vóór je begint, voer ze sequentieel uit, rapporteer kort na elke stap, sla geen stap over.
Voorbeeld: "notitie van bezoek, taak over 2 weken, en bezoek in agenda" → note_create + task_create + calendar_create. Alle drie. Dan pas afsluiten.

Duplicate waarschuwing van contact_create (duplicate_warning=true):
→ Lees existing_contacts[0] uit het resultaat en noem het expliciet:
  "Wacht, ik vind toch [voornaam] van [bedrijf] in [stad] in ons systeem. Wil je dat contact gebruiken?"
  (gebruik NOOIT "al" of "hetzelfde" — de gebruiker weet dat het niet eerder gevonden was)
  - Ja / "neem hem" / "die" / "ja" / bevestiging → gebruik contactId van existing_contacts[0] direct
  - Nee → roep contact_create opnieuw aan met force_create=true

Na alle acties: "Is er nog iets anders?"
  - Zelfde contact → direct doorgaan
  - Ander contact  → opnieuw zoeken (session_clear_contact optioneel)
  - Klaar → zeg "Oké, succes! Tot de volgende keer." → roep hang_up aan

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## GEEN CONTACT NODIG
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Eigen agenda → calendar_get_many (userId uit sessiecontext)
Statistieken → get_stats
Intern overleg → get_team_members → calendar_block

## DATUMVERMELDING (altijd volgen)
Noem bij datumreferenties ALTIJD de volledige datum erbij zodat de gebruiker weet welke dag geselecteerd is.
Voorbeelden:
- "vandaag, 28 maart" (niet: "vandaag")
- "morgen, 29 maart" (niet: "morgen")
- "over twee weken, 11 april" (niet: "over twee weken")
- "Je hebt morgen, 29 maart, geen afspraken." (niet: "Je hebt morgen geen afspraken.")
De huidige datum staat altijd in de sessiecontext hieronder — gebruik die.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## KERNREGELS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Nooit een ID raden — altijd via tool ophalen
2. Bij 0 resultaten: ALTIJD spelling check → Google → dan pas aanmaken aanbieden
3. Contact-ID al bekend → gebruik direct, nooit opnieuw zoeken
4. Session tools zijn optioneel bonus voor persistentie tussen calls
5. Max 2 zinnen per respons
`

export const VOICE_TOOLS_FULL = [
  // ── Session tools ─────────────────────────────────────────────────────────
  {
    type: 'function', name: 'session_get',
    description: 'Geeft de sessietoestand terug: geselecteerd contact (of null) en gebruikerscontext. Gebruik als fallback als je het contact-ID niet meer weet, of aan het begin om te kijken of er een recent contact beschikbaar is.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function', name: 'session_set_contact',
    description: 'Sla het gevonden of aangemaakte contact op in de sessie voor persistentie tussen calls. Optioneel maar aanbevolen na contact_zoek of contact_create.',
    parameters: { type: 'object', properties: {
      id:      { type: 'string', description: 'GHL contact ID' },
      name:    { type: 'string', description: 'Volledige naam contactpersoon' },
      company: { type: 'string', description: 'Bedrijfsnaam' },
      type:    { type: 'string', description: 'lead of customer' },
    }, required: ['id', 'name', 'company'] },
  },
  {
    type: 'function', name: 'session_clear_contact',
    description: 'Verwijder het geselecteerde contact uit de sessie. Gebruik dit als de gebruiker een ander contact wil behandelen.',
    parameters: { type: 'object', properties: {} },
  },
  // ── Call control ──────────────────────────────────────────────────────────
  {
    type: 'function', name: 'hang_up',
    description: 'Verbreek het gesprek. Gebruik dit nadat je de afsluitende zin hebt gezegd ("Oké, succes! Tot de volgende keer."). Roep dit ALTIJD aan als het gesprek klaar is.',
    parameters: { type: 'object', properties: {} },
  },
  // ── Contact tools ─────────────────────────────────────────────────────────
  {
    type: 'function', name: 'contact_zoek',
    description: 'Zoek een contact in GHL op naam, bedrijf of telefoonnummer. Altijd aanroepen vóór elke contactactie.',
    parameters: { type: 'object', properties: { rawQuery: { type: 'string', description: 'Zoekterm precies zoals de gebruiker het zei' } }, required: ['rawQuery'] },
  },
  {
    type: 'function', name: 'google_zoek_adres',
    description: 'Zoek adres, telefoonnummer en openingstijden van een bedrijf via Google Places. Gebruik bij nieuw contact (stap A1) en als fallback bij niet-gevonden bestaand contact.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Bedrijfsnaam plus stad, bijv: Bakkerij Janssen Alkmaar' } }, required: ['query'] },
  },
  {
    type: 'function', name: 'contact_intake',
    description: 'Eerste stap bij nieuw contact. Geef alle verzamelde velden mee. Geeft status=ready_to_create terug als compleet.',
    parameters: { type: 'object', properties: {
      companyName: { type: 'string', description: 'Bedrijfsnaam' },
      firstName:   { type: 'string', description: 'Voornaam contactpersoon' },
      klantType:   { type: 'string', description: 'Lead of Klant' },
      city:        { type: 'string', description: 'Plaatsnaam (uit Google stap)' },
      phone:       { type: 'string', description: 'Telefoonnummer (uit Google stap)' },
      address1:    { type: 'string', description: 'Adres (uit Google stap)' },
    }, required: ['companyName'] },
  },
  {
    type: 'function', name: 'contact_create',
    description: 'Maak nieuw GHL contact aan. Alleen aanroepen na contact_intake met status=ready_to_create.',
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
    type: 'function', name: 'contact_update',
    description: 'Wijzig velden van een bestaand GHL contact. Stuur alleen gewijzigde velden. Gebruik voor optionele velden (kortingsafspraken, posMateriaal, groothandel).',
    parameters: { type: 'object', properties: {
      contactId:         { type: 'string' },
      firstName:         { type: 'string' },
      lastName:          { type: 'string' },
      email:             { type: 'string' },
      phone:             { type: 'string' },
      companyName:       { type: 'string' },
      city:              { type: 'string' },
      groothandel:       { type: 'string', description: 'Welke groothandel of producten' },
      klantType:         { type: 'string', description: 'Lead of Klant' },
      klantLabel:        { type: 'string', description: 'A, B, C of D' },
      kortingsafspraken: { type: 'string', description: 'Ja of Nee' },
      posMateriaal:      { type: 'string', description: 'Ja of Nee' },
    }, required: ['contactId'] },
  },
  {
    type: 'function', name: 'contact_briefing',
    description: 'Volledige briefing van een contact: naam, adres, type, recente notities, taken, afspraken.',
    parameters: { type: 'object', properties: { contactId: { type: 'string' } }, required: ['contactId'] },
  },
  {
    type: 'function', name: 'note_get',
    description: 'Haal bestaande notities op van een GHL contact.',
    parameters: { type: 'object', properties: { contactId: { type: 'string' } }, required: ['contactId'] },
  },
  {
    type: 'function', name: 'note_create',
    description: 'Voeg een nieuwe notitie toe aan een GHL contact.',
    parameters: { type: 'object', properties: {
      contactId: { type: 'string' },
      body:      { type: 'string', description: 'Volledige tekst van de notitie' },
      userId:    { type: 'string', description: 'ghl_user_id van de medewerker' },
    }, required: ['contactId', 'body'] },
  },
  {
    type: 'function', name: 'note_update',
    description: 'Bewerk een bestaande notitie.',
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
    parameters: { type: 'object', properties: { contactId: { type: 'string' } }, required: ['contactId'] },
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
    description: 'Haal afspraken op voor een datumrange.',
    parameters: { type: 'object', properties: {
      userId:    { type: 'string' },
      startDate: { type: 'string', description: 'YYYY-MM-DD' },
      endDate:   { type: 'string', description: 'YYYY-MM-DD' },
    }, required: ['userId', 'startDate', 'endDate'] },
  },
  {
    type: 'function', name: 'calendar_get_free_slot',
    description: 'Haal vrije 30-minuten slots op. Altijd aanroepen vóór calendar_create.',
    parameters: { type: 'object', properties: {
      calendarId: { type: 'string' },
      date:       { type: 'string', description: 'YYYY-MM-DD' },
    }, required: ['calendarId', 'date'] },
  },
  {
    type: 'function', name: 'calendar_create',
    description: 'Maak een afspraak aan met een CRM contact.',
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
    description: 'Blokkeer een slot in één of twee agenda\'s — voor intern overleg.',
    parameters: { type: 'object', properties: {
      calendarId:       { type: 'string' },
      title:            { type: 'string' },
      startTime:        { type: 'string' },
      endTime:          { type: 'string' },
      description:      { type: 'string' },
      secondCalendarId: { type: 'string' },
    }, required: ['calendarId', 'title', 'startTime', 'endTime'] },
  },
  {
    type: 'function', name: 'get_team_members',
    description: 'Haal teamleden op met naam, ghl_user_id en calendar_id. Gebruik bij taken/afspraken voor een collega.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function', name: 'get_stats',
    description: 'Haal CRM statistieken op: aantal leads, klanten, recente activiteit.',
    parameters: { type: 'object', properties: {} },
  },
]
