# Muse

A smartphone-first, installable **PWA for families in Brazil**: open it and see what you can do
**today, tomorrow, this weekend or next weekend within 100 km** (the family can switch to 50, 120 or 150 km) — music festivals first, then food festivals, popular
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
| `api/search.mjs` | Vercel function behind “🔎 Buscar mais perto de mim”: on-demand search around one family's city (see below). |
| `cadastrar.html` + `cadastrar.js` | Form for organizers to list an event (no AI: validated, e-mail confirmed, approved by the owner). |
| `admin.html` + `admin.js` | The owner's approval queue (open once as `admin.html#k=<ADMIN_TOKEN>`). |
| `api/submit.mjs`, `api/confirm.mjs`, `api/admin.mjs` | Organizer submission, e-mail confirmation link, approval API. `api/_lib.mjs` holds shared helpers. |
| `vercel.json` | Function settings (300 s max duration, bundled `cities.json`). |

### Making a change to the app
1. Edit `index.html`, `style.css`, and/or `app.js`.
2. `node scripts/bump-sw.mjs` so returning users get it.
3. Commit to `main`. Vercel redeploys in ~1 minute.

## How the agenda is built (`scripts/events.mjs`)
- **Daily (free, no API):** drops finished events and re-expands the confirmed calendar seeds (weekly
  fairs become one dated event per day they run).
- **Monday (`--discover`):** Claude with the web-search tool (1) confirms the exact dates,
  venue and official page of calendar seeds whose usual months are near, and (2) searches 20 areas of Brazil
  (capital, interior and coast split apart in the big states) twice each — once for stage events
  (music first, festas, food) and once for family activities (kids, outdoor, fairs) — over the next
  14 days. A malformed answer gets one cheap re-format call instead of being lost.
- **Nothing is published unchecked.** Each candidate needs a known category, concrete dates in the
  window, a municipality that exists in `cities.json` (coordinates come from there, never from the
  model), and a source URL that resolves (404/DNS failure → dropped; when the page is plain HTML, the
  title must appear on it). Adults-only events are dropped; near-duplicates merged.
- Local testing without the API: `MOCK_FILE=mock.json SKIP_URL_CHECK=1 DRY_RUN=1 node scripts/events.mjs --discover`.

## On-demand local search (`api/search.mjs`)
The weekly sweep can't cover every town, so families can ask for a search around their own city:
1 search per device per week (3 per network), and one per ~50 km cell per week — the results are cached
in Supabase (`area_cache`) and every family in that region sees them instantly for 7 days. The function
snaps the family to the nearest municipality, runs six short searches in parallel (music / festas / food /
kids / outdoor / fairs) on the same thorough model as the sweep (Sonnet 5.5) and streams each one's validated events to
the app as soon as it finishes — first results in seconds — with the same validation as the sweep, and stops for the day once `MUSE_DAILY_BUDGET` (USD, default 3)
(set to 8 in Vercel) is spent. Limits and the cache live in `supabase/migrations/20261122010000_local_search.sql`.
Vercel env: `ANTHROPIC_API_KEY`, `MUSE_FN_SECRET` (must match `muse_private.fn_secret` in Supabase),
optional `LOCAL_MODEL`, `MUSE_DAILY_BUDGET`, `MUSE_SEARCH_KM`.

## Events listed by organizers
Organizers fill `cadastrar.html`. `api/submit.mjs` checks it without any AI (known category, dates within
6 months, a real municipality — coordinates from `cities.json` — a link that opens, no adults-only
wording; honeypot + 5 per network per day), stores it as *unconfirmed* and e-mails a confirmation link
(Resend). Confirmed submissions wait in the owner's queue (`admin.html`); approving copies the event to
`published_events`, which the app reads with the anon key and shows with a "✓ Cadastrado pelo
organizador" badge. Contact data never leaves `event_submissions` (no anon access). Schema:
`supabase/migrations/20261122020000_organizer_submissions.sql`. Vercel env: `RESEND_API_KEY`, `MAIL_FROM`
(both set by `setup-email.yml`), `ADMIN_TOKEN`.

## Automation (`.github/workflows/`)
- **`events.yml`** — the agenda (daily prune + Monday discovery; manual run with a `discover` toggle).
  Needs `ANTHROPIC_API_KEY`. Optional repo variable `EVENTS_MODEL` (default `claude-sonnet-5-5`, with the dynamic-filtering web search).
- **`setup-email.yml`** (manual) — registers the domain in Resend, writes its DNS records in Vercel and copies
  `RESEND_API_KEY` into Vercel. **`sync-vercel-key.yml`** (manual) — copies `ANTHROPIC_API_KEY` into Vercel.
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
