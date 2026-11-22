-- Muse — events submitted by organizers ("Cadastrar evento").
-- Flow: organizer submits (api/submit.mjs) -> status 'unconfirmed' + confirmation e-mail
--       -> clicks the link (api/confirm.mjs) -> 'pending'
--       -> the Muse owner approves or rejects on admin.html (api/admin.mjs) -> 'approved' | 'rejected'.
-- Approved events are copied to published_events, which the app reads with the public anon key.
-- Contact data (name, e-mail, phone) stays in event_submissions, which has NO anon policies: only the
-- server functions can touch it, through these RPCs, which first check the server-only secret
-- (muse_private.fn_secret, created by the local-search migration).

create table if not exists public.event_submissions (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  status        text not null default 'unconfirmed'
                check (status in ('unconfirmed', 'pending', 'approved', 'rejected')),
  event         jsonb not null,
  contact_name  text not null check (char_length(contact_name) between 2 and 120),
  contact_email text not null check (char_length(contact_email) <= 200),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 40),
  token_hash    text not null,
  ip_hash       text not null,
  confirmed_at  timestamptz,
  decided_at    timestamptz
);
alter table public.event_submissions enable row level security;
create index if not exists event_submissions_status_idx on public.event_submissions (status, created_at);

create table if not exists public.published_events (
  id           text primary key,
  submission   bigint references public.event_submissions (id) on delete cascade,
  event        jsonb not null,
  lat          double precision not null,
  lng          double precision not null,
  end_date     date not null,
  published_at timestamptz not null default now()
);
alter table public.published_events enable row level security;
drop policy if exists "anon read current published_events" on public.published_events;
create policy "anon read current published_events" on public.published_events
  for select to anon using (end_date >= (now() at time zone 'America/Sao_Paulo')::date);
create index if not exists published_events_latlng_idx on public.published_events (lat, lng);

create or replace function public.muse_check_secret(p_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from muse_private where k = 'fn_secret' and v = p_secret) then
    raise exception 'forbidden';
  end if;
end $$;
revoke all on function public.muse_check_secret(text) from public;

create or replace function public.muse_submit(
  p_secret text, p_event jsonb, p_name text, p_email text, p_phone text, p_token_hash text, p_ip text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform muse_check_secret(p_secret);
  if (select count(*) from event_submissions where ip_hash = p_ip and created_at > now() - interval '1 day') >= 5
     or (select count(*) from event_submissions where lower(contact_email) = lower(p_email)
          and status in ('unconfirmed', 'pending')) >= 10 then
    return jsonb_build_object('status', 'limited');
  end if;
  insert into event_submissions (event, contact_name, contact_email, contact_phone, token_hash, ip_hash)
  values (p_event, p_name, lower(p_email), nullif(p_phone, ''), p_token_hash, p_ip)
  returning id into v_id;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

create or replace function public.muse_confirm(p_secret text, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r event_submissions%rowtype;
begin
  perform muse_check_secret(p_secret);
  select * into r from event_submissions where token_hash = p_token_hash;
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  if r.status <> 'unconfirmed' then return jsonb_build_object('status', 'already', 'title', r.event->>'t'); end if;
  if r.created_at < now() - interval '7 days' then return jsonb_build_object('status', 'expired'); end if;
  update event_submissions set status = 'pending', confirmed_at = now() where id = r.id;
  return jsonb_build_object('status', 'confirmed', 'title', r.event->>'t');
end $$;

create or replace function public.muse_admin_list(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform muse_check_secret(p_secret);
  return coalesce((
    select jsonb_agg(x order by x.ord, x.created_at desc) from (
      select id, created_at, status, event, contact_name, contact_email, contact_phone, confirmed_at, decided_at,
             case status when 'pending' then 0 when 'unconfirmed' then 1 else 2 end as ord
        from event_submissions
       where status in ('pending', 'unconfirmed') or decided_at > now() - interval '14 days'
       order by created_at desc limit 200
    ) x), '[]'::jsonb);
end $$;

create or replace function public.muse_admin_decide(p_secret text, p_id bigint, p_approve boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r event_submissions%rowtype;
begin
  perform muse_check_secret(p_secret);
  select * into r from event_submissions where id = p_id;
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  update event_submissions set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now()
   where id = p_id;
  delete from published_events where submission = p_id;
  if p_approve then
    insert into published_events (id, submission, event, lat, lng, end_date)
    values (r.event->>'id', p_id, r.event, (r.event->>'lat')::double precision, (r.event->>'lng')::double precision,
            (r.event->>'end')::date)
    on conflict (id) do update set submission = excluded.submission, event = excluded.event, lat = excluded.lat,
      lng = excluded.lng, end_date = excluded.end_date, published_at = now();
  end if;
  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end);
end $$;

revoke all on function public.muse_submit(text, jsonb, text, text, text, text, text) from public;
revoke all on function public.muse_confirm(text, text) from public;
revoke all on function public.muse_admin_list(text) from public;
revoke all on function public.muse_admin_decide(text, bigint, boolean) from public;
grant execute on function public.muse_submit(text, jsonb, text, text, text, text, text) to anon;
grant execute on function public.muse_confirm(text, text) to anon;
grant execute on function public.muse_admin_list(text) to anon;
grant execute on function public.muse_admin_decide(text, bigint, boolean) to anon;
