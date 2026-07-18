/* Muse — pure-Node port of the app.js scoring engine (E0 eval harness foundation).
 *
 * MUST STAY IN SYNC WITH app.js. Same convention as refit.mjs mirroring CATALGOS and refresh.mjs
 * maintaining its own genre tables — this no-build-step project can't import from the browser
 * bundle, so the scoring math is duplicated here verbatim. Any change to a scoring function,
 * weight, sigma, or a NEW signal id in app.js must be mirrored here (and in refit.mjs), same order.
 *
 * Exposes the exact score()/crossScore()/parts() an item pair would get in the browser, reading
 * data.json + embeddings.b64.json + weights.json (weights fall back to the CATALGOS defaults, same
 * validation as app.js loadWeights). Used by eval.mjs (triplet accuracy) and refit.mjs (--synthetic).
 *
 * ONE intentional divergence from app.js, documented at buildPriors(): the per-category signal
 * priors are sampled with a SEEDED PRNG instead of Math.random(), so a run is reproducible. The
 * priors only impute MISSING signals; both candidates in a triplet are imputed from the same
 * priors, so the pairwise RANKING the eval measures is insensitive to the exact prior values.
 *
 * Node 18+ (global fetch not needed here; only fs). No deps.
 */
import { readFile } from 'node:fs/promises';

const ROOT_DEFAULT = new URL('..', import.meta.url).pathname;

/* ================= constants (mirror app.js) ================= */
const CAT_ORDER = ['movies', 'tv', 'books', 'music', 'games', 'anime', 'food', 'travel'];
// only CATS[cat].sigma is used by scoring (eraSim); other CATS fields are UI-only.
const CAT_SIGMA = { movies: 12, tv: 10, books: 25, music: 8, games: 8, anime: 10, food: 0, travel: 0 };
const REGIONS = {
  USA: 'NA', Canada: 'NA',
  Mexico: 'LATAM', Brazil: 'LATAM', Argentina: 'LATAM', Peru: 'LATAM', Chile: 'LATAM', Colombia: 'LATAM', Cuba: 'LATAM',
  Uruguay: 'LATAM', Bolivia: 'LATAM', Ecuador: 'LATAM', Venezuela: 'LATAM', Guatemala: 'LATAM', 'Costa Rica': 'LATAM', 'Puerto Rico': 'LATAM',
  UK: 'EUW', 'United Kingdom': 'EUW', Ireland: 'EUW', France: 'EUW', Germany: 'EUW', Netherlands: 'EUW', Belgium: 'EUW', Austria: 'EUW', Switzerland: 'EUW',
  Spain: 'EUS', Portugal: 'EUS', Italy: 'EUS', Greece: 'EUS',
  Sweden: 'EUN', Norway: 'EUN', Denmark: 'EUN', Finland: 'EUN', Iceland: 'EUN',
  Poland: 'EUE', 'Czech Republic': 'EUE', Hungary: 'EUE', Russia: 'EUE', Ukraine: 'EUE', Romania: 'EUE', Serbia: 'EUE',
  Japan: 'EA', 'South Korea': 'EA', China: 'EA', Taiwan: 'EA', 'Hong Kong': 'EA', Mongolia: 'EA',
  India: 'SA', Pakistan: 'SA', Bangladesh: 'SA', 'Sri Lanka': 'SA', Nepal: 'SA',
  Thailand: 'SEA', Vietnam: 'SEA', Indonesia: 'SEA', Philippines: 'SEA', Malaysia: 'SEA', Singapore: 'SEA', Cambodia: 'SEA', Laos: 'SEA', Myanmar: 'SEA',
  Turkey: 'ME', Israel: 'ME', Lebanon: 'ME', Iran: 'ME', 'Saudi Arabia': 'ME', UAE: 'ME', Jordan: 'ME', Egypt: 'ME',
  Morocco: 'AF', Tunisia: 'AF', Ethiopia: 'AF', Nigeria: 'AF', 'South Africa': 'AF', Kenya: 'AF', Ghana: 'AF', Senegal: 'AF', Tanzania: 'AF',
  Australia: 'OC', 'New Zealand': 'OC', Fiji: 'OC',
};
const DNA_AXIS_W = { _default: [1, 1, 1, 1, 1, 1, 1, 1] };
const DNA_SIGMA = 0.14, FEAT_SIGMA = 0.16;
const MIN_COVERAGE = 0.5;

