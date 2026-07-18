/* Muse — E0 eval harness: measures the matching engine against an LLM judge via triplet accuracy.
 *
 * Builds triplets (A, B, C) where the engine ranks B ABOVE C, asks a judge which of B/C is actually
 * closer to A, and scores the engine by how often it agreed. Same-category triplets use score();
 * cross-media triplets use crossScore(). Reads the real engine via engine-port.mjs (byte-identical
 * to app.js — see that file's parity test), so this measures exactly what ships.
 *
 * Triplet construction (per runbook E0.2):
 *   - same-cat: SEEDS_PER_CAT seeds per category; B = random of the seed's top-10, C = random of
 *     its rank 30-80 (by score().total).
 *   - cross:   CROSS_TRIPLETS triplets; B = random of the target category's Beyond top-5, C = random
 *     of its rank 20-60 (by crossScore()).
 * All selection is SEEDED (mulberry32) so the triplet set is stable run-to-run and the judge cache
 * (eval/triplets.json, keyed by hash(A,B,C)) actually hits — a triplet is never re-judged.
 *
 * Metric: triplet accuracy = fraction where the judge's winner is the engine's higher-ranked pick.
 * Writes eval/report.json (per-category, cross, overall, counts, timestamp).
 *
 * Env: ANTHROPIC_API_KEY (required for live judging). JUDGE_MODEL (default claude-sonnet-5),
 *      SEEDS_PER_CAT (40), CROSS_TRIPLETS (80), MAX_JUDGE (800 new API calls/run cap),
 *      JUDGE_CONCURRENCY (4), DRY_RUN=1 (build + metric with a deterministic mock judge, no API).
 * Node 18+ (global fetch). No deps.
 */
import { loadEngine } from './engine-port.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const API_KEY = process.env.ANTHROPIC_API_KEY;
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'claude-sonnet-5';
const SEEDS_PER_CAT = +(process.env.SEEDS_PER_CAT || 40);
const CROSS_TRIPLETS = +(process.env.CROSS_TRIPLETS || 80);
const MAX_JUDGE = +(process.env.MAX_JUDGE || 800);
const CONCURRENCY = Math.max(1, +(process.env.JUDGE_CONCURRENCY || 4));
const DRY_RUN = process.env.DRY_RUN === '1';

const ROOT = new URL('..', import.meta.url).pathname;
const EVAL_DIR = ROOT + 'eval/';
// DRY_RUN never touches the committed cache/report — its mock verdicts, keyed by the SAME real
// triplet hashes, would otherwise poison the live run (mock verdicts read back as "already judged").
const TRIPLETS_FILE = EVAL_DIR + (DRY_RUN ? 'triplets.dryrun.json' : 'triplets.json');
const REPORT_FILE = EVAL_DIR + (DRY_RUN ? 'report.dryrun.json' : 'report.json');

