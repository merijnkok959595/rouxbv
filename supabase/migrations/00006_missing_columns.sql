-- ROUX — add columns that the application uses but were missing from earlier migrations
-- Safe to run multiple times (IF NOT EXISTS guards)
-- Run in Supabase: SQL Editor → New query → paste → Run

-- team_members: UI color for employee avatars / dropdowns
alter table public.team_members
  add column if not exists color text;

comment on column public.team_members.color is
  'Hex color code (#RRGGBB) shown as avatar dot in the UI';

-- contacts: WhatsApp reachability flag and GHL sync status
alter table public.contacts
  add column if not exists whatsapp   boolean default false,
  add column if not exists ghl_synced boolean default false;

comment on column public.contacts.whatsapp   is 'True if customer is reachable via WhatsApp';
comment on column public.contacts.ghl_synced is 'True if contact has been synced to GoHighLevel';

-- intelligence_config: benchmark customers array for AI scoring
alter table public.intelligence_config
  add column if not exists benchmark_customers jsonb default '[]'::jsonb;

comment on column public.intelligence_config.benchmark_customers is
  'Array of reference customers used as scoring benchmarks: [{id, name, city, revenue, label}]';
