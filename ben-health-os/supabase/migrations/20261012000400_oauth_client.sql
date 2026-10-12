-- OAuth state carries which client started the flow so the callback can finish appropriately.
alter table public.oauth_states add column if not exists client text not null default 'web';
alter table public.oauth_states add column if not exists return_to text;
create index if not exists oauth_states_expires_idx on public.oauth_states (expires_at);
