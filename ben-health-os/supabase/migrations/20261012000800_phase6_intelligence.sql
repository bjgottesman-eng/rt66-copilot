-- Phase 6: AI intelligence — recommendation bookkeeping, notification preferences, report generators.
alter table public.profiles add column if not exists notification_prefs jsonb not null default '{"pushEnabled": true, "quietHoursStart": "22:00", "quietHoursEnd": "07:00", "enabledKinds": ["REPORT_READY","LABS_IMPORTED","CONNECTION_EXPIRED","SYNC_STALE","PERMISSIONS_REVOKED","EXPERIMENT_COMPLETED","FOLLOW_UP_DUE","MEDICATION_REVIEW_DUE"]}'::jsonb;
alter table public.recommendations add column if not exists rule_key text;
alter table public.recommendations add column if not exists snoozed_until timestamptz;
alter table public.recommendations add column if not exists dismiss_reason text;
alter table public.recommendations add column if not exists accepted_at timestamptz;
alter table public.recommendations add column if not exists completed_at timestamptz;
alter table public.recommendations add column if not exists packet_item_ids text[] not null default '{}';
create index if not exists recommendations_user_status_idx on public.recommendations (user_id, status, created_at desc);
create index if not exists recommendations_user_rule_idx on public.recommendations (user_id, rule_key);
create index if not exists alerts_user_unread_idx on public.alerts (user_id, created_at desc) where read_at is null and dismissed_at is null;
insert into public.algorithm_versions (algorithm, version, description) values
  ('analysis_packet', 1, 'Structured analysis packet: measured facts and derived trends with provenance ids, AI-sharing controls applied, hashed'),
  ('recommendation_rules', 1, 'Deterministic recommendation rules over the analysis packet; every candidate links evidence; weekly priorities capped at three'),
  ('ai_response_validator', 1, 'Rejects AI findings without valid packet citations or with diagnosis / medication-change / emergency phrasing'),
  ('weekly_health_ceo', 1, 'Weekly Health CEO report: latest 7 complete days vs preceding non-overlapping 28 days, 14 sections'),
  ('monthly_health_board', 1, 'Monthly Health Board report: last 30 days vs prior 90-day context and 365-day history'),
  ('recommendation_outcome', 1, 'Outcome metric 7-day mean before acceptance vs 7 days after; descriptive only')
on conflict do nothing;
