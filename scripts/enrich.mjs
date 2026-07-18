/* Muse — E3 weekly LLM enrichment: upgrades auto-derived / thin catalog metadata at the source.
 *
 * Many catalog items were added by refresh.mjs (TMDb/OpenLibrary, id `-tmdb`) or ingest.mjs (searched-
 * but-missed live items, id `sr-`). Those carry GENRE-CENTROID DNA + a couple of genre-derived themes
 * + heuristic craft fields — good enough to rank, but blurry. This job asks a cheap bulk LLM (Haiku)
 * to re-rate each such item against a FIXED rubric and writes the result back into data.json.
 *
 * Selection (per runbook E3.1): bot-added items (`-tmdb`/`sr-` id) OR items with <3 themes — and not
 * already enriched under the current rubric version. Hand-curated items are never touched.
 *
 * Rubric (per runbook E3.2, fixed below): score all 8 DNA axes 0-100 against written anchors; choose
 * 3-6 themes from the vocabulary already used in the app; fill the category's subjective craft
 * scalars (0-100). Count/string/array craft fields (run/ep/pg/inst/etc.) are left as-is — an LLM
 * can't reliably know an exact runtime, and those aren't what makes the DNA blurry.
 *
 * Writes back to data.json in the SAME minified shape the app ships (JSON.stringify, no spacing), only
 * mutating selected items' dna/th/x (+ an `enr` version marker so re-runs skip them). Everything else
 * round-trips byte-identical. Because data.json is one minified line, git shows the whole line changed
 * — so this script emits its OWN human-readable before->after diff to the job summary (the reviewable
 * artifact). Incremental + MAX_ITEMS-capped: a large backlog is chipped away across weekly runs, and a
 * mid-run failure flushes progress so a re-run resumes.
 *
 * Env: ANTHROPIC_API_KEY (required for live), BULK_MODEL (default Haiku), MAX_ITEMS (default 300),
 *      ENRICH_CONCURRENCY (4), DRY_RUN=1 (deterministic mock enrichment -> data.dryrun.json, no API).
 * Node 20+. No deps.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = ROOT + 'data.json';
const SW = ROOT + 'sw.js';

const API_KEY = process.env.ANTHROPIC_API_KEY;
const BULK_MODEL = process.env.BULK_MODEL || 'claude-haiku-4-5-20251001';
const MAX_ITEMS = +(process.env.MAX_ITEMS || 300);
const CONCURRENCY = Math.max(1, +(process.env.ENRICH_CONCURRENCY || 4));
const DRY_RUN = process.env.DRY_RUN === '1';
// bump when the rubric below changes materially, to re-enrich everything under the new rubric.
const ENR_VERSION = 1;

const CAT_ORDER = ['movies', 'tv', 'books', 'music', 'games', 'anime', 'food', 'travel'];

/* ================= FIXED RUBRIC ================= */
// DNA axis order MUST match app.js DNA_AX (Dark, Intense, Cerebral, Humor, Pace, Epic, Warm, Weird).
const DNA_AXES = ['Dark', 'Intense', 'Cerebral', 'Humor', 'Pace', 'Epic', 'Warm', 'Weird'];
const DNA_ANCHORS = [
  'Dark: 0 = light, uplifting, sunny; 100 = bleak, grim, heavy',
  'Intense: 0 = calm, gentle, low-stakes; 100 = gripping, relentless, high-stakes',
  'Cerebral: 0 = visceral, emotional, instinctive; 100 = intellectual, layered, demanding',
  'Humor: 0 = wholly serious; 100 = constantly funny, comedic',
  'Pace: 0 = slow, contemplative, unhurried; 100 = fast, breakneck, propulsive',
  'Epic: 0 = intimate, small-scale, personal; 100 = epic, grand, sweeping in scope',
  'Warm: 0 = cold, detached, clinical; 100 = warm, heartfelt, tender',
  'Weird: 0 = conventional, grounded, realistic; 100 = surreal, strange, experimental',
];
// The app's theme vocabulary = keys of THEME_I18N (app.js). Enrichment picks ONLY from this set.
const THEME_VOCAB = ['identity', 'love', 'family', 'friendship', 'betrayal', 'revenge', 'redemption', 'survival', 'coming-of-age', 'nostalgia', 'memory', 'loss', 'isolation', 'obsession', 'power', 'corruption', 'justice', 'crime', 'war', 'faith', 'freedom', 'rebellion', 'dystopia', 'technology', 'nature', 'journey', 'discovery', 'mystery', 'transformation', 'ambition', 'artistry', 'tradition', 'celebration', 'comfort', 'adventure', 'escape', 'community', 'luxury', 'simplicity', 'spirituality', 'romance', 'melancholy', 'joy', 'chaos', 'heritage', 'innovation', 'craftsmanship', 'indulgence', 'wonder'];
const VOCAB_SET = new Set(THEME_VOCAB);
// The subjective 0-100 craft scalars per category (= app.js CRAFT_FN featSim fields). Count/string/
// array fields (run, ep, pg, len, inst, mech, tech, reg, st, ...) are intentionally NOT enriched.
const CRAFT_SCALARS = {
  movies: ['vis', 'dlg', 'twist'], tv: ['ser', 'binge'], books: ['lit', 'plot', 'exp'],
  music: ['nrg', 'val', 'aco', 'dan'], games: ['dif', 'story', 'open'], anime: ['act', 'art', 'emo'],
  food: ['spice', 'rich', 'sweet', 'prep'], travel: ['nat', 'adv', 'bud', 'off'],
};
const CRAFT_DESC = {
  vis: 'visual spectacle / cinematography', dlg: 'dialogue-forward vs visual', twist: 'plot twistiness / unpredictability',
  ser: 'serialized continuity (vs episodic)', binge: 'binge-ability',
  lit: 'literary / prose density', plot: 'plot-driven momentum', exp: 'experimental / unconventional structure',
  nrg: 'sonic energy', val: 'valence (0 = sad/dark, 100 = happy/bright)', aco: 'acousticness', dan: 'danceability',
  dif: 'difficulty / challenge', story: 'story / narrative emphasis', open: 'open-world / nonlinearity',
  act: 'action intensity', art: 'art & animation showcase', emo: 'emotional weight',
  spice: 'spiciness / heat', rich: 'richness / heaviness', sweet: 'sweetness', prep: 'preparation effort / complexity',
  nat: 'nature & scenery', adv: 'adventurousness / activity', bud: 'budget-friendliness', off: 'off-the-beaten-path obscurity',
};

