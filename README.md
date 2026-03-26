# ROUX — CRM & Beurs Formulier

Interne Next.js applicatie voor ROUX BV. Bevat een beurs-intake formulier, AI-gestuurde lead routing en kwalificatie, een leads overzicht en SUUS — een AI assistent met toegang tot de CRM data.

---

## Architectuur

```
Browser / Mobiel
    │
    ▼
Next.js App (Vercel)
├── /formulier        Beurs intake formulier (mobiel-first)
├── /leads            Lead overzicht met filters
├── /instellingen     Medewerkers, routing, kwalificatie config
├── /routing          Routing configuratie (postcode, regels, AI)
├── /suus             SUUS AI chat assistent
└── /test             Endpoint smoke-tests (admin only)
    │
    ├── Supabase (PostgreSQL)   Primaire database
    ├── GoHighLevel (GHL)       CRM synchronisatie
    ├── OpenAI (GPT-4.1)        SUUS AI + lead kwalificatie
    ├── Retell AI               Voice agent
    └── Twilio                  SIP / WhatsApp
```

---

## Lokaal starten

```bash
# 1. Clone en installeer
git clone https://github.com/merijnkok959595/rouxbv.git
cd rouxbv
npm install

# 2. Maak .env.local aan (zie sectie Environment Variables)
cp .env.example .env.local   # of maak hem handmatig aan

# 3. Zet database op (eenmalig)
npm run setup-db   # of voer supabase/migrations/* handmatig uit in Supabase SQL Editor

# 4. Start dev server
npm run dev        # http://localhost:3000
```

> **Tip:** als de dev server op een andere poort start (bijv. 3007), werkt routing automatisch via `process.env.PORT`.

---

## Environment Variables

Maak een `.env.local` in de root aan met de volgende variabelen:

### Supabase
| Variabele | Beschrijving |
|-----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon/public key van Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side only, **geheim**) |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI access token (voor `supabase` CLI commands) |
| `ORGANIZATION_ID` | UUID van de ROUX organisatie-rij in de `organizations` tabel |

### Google Maps
| Variabele | Beschrijving |
|-----------|-------------|
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Maps API key (Places Autocomplete in formulier) |

### App
| Variabele | Beschrijving |
|-----------|-------------|
| `NEXT_PUBLIC_APP_URL` | Productie URL, bijv. `https://rouxbv.vercel.app` |

### OpenAI
| Variabele | Beschrijving |
|-----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key (SUUS, routing AI, kwalificatie) |
| `OPENAI_PROJECT_ID` | OpenAI project ID |
| `OPENAI_WEBHOOK_SECRET` | Webhook signing secret voor OpenAI events |

### Twilio
| Variabele | Beschrijving |
|-----------|-------------|
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token (**geheim**) |
| `TWILIO_PHONE_NUMBER` | Twilio telefoonnummer (bijv. `+31...`) |
| `TWILIO_SIP_TRUNK_SID` | SIP trunk SID voor inkomende calls |
| `TWILIO_WHATSAPP_FROM` | WhatsApp afzender (bijv. `whatsapp:+31...`) |

### Retell AI
| Variabele | Beschrijving |
|-----------|-------------|
| `RETELL_API_KEY` | Retell API key |
| `RETELL_AGENT_ID` | Retell agent ID (SUUS voice) |
| `RETELL_VOICE_AGENT_ID` | Retell voice-only agent ID |

### GoHighLevel
| Variabele | Beschrijving |
|-----------|-------------|
| `GHL_API_KEY` | GHL API key (CRM sync) |
| `GHL_LOCATION_ID` | GHL location/subaccount ID |

---

## Database Schema

Migraties staan in `supabase/migrations/`. Voer ze op volgorde uit in de Supabase SQL Editor.

| Migratie | Inhoud |
|----------|--------|
| `00001_roux_schema.sql` | `organizations`, `contacts` basistabellen + RLS |
| `00002_routing_qualify.sql` | `team_members`, `routing_config`, `routing_rules`, `intelligence_config`, `contact_events`, `chat_messages` |
| `00003_team_members_phone_calendar.sql` | `phone`, `calendar_id` op `team_members` |
| `00004_team_members_extra.sql` | `functie`, `rayon`, `ghl_user_id` op `team_members` |
| `00005_seed_team_members.sql` | Seed data voor ROUX teamleden |
| `00006_missing_columns.sql` | `color` op `team_members`, `whatsapp`/`ghl_synced` op `contacts`, `benchmark_customers` op `intelligence_config` |

