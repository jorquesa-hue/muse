-- Muse — monitoring: one row per sweep run, and where / how long each local search ran.
-- Read only with the service_role key (GitHub Actions: scripts/monitor.mjs). No policies, so the
-- public anon key in app.js can neither read nor write pipeline_runs.

create table if not exists public.pipeline_runs (
  id             bigint generated always as identity primary key,
  run_at         timestamptz not null default now(),
  mode           text not null,                 -- discover | prune
  model          text,
  calls          int not null default 0,
  input_tokens   bigint not null default 0,
  output_tokens  bigint not null default 0,
  searches       int not null default 0,         -- web searches billed
  cost_usd       numeric(10, 4) not null default 0,
  discovered     int not null default 0,         -- new events published by this run
  seeds_checked  int not null default 0,
  events_total   int not null default 0,         -- agenda size after the run
  by_uf          jsonb not null default '{}'::jsonb,
  by_cat         jsonb not null default '{}'::jsonb,
  areas          jsonb not null default '[]'::jsonb,  -- per sweep area: calls, searches, cost, candidates, valid, published
  rejected       jsonb not null default '{}'::jsonb,
  search_errors  jsonb not null default '{}'::jsonb,
  run_url        text
);
alter table public.pipeline_runs enable row level security;
create index if not exists pipeline_runs_run_at_idx on public.pipeline_runs (run_at);

-- local searches: the place (municipality/UF, never the family's coordinates) and the duration
alter table public.search_log add column if not exists place text;
alter table public.search_log add column if not exists secs numeric(6, 1);
update public.search_log s set place = a.place
  from public.area_cache a where s.place is null and a.cell = s.cell;

drop function if exists public.muse_search_finish(text, bigint, boolean, numeric, text, double precision, double precision, text, jsonb);
create or replace function public.muse_search_finish(
  p_secret text, p_log_id bigint, p_ok boolean, p_cost numeric,
  p_cell text, p_lat double precision, p_lng double precision, p_place text, p_events jsonb,
  p_secs numeric default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from muse_private where k = 'fn_secret' and v = p_secret) then
    raise exception 'forbidden';
  end if;
  update search_log
     set status = case when p_ok then 'done' else 'failed' end,
         cost_usd = coalesce(p_cost, 0),
         found = case when p_ok then jsonb_array_length(coalesce(p_events, '[]'::jsonb)) end,
         place = p_place,
         secs = p_secs
   where id = p_log_id;
  if p_ok then
    insert into area_cache (cell, lat, lng, place, searched_at, events)
    values (p_cell, p_lat, p_lng, p_place, now(), coalesce(p_events, '[]'::jsonb))
    on conflict (cell) do update
      set lat = excluded.lat, lng = excluded.lng, place = excluded.place,
          searched_at = excluded.searched_at, events = excluded.events;
  end if;
end $$;
revoke all on function public.muse_search_finish(text, bigint, boolean, numeric, text, double precision, double precision, text, jsonb, numeric) from public;
grant execute on function public.muse_search_finish(text, bigint, boolean, numeric, text, double precision, double precision, text, jsonb, numeric) to anon;
