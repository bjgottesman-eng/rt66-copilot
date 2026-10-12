-- Phase 7: N-of-1 experiments, strength-training sets, subjective check-ins.

-- Experiments: planning fields, evaluation snapshot, link to the recommendation that proposed it.
alter table public.health_experiments
  add column if not exists planned_baseline_days integer,
  add column if not exists planned_intervention_days integer,
  add column if not exists planned_blocks integer not null default 1,
  add column if not exists planned_washout_days integer not null default 0,
  add column if not exists start_date date,
  add column if not exists source_recommendation_id uuid references public.recommendations(id) on delete set null,
  add column if not exists evaluation jsonb,
  add column if not exists evaluated_at timestamptz,
  add column if not exists decided_at timestamptz,
  add column if not exists decision_note text;
create index if not exists health_experiments_user_status_idx on public.health_experiments (user_id, status);
create index if not exists experiment_phases_experiment_idx on public.experiment_phases (experiment_id, sequence);

-- Logged resistance-training sets (manual entry; the exercise session itself comes from Health Connect / connectors).
create table if not exists public.training_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  workout_id uuid references public.workouts(id) on delete set null,
  exercise text not null,
  set_index integer not null check (set_index between 1 and 50),
  reps integer not null check (reps between 1 and 200),
  load_kg double precision not null check (load_kg >= 0 and load_kg <= 1000),
  rpe double precision check (rpe between 1 and 10),
  notes text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, local_date, exercise, set_index)
);
create index if not exists training_sets_user_date_idx on public.training_sets (user_id, local_date desc);
alter table public.training_sets enable row level security;
create policy training_sets_select on public.training_sets for select to authenticated using ((select auth.uid()) = user_id);
create policy training_sets_insert on public.training_sets for insert to authenticated with check ((select auth.uid()) = user_id);
create policy training_sets_update on public.training_sets for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy training_sets_delete on public.training_sets for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.training_sets to authenticated;

-- Check-ins reuse public.symptoms; record where an entry came from.
alter table public.symptoms add column if not exists source text not null default 'manual';
create index if not exists symptoms_user_date_idx on public.symptoms (user_id, local_date desc);

insert into public.algorithm_versions (algorithm, version, description) values
  ('experiment_evaluation', 1, 'Pooled baseline vs intervention days with the trend change classifier; coverage gates (metric 7-day minimum and half the days), adherence gate (60%), ALTERNATING consistency; verdicts ADOPT / REJECT / RETEST / INCONCLUSIVE / INSUFFICIENT_EVIDENCE; never causal'),
  ('training_summary', 1, 'Weekly sessions (exercise records + logged sets, one per day), logged sets, volume kg, minutes; Epley estimated 1RM on 1–12-rep sets; progression = last 4 weeks vs prior 4 weeks (±2.5%)'),
  ('checkin_summary', 1, '1–10 self-ratings per day; 7-day vs preceding 28-day comparison with the statistical rule only; coverage 3/8 days')
on conflict (algorithm, version) do nothing;