// CATALGOS — mirror app.js exactly (id order matters: it defines the parts-vector order refit uses).
const CATALGOS_DEFAULT = {   // v3 §E2: vibemb 0.10 appended to every row (mirror app.js)
  movies: [['emb', .22], ['theme', .20], ['mood', .20], ['genre', .15], ['craft', .13], ['creator', .10], ['era', .08], ['audience', .08], ['culture', .06], ['vibemb', .10]],
  tv:     [['emb', .22], ['theme', .20], ['mood', .20], ['genre', .15], ['craft', .13], ['creator', .08], ['era', .08], ['audience', .10], ['culture', .06], ['vibemb', .10]],
  books:  [['emb', .22], ['theme', .22], ['mood', .20], ['genre', .14], ['craft', .14], ['creator', .08], ['era', .08], ['audience', .08], ['culture', .06], ['vibemb', .10]],
  music:  [['emb', .22], ['craft', .22], ['mood', .20], ['genre', .16], ['theme', .12], ['creator', .08], ['era', .10], ['audience', .06], ['culture', .06], ['vibemb', .10]],
  games:  [['emb', .22], ['craft', .22], ['genre', .18], ['mood', .16], ['theme', .12], ['creator', .06], ['era', .08], ['audience', .10], ['culture', .08], ['vibemb', .10]],
  anime:  [['emb', .22], ['theme', .18], ['mood', .18], ['genre', .16], ['craft', .14], ['creator', .12], ['era', .08], ['audience', .08], ['srcdem', .06], ['vibemb', .10]],
  food:   [['emb', .22], ['craft', .26], ['ing', .12], ['tech', .06], ['genre', .14], ['mood', .14], ['theme', .10], ['culture', .12], ['audience', .06], ['vibemb', .10]],
  travel: [['emb', .22], ['craft', .24], ['vibe', .14], ['mood', .16], ['theme', .12], ['genre', .12], ['climate', .08], ['culture', .08], ['audience', .06], ['vibemb', .10]],
};

/* ================= module state ================= */
let D = null;                 // { cat: [items] }
const byId = {};
let CATALGOS = null;          // possibly weights.json-overridden copy
const themeIDF = {};
let genreIDF = {};
let CAT_PRIORS = {}, CAT_P80 = {};
let EMB_BUF = null, EMB_IDX = null, EMB_DIM = 0;
let VIBE_BUF = null, VIBE_IDX = null, VIBE_DIM = 0;

/* ================= helpers (mirror app.js) ================= */
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const isNum = (v) => typeof v === 'number' && !Number.isNaN(v);
const validVec = (v) => Array.isArray(v) && v.length === 8 && v.every(isNum);
function cosSets(A, B) { if (!A || !B || !A.length || !B.length) return null; const sb = new Set(B); let inter = 0; for (const x of A) if (sb.has(x)) inter++; return inter / Math.sqrt(A.length * B.length); }
function blend(pairs) { let num = 0, den = 0; for (const p of pairs) { const v = p[0]; if (v != null) { num += v * p[1]; den += p[1]; } } return den > 0 ? num / den : null; }
const asArr = (v) => (Array.isArray(v) ? v : (typeof v === 'string' && v ? [v] : []));
function normalizeItemArrays(it) {
  it.g = asArr(it.g); it.th = asArr(it.th); it.alt = asArr(it.alt); it.cast = asArr(it.cast);
  if (it.x) { for (const k of ['ing', 'vibe', 'mech', 'inst', 'fl']) if (k in it.x) it.x[k] = asArr(it.x[k]); }
}

