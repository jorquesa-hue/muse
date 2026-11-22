-- Muse (family events) — anonymous interaction counts.
-- The app logs which action a family took on an event card: details | directions | calendar | share.
-- Stored: a random browser-local session id, the event id, its category and the EVENT's state (UF),
-- and the UI language. Never the family's own location. Insert-only for the public anon key
-- (same model as T24): no SELECT policy, so the key in app.js cannot read anything back;
-- scripts/metrics.mjs reads with the service_role key in GitHub Actions only.

create table if not exists public.event_clicks (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  sid         text not null check (char_length(sid) <= 64),
  event_id    text not null check (char_length(event_id) <= 160),
  cat         text not null check (cat in ('music','food','festas','kids','outdoor','fairs')),
  kind        text not null check (kind in ('details','directions','calendar','share','search')),
  uf          text check (uf is null or uf ~ '^[A-Z]{2}$'),
  lang        text check (lang is null or lang in ('en','es','pt'))
);

alter table public.event_clicks enable row level security;

drop policy if exists "anon insert event_clicks" on public.event_clicks;
create policy "anon insert event_clicks" on public.event_clicks
  for insert to anon with check (true);

create index if not exists event_clicks_created_at_idx on public.event_clicks (created_at);

-- Retention: same rolling 180-day window as the other tables (manual/periodic, see T24 migration):
--   delete from public.event_clicks where created_at < now() - interval '180 days';
