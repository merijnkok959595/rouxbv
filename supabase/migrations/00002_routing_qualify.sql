-- ROUX — routing, qualify/intelligence en activity tabellen
-- Uitvoeren in Supabase: SQL Editor → New query → plakken → Run

-- ── Team members ─────────────────────────────────────────────────────────
create table if not exists public.team_members (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  naam             text not null,
  email            text,
  postcode_ranges  text[] default '{}',
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

create index if not exists team_members_org on public.team_members (organization_id);

alter table public.team_members enable row level security;

-- ── Routing config (één rij per org) ─────────────────────────────────────
create table if not exists public.routing_config (
  organization_id          uuid primary key references public.organizations (id) on delete cascade,
  pre_routing_prompt       text,
  pre_routing_assign_to_id uuid references public.team_members (id) on delete set null,
  pre_routing_websearch    boolean not null default false,
  fallback_user_id         uuid references public.team_members (id) on delete set null,
  fallback_ai              boolean not null default false,
  routing_disabled         boolean not null default false,
  skip_pre                 boolean not null default false,
  skip_body                boolean not null default false,
  updated_at               timestamptz not null default now()
);

alter table public.routing_config enable row level security;

-- ── Routing rules ─────────────────────────────────────────────────────────
create table if not exists public.routing_rules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  phase            text not null default 'body'
                     check (phase in ('pre', 'body')),
  condition        text not null default 'name_contains'
                     check (condition in ('name_contains', 'industry_is', 'postcode_starts')),
  value            text not null default '',
  assign_to_id     uuid references public.team_members (id) on delete set null,
  position         integer not null default 0,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

create index if not exists routing_rules_org on public.routing_rules (organization_id, active, position);

alter table public.routing_rules enable row level security;

-- ── Intelligence / qualify config (één rij per org) ──────────────────────
create table if not exists public.intelligence_config (
  organization_id      uuid primary key references public.organizations (id) on delete cascade,
  system_prompt        text,
  knowledge_base       text,
  enrich_websearch     boolean not null default true,
  enrich_webcrawl      boolean not null default true,
  enrich_maps          boolean not null default false,
  enrich_linkedin      boolean not null default false,
  benchmark_assumptions jsonb default '[]'::jsonb,
  scoring_prompt       text,
  updated_at           timestamptz not null default now()
);

alter table public.intelligence_config enable row level security;

-- ── Contact events (activity log) ────────────────────────────────────────
create table if not exists public.contact_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  contact_id       uuid references public.contacts (id) on delete set null,
  event_type       text not null,
  actor            text not null default 'system',
  metadata         jsonb default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists contact_events_contact on public.contact_events (contact_id, created_at desc);
create index if not exists contact_events_org on public.contact_events (organization_id, created_at desc);

alter table public.contact_events enable row level security;

-- ── Chat messages (voor SUUS) ─────────────────────────────────────────────
create table if not exists public.chat_messages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations (id) on delete cascade,
  session_id       text not null,
  role             text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content          text,
  surface          text default 'web',
  created_at       timestamptz not null default now()
);

create index if not exists chat_messages_session on public.chat_messages (session_id, created_at asc);
create index if not exists chat_messages_org on public.chat_messages (organization_id, created_at desc);

alter table public.chat_messages enable row level security;

-- ── Extra kolommen op contacts voor intelligence ──────────────────────────
alter table public.contacts add column if not exists label   text;
alter table public.contacts add column if not exists revenue integer;
alter table public.contacts add column if not exists website text;
alter table public.contacts add column if not exists industry text;
alter table public.contacts add column if not exists last_activity timestamptz;