/* ================= similarity (mirror app.js) ================= */
function wCos(A, B, idf) {
  if (!A || !B || !A.length || !B.length) return null;
  const w = (t) => { const v = idf[t]; return v ? v * v : 1; };
  let num = 0, sa = 0, sb = 0; const setB = new Set(B);
  for (const t of A) { sa += w(t); if (setB.has(t)) num += w(t); }
  for (const t of B) sb += w(t);
  const den = Math.sqrt(sa * sb); return den ? num / den : null;
}
function dnaSim(a, b, cat) {
  if (!validVec(a) || !validVec(b)) return null;
  const w = DNA_AXIS_W[cat] || DNA_AXIS_W._default; let s = 0, sw = 0;
  for (let i = 0; i < 8; i++) { const d = (a[i] - b[i]) / 100; s += w[i] * d * d; sw += w[i]; }
  const d = Math.sqrt(s / sw); return Math.exp(-(d * d) / (2 * DNA_SIGMA * DNA_SIGMA));
}
function featSim(xa, xb, keys) {
  if (!xa || !xb) return null; let s = 0, n = 0;
  for (const k of keys) { if (isNum(xa[k]) && isNum(xb[k])) { const d = (xa[k] - xb[k]) / 100; s += d * d; n++; } }
  if (n === 0) return null; const d = Math.sqrt(s / n); return Math.exp(-(d * d) / (2 * FEAT_SIGMA * FEAT_SIGMA));
}
function prox(a, b, span) { if (!isNum(a) || !isNum(b)) return null; return Math.max(0, 1 - Math.abs(a - b) / span); }
function eraSim(ya, yb, sg) { if (!isNum(ya) || !isNum(yb)) return null; const d = ya - yb; return Math.exp(-d * d / (2 * sg * sg)); }
function creatorSim(a, b) {
  if (a.by && b.by && norm(a.by) === norm(b.by)) return 1;
  const xa = a.x || {}, xb = b.x || {};
  if (xa.st && xb.st && xa.st === xb.st) return .8;
  const ca = (a.cast || []).map(norm), cb = (b.cast || []).map(norm);
  if (ca.some((x) => x && cb.includes(x))) return .65;
  return 0;
}
function cultureSim(a, b) {
  const ca = (a.x && a.x.reg) || a.c, cb = (b.x && b.x.reg) || b.c;
  if (!ca || !cb) return null; if (ca === cb) return 1;
  return (REGIONS[ca] && REGIONS[ca] === REGIONS[cb]) ? .55 : 0;
}
function audSim(a, b) {
  if (!isNum(a.pop) || !isNum(b.pop) || !isNum(a.acc) || !isNum(b.acc) || !isNum(a.main) || !isNum(b.main)) return null;
  return Math.max(0, 1 - (Math.abs(a.pop - b.pop) + Math.abs(a.acc - b.acc) + Math.abs(a.main - b.main)) / 300);
}
function embSim(a, b) {
  if (!EMB_BUF) return null; const ia = EMB_IDX[a.id], ib = EMB_IDX[b.id];
  if (ia == null || ib == null) return null; const oa = ia * EMB_DIM, ob = ib * EMB_DIM; let dot = 0;
  for (let k = 0; k < EMB_DIM; k++) dot += EMB_BUF[oa + k] * EMB_BUF[ob + k]; return Math.max(0, dot / (127 * 127));
}
// v3 §E2: vibe embedding — same byte format/loader as embeddings; null-safe (graceful-absent).
function vibeSim(a, b) {
  if (!VIBE_BUF) return null; const ia = VIBE_IDX[a.id], ib = VIBE_IDX[b.id];
  if (ia == null || ib == null) return null; const oa = ia * VIBE_DIM, ob = ib * VIBE_DIM; let dot = 0;
  for (let k = 0; k < VIBE_DIM; k++) dot += VIBE_BUF[oa + k] * VIBE_BUF[ob + k]; return Math.max(0, dot / (127 * 127));
}
const CRAFT_FN = {
  movies: (a, b) => { const xa = a.x || {}, xb = b.x || {}; return blend([[featSim(xa, xb, ['vis', 'dlg', 'twist']), .8], [prox(xa.run, xb.run, 90), .2]]); },
  tv: (a, b) => { const xa = a.x || {}, xb = b.x || {}; return blend([[featSim(xa, xb, ['ser', 'binge']), .6], [prox(xa.ep, xb.ep, 40), .2], [prox(xa.sea, xb.sea, 8), .2]]); },
  books: (a, b) => { const xa = a.x || {}, xb = b.x || {}; return blend([[featSim(xa, xb, ['lit', 'plot', 'exp']), .8], [prox(xa.pg, xb.pg, 600), .2]]); },
  music: (a, b) => { const xa = a.x || {}, xb = b.x || {}; return blend([[featSim(xa, xb, ['nrg', 'val', 'aco', 'dan']), .7], [cosSets(xa.inst, xb.inst), .3]]); },
  games: (a, b) => { const xa = a.x || {}, xb = b.x || {}; const la = isNum(xa.len) ? Math.min(xa.len, 120) : null, lb = isNum(xb.len) ? Math.min(xb.len, 120) : null; return blend([[featSim(xa, xb, ['dif', 'story', 'open']), .6], [cosSets(xa.mech, xb.mech), .3], [prox(la, lb, 100), .1]]); },
  anime: (a, b) => { const xa = a.x || {}, xb = b.x || {}; return featSim(xa, xb, ['act', 'art', 'emo']); },
  food: (a, b) => { const xa = a.x || {}, xb = b.x || {}; return blend([[featSim(xa, xb, ['spice', 'rich', 'sweet', 'prep']), .6], [cosSets(xa.fl, xb.fl), .4]]); },
  travel: (a, b) => { const xa = a.x || {}, xb = b.x || {}; return featSim(xa, xb, ['nat', 'adv', 'bud', 'off']); },
};
const ALGO = {
  emb: (a, b) => embSim(a, b),
  vibemb: (a, b) => vibeSim(a, b),   // v3 §E2
  theme: (a, b) => wCos(a.th, b.th, themeIDF),
  mood: (a, b, cat) => dnaSim(a.dna, b.dna, cat),
  genre: (a, b, cat) => wCos(a.g, b.g, genreIDF[cat]),
  craft: (a, b, cat) => (CRAFT_FN[cat] ? CRAFT_FN[cat](a, b) : null),
  creator: (a, b) => creatorSim(a, b),
  era: (a, b, cat) => eraSim(a.y, b.y, CAT_SIGMA[cat] || 10),
  audience: (a, b) => audSim(a, b),
  culture: (a, b) => cultureSim(a, b),
  ing: (a, b) => cosSets((a.x || {}).ing, (b.x || {}).ing),
  tech: (a, b) => { const A = (a.x || {}).tech, B = (b.x || {}).tech; if (A == null || B == null) return null; return A === B ? 1 : 0; },
  vibe: (a, b) => cosSets((a.x || {}).vibe, (b.x || {}).vibe),
  climate: (a, b) => { const A = (a.x || {}).climate, B = (b.x || {}).climate; if (!A || !B) return null; if (A === B) return 1; const mild = ['temperate', 'mediterranean']; return (mild.includes(A) && mild.includes(B)) ? .5 : 0; },
  srcdem: (a, b) => { const xa = a.x || {}, xb = b.x || {}; if ((xa.src == null && xa.dem == null) || (xb.src == null && xb.dem == null)) return null; return (xa.src && xa.src === xb.src ? .5 : 0) + (xa.dem && xa.dem === xb.dem ? .5 : 0); },
};

