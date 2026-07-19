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
const BATCH = 8; // items per LLM call — small enough that the JSON array fits well under max_tokens

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
    // rotate the prompt through these so each round targets a distinct cuisine instead of the LLM
    // re-proposing the same globally-famous dishes (which just get deduped). Covers the culinary world.
    pool: ['Italian', 'French', 'Japanese', 'Chinese (Sichuan)', 'Chinese (Cantonese)', 'Thai', 'Indian (North)', 'Indian (South)', 'Mexican', 'Korean', 'Vietnamese', 'Spanish', 'Greek', 'Turkish', 'Lebanese', 'Moroccan', 'Ethiopian', 'Brazilian', 'Peruvian', 'Argentine', 'German', 'British', 'American (Southern)', 'Cajun & Creole', 'Filipino', 'Indonesian', 'Malaysian', 'Portuguese', 'Polish', 'Russian', 'Hungarian', 'Nigerian', 'Egyptian', 'Jamaican & Caribbean', 'Cuban', 'Colombian', 'Georgian', 'Persian', 'Pakistani', 'Sri Lankan', 'Nepali & Tibetan', 'Nordic', 'Belgian', 'Swiss', 'Austrian', 'Israeli', 'Syrian', 'Tunisian', 'South African', 'Ukrainian', 'Taiwanese', 'Singaporean', 'Burmese', 'Cambodian', 'Bolivian', 'Ecuadorian', 'Chilean', 'Ghanaian', 'Kenyan', 'Icelandic'],
  },
  travel: {
    prefix: 'tr', noun: 'globally-recognized travel destination (city, landmark, natural site or region)',
    craft: ['nat', 'adv', 'bud', 'off'],
    dnaGuide: 'For travel read the 8 axes as the VISIT EXPERIENCE: Dark=somber/gritty vs bright, Intense=thrilling, Cerebral=cultural/educational, Humor=lively/fun, Pace=fast city vs slow retreat, Epic=grand/awe-inspiring, Warm=welcoming, Weird=offbeat/unusual.',
    genresHint: '2-4 travel tags (e.g. beach, city, nature, historic, adventure, cultural, mountain, island, desert)',
    extra: '"vibe": [3-5 vibe tags e.g. "ancient","romantic","bustling"], "climate": one of tropical/alpine/desert/temperate/mediterranean/continental/arid/polar, "region": broader region, "country": country',
    defaultTheme: 'adventure',
    pool: ['Italy', 'France', 'Japan', 'China', 'Thailand', 'India', 'Mexico', 'Spain', 'Greece', 'Turkey', 'Egypt', 'Morocco', 'Brazil', 'Peru', 'Argentina', 'Germany', 'United Kingdom', 'United States (national parks)', 'Vietnam', 'Indonesia', 'Portugal', 'Croatia', 'Iceland', 'Norway', 'Switzerland', 'Austria', 'Ireland', 'Scotland', 'Nepal', 'Jordan', 'Kenya & Tanzania', 'South Africa', 'Australia', 'New Zealand', 'Canada', 'Chile', 'Colombia', 'Cuba', 'Cambodia', 'Sri Lanka', 'Philippines', 'Malaysia', 'South Korea', 'Georgia', 'Uzbekistan', 'Ethiopia', 'Namibia', 'Costa Rica', 'Bolivia', 'Finland'],
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

function buildPrompt(cat, cfg, exclude, focus) {
  const ex = exclude.slice(-900).join(', '); // existing titles to avoid re-proposing
  const lead = focus
    ? `Propose ${BATCH} ${cfg.noun}s specifically from ${focus}${cat === 'food' ? ' cuisine' : ''}. Give a mix of its most ` +
      `ICONIC, must-know ${cfg.noun}s AND its lesser-known-but-real regional ones. `
    : `Propose ${BATCH} ${cfg.noun}s — a mix of canonical, globally-famous ones AND diverse regional choices. `;
  return (
    lead +
    `Each must be REAL and notable enough to have its own English Wikipedia page. Every item MUST be ` +
    `different from ALL of these (already in the catalog) — do not repeat any, even with slight rewording:\n${ex}\n\n` +
    `Return ONLY a JSON array (no prose). Each element:\n` +
    `{\n` +
    `  "name": "canonical English name (matches its Wikipedia title)",\n` +
    `  "alt": ["2-5 alternate names for search: the name in its origin language + common spellings/variants"],\n` +
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
  let s = String(txt).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''); // strip markdown code fences
  const m = s.match(/\[[\s\S]*\]/);
  if (m) { try { const a = JSON.parse(m[0]); if (Array.isArray(a)) return a; } catch {} }
  // fallback: an object like {"items":[...]} or {"dishes":[...]}
  try { const o = JSON.parse(s); if (o && typeof o === 'object') { for (const v of Object.values(o)) if (Array.isArray(v)) return v; } } catch {}
  // SALVAGE (handles a max_tokens-TRUNCATED array): scan for complete, balanced top-level {...}
  // objects — string-aware so braces inside descriptions don't confuse the depth count — and parse
  // each individually, keeping the ones that completed. Recovers all whole items from a cut-off array.
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') { if (depth > 0) { depth--; if (depth === 0 && start >= 0) { try { out.push(JSON.parse(s.slice(start, i + 1))); } catch {} start = -1; } } }
  }
  return out;
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
  const alt = strArr(p.alt, 6).filter((a) => normT(a) && normT(a) !== normT(t)); // alt names for multilingual/variant search (drop empties + the canonical title itself)
  const item = {
    id, t, alt, y: null, by: cat === 'food' ? (str(p.cuisine) ? str(p.cuisine).toLowerCase() + ' cuisine' : '') : str(p.country),
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

  // Rotate the prompt through cfg.pool (cuisines/regions) so each round asks for a DIFFERENT area —
  // this is what stops the LLM re-proposing the same famous dishes round after round (the reason a
  // flat prompt stalls at +2). dry only trips once we've cycled the WHOLE pool with nothing new.
  const rotation = (cfg.pool && cfg.pool.length) ? cfg.pool : [null];
  const MAX_DRY = rotation.length + 3;
  let added = 0, dry = 0, poolIdx = 0;
  while (added < want && dry < MAX_DRY) {
    const focus = rotation[poolIdx % rotation.length]; poolIdx++;
    const prompt = buildPrompt(cat, cfg, existingTitles, focus);
    let raw = '', proposals;
    try {
      if (DRY_RUN || !API_KEY) { proposals = mockProposals(cat); }
      else { raw = await callAnthropic(prompt, 8192); proposals = parseArray(raw); }
    } catch (e) { console.error(`  [LLM failed] ${cat}: ${e.message}`); break; }
    if (!proposals.length) console.error(`  parsed 0 proposals; raw snippet: ${JSON.stringify(String(raw).slice(0, 200))}`);
    // dedupe proposals by name against what we already have / added, before spending Wikipedia calls
    const fresh = [];
    let dupd = 0;
    for (const p of proposals) {
      const nm = p && str(p.name); if (!nm) continue;
      const dk = dedupKey(nm);
      if (seen.has(dk)) { dupd++; continue; }
      seen.add(dk); fresh.push(p); // provisionally reserve (canonical title re-checked after wiki)
    }
    console.log(`  [${focus || 'mixed'}] parsed ${proposals.length}, fresh ${fresh.length} (deduped ${dupd})`);
    if (!fresh.length) { dry++; continue; }
    // validate each against Wikipedia (bounded concurrency, polite pacing)
    const validated = await pool(fresh, CONCURRENCY, async (p) => {
      if (!DRY_RUN && API_KEY) await sleep(200);
      const w = await wikiValidate(str(p.name));
      return w ? { p, w } : null;
    });
    console.log(`  wikipedia-validated ${validated.filter(Boolean).length}/${fresh.length}`);
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
      name, alt: [name.toLowerCase(), 'alt-' + mockN], genres: [cat === 'food' ? 'street food' : 'city', 'popular'],
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

  // GROW_CATS lets a dispatch focus on one category (e.g. "food") instead of both.
  const cats = (process.env.GROW_CATS || 'food,travel').split(',').map((s) => s.trim()).filter((c) => CATS[c]);
  console.log('growing:', cats.join(', '));
  let total = 0;
  for (const cat of cats) total += await growCategory(data, cat);

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