/* ================= selection ================= */
const isBotAdded = (it) => /-tmdb\d*$/.test(it.id) || /^sr-/.test(it.id);
const thCount = (it) => (Array.isArray(it.th) ? it.th.length : 0);
const isEligible = (it) => it && it.id && it.enr !== ENR_VERSION && (isBotAdded(it) || thCount(it) < 3);

/* ================= prompt ================= */
function descOf(it) { const d = it.d && (it.d.en || it.d.es || it.d.pt); return d ? String(d).slice(0, 240) : ''; }
function buildPrompt(it, cat) {
  const scalars = CRAFT_SCALARS[cat];
  const g = Array.isArray(it.g) ? it.g : [];
  return (
    `You are enriching a metadata record for a cross-media recommendation engine. Rate this work ` +
    `honestly and specifically, based on its actual character (not the average of its genre).\n\n` +
    `WORK: "${it.t}"${it.y ? ' (' + it.y + ')' : ''}${it.by ? ' by ' + it.by : ''} — category: ${cat}` +
    `${g.length ? ', genres: ' + g.join(', ') : ''}${descOf(it) ? '. ' + descOf(it) : ''}\n\n` +
    `Return ONLY a JSON object (no prose, no code fence) with exactly these keys:\n` +
    `{\n` +
    `  "dna": [8 integers 0-100, in THIS order: ${DNA_AXES.join(', ')}],\n` +
    `  "themes": [3 to 6 strings, chosen ONLY from the allowed list, most central first],\n` +
    `  "craft": {${scalars.map((s) => `"${s}": <int 0-100>`).join(', ')}}\n` +
    `}\n\n` +
    `DNA axis anchors:\n${DNA_ANCHORS.map((a) => '- ' + a).join('\n')}\n\n` +
    `Allowed themes (choose 3-6, exact spelling): ${THEME_VOCAB.join(', ')}\n\n` +
    `Craft scalars for ${cat} (0 = low, 100 = high):\n${scalars.map((s) => `- ${s}: ${CRAFT_DESC[s]}`).join('\n')}\n\n` +
    `Rules: dna is exactly 8 integers. themes are 3-6 items, all from the allowed list. craft values ` +
    `are integers 0-100. Output the JSON object and nothing else.`
  );
}

