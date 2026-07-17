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

const ROOT = new URL('..', import.meta.url).pathname;
const OUT  = ROOT + 'weights.json';
const SW   = ROOT + 'sw.js';
const SB   = 'https://esviqajfbkdnpoohjpjt.supabase.co';
const KEY  = process.env.SB_SERVICE_KEY;

// Mirrors app.js's CATALGOS (must stay in sync — same convention as refresh.mjs independently
// maintaining its own genre-mapping tables rather than importing from app.js in this no-build-step
// project). Only the algo IDS and their DEFAULT weights matter here (the id list defines which
// `parts` fields this category's feature vector is built from; the weights are the fallback
// baseline a refit must beat when no weights.json exists yet).
const CATALGOS = {
  movies:[['emb',.22],['theme',.20],['mood',.20],['genre',.15],['craft',.13],['creator',.10],['era',.08],['audience',.08],['culture',.06]],
  tv:    [['emb',.22],['theme',.20],['mood',.20],['genre',.15],['craft',.13],['creator',.08],['era',.08],['audience',.10],['culture',.06]],
  books: [['emb',.22],['theme',.22],['mood',.20],['genre',.14],['craft',.14],['creator',.08],['era',.08],['audience',.08],['culture',.06]],
  music: [['emb',.22],['craft',.22],['mood',.20],['genre',.16],['theme',.12],['creator',.08],['era',.10],['audience',.06],['culture',.06]],
  games: [['emb',.22],['craft',.22],['genre',.18],['mood',.16],['theme',.12],['creator',.06],['era',.08],['audience',.10],['culture',.08]],
  anime: [['emb',.22],['theme',.18],['mood',.18],['genre',.16],['craft',.14],['creator',.12],['era',.08],['audience',.08],['srcdem',.06]],
  food:  [['emb',.22],['craft',.26],['ing',.12],['tech',.06],['genre',.14],['mood',.14],['theme',.10],['culture',.12],['audience',.06]],
  travel:[['emb',.22],['craft',.24],['vibe',.14],['mood',.16],['theme',.12],['genre',.12],['climate',.08],['culture',.08],['audience',.06]],
};

const MIN_RATINGS = 150;
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

async function main() {
  const rows = await fetchRatings();
  console.log('ratings fetched:', rows.length);
  const existing = await loadExistingWeights();

  const byCat = {};
  for (const r of rows) { if (!r || !CATALGOS[r.cat] || (r.r !== 1 && r.r !== -1) || !r.parts) continue; (byCat[r.cat] = byCat[r.cat] || []).push(r); }

  const out = {};
  let changed = false;
  for (const cat of Object.keys(CATALGOS)) {
    const ids = CATALGOS[cat].map(([id]) => id);
    const defaultWeights = Object.fromEntries(CATALGOS[cat]);
    const existingForCat = existing[cat] ? Object.fromEntries(existing[cat]) : defaultWeights;
    const rowsForCat = byCat[cat] || [];
    const result = refitCategory(cat, ids, rowsForCat, existingForCat);
    if (result.skipped) {
      console.log(`${cat}: skipped — ${result.reason}`);
      if (existing[cat]) out[cat] = existing[cat]; // keep whatever was already live
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

  let sw = await readFile(SW, 'utf8');
  const m = sw.match(/muse-v(\d+)/);
  if (m) { const next = `muse-v${parseInt(m[1], 10) + 1}`; sw = sw.replace(/muse-v\d+/g, next); await writeFile(SW, sw, 'utf8'); console.log('sw ->', next); }
}
main().catch((e) => { console.error(e); process.exit(1); });
