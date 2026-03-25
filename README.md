# ROUX

Standalone webapp met twee modules:
- **Beurs formulier** — offline lead intake met Google Places autocomplete
- **SUUS** — AI sales assistant (chat + bellen via Retell)

## Setup

```bash
cp .env.local.example .env.local
# Vul alle variabelen in

npm install
npm run dev
```

## Pagina's

| Route | Module |
|---|---|
| `/formulier` | Beurs lead intake formulier |
| `/suus` | SUUS AI chat |

## Supabase Edge Function (SUUS)

```bash
# Deploy de edge function
supabase functions deploy suus

# Stel secrets in
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set DEFAULT_ORGANIZATION_ID=your-org-uuid

# Kopieer de URL naar .env.local
# SUPABASE_SUUS_EDGE_URL=https://xxxx.supabase.co/functions/v1/suus
```

## Deploy naar Vercel

```bash
vercel --prod
```

Zet alle env vars in Vercel dashboard onder Settings → Environment Variables.

## GHL koppeling (later)

- **Formulier** → webhook na contact_create → GHL contact aanmaken
- **SUUS** → GHL custom values bijwerken na chat sessie