/* ================= parse + validate ================= */
const clampI = (n) => Math.max(0, Math.min(100, Math.round(n)));
function parseEnrichment(txt, cat) {
  if (!txt) return null;
  const m = String(txt).match(/\{[\s\S]*\}/); if (!m) return null;
  let obj; try { obj = JSON.parse(m[0]); } catch { return null; }
  const out = {};
  if (Array.isArray(obj.dna) && obj.dna.length === 8 && obj.dna.every((n) => typeof n === 'number' && isFinite(n))) {
    out.dna = obj.dna.map(clampI);
  }
  if (Array.isArray(obj.themes)) {
    const seen = new Set(); const th = [];
    for (const t of obj.themes) {
      if (typeof t !== 'string') continue;
      const k = t.trim().toLowerCase();
      if (VOCAB_SET.has(k) && !seen.has(k)) { seen.add(k); th.push(k); }
    }
    if (th.length >= 3) out.themes = th.slice(0, 6);
  }
  if (obj.craft && typeof obj.craft === 'object') {
    const craft = {};
    for (const s of CRAFT_SCALARS[cat]) {
      const v = obj.craft[s];
      if (typeof v === 'number' && isFinite(v)) craft[s] = clampI(v);
    }
    if (Object.keys(craft).length) out.craft = craft;
  }
  return out;
}

/* ================= apply (surgical mutation + change log) ================= */
const pick = (o, keys) => { const r = {}; for (const k of keys) if (k in o) r[k] = o[k]; return r; };
function applyEnrichment(it, cat, e) {
  const changes = [];
  if (e.dna && JSON.stringify(it.dna) !== JSON.stringify(e.dna)) { changes.push({ field: 'dna', before: it.dna, after: e.dna }); it.dna = e.dna; }
  else if (e.dna) it.dna = e.dna;
  if (e.themes && JSON.stringify(it.th) !== JSON.stringify(e.themes)) { changes.push({ field: 'th', before: it.th, after: e.themes }); it.th = e.themes; }
  else if (e.themes) it.th = e.themes;
  if (e.craft) {
    const x = (it.x && typeof it.x === 'object') ? it.x : {};
    const beforeX = pick(x, CRAFT_SCALARS[cat]);
    let touched = false;
    for (const s of CRAFT_SCALARS[cat]) if (s in e.craft) { if (x[s] !== e.craft[s]) touched = true; x[s] = e.craft[s]; }
    if (touched) changes.push({ field: 'x', before: beforeX, after: pick(x, CRAFT_SCALARS[cat]) });
    it.x = x;
  }
  return changes;
}

/* ================= LLM call (mirror vibe.mjs callAnthropic) ================= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let emptyLogged = 0;
async function callAnthropic(p) {
  const body = { model: BULK_MODEL, max_tokens: 512, messages: [{ role: 'user', content: p }] };
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
      if (!txt && emptyLogged < 8) { emptyLogged++; console.error(`  [empty response #${emptyLogged}] stop_reason=${j.stop_reason} usage=${JSON.stringify(j.usage)}`); }
      return txt;
    }
    if (res.status === 429 || res.status >= 500) { await sleep(800 * 2 ** attempt); continue; }
    throw new Error(`Anthropic API ${res.status}: ${await res.text().catch(() => '')}`);
  }
  throw new Error('Anthropic API: exhausted retries');
}

// deterministic mock enrichment for DRY_RUN (exercises parse+validate+apply+writeback without API).
function mockResponse(it, cat) {
  let s = 2166136261 >>> 0; for (let k = 0; k < it.id.length; k++) { s ^= it.id.charCodeAt(k); s = Math.imul(s, 16777619) >>> 0; }
  const rnd = () => { s = (Math.imul(s ^ (s >>> 15), s | 1) ^ (s + Math.imul(s ^ (s >>> 7), s | 61))) >>> 0; return s / 4294967296; };
  const dna = Array.from({ length: 8 }, () => Math.round(rnd() * 100));
  const themes = []; const start = (s >>> 3) % THEME_VOCAB.length;
  for (let i = 0; i < 4; i++) themes.push(THEME_VOCAB[(start + i * 7) % THEME_VOCAB.length]);
  const craft = {}; for (const c of CRAFT_SCALARS[cat]) craft[c] = Math.round(rnd() * 100);
  return JSON.stringify({ dna, themes, craft });
}

// bounded-concurrency map (mirror vibe.mjs pool)
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

/* ================= diff summary ================= */
function fmt(v) { return Array.isArray(v) || (v && typeof v === 'object') ? JSON.stringify(v) : String(v); }
function renderDiffTable(log, limit) {
  const lines = ['| id | cat | field | before | after |', '|---|---|---|---|---|'];
  for (const row of log.slice(0, limit)) for (const c of row.changes) lines.push(`| \`${row.id}\` | ${row.cat} | ${c.field} | ${fmt(c.before)} | ${fmt(c.after)} |`);
  if (log.length > limit) lines.push(`| … | | | +${log.length - limit} more items | |`);
  return lines.join('\n');
}

