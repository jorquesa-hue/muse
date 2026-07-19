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
Each item carries a precomputed feature set. `score(a, b, cat)` blends ~15 per-category signals
(a text-**embedding** term `emb`, an atmosphere-**embedding** term `vibemb`, a **lineage** graph term
`lineage`, plus dna, theme, mood, genre, craft, creator, era, audience, culture) via the weighted
`CATALGOS` table, using null-safe **prior-imputed** scoring, a coverage gate, and an **MMR diversity**
re-rank. `lineage` scores 1.0 when two works are a direct influence/kin edge, 0.5 when they share a
neighbour in the graph, else null — a light nudge (0.02 within a category, 0.05 cross-media; see
`influence.yml` below). It is deliberately small same-category, and shipped as a conscious tradeoff:
any same-category lineage weight costs ~2–2.5pt on the similarity-eval (weight-independent — 0.02 and
0.05 both land ~77.4 vs a 79.8 no-lineage control, because within a medium the base signals already
rank similarity well and lineage surfaces influence links a pure-similarity judge scores slightly
lower). We keep it small and on for its **influence-discovery** value (it lifts a known influence's
rank in 80.7% of edge pairs and never lowers it — see `eval/lineage-probe.json`), not because it is
eval-neutral. Cross-media (`crossScore`, where it's flat) keeps 0.05:
a text-embedding-led blend (`emb .55 / dna .30 / theme .15 / lineage .05`); the atmosphere embedding
`vibemb` is a **within-category** signal only — adding it to cross-media measured neutral-to-worse
against the judge (67.5% at a .45 lead, 70.0% at .20, vs the 72.5% emb-only baseline), so it stays
out of `crossScore`. Both embedding terms are **live**: weekly jobs rebuild `embeddings.b64.json`
(`embed.yml` → `scripts/embed.mjs`, from the item's catalog text) and `vibe.b64.json` (`vibe.yml` →
`scripts/vibe.mjs`, from an LLM-written "atmosphere only" description), and the app loads both at
boot — each degrades gracefully to a no-op if its file hasn't been built yet.

## Eval (how we know matching is any good)
`scripts/eval.mjs` measures the engine against an LLM judge via **triplet accuracy**: it builds
triplets `(A, B, C)` where the engine ranks `B` above `C`, asks a judge which of `B`/`C` is actually
closer to `A`, and scores the engine by how often it agreed (same-category triplets use `score()`,
cross-media use `crossScore()`). It reads the engine through **`scripts/engine-port.mjs`** — a
pure-Node port of the scoring math proven byte-identical to `app.js` — so the eval measures exactly
what ships. Runs weekly (`eval.yml`, after `embed.yml`), caches judged triplets in
`eval/triplets.json` (never re-judged), and writes `eval/report.json` + a job-summary table.

**Baseline** (judge `claude-sonnet-5`, 400 triplets, 2026-07-18): **76.8% overall**, 72.5% cross-media.
Per category — movies 67.5, tv 82.5, books 82.5, music 72.5, games 80.0, anime 77.5, food 85.0,
travel 75.0. Every later batch (E1–E6) must hold or beat this; the current numbers live in
`eval/report.json`.

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
- **`grow.yml`** (weekly, Mon, before `enrich`) → `grow.mjs`: E5 catalog rebalance — grows the two
  starved categories **food** and **travel** toward ≥600. A bulk LLM (Haiku) proposes canonical
  dishes/destinations with full metadata; each is **validated against a real Wikipedia page** (keyless
  — title + thumbnail) before it's kept, so hallucinations are dropped. New items get `-tmdb` ids so
  `enrich` re-rates them; `GROW_MAX_ITEMS`-capped per run; needs `ANTHROPIC_API_KEY`.
- **`enrich.yml`** (weekly, Mon, before `embed`) → `enrich.mjs`: a cheap bulk LLM (Haiku) re-rates
  auto-derived / thin items (ids `-tmdb`/`sr-`, or <3 themes) against a **fixed rubric** — the 8 DNA
  axes 0–100, 3–6 themes from the app vocabulary, and the category's subjective craft scalars — and
  writes the result back into `data.json` (marking each with an `enr` version so re-runs skip it).
  Hand-curated items are never touched; `MAX_ITEMS`-capped; needs `ANTHROPIC_API_KEY`. Runs in the
  chain refresh → ingest → **enrich** → embed → eval → refit so upgraded metadata feeds the embeddings.
- **`embed.yml`** (weekly, Mon) → `embed.mjs`: rebuilds `embeddings.b64.json` (the `emb` signal) with
  a local 384-d sentence-transformer (`bge-small-en-v1.5`, chosen over MiniLM by the E4 eval bake-off —
  see `eval/model-comparison.md`); caches the model between runs. `EMBED_MODEL` overrides it.
- **`vibe.yml`** (weekly, Mon, after `embed`) → `vibe.mjs`: a cheap bulk LLM (Haiku) writes a ≤45-word
  "atmosphere only" descriptor per item (mood/energy/texture/tempo — no plot, names, or genre), cached
  by id in `vibe/texts.json`; those texts are MiniLM-embedded into `vibe.b64.json` (the `vibemb` signal).
  Texts are generated incrementally and `MAX_ITEMS`-capped; needs `ANTHROPIC_API_KEY`.
- **`influence.yml`** (weekly, Mon, after `embed`) → `influence.mjs`: for each item, a cheap bulk LLM
  (Haiku) picks ≤4 of its 40 nearest embedding neighbours that are direct influences or spiritual kin
  (answers restricted to those ids, so it stays grounded); edges are cached by id in `edges.json` (the
  `lineage` signal — 1.0 for a direct edge, 0.5 for a shared neighbour). Built incrementally and
  `MAX_ITEMS`-capped; needs `ANTHROPIC_API_KEY`. A no-API `lineage-probe.mjs` gate (writes
  `eval/lineage-probe.json`) checks the signal lifts a known influence above a random peer by ≥1 pt.
- **`refit.yml`** (weekly, Mon) → `refit.mjs`: re-fits the per-category `CATALGOS` weights from logged
  ratings (or synthetic eval triplets — see `--synthetic`), gated on held-out AUC; writes `weights.json`.
- **`eval.yml`** (weekly, Mon) → `eval.mjs`: triplet-accuracy eval vs an LLM judge (see **Eval** above);
  writes `eval/*.json`. Uses `scripts/engine-port.mjs` (byte-identical port of `app.js` scoring).
- **`model-compare.yml`** (on-demand) → `embed.mjs` (`EMBED_MODEL`/`EMBED_OUT` env) + `eval.mjs` +
  `model-compare.mjs`: E4 embedding-model bake-off. Builds a candidate model's embeddings into a
  throwaway file, evals both against the same catalog, and writes `eval/model-comparison.md`. Ship
  gate: switch the default model only if the candidate's overall accuracy beats the baseline by ≥1 pt.
- **`bump-sw.mjs`**: helper to increment the SW version after editing app files.

The catalog/automation jobs commit only when something changed, and modify `data.json`, `sw.js`,
`embeddings.b64.json`, `vibe.b64.json`, `vibe/texts.json`, `edges.json`, `weights.json`, and/or
`eval/*.json` only — never the app code.

## Backend (Supabase, free tier)
The client's Supabase **anon key is public by design** — Row-Level Security is **insert-only**, so
it can't read/steal anything. Two tables:
- `ratings` — 👍/👎 on matches, with the per-algorithm sub-scores (for a future learning-to-rank retrain).
- `searches` — the live-lookup "misses" the daily ingest reads.

## Secrets / config
- Repo secret **`TMDB_KEY`** — TMDB v4 Read Access Token (used only by the weekly refresh, never shipped).
- Repo secret **`SB_SERVICE_KEY`** — Supabase service_role key (read-only use by `refit.mjs`; never shipped).
- Repo secret **`ANTHROPIC_API_KEY`** — Claude API key for the LLM-in-Actions jobs (`eval.mjs`, and the
  E2/E3/E6 enrichment jobs). Never shipped to the client — all LLM calls happen in Actions only.
- Optional repo **variables**: `JUDGE_MODEL` (eval judge model, default `claude-sonnet-5`),
  `EVAL_MAX_JUDGE` (cap on new judge calls per eval run).
- Repo → Settings → Actions → **Workflow permissions must be "Read and write"** (so the jobs can commit).