/* ---------- deterministic helpers ---------- */
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// FNV-1a 32-bit — stable string hash for seeds and triplet cache keys.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function distinctInts(rng, range, count) {
  const seen = new Set(); const out = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 50 && seen.size < range) {
    const v = (rng() * range) | 0;
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

/* ---------- triplet building ---------- */
const tripletKey = (aId, bId, cId) => hash(`${aId}::${bId}::${cId}`).toString(16);

function makeTriplet(kind, cat, A, B, C) {
  return {
    key: tripletKey(A.id, B.id, C.id),
    kind, cat, // for 'cross', cat is the TARGET category being compared within
    a: A.id, b: B.id, c: C.id,
    aT: A.t, bT: B.t, cT: C.t,
  };
}

function sameCatTriplets(eng) {
  const out = [];
  for (const cat of eng.CAT_ORDER) {
    const pool = eng.D[cat];
    if (!pool || pool.length < 90) { console.log(`  ${cat}: only ${pool ? pool.length : 0} items, need >=90 for rank 30-80 — skipping same-cat triplets`); continue; }
    const rng = mulberry32(hash('seed:' + cat));
    const seedIdx = distinctInts(rng, pool.length, SEEDS_PER_CAT);
    for (const si of seedIdx) {
      const A = pool[si];
      const ranked = pool.filter((x) => x.id !== A.id)
        .map((x) => ({ x, s: eng.score(A, x, cat).total }))
        .sort((p, q) => q.s - p.s);
      if (ranked.length < 80) continue;
      const top10 = ranked.slice(0, 10), mid = ranked.slice(30, 80);
      const B = top10[(rng() * top10.length) | 0].x;
      const C = mid[(rng() * mid.length) | 0].x;
      if (B.id === C.id) continue;
      out.push(makeTriplet('same', cat, A, B, C));
    }
  }
  return out;
}

function crossTriplets(eng) {
  const out = []; const seen = new Set();
  const rng = mulberry32(hash('cross'));
  let guard = 0;
  while (out.length < CROSS_TRIPLETS && guard++ < CROSS_TRIPLETS * 40) {
    const seedCat = eng.CAT_ORDER[(rng() * eng.CAT_ORDER.length) | 0];
    const targetCat = eng.CAT_ORDER[(rng() * eng.CAT_ORDER.length) | 0];
    if (targetCat === seedCat) continue;
    const seedPool = eng.D[seedCat], targetPool = eng.D[targetCat];
    if (!seedPool.length || targetPool.length < 62) continue;
    const A = seedPool[(rng() * seedPool.length) | 0];
    const ranked = targetPool.map((x) => ({ x, s: eng.crossScore(A, x) })).sort((p, q) => q.s - p.s);
    const top5 = ranked.slice(0, 5), mid = ranked.slice(20, 60);
    if (top5.length < 1 || mid.length < 1) continue;
    const B = top5[(rng() * top5.length) | 0].x;
    const C = mid[(rng() * mid.length) | 0].x;
    if (B.id === C.id || A.id === B.id || A.id === C.id) continue;
    const t = makeTriplet('cross', targetCat, A, B, C);
    if (seen.has(t.key)) continue; seen.add(t.key);
    out.push(t);
  }
  return out;
}

/* ---------- the judge ---------- */
function describe(eng, id) {
  const it = eng.byId[id]; if (!it) return id;
  const bits = [`"${it.t}" (${it._cat}${it.y ? ', ' + it.y : ''})`];
  if (it.by) bits.push('by ' + it.by);
  if (it.g && it.g.length) bits.push('genres: ' + it.g.slice(0, 4).join(', '));
  if (it.th && it.th.length) bits.push('themes: ' + it.th.slice(0, 5).join(', '));
  const d = it.d && (it.d.en || it.d.es || it.d.pt);
  if (d) bits.push(String(d).slice(0, 140));
  return bits.join(' — ');
}

let emptyLogged = 0;
async function callAnthropic(prompt) {
  // 1024 (was 128): the first live runs returned EMPTY text for the hardest triplets — the model
  // spends its token budget reaching an answer and never emits the text with a tighter cap. A short
  // judgment still costs only a handful of output tokens; this just raises the ceiling.
  const body = { model: JUDGE_MODEL, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] };
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
      // concatenate ALL text blocks — a model may prepend a non-text (e.g. thinking) block, so
      // content[0].text can be undefined even when a perfectly good answer is in a later block.
      const txt = (j.content || []).filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim();
      if (!txt && emptyLogged < 8) { emptyLogged++; console.error(`  [empty response #${emptyLogged}] stop_reason=${j.stop_reason} blocks=${JSON.stringify((j.content || []).map((b) => b && b.type))} usage=${JSON.stringify(j.usage)}`); }
      return txt;
    }
    if (res.status === 429 || res.status >= 500) { await sleep(800 * 2 ** attempt); continue; }
    throw new Error(`Anthropic API ${res.status}: ${await res.text().catch(() => '')}`);
  }
  throw new Error('Anthropic API: exhausted retries');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Parse a judge reply ("1"/"2" + reason) and map it back to whether the engine's higher pick (B)
