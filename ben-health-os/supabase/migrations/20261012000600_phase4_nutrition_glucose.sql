-- Phase 4: per-user glucose range and nutrition targets (user-defined or clinician-set; labelled as such).
alter table public.profiles add column if not exists glucose_range jsonb not null default '{"lowMgDl": 70, "highMgDl": 140, "source": "Default range placeholder (70–140 mg/dL). Set with your clinician."}'::jsonb;
alter table public.profiles add column if not exists nutrition_targets jsonb not null default '{}'::jsonb;
create index if not exists meals_user_day_idx on public.meals (user_id, local_date) where deleted_at is null;
create index if not exists annotations_user_day_idx on public.annotations (user_id, local_date);
insert into public.algorithm_versions (algorithm, version, description) values
  ('glucose_day', 1, 'Daily glucose statistics: mean, SD, CV, time in/below/above a configurable range, overnight mean, coverage'),
  ('meal_excursion', 1, 'Post-meal glucose excursion: baseline = mean of the 30 min before the meal, peak and minutes-to-peak within 2 h, incremental AUC above baseline'),
  ('cronometer_csv', 1, 'Header-mapped Cronometer CSV import (daily summary or servings) with per-row idempotent external ids')
on conflict do nothing;