/* ================= IDF (mirror app.js buildIDF) ================= */
function buildIDF(all) {
  const N = Math.max(1, all.length), themeFL = 10, td = {};
  all.forEach((it) => Array.from(new Set(it.th || [])).forEach((t) => (td[t] = (td[t] || 0) + 1)));
  for (const t in td) themeIDF[t] = Math.log(N / Math.max(td[t], themeFL)) + 1;
  genreIDF = {};
  CAT_ORDER.forEach((cat) => {
    const list = D[cat] || [], n = Math.max(1, list.length), fl = Math.max(3, Math.round(0.01 * n)), gd = {};
    list.forEach((it) => Array.from(new Set(it.g || [])).forEach((g) => (gd[g] = (gd[g] || 0) + 1)));
    const idf = {}; for (const g in gd) idf[g] = Math.log(n / Math.max(gd[g], fl)) + 1;
    genreIDF[cat] = idf;
  });
}

/* ================= priors (mirror app.js buildPriors, SEEDED) ================= */
// Deterministic PRNG so a run reproduces exactly (app.js uses Math.random; see file header).
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ALGO_PRESENT = {
  theme: (it) => !!(it.th && it.th.length), mood: (it) => validVec(it.dna), genre: (it) => !!(it.g && it.g.length),
  craft: (it) => !!(it.x && Object.keys(it.x).length), creator: () => true,
  era: (it) => isNum(it.y), audience: (it) => isNum(it.pop) && isNum(it.acc) && isNum(it.main),
  culture: (it) => !!((it.x && it.x.reg) || it.c),
  ing: (it) => !!(it.x && it.x.ing && it.x.ing.length), tech: (it) => (it.x && it.x.tech) != null,
  vibe: (it) => !!(it.x && it.x.vibe && it.x.vibe.length), climate: (it) => !!(it.x && it.x.climate),
  srcdem: (it) => !!(it.x && (it.x.src != null || it.x.dem != null)),
};
function buildPriors(cat, rng, sampleSize = 300) {
  const pool = D[cat] || []; if (pool.length < 2) return { priors: {}, p80: {} };
  const priors = {}, p80 = {};
  for (const [id] of CATALGOS[cat]) {
    if (id === 'emb' || id === 'vibemb') continue;   // v3 §E2
    const present = ALGO_PRESENT[id];
    const eligible = present ? pool.filter(present) : pool;
    const m = eligible.length; if (m < 2) { priors[id] = null; p80[id] = null; continue; }
    const vals = [];
    for (let i = 0; i < sampleSize; i++) {
      const a = eligible[(rng() * m) | 0], b = eligible[(rng() * m) | 0]; if (a === b) continue;
      const v = ALGO[id] ? ALGO[id](a, b, cat) : null; if (v != null) vals.push(clamp01(v));
    }
    if (vals.length) { priors[id] = vals.reduce((s, v) => s + v, 0) / vals.length; vals.sort((x, y) => x - y); p80[id] = vals[Math.floor(vals.length * 0.8)]; }
    else { priors[id] = null; p80[id] = null; }
  }
  return { priors, p80 };
}
function buildAllPriors(seed = 0x9e3779b9) {
  CAT_PRIORS = {}; CAT_P80 = {};
  const rng = mulberry32(seed);
  CAT_ORDER.forEach((cat) => { const r = buildPriors(cat, rng); CAT_PRIORS[cat] = r.priors; CAT_P80[cat] = r.p80; });
}

