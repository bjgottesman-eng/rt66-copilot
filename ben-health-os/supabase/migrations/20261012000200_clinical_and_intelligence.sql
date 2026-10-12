-- Ben Health OS — clinical records, medications, goals, experiments, recommendations, reports, memory.
-- Tables are created in Phase 0/1 so the data model is complete; feature code arrives in later phases.

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,                  -- LAB_PDF|LAB_CSV|CLINICAL_NOTE|IMAGING|OTHER
  title text not null,
  storage_path text,                   -- object storage key; files never live in the database
  mime_type text,
  sha256 text,
  size_bytes bigint,
  provider text,
  document_date date,
  uploaded_at timestamptz not null default now(),
  extraction_status text not null default 'PENDING' check (extraction_status in ('PENDING','EXTRACTED','REVIEW','CONFIRMED','FAILED')),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.lab_panels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  collected_at timestamptz,
  resulted_at timestamptz,
  laboratory text,
  ordering_provider text,
  source_connector text not null,
  document_id uuid references public.documents(id) on delete set null,
  external_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.lab_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  panel_id uuid references public.lab_panels(id) on delete set null,
  analyte text not null,               -- catalog id when mapped (apob, ldl_c ...), else raw name
  analyte_raw_name text not null,
  loinc text,
  value double precision,
  value_text text,                     -- for qualitative results ("Negative")
  unit text,
  canonical_value double precision,    -- converted to the catalog canonical unit when the conversion is defined
  canonical_unit text,
  reference_low double precision,
  reference_high double precision,
  reference_text text,
  abnormal_flag text,                  -- H|L|HH|LL|A|N|null as reported by the lab
  collected_at timestamptz,
  resulted_at timestamptz,
  laboratory text,
  provider text,
  method text,
  document_id uuid references public.documents(id) on delete set null,
  source_connector text not null,
  external_id text,
  extraction_confidence double precision,
  verification_status text not null default 'UNVERIFIED' check (verification_status in ('UNVERIFIED','REVIEW','CONFIRMED','REJECTED')),
  canonical boolean not null default true,
  duplicate_of uuid references public.lab_results(id) on delete set null,
  quality_flags text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, source_connector, external_id)
);
create index if not exists lab_results_analyte_idx on public.lab_results (user_id, analyte, collected_at desc);

create table if not exists public.conditions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  code_system text,
  code text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','RESOLVED','HISTORICAL','UNCERTAIN')),
  onset_date date,
  resolved_date date,
  source text not null,                -- CLINICIAN|DEVICE|USER|DERIVED|AI_HYPOTHESIS
  source_record text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clinical_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,                  -- VISIT|PROCEDURE|VACCINATION|SCREENING|HOSPITALIZATION|OTHER
  occurred_at timestamptz not null,
  provider text,
  title text not null,
  details jsonb not null default '{}'::jsonb,
  source text not null,
  document_id uuid references public.documents(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.medications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  dosage text,
  route text,
  frequency text,
  prescribing_clinician text,
  start_date date,
  stop_date date,
  indication text,
  status text not null default 'UNCERTAIN' check (status in ('CURRENT','AS_NEEDED','HISTORICAL','UNCERTAIN','DUPLICATE')),
  refill_date date,
  side_effects text,
  adherence_notes text,
  rxnorm text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.medication_source_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  medication_id uuid references public.medications(id) on delete set null,
  source text not null,
  source_record_id text,
  document_id uuid references public.documents(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  recorded_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.medication_reconciliations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  performed_at timestamptz not null default now(),
  performed_by text not null,          -- USER|CLINICIAN
  summary text,
  decisions jsonb not null default '[]'::jsonb
);

create table if not exists public.supplements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  brand text,
  ingredients jsonb not null default '[]'::jsonb,
  dose text,
  frequency text,
  purpose text,
  start_date date,
  stop_date date,
  monthly_cost_cents integer,
  perceived_benefit text,
  possible_adverse_effects text,
  status text not null default 'CURRENT' check (status in ('CURRENT','AS_NEEDED','HISTORICAL','UNCERTAIN')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.symptoms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  at timestamptz not null,
  local_date date not null,
  energy smallint check (energy between 1 and 10),
  mood smallint check (mood between 1 and 10),
  stress smallint check (stress between 1 and 10),
  soreness smallint check (soreness between 1 and 10),
  fatigue smallint check (fatigue between 1 and 10),
  focus smallint check (focus between 1 and 10),
  pain smallint check (pain between 0 and 10),
  perceived_sleep_quality smallint check (perceived_sleep_quality between 1 and 10),
  subjective_recovery smallint check (subjective_recovery between 1 and 10),
  illness_symptoms text[] not null default '{}',
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, local_date, at)
);

-- Journal entries can be local-only on the device; rows here exist only when the user opted to sync.
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  at timestamptz not null,
  body text not null,
  tags text[] not null default '{}',
  sensitivity text not null default 'NORMAL' check (sensitivity in ('NORMAL','SENSITIVE')),
  created_at timestamptz not null default now()
);

