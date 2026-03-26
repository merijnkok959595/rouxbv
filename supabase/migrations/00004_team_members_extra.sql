-- ROUX — extra kolommen op team_members voor GHL koppeling
-- Uitvoeren in Supabase: SQL Editor → New query → plakken → Run

alter table public.team_members add column if not exists phone        text;
alter table public.team_members add column if not exists functie      text;
alter table public.team_members add column if not exists rayon        text;
alter table public.team_members add column if not exists ghl_user_id  text;
alter table public.team_members add column if not exists calendar_id  text;
