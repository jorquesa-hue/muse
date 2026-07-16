# Muse

A smartphone-only, offline-capable, **cross-media recommendation PWA**. Tell Muse one thing you
love (a movie, TV series, book, album, game, anime, dish, or travel destination) and it returns
algorithm-ranked similar picks in that category, plus a **"Beyond — same DNA, different medium"**
cross-media section. Trilingual (EN / ES / Brazilian-PT). Runs fully client-side.

**Live:** https://muse-find.com — served from this repo via GitHub Pages.

## Structure (no build step — edit these files directly)

| File | What it is |
|---|---|
| `index.html` | HTML shell + head/meta + links to `style.css` and `app.js`. Edit for markup/head. |
| `style.css` | All styling. Edit for looks. |
| `app.js` | The whole app: the matching **engine** (`CATALGOS`/`score`/`crossScore`), search & autocomplete, rendering, i18n (`T`/`TT`), the live "find anything" fallback (`liveLookup`/`selectLive`), ratings, and Supabase wiring. |
| `data.json` | The catalog (~6,250 items; each has an 8-axis DNA vector, themes, genres, per-category `x` features, popularity, cover URL, localized titles `tl`). **Auto-maintained — do not hand-edit** (see Automation). |
| `sw.js` | Offline-first service worker, cache-versioned `muse-vN`. |
| `manifest.webmanifest`, `apple-touch-icon.png`, `icons/` | PWA install assets. |
| `scripts/` | Node automation (see below). |
| `.github/workflows/` | The scheduled jobs. |

**There is no build.** The browser loads `index.html` → `style.css` + `app.js` directly.

### Making a change to the app
1. Edit `index.html`, `style.css`, and/or `app.js`.
2. Bump the service worker so returning users get it: `node scripts/bump-sw.mjs`
3. Commit to `main`. GitHub Pages redeploys in ~1 minute.

## How matching works (in `app.js`)
Each item carries a precomputed feature set. `score(a, b, cat)` blends ~14 per-category signals
(dna, theme, mood, genre, craft, creator, era, audience, culture, + a dormant `emb` embedding term)
via the weighted `CATALGOS` table, using null-safe **skip-and-renormalize** scoring, a coverage
gate, and an **MMR diversity** re-rank. Cross-media picks use `crossScore`. The embedding term is
**dormant** — it activates if an `embeddings.b64.json` is added.

## Live "find anything" fallback
If a search isn't in `data.json`, the app looks the title up **live and keylessly** (Wikipedia +
Wikidata), derives its features on the fly, and runs the same algorithms. See `liveLookup`.

## Automation (`scripts/` + `.github/workflows/`)
- **`refresh.yml`** (weekly, Mon) → `refresh.mjs`: pulls trending movies/TV from **TMDB** (needs the
  `TMDB_KEY` repo secret) + trending books from **Open Library**, backfills localized titles,
  dedups, bumps `sw.js`, commits.
- **`ingest.yml`** (daily, 03:30 UTC) → `ingest.mjs`: folds titles that users searched-but-missed
  (found via the live fallback, logged to Supabase) into `data.json` — so searched titles become
  permanent + instant + offline the next day.
- **`bump-sw.mjs`**: helper to increment the SW version after editing app files.

All three commit only when something changed, and modify `data.json` and/or `sw.js` only — never the app code.

## Backend (Supabase, free tier)
The client's Supabase **anon key is public by design** — Row-Level Security is **insert-only**, so
it can't read/steal anything. Two tables:
- `ratings` — 👍/👎 on matches, with the per-algorithm sub-scores (for a future learning-to-rank retrain).
- `searches` — the live-lookup "misses" the daily ingest reads.

## Secrets / config
- Repo secret **`TMDB_KEY`** — TMDB v4 Read Access Token (used only by the weekly refresh, never shipped).
- Repo → Settings → Actions → **Workflow permissions must be "Read and write"** (so the jobs can commit).
