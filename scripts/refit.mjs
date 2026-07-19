/* Muse — weekly ratings -> CATALGOS refit (runs in GitHub Actions, weekly, after embed.yml so
 * ratings collected once emb is live get fit with it present).
 * Reads `ratings` via Supabase REST (service_role — see T24; ratings.parts already IS the exact
 * per-algo feature vector score() computed at rating time, no need to touch data.json at all).
 * Per category: fit a logistic regression of r∈{+1,-1} on that category's sub-scores (plain-JS
 * gradient descent, no deps). Gate: skip a category unless >=150 ratings AND the newly-fit
 * weights beat the CURRENTLY-LIVE weights (last weights.json, or the CATALGOS default if none)
 * on a held-out split — never ships a regression, and stays a no-op entirely at today's ~6-row
 * volume (this is the deliberately-boring, safe steady state until B3/B4 fill the table).
 * Killed: per-user taste profiles — data-starved vaporware at current volume.
 * Node 18+ (global fetch). Env: SB_SERVICE_KEY.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { loadEngine } from './engine-port.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT  = ROOT + 'weights.json';
const SW   = ROOT + 'sw.js';
const TRIPLETS = ROOT + 'eval/triplets.json';
const SB   = 'https://esviqajfbkdnpoohjpjt.supabase.co';
const KEY  = process.env.SB_SERVICE_KEY;
const SYNTHETIC = process.argv.includes('--synthetic'); // E1: fit from eval triplets, not ratings

// Mirrors app.js's CATALGOS (must stay in sync — same convention as refresh.mjs independently
// maintaining its own genre-mapping tables rather than importing from app.js in this no-build-step
// project). Only the algo IDS and their DEFAULT weights matter here (the id list defines which
// `parts` fields this category's feature vector is built from; the weights are the fallback
// baseline a refit must beat when no weights.json exists yet).
const CATALGOS = {   // v3 §E2: vibemb 0.10; v3 §E6: lineage 0.05 — appended to every row (mirror app.js/engine-port)
  movies:[['emb',.22],['theme',.20],['mood',.20],['genre',.15],['craft',.13],['creator',.10],['era',.08],['audience',.08],['culture',.06],['vibemb',.10],['lineage',.05]],
  tv:    [['emb',.22],['theme',.20],['mood',.20],['genre',.15],['craft',.13],['creator',.08],['era',.08],['audience',.10],['culture',.06],['vibemb',.10],['lineage',.05]],
  books: [['emb',.22],['theme',.22],['mood',.20],['genre',.14],['craft',.14],['creator',.08],['era',.08],['audience',.08],['culture',.06],['vibemb',.10],['lineage',.05]],
  music: [['emb',.22],['craft',.22],['mood',.20],['genre',.16],['theme',.12],['creator',.08],['era',.10],['audience',.06],['culture',.06],['vibemb',.10],['lineage',.05]],
  games: [['emb',.22],['craft',.22],['genre',.18],['mood',.16],['theme',.12],['creator',.06],['era',.08],['audience',.10],['culture',.08],['vibemb',.10],['lineage',.05]],
  anime: [['emb',.22],['theme',.18],['mood',.18],['genre',.16],['craft',.14],['creator',.12],['era',.08],['audience',.08],['srcdem',.06],['vibemb',.10],['lineage',.05]],
  food:  [['emb',.22],['craft',.26],['ing',.12],['tech',.06],['genre',.14],['mood',.14],['theme',.10],['culture',.12],['audience',.06],['vibemb',.10],['lineage',.05]],
  travel:[['emb',.22],['craft',.24],['vibe',.14],['mood',.16],['theme',.12],['genre',.12],['climate',.08],['culture',.08],['audience',.06],['vibemb',.10],['lineage',.05]],
};

const MIN_RATINGS = 150;
// E1: synthetic mode needs far fewer rows than the 150-HUMAN-rating gate — the eval only produces
// ~40 triplets/category by design, and the held-out AUC-beat gate is the real safety net (a fit
// that doesn't generalize simply won't clear it), so a modest triplet floor is enough.
const MIN_SYNTHETIC_TRIPLETS = 25;
const WEIGHT_MIN = 0.02, WEIGHT_MAX = 0.35;
const LR = 0.3, L2 = 0.01, EPOCHS = 300;
const HOLDOUT_FRAC = 0.2;

// ---------- math ----------
const sigmoid = (z) => { const c = Math.max(-30, Math.min(30, z)); return 1 / (1 + Math.exp(-c)); }; // clamp to avoid exp() overflow
function dot(w, x, b) { let s = b; for (let j = 0; j < w.length; j++) s += w[j] * x[j]; return s; }

// Logistic regression via batch gradient descent. X: n x d array, y: n-array of +-1.
// Returns {w: d-array, b: number}.
function fitLogistic(X, y, epochs = EPOCHS, lr = LR, l2 = L2) {
  const n = X.length, d = X[0].length;
  let w = new Array(d).fill(0), b = 0;
  for (let e = 0; e < epochs; e++) {
    const gw = new Array(d).fill(0); let gb = 0;
    for (let i = 0; i < n; i++) {
      const z = dot(w, X[i], b);
      const s = sigmoid(y[i] * z); // probability the model assigns to the CORRECT label
      const coef = -y[i] * (1 - s);
      for (let j = 0; j < d; j++) gw[j] += coef * X[i][j];
      gb += coef;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + 2 * l2 * w[j]);
    b -= lr * (gb / n);
  }
  return { w, b };
}

// AUC (Mann-Whitney U / rank-sum method, average ranks on ties). scores/labels are parallel arrays.
function auc(scores, labels) {
  const n = scores.length;
  const idx = [...Array(n).keys()].sort((a, b) => scores[a] - scores[b]);
  const ranks = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && scores[idx[j + 1]] === scores[idx[i]]) j++;
    const avgRank = (i + j) / 2 + 1; // 1-indexed average rank across the tied block
    for (let k = i; k <= j; k++) ranks[idx[k]] = avgRank;
    i = j + 1;
  }
  let sumPosRanks = 0, nPos = 0, nNeg = 0;
  for (let k = 0; k < n; k++) { if (labels[k] === 1) { sumPosRanks += ranks[k]; nPos++; } else nNeg++; }
  if (!nPos || !nNeg) return null; // undefined without both classes present
  return (sumPosRanks - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// Clamping then renormalizing in a single pass can push values back OUTSIDE [min,max] whenever
// the post-clamp sum isn't exactly 1 (e.g. clamp to 0.35, sum lands at 0.99, rescale -> 0.3535 >
// 0.35). Iterate clamp+rescale to a fixed point — a standard box-constrained simplex projection;
// with 9 features and bounds [0.02,0.35] the [sum=1] target is always feasible (min possible sum
// 9*0.02=0.18, max 9*0.35=3.15), so this converges.
function clampAndRenormalize(weights, iterations = 20) {
  let w = weights.slice();
  for (let it = 0; it < iterations; it++) {
    w = w.map((v) => Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, v)));
    const total = w.reduce((s, v) => s + v, 0) || 1;
    w = w.map((v) => v / total);
  }
  return w;
}

// ---------- per-category refit ----------
// existingWeights: {id: weight} baseline for this category (from weights.json or CATALGOS default).
function refitCategory(cat, ids, rows, existingWeights) {
  const n = rows.length;
  if (n < MIN_RATINGS) return { skipped: true, reason: `only ${n} ratings, need ${MIN_RATINGS}` };

  const X = rows.map((r) => ids.map((id) => (typeof r.parts[id] === 'number' ? r.parts[id] : 0)));
  const y = rows.map((r) => r.r);

  const order = shuffle([...Array(n).keys()]);
  const nHold = Math.max(20, Math.round(n * HOLDOUT_FRAC));
  const holdIdx = order.slice(0, nHold), trainIdx = order.slice(nHold);
  if (trainIdx.length < MIN_RATINGS - nHold) return { skipped: true, reason: 'not enough training rows after holdout split' };

  const Xtrain = trainIdx.map((i) => X[i]), ytrain = trainIdx.map((i) => y[i]);
  const Xhold = holdIdx.map((i) => X[i]), yhold = holdIdx.map((i) => y[i]);

  const { w, b } = fitLogistic(Xtrain, ytrain);
  const newScores = Xhold.map((x) => dot(w, x, b));
  const newAuc = auc(newScores, yhold);

  // baseline: the CURRENTLY-LIVE weighted sum (no bias, no sigmoid needed — AUC is rank-invariant
  // to monotonic transforms, so the raw weighted sum ranks identically to sigmoid(weighted sum)).
  const baseW = ids.map((id) => existingWeights[id] || 0);
  const baseScores = Xhold.map((x) => dot(baseW, x, 0));
  const baseAuc = auc(baseScores, yhold);

  if (newAuc == null || baseAuc == null) return { skipped: true, reason: 'held-out split lacked both classes' };
  if (newAuc <= baseAuc) return { skipped: true, reason: `held-out AUC ${newAuc.toFixed(3)} did not beat current ${baseAuc.toFixed(3)}` };

  const finalWeights = clampAndRenormalize(w);
  return { skipped: false, weights: ids.map((id, i) => [id, Math.round(finalWeights[i] * 1000) / 1000]), newAuc, baseAuc, n };
}

// ---------- Supabase read ----------
async function fetchRatings() {
  if (!KEY) { console.error('FATAL: missing SB_SERVICE_KEY env/secret.'); process.exit(1); }
  const url = `${SB}/rest/v1/ratings?select=cat,r,parts`;
  const r = await fetch(url, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
  if (!r.ok) { console.error('FATAL: Supabase read failed', r.status, await r.text().catch(() => '')); process.exit(1); }
  return r.json();
}

async function loadExistingWeights() {
  try { return JSON.parse(await readFile(OUT, 'utf8')); } catch { return {}; }
}

async function bumpSW() {
  let sw = await readFile(SW, 'utf8');
  const m = sw.match(/muse-v(\d+)/);
  if (m) { const next = `muse-v${parseInt(m[1], 10) + 1}`; sw = sw.replace(/muse-v\d+/g, next); await writeFile(SW, sw, 'utf8'); console.log('sw ->', next); }
}

async function main() {
  const rows = await fetchRatings();
  console.log('ratings fetched:', rows.length);
  const existing = await loadExistingWeights();

  const byCat = {};
  for (const r of rows) { if (!r || !CATALGOS[r.cat] || (r.r !== 1 && r.r !== -1) || !r.parts) continue; (byCat[r.cat] = byCat[r.cat] || []).push(r); }

  const out = { ...existing };
  let changed = false;
  for (const cat of Object.keys(CATALGOS)) {
    const ids = CATALGOS[cat].map(([id]) => id);
    const defaultWeights = Object.fromEntries(CATALGOS[cat]);
    const existingForCat = existing[cat] ? Object.fromEntries(existing[cat]) : defaultWeights;
    const rowsForCat = byCat[cat] || [];
    const result = refitCategory(cat, ids, rowsForCat, existingForCat);
    if (result.skipped) {
      console.log(`${cat}: skipped — ${result.reason}`);
    } else {
      console.log(`${cat}: REFIT accepted — n=${result.n}, heldout AUC ${result.newAuc.toFixed(3)} vs current ${result.baseAuc.toFixed(3)}`);
      out[cat] = result.weights;
      changed = true;
    }
  }

  if (!changed) {
    console.log('No category cleared the gate this run — leaving weights.json untouched.');
    return;
  }

  await writeFile(OUT, JSON.stringify(out));
  console.log('wrote', OUT, out);
  await bumpSW();
}

/* ================= E1: synthetic mode (fit from eval triplets) ================= */
// Bridges the cold-start gap before 150 human ratings exist: the eval already produced triplets
// (A,B,C) with an LLM judge's verdict on which is closer to A. We turn each into a pairwise ranking
// example and fit the SAME per-category logistic weights, so the engine learns to agree with the
// judge. Any category that reaches >=150 real human ratings ignores synthetic data (priority rule).