### Tabellen

#### `organizations`
Eén rij voor ROUX. Het `id` veld staat in `ORGANIZATION_ID`.

| Kolom | Type | Beschrijving |
|-------|------|-------------|
| `id` | uuid | Primary key |
| `name` | text | Organisatienaam |
| `created_at` | timestamptz | Aanmaaktijd |

#### `contacts`
Alle beurs leads en klanten.

| Kolom | Type | Beschrijving |
|-------|------|-------------|
| `id` | uuid | Primary key |
| `organization_id` | uuid | FK → organizations |
| `company_name` | text | Bedrijfsnaam (verplicht) |
| `first_name`, `last_name` | text | Contactpersoon |
| `email`, `phone` | text | Contactgegevens |
| `address1`, `city`, `postcode`, `country` | text | Adres |
| `assigned_to` | text | Naam van toegewezen medewerker |
| `type` | text | `lead` of `customer` |
| `label` | text | AI kwalificatielabel: `A`, `B`, `C`, `D` |
| `revenue` | numeric | Geschatte omzet (AI) |
| `source` | text | Herkomst, bijv. `Horecava 2026` |
| `channel` | text | `OFFLINE`, `ONLINE`, etc. |
| `whatsapp` | boolean | Bereikbaar via WhatsApp |
| `ghl_synced` | boolean | Gesynchroniseerd met GHL |
| `custom_fields` | jsonb | Vrije velden: `intake_notes`, `created_by` |
| `opening_hours` | jsonb | Openingstijden (Google Places) |
| `created_at` | timestamptz | Aanmaaktijd |

#### `team_members`
ROUX medewerkers / account managers.

| Kolom | Type | Beschrijving |
|-------|------|-------------|
| `id` | uuid | Primary key |
| `organization_id` | uuid | FK → organizations |
| `naam` | text | Volledige naam |
| `email`, `phone` | text | Contactgegevens |
| `functie` | text | Rol, bijv. `Account Manager` |
| `rayon` | text | Regio beschrijving |
| `postcode_ranges` | text[] | Postcodegebieden, bijv. `["1000-1199"]` |
| `ghl_user_id` | text | GHL user ID voor CRM koppeling |
| `calendar_id` | text | GHL calendar ID voor SUUS afspraken |
| `color` | text | Hex kleurcode voor UI avatar dot |
| `active` | boolean | Actief in het systeem |

#### `routing_config`
Één rij per organisatie met routing-instellingen.

| Kolom | Type | Beschrijving |
|-------|------|-------------|
| `routing_disabled` | boolean | Schakel alle routing uit |
| `skip_pre` | boolean | Sla pre-routing over |
| `skip_body` | boolean | Sla body-routing over |
| `pre_routing_prompt` | text | AI prompt voor pre-routing classifier |
| `pre_routing_assign_to_id` | uuid | FK → team_members voor pre-routing match |
| `pre_routing_websearch` | boolean | Gebruik websearch in AI pre-routing |
| `fallback_user_id` | uuid | FK → team_members als geen regel matcht |

#### `routing_rules`
Handmatige routing regels op volgorde.

| Kolom | Type | Beschrijving |
|-------|------|-------------|
| `phase` | text | `pre` of `body` |
| `condition` | text | `name_contains`, `industry_is`, `postcode_starts` |
| `value` | text | Vergelijkingswaarde |
| `assign_to_id` | uuid | FK → team_members |
| `position` | int | Volgorde (laagste eerst) |
| `active` | boolean | Regel actief |

#### `intelligence_config`
AI kwalificatie-instellingen per organisatie.

| Kolom | Type | Beschrijving |
|-------|------|-------------|
| `system_prompt` | text | Basis systeem-prompt voor SUUS |
| `knowledge_base` | text | Extra kennisbank tekst |
| `enrich_websearch` | boolean | Websearch bij verrijken |
| `enrich_webcrawl` | boolean | Website crawl bij verrijken |
| `enrich_maps` | boolean | Google Maps data bij verrijken |
| `scoring_prompt` | text | Prompt voor A/B/C/D scoring |
| `benchmark_customers` | jsonb | Referentieklanten voor scoring |

