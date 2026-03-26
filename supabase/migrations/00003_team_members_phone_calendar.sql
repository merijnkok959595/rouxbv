-- Add phone and calendar_id to team_members for SUUS voice/WhatsApp identification
-- Run in Supabase: SQL Editor → New query → paste → Run

alter table public.team_members
  add column if not exists phone       text,
  add column if not exists calendar_id text;

comment on column public.team_members.phone       is 'E.164 phone number (+31612345678) — used to identify incoming WhatsApp/voice calls';
comment on column public.team_members.calendar_id is 'GHL calendar ID for this team member — used by SUUS for appointment creation';