// won, given which item was shown as Option 1 vs Option 2. Pure + exported so it's unit-testable.
const firstIndex = (str, re) => { const m = re.exec(str); return m ? m.index : -1; };
export function parseVerdict(text, firstId, secondId, bId) {
  if (!text) return null;
  const s = String(text).trim();
  const low = s.toLowerCase();
  // accept the digit OR the spelled-out form ("first"/"one", "second"/"two"); pick whichever
  // signal appears EARLIEST (the model was asked to lead with its answer).
  const p1 = firstIndex(low, /\b(?:1|one|first)\b/);
  const p2 = firstIndex(low, /\b(?:2|two|second)\b/);
  let pick;
  if (p1 < 0 && p2 < 0) return null;
  else if (p2 < 0) pick = '1';
  else if (p1 < 0) pick = '2';
  else pick = p1 <= p2 ? '1' : '2';
  const chosenId = pick === '1' ? firstId : secondId;
  const winner = chosenId === bId ? 'B' : 'C';
  const reason = s.replace(/^\s*(?:option\s*)?(?:1|2|one|two|first|second)\b\s*(?:option)?\s*[-–:.]*\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return { winner, reason };
}

// Present B and C in a deterministically-shuffled order (Option 1/2) so the judge can't exploit
// position, then map the answer back to whether the engine's higher pick (B) won.
async function judgeTriplet(eng, t) {
  const flip = (hash(t.key) & 1) === 1;
  const firstId = flip ? t.c : t.b, secondId = flip ? t.b : t.c;
  const prompt =
    `Reference work A:\n${describe(eng, t.a)}\n\n` +
    `Option 1:\n${describe(eng, firstId)}\n\n` +
    `Option 2:\n${describe(eng, secondId)}\n\n` +
    `Begin your reply with the single digit 1 or 2 — whichever option is closer to A in overall ` +
    `experience and DNA (its mood, tone, feel, pacing and themes, NOT just shared facts) — then a ` +
    `dash and a reason of 8 words or fewer.`;
  let text;
  if (DRY_RUN || !API_KEY) {
    // deterministic mock: pick the engine-higher option ~72% of the time, keyed on the triplet hash
    const mockPickId = (hash('mock:' + t.key) % 100) < 72 ? t.b : t.c;
    text = (mockPickId === firstId ? '1' : '2') + ' - mock verdict';
  } else {
    text = await callAnthropic(prompt);
  }
  const v = parseVerdict(text, firstId, secondId, t.b);
  if (!v && !DRY_RUN && nullLogged < 20) { nullLogged++; console.error(`  [unparsed judge reply #${nullLogged}] ${JSON.stringify(String(text).slice(0, 140))}`); }
  return v;
}
let nullLogged = 0;

// bounded-concurrency map
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

/* ---------- report ---------- */
function buildReport(triplets, verdicts) {
  // engine ranks B above C by construction, so the engine's higher pick is always 'B'.
  const bucket = {}; // key -> {correct, total}
  const add = (k, correct) => { (bucket[k] = bucket[k] || { correct: 0, total: 0 }); bucket[k].total++; if (correct) bucket[k].correct++; };
  let judged = 0;
  for (const t of triplets) {
    const v = verdicts[t.key]; if (!v || !v.winner) continue;
    judged++;
    const correct = v.winner === 'B';
    if (t.kind === 'cross') add('cross', correct); else add('same:' + t.cat, correct);
    add('overall', correct);
  }
  const pct = (b) => (b && b.total ? Math.round((1000 * b.correct) / b.total) / 10 : null);
  const perCategory = {};
  for (const cat of ['movies', 'tv', 'books', 'music', 'games', 'anime', 'food', 'travel']) {
    const b = bucket['same:' + cat]; if (b) perCategory[cat] = { accuracy: pct(b), n: b.total };
  }
  return {
    generatedAt: new Date().toISOString(),
    judgeModel: DRY_RUN || !API_KEY ? 'MOCK' : JUDGE_MODEL,
    overall: { accuracy: pct(bucket.overall), n: bucket.overall ? bucket.overall.total : 0 },
    cross: bucket.cross ? { accuracy: pct(bucket.cross), n: bucket.cross.total } : { accuracy: null, n: 0 },
    perCategory,
    judgedTriplets: judged,
    builtTriplets: triplets.length,
  };
}

function printTable(report) {
  const lines = [];
  lines.push(`Judge: ${report.judgeModel}   built: ${report.builtTriplets}   judged: ${report.judgedTriplets}`);
  lines.push('');
  lines.push('| bucket | accuracy | n |');
  lines.push('|---|---|---|');
  lines.push(`| **overall** | **${report.overall.accuracy ?? '—'}%** | ${report.overall.n} |`);
  lines.push(`| cross-media | ${report.cross.accuracy ?? '—'}% | ${report.cross.n} |`);
  for (const [cat, v] of Object.entries(report.perCategory)) lines.push(`| ${cat} | ${v.accuracy ?? '—'}% | ${v.n} |`);
  return lines.join('\n');
}

/* ---------- main ---------- */
async function main() {
  const eng = await loadEngine({ root: ROOT });
  console.log(`engine loaded: ${eng.ALL.length} items, embeddings ${eng.embLoaded() ? 'live' : 'ABSENT'}`);

  console.log('building triplets...');
  const triplets = [...sameCatTriplets(eng), ...crossTriplets(eng)];
  console.log(`built ${triplets.length} triplets (${triplets.filter((t) => t.kind === 'same').length} same-cat, ${triplets.filter((t) => t.kind === 'cross').length} cross)`);

  // load cache
  let cache = {};
  try { cache = JSON.parse(await readFile(TRIPLETS_FILE, 'utf8')); } catch { cache = {}; }
  const verdicts = {};
  const toJudge = [];
  for (const t of triplets) {
    if (cache[t.key] && cache[t.key].winner) verdicts[t.key] = cache[t.key];
    else toJudge.push(t);
  }
  console.log(`cached verdicts: ${Object.keys(verdicts).length}; new to judge: ${toJudge.length}`);

  if (!DRY_RUN && !API_KEY && toJudge.length) {
    console.error('FATAL: ANTHROPIC_API_KEY not set and uncached triplets remain. Set the secret or run DRY_RUN=1.');
    process.exit(1);
  }

  const batch = toJudge.slice(0, MAX_JUDGE);
  if (batch.length < toJudge.length) console.log(`NOTE: capping this run at MAX_JUDGE=${MAX_JUDGE}; ${toJudge.length - batch.length} triplets deferred to a later run.`);

  let done = 0;
  await pool(batch, CONCURRENCY, async (t) => {
    const v = await judgeTriplet(eng, t);
    if (v) { verdicts[t.key] = v; cache[t.key] = { ...v, a: t.a, b: t.b, c: t.c, kind: t.kind, cat: t.cat }; }
    if (++done % 50 === 0) console.log(`  judged ${done}/${batch.length}`);
  });

  await mkdir(EVAL_DIR, { recursive: true });
  await writeFile(TRIPLETS_FILE, JSON.stringify(cache));
  const report = buildReport(triplets, verdicts);
  await writeFile(REPORT_FILE, JSON.stringify(report, null, 2));

  const table = printTable(report);
  console.log('\n' + table);
  // GitHub Actions job summary
  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, '## Muse eval\n\n' + table + '\n', { flag: 'a' });
  }

  console.log(`\nwrote ${REPORT_FILE} and ${TRIPLETS_FILE}`);
  if (report.judgedTriplets < 400) console.log(`NOTE: only ${report.judgedTriplets} judged triplets (<400 ship-gate threshold) — re-run to accumulate more.`);
}

// run only when invoked directly (not when imported for unit tests)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
