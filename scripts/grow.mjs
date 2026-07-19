/* Muse — E5 catalog growth: LLM-curated food & travel, to rebalance the catalog so cross-media
 * "Beyond" isn't starved in the small categories. food (~371) and travel (~328) are a quarter the
 * size of movies; this grows each toward >=600 with canonical, real items.
 *
 * Per run, for each under-target category: a bulk LLM (Haiku) proposes canonical dishes/destinations
 * NOT already in the catalog, each with full metadata (8-axis DNA, 3-6 themes from the app vocab, the
 * category's craft fields, a tri-lingual one-line description). Every proposal is then VALIDATED
 * against a real English Wikipedia page (keyless) — if the page doesn't exist the item is dropped as a
 * likely hallucination; if it does, we take Wikipedia's canonical title + thumbnail image. Survivors
 * are minted as `<prefix>-<slug>-tmdb` ids (so enrich.mjs re-rates them later via /-tmdb\d*$/), deduped
 * by normalized title, and appended. Writes minified data.json + bumps the SW, exactly like refresh.mjs.
 *
 * Env: ANTHROPIC_API_KEY (required for live), BULK_MODEL (default Haiku), GROW_TARGET (600),
 *      GROW_MAX_ITEMS (max NEW items per category per run, default 50), GROW_CONCURRENCY (3 — polite
 *      to Wikipedia), DRY_RUN=1 (mock LLM + mock Wikipedia -> data.dryrun.json, no network). Node 20+.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = ROOT + 'data.json';
const SW = ROOT + 'sw.js';

const API_KEY = process.env.ANTHROPIC_API_KEY;
const BULK_MODEL = process.env.BULK_MODEL || 'claude-haiku-4-5-20251001';
const TARGET = +(process.env.GROW_TARGET || 600);
const MAX_ITEMS = +(process.env.GROW_MAX_ITEMS || 50);
const CONCURRENCY = Math.max(1, +(process.env.GROW_CONCURRENCY || 3));
const DRY_RUN = process.env.DRY_RUN === '1';
const BATCH = 12; // items requested per LLM call

/* ---------- helpers replicated from refresh.mjs (keep in sync) ---------- */
const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const normT = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const dedupKey = (t) => normT(t); // food/travel have no year
const clampI = (n) => Math.max(0, Math.min(100, Math.round(n)));
const hueOf = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// app theme vocabulary (keys of THEME_I18N in app.js / enrich.mjs THEME_VOCAB) — proposals pick from this.
const THEME_VOCAB = ['identity', 'love', 'family', 'friendship', 'betrayal', 'revenge', 'redemption', 'survival', 'coming-of-age', 'nostalgia', 'memory', 'loss', 'isolation', 'obsession', 'power', 'corruption', 'justice', 'crime', 'war', 'faith', 'freedom', 'rebellion', 'dystopia', 'technology', 'nature', 'journey', 'discovery', 'mystery', 'transformation', 'ambition', 'artistry', 'tradition', 'celebration', 'comfort', 'adventure', 'escape', 'community', 'luxury', 'simplicity', 'spirituality', 'romance', 'melancholy', 'joy', 'chaos', 'heritage', 'innovation', 'craftsmanship', 'indulgence', 'wonder'];
const VOCAB_SET = new Set(THEME_VOCAB);
const DNA_AXES = ['Dark', 'Intense', 'Cerebral', 'Humor', 'Pace', 'Epic', 'Warm', 'Weird'];

