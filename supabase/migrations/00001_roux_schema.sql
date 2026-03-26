-- ROUX — schema voor beurs-formulier (contacts + organizations)
-- Uitvoeren in Supabase: SQL Editor → New query → plakken → Run

create extension if not exists "pgcrypto";

-- ── Organisaties (één id zet je in ORGANIZATION_ID) ─────────────────────
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'ROUX',
  created_at  timestamptz not null default now()
);

-- ── Leads / contacts ────────────────────────────────────────────────────
create table if not exists public.contacts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  company_name     text not null,
  first_name       text,
  last_name        text,
  email            text,
  phone            text,
  address1         text,
  city             text,
  postcode         text,
  country          text default 'Nederland',
  assigned_to      text,
  type             text default 'lead',
  source           text,
  channel          text default 'OFFLINE',
  custom_fields    jsonb,
  opening_hours    jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists contacts_org_created_desc
  on public.contacts (organization_id, created_at desc);

-- RLS aan (service role key negeert RLS in Supabase; anon heeft zo geen toegang)
alter table public.organizations enable row level security;
alter table public.contacts enable row level security;

-- Startorganisatie (één keer uitvoeren; daarna id kopiëren naar .env.local)
insert into public.organizations (name)
select 'ROUX'
where not exists (select 1 from public.organizations limit 1);
