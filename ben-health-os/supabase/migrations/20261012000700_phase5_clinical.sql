-- Phase 5: clinical intelligence — lab review staging, allergies, medication source reconciliation, FHIR staging.
create table if not exists public.allergies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  substance text not null,
  reaction text,
  severity text not null default 'UNKNOWN' check (severity in ('MILD','MODERATE','SEVERE','UNKNOWN')),
  source text not null default 'USER',        -- USER|CLINICIAN|CLINICAL_FHIR
  source_record text,
  recorded_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, source_record)
);
alter table public.allergies enable row level security;
create policy allergies_select on public.allergies for select to authenticated using ((select auth.uid()) = user_id);
create policy allergies_insert on public.allergies for insert to authenticated with check ((select auth.uid()) = user_id);
create policy allergies_update on public.allergies for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy allergies_delete on public.allergies for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.allergies to authenticated;

alter table public.lab_results add column if not exists raw_event_id uuid references public.raw_ingest_events(id) on delete set null;
alter table public.lab_results add column if not exists panel_name text;
alter table public.lab_results add column if not exists review_note text;
alter table public.lab_results add column if not exists reviewed_at timestamptz;
alter table public.lab_results add column if not exists duplicate_reason text;
create index if not exists lab_results_user_analyte_idx on public.lab_results (user_id, analyte, collected_at desc);
create index if not exists lab_results_user_status_idx on public.lab_results (user_id, verification_status);

alter table public.documents add column if not exists page_count integer;
alter table public.documents add column if not exists extraction_summary jsonb not null default '{}'::jsonb;

alter table public.conditions add column if not exists external_id text;
alter table public.conditions add column if not exists verification_status text not null default 'CONFIRMED' check (verification_status in ('UNVERIFIED','REVIEW','CONFIRMED','REJECTED'));
alter table public.conditions add column if not exists raw jsonb not null default '{}'::jsonb;
create unique index if not exists conditions_user_source_external_idx on public.conditions (user_id, source, external_id) where external_id is not null;

alter table public.clinical_events add column if not exists external_id text;
create unique index if not exists clinical_events_user_source_external_idx on public.clinical_events (user_id, source, external_id) where external_id is not null;

alter table public.medications add column if not exists source text not null default 'USER';
alter table public.medication_source_records add column if not exists name text;
alter table public.medication_source_records add column if not exists status text not null default 'UNRECONCILED' check (status in ('UNRECONCILED','LINKED','IGNORED'));
create unique index if not exists medication_source_records_user_source_idx on public.medication_source_records (user_id, source, source_record_id) where source_record_id is not null;

alter table public.preventive_care_items add column if not exists completion_history jsonb not null default '[]'::jsonb;

insert into public.algorithm_versions (algorithm, version, description) values
  ('lab_unit_normalization', 1, 'Per-analyte canonical units with explicit conversion factors; unconvertible units are kept as reported and flagged'),
  ('lab_text_extraction', 1, 'Line-based extraction from PDF text layers (name, value, unit, reference range, flag) with per-row confidence; always staged for review'),
  ('lab_dedup', 1, 'Same analyte, collection date within 1 day, canonical value within 1 %: lower-priority source linked as duplicate'),
  ('preventive_status', 1, 'DUE / DUE_SOON (60 days) / COMPLETED from last completion + interval; DISCUSS_WITH_CLINICIAN and NOT_APPLICABLE are user-set'),
  ('physician_brief', 1, 'Assembles measured facts with provenance: medications, allergies, conditions, BP/weight/lab trends, exercise/recovery, recent signals')
on conflict do nothing;

-- SMART on FHIR launches need the organization + discovered endpoints between start and callback.
alter table public.oauth_states add column if not exists metadata jsonb not null default '{}'::jsonb;
