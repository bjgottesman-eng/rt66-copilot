-- Phase 3: persisted signals, profile physiology for heart-rate zones, derived-metric helpers.
alter table public.profiles add column if not exists birth_date date;
alter table public.profiles add column if not exists max_heart_rate integer check (max_heart_rate between 100 and 230);
alter table public.profiles add column if not exists resting_heart_rate_override integer check (resting_heart_rate_override between 25 and 120);

-- Deterministic signals detected for an as-of date (latest complete local day). Versioned by algorithm.
create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  as_of_date date not null,
  metric_id text not null,
  domain text not null,
  kind text not null check (kind in ('MEANINGFUL_CHANGE','DIRECTIONAL_CHANGE','NEW_365D_HIGH','NEW_365D_LOW','LOW_COVERAGE','STALE_SOURCE','SYNC_ERROR','IMPLAUSIBLE_VALUES')),
  direction text check (direction in ('favourable','unfavourable','neutral')),
  priority integer not null default 3,
  delta double precision,
  delta_pct double precision,
  effect_size double precision,
  explanation text not null,
  evidence jsonb not null default '{}'::jsonb,
  algorithm text not null default 'signal_engine',
  algorithm_version integer not null default 1,
  computed_at timestamptz not null default now(),
  unique (user_id, as_of_date, metric_id, kind, algorithm_version)
);
create index if not exists signals_user_date_idx on public.signals (user_id, as_of_date desc, priority);

insert into public.algorithm_versions (algorithm, version, description) values
  ('signal_engine', 1, 'Deterministic signals: meaningful/directional changes vs 28-day baseline, 365-day highs/lows, coverage, freshness problems'),
  ('zone2_minutes', 1, 'Minutes in heart-rate zone 2 (60-70% of max HR) per workout, estimated from heart-rate samples inside the workout window'),
  ('percentile_365', 1, 'Percentile rank of the current 7-day mean within the trailing 365 days of daily values')
on conflict do nothing;

alter table public.signals enable row level security;
drop policy if exists signals_select_own on public.signals;
drop policy if exists signals_insert_own on public.signals;
drop policy if exists signals_update_own on public.signals;
drop policy if exists signals_delete_own on public.signals;
create policy signals_select_own on public.signals for select to authenticated using ((select auth.uid()) = user_id);
create policy signals_insert_own on public.signals for insert to authenticated with check ((select auth.uid()) = user_id);
create policy signals_update_own on public.signals for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy signals_delete_own on public.signals for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.signals to authenticated, service_role;