#### `contact_events`
Immutable event log per contact (routing, verrijking, etc.).

#### `chat_messages`
SUUS chat geschiedenis per sessie.

---

## API Routes

### Formulier & Leads
| Route | Method | Beschrijving |
|-------|--------|-------------|
| `/api/formulier` | POST | Maak nieuw contact aan, start routing + verrijking |
| `/api/leads` | GET | Haal alle contacts op met filters |
| `/api/leads/stats` | GET | Statistieken (totaal, potentie, vandaag) |
| `/api/contacts/[id]` | GET | Haal één contact op (voor polling na submit) |

### Medewerkers
| Route | Method | Beschrijving |
|-------|--------|-------------|
| `/api/settings/employees` | GET | Alle actieve medewerkers |
| `/api/settings/employees` | POST | Nieuw teamlid aanmaken |
| `/api/settings/employees/[id]` | PATCH | Medewerker bijwerken |
| `/api/settings/employees/[id]` | DELETE | Medewerker deactiveren (soft delete) |
| `/api/settings/seed-users` | POST | Seed ROUX teamleden opnieuw |

### Routing
| Route | Method | Beschrijving |
|-------|--------|-------------|
| `/api/routing/config` | GET / PUT | Routing configuratie lezen/schrijven |
| `/api/routing/rules` | GET / POST | Routing regels |
| `/api/routing/rules/[id]` | DELETE | Verwijder routing regel |
| `/api/routing/apply` | POST | Routeer één contact |
| `/api/routing/apply-all` | POST | Herouteer alle contacten |

### Kwalificatie (Intelligence)
| Route | Method | Beschrijving |
|-------|--------|-------------|
| `/api/intelligence/config` | GET / PUT | AI kwalificatie instellingen |
| `/api/intelligence/enrich` | POST | Verrijk één contact (AI label, omzet, website) |
| `/api/intelligence/enrich-all` | POST | Verrijk alle contacten |

### SUUS AI
| Route | Method | Beschrijving |
|-------|--------|-------------|
| `/api/suus` | POST | SUUS chat (streaming SSE) |
| `/api/suus/transcribe` | POST | Audio → tekst (OpenAI Whisper) |
| `/api/suus/save-message` | POST | Sla chatbericht op |
| `/api/suus/tool-call` | POST | SUUS tool executie |

### Voice & WhatsApp
| Route | Method | Beschrijving |
|-------|--------|-------------|
| `/api/call` | POST | Initieer outbound call |
| `/api/call/incoming` | GET | WebSocket handler voor inkomende SIP calls |
| `/api/retell-llm` | POST | Retell LLM webhook |
| `/api/voice` | POST | Voice webhook handler |
| `/api/whatsapp` | POST | WhatsApp webhook (Twilio) |

### GHL (GoHighLevel)
| Route | Method | Beschrijving |
|-------|--------|-------------|
| `/api/contact-create` | POST | Maak contact aan in GHL |
| `/api/contact-update/[id]` | POST | Update contact in GHL |

---

## Scripts

```bash
npm run dev          # Start dev server (met WATCHPACK_POLLING)
npm run dev:clean    # Wis .next cache + start dev server
npm run build        # Productie build
npm run setup-db     # Voer database setup script uit
```

---

## Deployment

De app deployt automatisch op **Vercel** bij elke push naar `main`.

### Omgevingsvariabelen instellen op Vercel
Voeg alle variabelen uit `.env.local` toe in het Vercel dashboard onder **Settings → Environment Variables**.

### Supabase Edge Functions
Edge functions staan in `supabase/functions/`. Deploy met:
```bash
supabase functions deploy retell-llm
supabase functions deploy suus
supabase functions deploy voice
```

> Edge functions gebruiken `DEFAULT_ORGANIZATION_ID` (suus, retell-llm) of `ORGANIZATION_ID` (voice) als environment variabele — stel deze in via het Supabase dashboard onder **Edge Functions → Secrets**.

---

## Wachtwoord & Beveiliging

De app is beveiligd met een eenvoudig wachtwoord in `components/PasswordGate.tsx`. Dit is bedoeld voor intern gebruik op een beurs — geen productie-authenticatie.

Admin functies (test page, seed users) zijn extra beveiligd via `components/AdminGate.tsx`.

> Voor productie-gebruik: vervang PasswordGate door Supabase Auth of een andere auth provider.