/* ---------- per-category config ---------- */
const CATS = {
  food: {
    prefix: 'fd', noun: 'globally-recognized dish or food',
    craft: ['spice', 'rich', 'sweet', 'prep'],
    dnaGuide: 'For food read the 8 axes as the EATING EXPERIENCE: Dark=heaviness, Intense=bold/spicy flavor, Cerebral=refined/complex, Humor=playful/fun, Pace=quick vs slow food, Epic=indulgent/grand, Warm=comforting, Weird=exotic/unusual.',
    genresHint: '2-4 food tags (e.g. comfort food, street food, dessert, seafood, breakfast, spicy, vegetarian, grilled)',
    extra: '"cuisine": national/regional cuisine (e.g. "Italian"), "flavors": [3-5 flavor words], "ingredients": [3-6 key ingredients], "technique": one prep word (e.g. "grilled"), "region": place of origin, "country": country of origin',
    defaultTheme: 'indulgence',
  },
  travel: {
    prefix: 'tr', noun: 'globally-recognized travel destination (city, landmark, natural site or region)',
    craft: ['nat', 'adv', 'bud', 'off'],
    dnaGuide: 'For travel read the 8 axes as the VISIT EXPERIENCE: Dark=somber/gritty vs bright, Intense=thrilling, Cerebral=cultural/educational, Humor=lively/fun, Pace=fast city vs slow retreat, Epic=grand/awe-inspiring, Warm=welcoming, Weird=offbeat/unusual.',
    genresHint: '2-4 travel tags (e.g. beach, city, nature, historic, adventure, cultural, mountain, island, desert)',
    extra: '"vibe": [3-5 vibe tags e.g. "ancient","romantic","bustling"], "climate": one of tropical/alpine/desert/temperate/mediterranean/continental/arid/polar, "region": broader region, "country": country',
    defaultTheme: 'adventure',
  },
};

/* ---------- LLM ---------- */
let emptyLogged = 0;
async function callAnthropic(p, maxTokens) {
  const body = { model: BULK_MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: p }] };
  for (let attempt = 0; attempt <= 4; attempt++) {
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) { if (attempt === 4) throw e; await sleep(500 * 2 ** attempt); continue; }
    if (res.ok) {
      const j = await res.json();
      const txt = (j.content || []).filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim();
      if (!txt && emptyLogged < 5) { emptyLogged++; console.error(`  [empty LLM] stop=${j.stop_reason} usage=${JSON.stringify(j.usage)}`); }
      return txt;
    }
    if (res.status === 429 || res.status >= 500) { await sleep(800 * 2 ** attempt); continue; }
    throw new Error(`Anthropic API ${res.status}: ${await res.text().catch(() => '')}`);
  }
  throw new Error('Anthropic API: exhausted retries');
}

function buildPrompt(cat, cfg, exclude) {
  const ex = exclude.slice(0, 400).join(', ');
  return (
    `Propose ${BATCH} ${cfg.noun}s for a recommendation catalog. They must be REAL, canonical, and ` +
    `well-known enough to have an English Wikipedia page. Do NOT propose any of these (already in the ` +
    `catalog): ${ex}.\n\n` +
    `Return ONLY a JSON array (no prose). Each element:\n` +
    `{\n` +
    `  "name": "canonical English name (matches its Wikipedia title)",\n` +
    `  "genres": [${cfg.genresHint}],\n` +
    `  "dna": [8 integers 0-100 in order ${DNA_AXES.join(', ')}],\n` +
    `  "themes": [3-6 strings from this list ONLY: ${THEME_VOCAB.join(', ')}],\n` +
    `  "craft": {${cfg.craft.map((c) => `"${c}": <int 0-100>`).join(', ')}},\n` +
    `  ${cfg.extra},\n` +
    `  "description": {"en": "one vivid sentence", "es": "una frase", "pt": "uma frase"}\n` +
    `}\n\n${cfg.dnaGuide}\nRules: dna is exactly 8 integers; themes 3-6 from the allowed list; craft ints 0-100. Output the JSON array only.`
  );
}

function parseArray(txt) {
  if (!txt) return [];
  const m = String(txt).match(/\[[\s\S]*\]/); if (!m) return [];
  try { const a = JSON.parse(m[0]); return Array.isArray(a) ? a : []; } catch { return []; }
}

/* ---------- Wikipedia validation (keyless) ---------- */
// returns { title, img } for a real page, or null. Uses the action API: resolves redirects, checks the
// page isn't missing, and grabs a thumbnail if present.
async function wikiValidate(name) {
  if (DRY_RUN || !API_KEY) { // deterministic mock: "exists" unless the name contains 'faketest'
    if (/faketest/i.test(name)) return null;
    return { title: name, img: `https://upload.wikimedia.org/mock/${slug(name)}.jpg` };
  }
  const u = new URL('https://en.wikipedia.org/w/api.php');
  u.search = new URLSearchParams({ action: 'query', titles: name, prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '500', redirects: '1', format: 'json', formatversion: '2' }).toString();
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'MuseRefresh/1.0 (jorquesa@gmail.com)' } });
      if (r.ok) {
        const j = await r.json();
        const page = j && j.query && Array.isArray(j.query.pages) ? j.query.pages[0] : null;
        if (!page || page.missing || page.invalid || !page.title) return null;
        // reject disambiguation-ish or list pages by title heuristics
        if (/^(List of|Index of)\b/i.test(page.title)) return null;
        return { title: page.title, img: (page.thumbnail && page.thumbnail.source) || null };
      }
      if (r.status === 429 || r.status >= 500) { await sleep(700 * a); continue; }
      return null;
    } catch { await sleep(500 * a); }
  }
  return null;
}

