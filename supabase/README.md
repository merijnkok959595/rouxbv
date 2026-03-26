# Nieuwe database voor ROUX (Supabase)

## 1. Nieuw Supabase-project

1. Ga naar [supabase.com](https://supabase.com) → **New project** (eigen naam/regio/wachtwoord).
2. Wacht tot de database klaar is.

## 2. Schema aanmaken

1. In het project: **SQL Editor** → **New query**.
2. Open lokaal het bestand `migrations/00001_roux_schema.sql` en plak de volledige inhoud in de editor.
3. Klik **Run**.

## 3. Keys en org-ID in `.env.local`

1. **Settings** → **API**:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY` (optioneel voor client)
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (geheim; alleen server)

2. **Organization UUID** voor `ORGANIZATION_ID`:

   ```sql
   select id, name from public.organizations;
   ```

   Kopieer `id` van de rij `ROUX` naar `ORGANIZATION_ID` in `.env.local`.

## 4. App starten

```bash
npm run dev
```

Formulier en `/api/leads` gebruiken de **service role** + `ORGANIZATION_ID`; zonder correcte waarden faalt opslaan.

## Optioneel: CLI-migraties

Als je de Supabase CLI gebruikt: `supabase link` en daarna `supabase db push` (met project gekoppeld).