async function loadTriplets() {
  try { return JSON.parse(await readFile(TRIPLETS, 'utf8')); } catch { return {}; }
}

// human ratings per category — soft (no key -> treat as zero, so synthetic just runs everywhere).
async function humanRatingCounts() {
  if (!KEY) { console.log('no SB_SERVICE_KEY — treating human-rating counts as 0 (synthetic runs for all categories)'); return {}; }
  try {
    const r = await fetch(`${SB}/rest/v1/ratings?select=cat,r`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
    if (!r.ok) { console.log('ratings count fetch failed', r.status, '— treating as 0'); return {}; }
    const rows = await r.json();
    const c = {};
    for (const row of rows) { if (row && CATALGOS[row.cat] && (row.r === 1 || row.r === -1)) c[row.cat] = (c[row.cat] || 0) + 1; }
    return c;
  } catch { return {}; }
}

// one triplet -> [ +1 (winner-minus-loser), -1 (its mirror) ] feature rows, in `ids` order.
function syntheticRows(eng, ids, cat, t) {
  const A = eng.byId[t.a];
  const winner = eng.byId[t.winner === 'B' ? t.b : t.c];
  const loser  = eng.byId[t.winner === 'B' ? t.c : t.b];
  if (!A || !winner || !loser) return null;
  const pw = eng.parts(A, winner, cat), pl = eng.parts(A, loser, cat);
  const num = (v) => (typeof v === 'number' ? v : 0); // null signal -> 0, same as the ratings path
  const diff = ids.map((id) => num(pw[id]) - num(pl[id]));
  return [{ x: diff, y: 1 }, { x: diff.map((v) => -v), y: -1 }];
}

// Split by TRIPLET (not by row): a +1 row and its -1 mirror must never straddle the train/holdout
// boundary, or the holdout would be negated training rows and the AUC gate would pass trivially.
function refitCategorySynthetic(cat, ids, tripletRows, existingWeights) {
  const n = tripletRows.length;
  if (n < MIN_SYNTHETIC_TRIPLETS) return { skipped: true, reason: `only ${n} triplets, need ${MIN_SYNTHETIC_TRIPLETS}` };
  const order = shuffle([...Array(n).keys()]);
  const nHold = Math.max(6, Math.round(n * HOLDOUT_FRAC));
  const holdIdx = order.slice(0, nHold), trainIdx = order.slice(nHold);
  const flatten = (idxs) => { const X = [], y = []; for (const i of idxs) for (const r of tripletRows[i]) { X.push(r.x); y.push(r.y); } return { X, y }; };
  const { X: Xtr, y: ytr } = flatten(trainIdx);
  const { X: Xho, y: yho } = flatten(holdIdx);

  const { w, b } = fitLogistic(Xtr, ytr);
  const newAuc = auc(Xho.map((x) => dot(w, x, b)), yho);
  const baseW = ids.map((id) => existingWeights[id] || 0);
  const baseAuc = auc(Xho.map((x) => dot(baseW, x, 0)), yho); // how well the LIVE weights already rank winner>loser

  if (newAuc == null || baseAuc == null) return { skipped: true, reason: 'held-out split lacked both classes' };
  if (newAuc <= baseAuc) return { skipped: true, reason: `held-out AUC ${newAuc.toFixed(3)} did not beat current ${baseAuc.toFixed(3)}` };

  const finalWeights = clampAndRenormalize(w);
  return { skipped: false, weights: ids.map((id, i) => [id, Math.round(finalWeights[i] * 1000) / 1000]), newAuc, baseAuc, n };
}

async function mainSynthetic() {
  const triplets = await loadTriplets();
  const keys = Object.keys(triplets);
  if (!keys.length) { console.log('no eval triplets (eval/triplets.json empty/absent) — nothing to fit.'); return; }
  console.log('eval triplets loaded:', keys.length);

  const eng = await loadEngine({ root: ROOT });
  const humanCounts = await humanRatingCounts();
  const existing = await loadExistingWeights();

  const byCat = {};
  for (const key of keys) { const t = triplets[key]; if (t && CATALGOS[t.cat] && (t.winner === 'B' || t.winner === 'C')) (byCat[t.cat] = byCat[t.cat] || []).push(t); }

  const out = { ...existing }; // preserve whatever the ratings refit already set (human-owned cats)
  let changed = false;
  for (const cat of Object.keys(CATALGOS)) {
    const ids = CATALGOS[cat].map(([id]) => id);
    if ((humanCounts[cat] || 0) >= MIN_RATINGS) { console.log(`${cat}: ${humanCounts[cat]} human ratings >= ${MIN_RATINGS} — synthetic skipped (human refit owns it)`); continue; }
    const rows = (byCat[cat] || []).map((t) => syntheticRows(eng, ids, cat, t)).filter(Boolean);
    const defaultWeights = Object.fromEntries(CATALGOS[cat]);
    const existingForCat = existing[cat] ? Object.fromEntries(existing[cat]) : defaultWeights;
    const result = refitCategorySynthetic(cat, ids, rows, existingForCat);
    if (result.skipped) { console.log(`${cat}: synthetic skipped — ${result.reason}`); }
    else { console.log(`${cat}: SYNTHETIC refit accepted — ${result.n} triplets, heldout AUC ${result.newAuc.toFixed(3)} vs current ${result.baseAuc.toFixed(3)}`); out[cat] = result.weights; changed = true; }
  }

  if (!changed) { console.log('No category cleared the synthetic gate this run — leaving weights.json untouched.'); return; }
  await writeFile(OUT, JSON.stringify(out));
  console.log('wrote', OUT, out);
  await bumpSW();
}

(SYNTHETIC ? mainSynthetic() : main()).catch((e) => { console.error(e); process.exit(1); });