/* ================= main ================= */
async function main() {
  const data = JSON.parse(await readFile(DATA, 'utf8'));

  // round-robin across categories so a MAX_ITEMS-capped run spans the whole catalog (better coverage
  // + a representative spot-check), rather than draining one big category first.
  const perCat = CAT_ORDER.map((cat) => (Array.isArray(data[cat]) ? data[cat] : []).filter(isEligible).map((it) => ({ it, cat })));
  const totalEligible = perCat.reduce((s, a) => s + a.length, 0);
  const queue = [];
  for (let r = 0; queue.length < totalEligible; r++) { let added = false; for (const arr of perCat) if (r < arr.length) { queue.push(arr[r]); added = true; } if (!added) break; }
  const batch = queue.slice(0, MAX_ITEMS);
  console.log(`enrich: ${totalEligible} eligible items, processing ${batch.length} this run (MAX_ITEMS=${MAX_ITEMS}, rubric v${ENR_VERSION})${DRY_RUN ? ' [DRY_RUN]' : ''}`);
  if (batch.length < totalEligible) console.log(`NOTE: ${totalEligible - batch.length} eligible items deferred to a later run.`);

  if (batch.length && !DRY_RUN && !API_KEY) { console.error('FATAL: ANTHROPIC_API_KEY not set and eligible items remain.'); process.exit(1); }

  const DATA_OUT = DRY_RUN ? ROOT + 'data.dryrun.json' : DATA;
  const changeLog = [];
  const stats = { dna: 0, themes: 0, craft: 0, attempted: 0, applied: 0, invalid: 0 };
  let sinceFlush = 0, done = 0;

  const flush = async () => { await writeFile(DATA_OUT, JSON.stringify(data), 'utf8'); };

  await pool(batch, CONCURRENCY, async ({ it, cat }) => {
    let txt;
    try { txt = (DRY_RUN || !API_KEY) ? mockResponse(it, cat) : await callAnthropic(buildPrompt(it, cat)); }
    catch (e) { console.error(`  [call failed] ${it.id}: ${e.message}`); return; } // leave unmarked -> retried next run
    stats.attempted++;
    const e = parseEnrichment(txt, cat);
    if (!e || (!e.dna && !e.themes && !e.craft)) { stats.invalid++; }
    else {
      const changes = applyEnrichment(it, cat, e);
      if (e.dna) stats.dna++; if (e.themes) stats.themes++; if (e.craft) stats.craft++;
      if (changes.length) { stats.applied++; changeLog.push({ id: it.id, cat, changes }); }
    }
    it.enr = ENR_VERSION; // mark attempted (parsed a response) so we never re-bill this item
    if (++done % 25 === 0) console.log(`  ${done}/${batch.length}`);
    if (++sinceFlush >= 25) { sinceFlush = 0; await flush(); } // preserve progress on a mid-run failure
  });

  await flush();
  console.log(`done: attempted ${stats.attempted}, changed ${stats.applied} items (dna ${stats.dna}, themes ${stats.themes}, craft ${stats.craft}), invalid/empty ${stats.invalid}`);
  console.log(`wrote ${DATA_OUT}`);

  if (!DRY_RUN) {
    // bump the SW cache version so returning clients re-fetch the changed catalog (same as refresh/ingest).
    let sw = await readFile(SW, 'utf8');
    const m = sw.match(/muse-v(\d+)/);
    if (m) { const next = `muse-v${parseInt(m[1], 10) + 1}`; sw = sw.replace(/muse-v\d+/g, next); await writeFile(SW, sw, 'utf8'); console.log('sw ->', next); }
  }

  // human-readable diff (the reviewable artifact — git only sees the one minified line change).
  const table = renderDiffTable(changeLog, 30);
  const summary = `## Muse enrich — ${stats.applied} items changed\n\ndna ${stats.dna} · themes ${stats.themes} · craft ${stats.craft} · invalid ${stats.invalid} · attempted ${stats.attempted}\n\n${table}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
  console.log('\n' + renderDiffTable(changeLog, 12));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { isBotAdded, isEligible, parseEnrichment, applyEnrichment, CRAFT_SCALARS, THEME_VOCAB, DNA_AXES };