create table if not exists public.health_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  domain text not null,
  target_metric text,
  baseline_value double precision,
  direction text not null default 'neutral',
  target_value double precision,
  target_unit text,
  target_date date,
  supporting_habits jsonb not null default '[]'::jsonb,
  measurement_method text,
  target_type text not null default 'USER_DEFINED' check (target_type in ('POPULATION_GUIDELINE','CLINICIAN_PRESCRIBED','USER_DEFINED','EXPERIMENTAL')),
  clinician_approval text not null default 'NOT_APPLICABLE' check (clinician_approval in ('NOT_APPLICABLE','PENDING','APPROVED','DECLINED')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','PAUSED','ACHIEVED','ABANDONED')),
  progress double precision,
  confidence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.health_experiments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  research_question text not null,
  hypothesis text not null,
  intervention text not null,
  primary_outcome_metric text not null,
  secondary_outcome_metrics text[] not null default '{}',
  adherence_measure text,
  confounders text[] not null default '{}',
  exclusion_criteria text[] not null default '{}',
  design text not null default 'BEFORE_AFTER' check (design in ('BEFORE_AFTER','ALTERNATING','RANDOMIZED_BLOCKS')),
  statistical_method text,
  status text not null default 'DRAFT' check (status in ('DRAFT','BASELINE','INTERVENTION','WASHOUT','ANALYSIS','COMPLETED','ABANDONED')),
  decision text check (decision in ('ADOPT','REJECT','RETEST','INCONCLUSIVE')),
  confidence text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.experiment_phases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  experiment_id uuid not null references public.health_experiments(id) on delete cascade,
  phase text not null check (phase in ('BASELINE','INTERVENTION','WASHOUT')),
  sequence integer not null,
  start_date date not null,
  end_date date,
  adherence jsonb not null default '[]'::jsonb,
  notes text
);

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text not null,
  observation text not null,
  interpretation text,
  reason text not null,
  proposed_action text not null,
  expected_benefit text,
  required_effort text,
  estimated_cost text,
  confidence text not null default 'LOW' check (confidence in ('LOW','MEDIUM','HIGH')),
  claim_type text not null default 'RECOMMENDATION' check (claim_type in ('MEASURED_FACT','DERIVED_TREND','HYPOTHESIS','RECOMMENDATION')),
  limitations text,
  clinician_review_status text not null default 'NOT_REQUIRED' check (clinician_review_status in ('NOT_REQUIRED','RECOMMENDED','REQUESTED','REVIEWED')),
  status text not null default 'NEW' check (status in ('NEW','ACCEPTED','IN_PROGRESS','SNOOZED','DISMISSED','COMPLETED','DISCUSS_WITH_CLINICIAN')),
  priority integer,
  generated_by text not null,          -- 'rules:<name>' | 'ai:<provider/model>'
  source_report_id uuid,
  expires_at timestamptz,
  outcome_metric text,
  outcome jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recommendation_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recommendation_id uuid not null references public.recommendations(id) on delete cascade,
  evidence_type text not null check (evidence_type in ('OBSERVATION','DERIVED_METRIC','LAB_RESULT','GUIDELINE','STUDY','CLINICIAN_NOTE','USER_REPORT')),
  ref_table text,
  ref_id uuid,
  citation text,
  publication_date date,
  population text,
  strength text,
  applicability text,
  limitations text,
  last_verified_at timestamptz,
  details jsonb not null default '{}'::jsonb
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,                  -- REPORT_READY|LABS_IMPORTED|CONNECTION_EXPIRED|SYNC_STALE|PERMISSIONS_REVOKED|EXPERIMENT_COMPLETED|FOLLOW_UP_DUE|MEDICATION_REVIEW_DUE
  severity text not null default 'INFO' check (severity in ('INFO','ATTENTION','URGENT')),
  title text not null,                 -- safe for lock screens: never contains measurement values
  body text,                           -- shown only after unlock
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz,
  dismissed_at timestamptz,
  dedupe_key text,
  unique (user_id, dedupe_key)
);

create table if not exists public.preventive_care_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text not null,
  guideline_source text,
  guideline_reviewed_at date,
  interval_months integer,
  last_completed_at date,
  due_at date,
  status text not null default 'DISCUSS_WITH_CLINICIAN' check (status in ('DUE','DUE_SOON','COMPLETED','DISCUSS_WITH_CLINICIAN','NOT_APPLICABLE')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.weekly_health_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_from date not null,
  period_to date not null,
  baseline_from date not null,
  baseline_to date not null,
  generated_at timestamptz not null default now(),
  generator jsonb not null default '{}'::jsonb,
  content jsonb not null,
  status text not null default 'READY' check (status in ('GENERATING','READY','FAILED')),
  unique (user_id, period_to)
);

create table if not exists public.monthly_health_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_from date not null,
  period_to date not null,
  generated_at timestamptz not null default now(),
  generator jsonb not null default '{}'::jsonb,
  content jsonb not null,
  status text not null default 'READY' check (status in ('GENERATING','READY','FAILED')),
  unique (user_id, period_to)
);

create table if not exists public.physician_briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  generated_at timestamptz not null default now(),
  reason_for_visit text,
  content jsonb not null,
  pdf_document_id uuid references public.documents(id) on delete set null
);

create table if not exists public.health_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,              -- GOAL|BASELINE|INTERVENTION|DIAGNOSIS|MEDICATION|ALLERGY|FAMILY_HISTORY|PREFERENCE|CLINICAL_EVENT|RECOMMENDATION|EXPERIMENT|CLINICIAN_INSTRUCTION|PRIORITY
  statement text not null,
  origin text not null check (origin in ('CLINICIAN_DOCUMENTED','DEVICE_MEASUREMENT','USER_REPORTED','DERIVED_CALCULATION','AI_HYPOTHESIS')),
  source_ref text,
  confidence text not null default 'MEDIUM' check (confidence in ('LOW','MEDIUM','HIGH')),
  verification_status text not null default 'UNVERIFIED' check (verification_status in ('UNVERIFIED','USER_CONFIRMED','CLINICIAN_CONFIRMED','ARCHIVED','DELETED')),
  recorded_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  archived_at timestamptz
);