/* ---------- item construction + validation ---------- */
function cleanThemes(arr, fallback) {
  const seen = new Set(), out = [];
  for (const t of (Array.isArray(arr) ? arr : [])) {
    if (typeof t !== 'string') continue;
    const k = t.trim().toLowerCase();
    if (VOCAB_SET.has(k) && !seen.has(k)) { seen.add(k); out.push(k); }
  }
  if (!out.length) out.push(fallback);
  return out.slice(0, 6);
}
function cleanDna(arr) {
  if (!Array.isArray(arr) || arr.length !== 8 || !arr.every((n) => typeof n === 'number' && isFinite(n))) return null;
  return arr.map(clampI);
}
const strArr = (v, n) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()).slice(0, n) : []);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

function buildItem(cat, cfg, p, wiki, ids) {
  const t = wiki.title; // canonical Wikipedia title
  const dna = cleanDna(p.dna); if (!dna) return null; // no valid DNA -> drop (would break scoring)
  const craft = {};
  for (const c of cfg.craft) { const v = p.craft && p.craft[c]; if (typeof v === 'number' && isFinite(v)) craft[c] = clampI(v); }
  const d = (p.description && typeof p.description === 'object') ? p.description : {};
  const en = str(d.en); if (!en) return null; // require at least an English description
  const seed = hueOf(t);
  const base = slug(t) || ('id' + seed);
  let id = `${cfg.prefix}-${base}-tmdb`, b = id, i = 2; while (ids.has(id)) { id = `${b}${i}`; i++; } ids.add(id);
  const g = strArr(p.genres, 4); if (!g.length) g.push(cat === 'food' ? 'comfort food' : 'city');
  const item = {
    id, t, alt: [], y: null, by: cat === 'food' ? (str(p.cuisine) ? str(p.cuisine).toLowerCase() + ' cuisine' : '') : str(p.country),
    g, th: cleanThemes(p.themes, cfg.defaultTheme), dna,
    pop: 55, acc: 60, main: 52, c: str(p.country),
    d: { en, es: str(d.es) || en, pt: str(d.pt) || en }, hue: seed, img: wiki.img || null,
    x: cat === 'food'
      ? { ...craft, fl: strArr(p.flavors, 5), ing: strArr(p.ingredients, 6), tech: str(p.technique), reg: str(p.region) }
      : { ...craft, vibe: strArr(p.vibe, 5), climate: str(p.climate), reg: str(p.region) },
  };
  return item;
}

/* ---------- concurrency ---------- */
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

