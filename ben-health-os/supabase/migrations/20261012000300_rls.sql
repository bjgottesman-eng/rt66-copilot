-- Row Level Security for every user-owned table. Pattern per Supabase guidance:
-- one policy per operation, `to authenticated`, `(select auth.uid()) = user_id`.
-- service_role bypasses RLS and is used only by trusted server-side jobs (webhooks, schedulers).
do $$
declare
  t text;
  tables text[] := array[
    'source_connections','source_devices','sync_cursors','sync_runs','raw_ingest_events','observations',
    'blood_pressure_sessions','blood_pressure_readings','sleep_sessions','sleep_stages','workouts','daily_activity',
    'meals','nutrient_observations','nutrition_days','glucose_samples','annotations','derived_metrics',
    'oauth_states','documents','lab_panels','lab_results','conditions','clinical_events','medications',
    'medication_source_records','medication_reconciliations','supplements','symptoms','journal_entries',
    'health_goals','health_experiments','experiment_phases','recommendations','recommendation_evidence','alerts',
    'preventive_care_items','weekly_health_reports','monthly_health_reports','physician_briefs','health_memories'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t || '_delete_own', t);
  end loop;
end $$;

-- profiles: keyed by id instead of user_id
alter table public.profiles enable row level security;
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert_own on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy profiles_delete_own on public.profiles for delete to authenticated using ((select auth.uid()) = id);

-- audit_log: users may read their own entries; only the server (service_role) writes.
alter table public.audit_log enable row level security;
drop policy if exists audit_log_select_own on public.audit_log;
create policy audit_log_select_own on public.audit_log for select to authenticated using ((select auth.uid()) = user_id);

-- webhook_events and algorithm_versions are server-only / reference data.
alter table public.webhook_events enable row level security;
alter table public.algorithm_versions enable row level security;
drop policy if exists algorithm_versions_read on public.algorithm_versions;
create policy algorithm_versions_read on public.algorithm_versions for select to authenticated using (true);

-- Grants (Supabase sets default privileges itself; explicit grants keep local Postgres identical).
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke all on public.webhook_events from authenticated;
revoke insert, update, delete on public.audit_log from authenticated;
revoke insert, update, delete on public.algorithm_versions from authenticated;
