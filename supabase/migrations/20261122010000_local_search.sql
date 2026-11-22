-- Muse — on-demand local search ("Buscar mais perto de mim").
-- api/search.mjs (Vercel) runs a web search around one family's city and caches the validated events
-- per ~50 km grid cell for 7 days, so the next families in that region see them instantly at no cost.
--
-- Who can do what:
--   * area_cache: the public anon key can READ fresh rows (it is public event data). Nobody writes
--     with the anon key directly.
--   * search_log / muse_private: no policies at all — unreadable and unwritable with the anon key.
--   * muse_search_begin / muse_search_finish: callable with the anon key, but they first check a
--     secret that only the Vercel function knows (stored in muse_private, set outside this file).
--     They enforce: 1 search per device per 7 days, 3 per network per 7 days, one search per cell per
--     7 days, no parallel duplicate for a cell, and a daily spending cap.

create table if not exists public.area_cache (
  cell        text primary key,
  lat         double precision not null,
  lng         double precision not null,
  place       text not null,
  searched_at timestamptz not null default now(),
  events      jsonb not null default '[]'::jsonb
);
alter table public.area_cache enable row level security;
drop policy if exists "anon read fresh area_cache" on public.area_cache;
create policy "anon read fresh area_cache" on public.area_cache
  for select to anon using (searched_at > now() - interval '8 days');
create index if not exists area_cache_latlng_idx on public.area_cache (lat, lng);

create table if not exists public.search_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  cell        text not null,
  sid_hash    text not null,
  ip_hash     text not null,
  status      text not null default 'running' check (status in ('running', 'done', 'failed')),
  found       int,
  cost_usd    numeric(8, 4) not null default 0
);
alter table public.search_log enable row level security;
create index if not exists search_log_created_at_idx on public.search_log (created_at);

create table if not exists public.muse_private (k text primary key, v text not null);
alter table public.muse_private enable row level security;

create or replace function public.muse_search_begin(
  p_secret text, p_cell text, p_sid text, p_ip text, p_daily_budget numeric
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r area_cache%rowtype;
  v_last timestamptz;
  v_ip_n int;
  v_spent numeric;
  v_day_start timestamptz := (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
  v_id bigint;
begin
  if not exists (select 1 from muse_private where k = 'fn_secret' and v = p_secret) then
    raise exception 'forbidden';
  end if;
  perform pg_advisory_xact_lock(hashtext('muse_search'));

  select * into r from area_cache where cell = p_cell and searched_at > now() - interval '7 days';
  if found then
    return jsonb_build_object('status', 'cached', 'searched_at', r.searched_at, 'place', r.place,
                              'next_at', r.searched_at + interval '7 days');
  end if;
  if exists (select 1 from search_log where cell = p_cell and status = 'running'
             and created_at > now() - interval '6 minutes') then
    return jsonb_build_object('status', 'busy');
  end if;

  select max(created_at) into v_last from search_log
   where sid_hash = p_sid and status <> 'failed' and created_at > now() - interval '7 days';
  if v_last is not null then
    return jsonb_build_object('status', 'limited', 'next_at', v_last + interval '7 days');
  end if;
  select count(*) into v_ip_n from search_log
   where ip_hash = p_ip and status <> 'failed' and created_at > now() - interval '7 days';
  if v_ip_n >= 3 then
    return jsonb_build_object('status', 'limited', 'next_at', now() + interval '1 day');
  end if;

  -- finished searches at their real cost, running ones at a conservative estimate
  select coalesce(sum(case when status = 'running' then 1.5 else cost_usd end), 0) into v_spent
    from search_log where created_at >= v_day_start;
  if v_spent >= p_daily_budget then
    return jsonb_build_object('status', 'budget');
  end if;

  insert into search_log (cell, sid_hash, ip_hash) values (p_cell, p_sid, p_ip) returning id into v_id;
  return jsonb_build_object('status', 'go', 'log_id', v_id);
end $$;

create or replace function public.muse_search_finish(
  p_secret text, p_log_id bigint, p_ok boolean, p_cost numeric,
  p_cell text, p_lat double precision, p_lng double precision, p_place text, p_events jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from muse_private where k = 'fn_secret' and v = p_secret) then
    raise exception 'forbidden';
  end if;
  update search_log
     set status = case when p_ok then 'done' else 'failed' end,
         cost_usd = coalesce(p_cost, 0),
         found = case when p_ok then jsonb_array_length(coalesce(p_events, '[]'::jsonb)) end
   where id = p_log_id;
  if p_ok then
    insert into area_cache (cell, lat, lng, place, searched_at, events)
    values (p_cell, p_lat, p_lng, p_place, now(), coalesce(p_events, '[]'::jsonb))
    on conflict (cell) do update
      set lat = excluded.lat, lng = excluded.lng, place = excluded.place,
          searched_at = excluded.searched_at, events = excluded.events;
  end if;
end $$;

revoke all on function public.muse_search_begin(text, text, text, text, numeric) from public;
revoke all on function public.muse_search_finish(text, bigint, boolean, numeric, text, double precision, double precision, text, jsonb) from public;
grant execute on function public.muse_search_begin(text, text, text, text, numeric) to anon;
grant execute on function public.muse_search_finish(text, bigint, boolean, numeric, text, double precision, double precision, text, jsonb) to anon;

-- Retention: search_log rows are only needed for the 7-day limits and daily spend:
--   delete from public.search_log where created_at < now() - interval '30 days';