/* ---------- grow one category ---------- */
async function growCategory(data, cat) {
  const cfg = CATS[cat];
  const list = Array.isArray(data[cat]) ? data[cat] : [];
  if (list.length >= TARGET) { console.log(`${cat}: ${list.length} >= target ${TARGET} — skipping`); return 0; }
  const seen = new Set(list.map((x) => dedupKey(x.t)));
  const ids = new Set(list.map((x) => x.id));
  const existingTitles = list.map((x) => x.t).filter(Boolean);
  const want = Math.min(MAX_ITEMS, TARGET - list.length);
  console.log(`${cat}: ${list.length}/${TARGET}, aiming to add up to ${want} this run`);

  let added = 0, dry = 0;
  while (added < want && dry < 2) {
    const prompt = buildPrompt(cat, cfg, existingTitles);
    let proposals;
    try { proposals = DRY_RUN || !API_KEY ? mockProposals(cat) : parseArray(await callAnthropic(prompt, 3072)); }
    catch (e) { console.error(`  [LLM failed] ${cat}: ${e.message}`); break; }
    // dedupe proposals by name against what we already have / added, before spending Wikipedia calls
    const fresh = [];
    for (const p of proposals) {
      const nm = p && str(p.name); if (!nm) continue;
      const dk = dedupKey(nm);
      if (seen.has(dk)) continue;
      seen.add(dk); fresh.push(p); // provisionally reserve (canonical title re-checked after wiki)
    }
    if (!fresh.length) { dry++; continue; }
    // validate each against Wikipedia (bounded concurrency, polite pacing)
    const validated = await pool(fresh, CONCURRENCY, async (p) => {
      if (!DRY_RUN && API_KEY) await sleep(200);
      const w = await wikiValidate(str(p.name));
      return w ? { p, w } : null;
    });
    let roundAdded = 0;
    for (const v of validated) {
      if (!v || added >= want) continue;
      const dkc = dedupKey(v.w.title); // re-dedupe on the CANONICAL wiki title
      if (seen.has(dkc) && dkc !== dedupKey(str(v.p.name))) continue;
      seen.add(dkc);
      const item = buildItem(cat, cfg, v.p, v.w, ids);
      if (!item) continue;
      list.push(item); existingTitles.push(item.t); added++; roundAdded++;
    }
    console.log(`  +${roundAdded} (total ${added}/${want})`);
    if (roundAdded === 0) dry++; else dry = 0;
  }
  data[cat] = list;
  return added;
}

// deterministic mock proposals for DRY_RUN (exercises parse/validate/build/dedupe/write without network)
let mockN = 0;
function mockProposals(cat) {
  const out = [];
  for (let i = 0; i < BATCH; i++) {
    mockN++;
    const name = `Mock ${cat} ${mockN}`;
    const craft = {}; for (const c of CATS[cat].craft) craft[c] = (mockN * 7 + c.length * 11) % 101;
    out.push({
      name, genres: [cat === 'food' ? 'street food' : 'city', 'popular'],
      dna: Array.from({ length: 8 }, (_, k) => (mockN * 13 + k * 17) % 101),
      themes: [THEME_VOCAB[mockN % THEME_VOCAB.length], THEME_VOCAB[(mockN + 5) % THEME_VOCAB.length], THEME_VOCAB[(mockN + 9) % THEME_VOCAB.length]],
      craft, cuisine: 'Testland', country: 'Testland', region: 'Test Region',
      flavors: ['savory', 'rich'], ingredients: ['a', 'b', 'c'], technique: 'grilled',
      vibe: ['calm', 'scenic'], climate: 'temperate',
      description: { en: `A mock ${cat} number ${mockN}.`, es: `Un ${cat} de prueba ${mockN}.`, pt: `Um ${cat} de teste ${mockN}.` },
    });
  }
  return out;
}

/* ---------- main ---------- */
async function main() {
  const data = JSON.parse(await readFile(DATA, 'utf8'));
  const before = Object.fromEntries(Object.keys(data).map((k) => [k, data[k].length]));

  if (!DRY_RUN && !API_KEY) { console.error('FATAL: ANTHROPIC_API_KEY not set.'); process.exit(1); }

  let total = 0;
  for (const cat of ['food', 'travel']) total += await growCategory(data, cat);

  const after = Object.fromEntries(Object.keys(data).map((k) => [k, data[k].length]));
  console.log(`\nadded ${total} items. food ${before.food}->${after.food}, travel ${before.travel}->${after.travel}`);

  if (!total) { console.log('No new items this run — leaving data.json + sw.js untouched.'); return; }

  const OUT = DRY_RUN ? ROOT + 'data.dryrun.json' : DATA;
  await writeFile(OUT, JSON.stringify(data), 'utf8');
  console.log(`wrote ${OUT}`);
  if (!DRY_RUN) {
    let sw = await readFile(SW, 'utf8');
    const m = sw.match(/muse-v(\d+)/);
    if (m) { const next = `muse-v${parseInt(m[1], 10) + 1}`; sw = sw.replace(/muse-v\d+/g, next); await writeFile(SW, sw, 'utf8'); console.log(`sw -> ${next}`); }
  }
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `## Muse grow (E5)\n\nadded ${total} items — food ${before.food}→${after.food}, travel ${before.travel}→${after.travel}\n`, { flag: 'a' });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { slug, dedupKey, cleanDna, cleanThemes, buildItem, wikiValidate, parseArray, CATS, THEME_VOCAB };