/* ================= score / crossScore / parts (mirror app.js) ================= */
function score(a, b, cat) {
  const parts = {}; let num = 0, den = 0, wtot = 0, presentDen = 0;
  const priors = CAT_PRIORS[cat] || {};
  for (const pair of CATALGOS[cat]) {
    const id = pair[0], w = pair[1]; wtot += w;
    const v = ALGO[id] ? ALGO[id](a, b, cat) : null; parts[id] = v;
    if (v == null) { const p = priors[id]; if (p != null) { num += p * w; den += w; } continue; }
    num += clamp01(v) * w; den += w; presentDen += w;
  }
  const total = den > 0 ? num / den : 0, coverage = wtot > 0 ? presentDen / wtot : 0;
  return { parts, total, coverage, eligible: coverage >= MIN_COVERAGE, pct: Math.min(99, Math.round(100 * Math.pow(total, 0.8))) };
}
function crossScore(a, b) {   // v3 §E2 (final): proven emb-led blend — vibe measured neutral-to-worse on cross, stays same-cat only (mirror app.js)
  let num = 0, den = 0;
  const e = embSim(a, b); if (e != null) { num += 0.55 * e; den += 0.55; }
  const dn = dnaSim(a.dna, b.dna, null); if (dn != null) { num += 0.30 * dn; den += 0.30; }
  const th = wCos(a.th, b.th, themeIDF); if (th != null) { num += 0.15 * th; den += 0.15; }
  return den > 0 ? num / den : 0;
}
// convenience: the raw per-signal parts object for a pair (= score().parts). Used by refit --synthetic.
function parts(a, b, cat) { return score(a, b, cat).parts; }

