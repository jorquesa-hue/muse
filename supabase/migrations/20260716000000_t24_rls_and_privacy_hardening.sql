-- T24 — Supabase RLS + privacy hardening (see IMPLEMENTATION_PLAN.md)
--
-- NOT YET APPLIED. This file is a reviewable migration, prepared but deliberately not run
-- against the live project — it changes production access control and adds constraints that
-- could reject future writes, so it needs a human decision on timing, not a bot decision.
--
-- Apply with the Supabase SQL editor, `supabase db push`, or the apply_migration MCP tool, in
-- this order:
--
--   1. Add a `SB_SERVICE_KEY` GitHub Actions secret (Settings -> Secrets and variables -> Actions)
--      holding the project's service_role key (Project Settings -> API -> service_role, NOT the
--      anon key). ingest.mjs already reads it from the environment when present, falling back to
--      the current anon key when it's unset — so nothing breaks before this migration runs.
--   2. Run this migration (steps A-C below).
--   3. Confirm the next scheduled ingest.yml run succeeds (it now reads via service_role).
--
-- Skipping step 1 before applying step A below will break the daily ingest job (loudly — it
-- FATALs with a clear "Supabase read failed" error, no data is lost) until the secret is added.

-- ============================================================================================
-- A. Close the read leak: anon can currently read every user's search history.
--    (confirmed live: `searches` has policy "anon read searches" with USING(true))
-- ============================================================================================
drop policy if exists "anon read searches" on public.searches;
-- No replacement SELECT policy for anon/authenticated — the table becomes write-only for them.
-- service_role bypasses RLS entirely by default in Supabase, so ingest.mjs's service_role-keyed
-- read continues to work with no policy needed for it specifically.

-- ============================================================================================
-- B. Column-level size caps — defense in depth against the storage/cost-DoS vector: RLS
--    currently allows ANYONE with the public anon key to INSERT directly against the REST API,
--    bypassing app.js and ingest.mjs's own `clean()` validation entirely. These constraints cap
--    payload size at the database itself, regardless of what calls the API.
--    Limits mirror (with headroom) app.js's own field sizes and ingest.mjs's clean()/4000-char cap.
-- ============================================================================================
alter table public.searches
  add constraint searches_title_len check (char_length(title) <= 200),
  add constraint searches_item_size check (item is null or octet_length(item::text) <= 6000),
  add constraint searches_cat_valid check (cat is null or cat in
    ('movies','tv','books','music','games','anime','food','travel'));

alter table public.ratings
  add constraint ratings_sid_len check (char_length(sid) <= 64),
  add constraint ratings_src_len check (char_length(src) <= 128),
  add constraint ratings_match_len check (char_length(match) <= 128),
  add constraint ratings_cat_valid check (cat is null or cat in
    ('movies','tv','books','music','games','anime','food','travel')),
  add constraint ratings_pct_range check (pct is null or (pct >= 0 and pct <= 100)),
  add constraint ratings_r_valid check (r is null or r in (-1, 0, 1)),
  add constraint ratings_lang_valid check (lang is null or lang in ('en','es','pt')),
  add constraint ratings_parts_size check (parts is null or octet_length(parts::text) <= 2000);

-- ============================================================================================
-- C. Retention — muse-sid + ratings/search payloads currently have no purge window. This is
--    intentionally NOT automated by this migration (enabling pg_cron, or wiring a scheduled
--    GitHub Action with the service_role key, is its own decision). Suggested manual/periodic
--    purge, matching the privacy notice's stated retention window (see privacy.html):
--
--   delete from public.searches where created_at < now() - interval '180 days';
--   delete from public.ratings  where created_at < now() - interval '180 days';
