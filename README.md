# Muse

A smartphone-first, installable **PWA for families in Brazil**: open it and see what you can do
**today, tomorrow or this weekend within 100 km** (the family can switch to 50, 120 or 150 km) — music festivals first, then food festivals, popular
festas, kids' shows, outdoor activities and fairs. Trilingual (PT-BR / EN / ES). Your location never
leaves the device.

**Live:** https://muse-find.com — served from this repo via Vercel (static, no build step).

## Structure (no build step — edit these files directly)

| File | What it is |
|---|---|
| `index.html` | HTML shell (device frame on desktop, full-screen on phones), meta/OG tags. |
| `style.css` | All styling. Bright light theme, self-hosted Fredoka + Nunito (`fonts/`, SIL OFL). |
| `app.js` | The app: location (GPS or city), day tabs, radius filter (50 / 100 / 120 / 150 km, remembered on the device), category chips, event cards, `.ics` export, share, i18n (`T`/`tr()`), hash routing, anonymous click counts. |
| `events.json` | The agenda the app reads. **Auto-generated — do not hand-edit** (see Automation). |
| `cities.json` | All 5,570 Brazilian municipalities with coordinates (IBGE, via kelvins/municipios-brasileiros, MIT). Powers the city picker and every distance, offline. |
| `calendar/festivals-br.json` | Seed calendar of recurring festivals and weekly fairs — *hints* the pipeline confirms before publishing. Add festivals here. |
| `calendar/state.json` | Pipeline cache: which seeds were confirmed, when, and their dates. Auto-maintained. |
| `sw.js` | Service worker: app shell cache-first (bump with `node scripts/bump-sw.mjs`), `events.json` **network-first** so the agenda is never stale when online. |
| `manifest.webmanifest`, icons, `og-image.jpg` | Install + link-preview assets. |
| `privacy.html` | Privacy notice (PT-BR). |

### Making a change to the app
1. Edit `index.html`, `style.css`, and/or `app.js`.
2. `node scripts/bump-sw.mjs` so returning users get it.
3. Commit to `main`. Vercel redeploys in ~1 minute.

## How the agenda is built (`scripts/events.mjs`)
- **Daily (free, no API):** drops finished events and re-expands the confirmed calendar seeds (weekly
  fairs become one dated event per day they run).
- **Monday + Thursday (`--discover`):** Claude with the web-search tool (1) confirms the exact dates,
  venue and official page of calendar seeds whose usual months are near, and (2) searches 20 areas of Brazil
  (capital, interior and coast split apart in the big states) twice each — once for stage events
  (music first, festas, food) and once for family activities (kids, outdoor, fairs) — over the next
  14 days. A malformed answer gets one cheap re-format call instead of being lost.
- **Nothing is published unchecked.** Each candidate needs a known category, concrete dates in the
  window, a municipality that exists in `cities.json` (coordinates come from there, never from the
  model), and a source URL that resolves (404/DNS failure → dropped; when the page is plain HTML, the
  title must appear on it). Adults-only events are dropped; near-duplicates merged.
- Local testing without the API: `MOCK_FILE=mock.json SKIP_URL_CHECK=1 DRY_RUN=1 node scripts/events.mjs --discover`.

## Automation (`.github/workflows/`)
- **`events.yml`** — the agenda (daily prune + Mon/Thu discovery; manual run with a `discover` toggle).
  Needs `ANTHROPIC_API_KEY`. Optional repo variable `EVENTS_MODEL` (default `claude-haiku-5-5`).
- **`metrics.yml`** (daily) → `metrics.mjs`: usage & agenda health dashboard at `/metrics/` (not linked
  from the app) — agenda by category/state, anonymous interactions, Vercel visitors by country/device.

## Backend (Supabase, free tier)
`event_clicks` — anonymous taps (details / directions / calendar / share) with the event id, category,
the **event's** state and the UI language. The public anon key in `app.js` is **insert-only** (RLS, no
SELECT policy). Schema: `supabase/migrations/20261122000000_event_clicks.sql`.

## Secrets / config
- **`ANTHROPIC_API_KEY`** — Claude API key for `events.mjs --discover` (Actions only, never shipped).
- **`SB_SERVICE_KEY`** — Supabase service_role key, read-only use by `metrics.mjs` (never shipped).
- **`VERCEL_TOKEN`** (optional) — Vercel token for the dashboard's traffic/geography section.
- Repo → Settings → Actions → **Workflow permissions must be "Read and write"** (the jobs commit).

The previous product (a cross-media taste recommender) was removed in November 2026; it remains in
the git history.