/* ================= weights.json override (mirror app.js loadWeights) ================= */
function applyWeights(j) {
  if (!j || typeof j !== 'object') return;
  for (const cat of Object.keys(j)) {
    if (!CATALGOS[cat]) continue;
    const arr = j[cat];
    if (!Array.isArray(arr) || !arr.length) continue;
    const cleaned = arr.filter((p) => Array.isArray(p) && typeof p[0] === 'string' && isNum(+p[1])).map((p) => [p[0], +p[1]]);
    if (cleaned.length !== CATALGOS[cat].length) continue;
    const curIds = new Set(CATALGOS[cat].map(([id]) => id)), newIds = new Set(cleaned.map(([id]) => id));
    if ([...curIds].some((id) => !newIds.has(id))) continue;
    CATALGOS[cat] = cleaned;
  }
}

/* ================= embeddings loader (mirror app.js loadEmb, Node Buffer) ================= */
function loadEmbeddings(j) {
  if (!j || !j.data) return;
  const buf = Buffer.from(j.data, 'base64');
  EMB_BUF = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  EMB_DIM = j.dim; EMB_IDX = Object.create(null);
  j.ids.forEach((id, i) => { EMB_IDX[id] = i; });
}
function loadVibeEmbeddings(j) {   // v3 §E2
  if (!j || !j.data) return;
  const buf = Buffer.from(j.data, 'base64');
  VIBE_BUF = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  VIBE_DIM = j.dim; VIBE_IDX = Object.create(null);
  j.ids.forEach((id, i) => { VIBE_IDX[id] = i; });
}
// test hook: inject vibe vectors directly (used by the parity harness before vibe.b64.json exists)
export function _setVibe(buf, idx, dim) { VIBE_BUF = buf; VIBE_IDX = idx; VIBE_DIM = dim; }

/* ================= init ================= */
async function readJSON(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } }

// Load data + (optional) embeddings + (optional) weights, build IDF and priors, return the engine.
export async function loadEngine(opts = {}) {
  const root = opts.root || ROOT_DEFAULT;
  const priorSeed = opts.priorSeed != null ? opts.priorSeed : 0x9e3779b9;
  D = await readJSON(root + 'data.json');
  if (!D || typeof D !== 'object') throw new Error('engine-port: could not read data.json at ' + root);

  // index
  const ALL = [];
  for (const k of CAT_ORDER) for (const it of (D[k] || [])) { normalizeItemArrays(it); it._cat = k; byId[it.id] = it; ALL.push(it); }

  // CATALGOS: start from defaults (deep copy), then apply weights.json if present + valid
  CATALGOS = Object.fromEntries(Object.entries(CATALGOS_DEFAULT).map(([c, rows]) => [c, rows.map((r) => [r[0], r[1]])]));
  if (opts.withWeights !== false) { const w = await readJSON(root + 'weights.json'); applyWeights(w); }

  // embeddings (default on; embSim just returns null if absent — same as browser before B2 landed)
  if (opts.withEmbeddings !== false) { const e = await readJSON(root + (opts.embFile || 'embeddings.b64.json')); loadEmbeddings(e); }
  // v3 §E2: vibe embeddings (default on; vibeSim null if absent — graceful, same as embeddings)
  if (opts.withVibe !== false) { const v = await readJSON(root + (opts.vibeFile || 'vibe.b64.json')); loadVibeEmbeddings(v); }

  buildIDF(ALL);
  // opts.priors lets a caller inject an externally-computed CAT_PRIORS (e.g. to reproduce app.js's
  // random-sampled priors exactly in a parity test); otherwise sample them deterministically here.
  if (opts.priors) CAT_PRIORS = opts.priors; else buildAllPriors(priorSeed);

  return {
    D, byId, ALL, CAT_ORDER,
    get CATALGOS() { return CATALGOS; },
    ALGO, score, crossScore, parts,
    embLoaded: () => !!EMB_BUF,
  };
}

// also export the pure pieces for targeted testing
export { CAT_ORDER, CATALGOS_DEFAULT, score, crossScore, parts, ALGO };
