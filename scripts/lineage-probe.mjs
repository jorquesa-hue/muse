/* Muse — E6 lineage probe. Measures whether the lineage signal actually helps: for a set of anchors
 * A that have a known influence/kin edge to B, does the engine rank B ABOVE a random C (same category
 * as B, but NOT lineage-connected to A) more often WITH the lineage signal than WITHOUT it?
 *
 * This is a purely mechanical, no-API probe (no judge) — it toggles the engine's edge graph on/off via
 * _setEdges and recomputes the same triplets, so it isolates the lineage term's effect. Same-category
 * pairs use score(); cross-media pairs use crossScore() — exactly what ships (engine-port.mjs).
 *
 * C is a COMPETITIVE rival, not a random item: a random same-category pick is almost always far less
 * similar to A than B (a near-neighbour influence), so B wins regardless and the probe measures noise.
 * We instead rank B's category by the base (lineage-off) similarity to A and take a mid-rank rival, so
 * the lineage edge can actually decide the pairing. (Against a random negative the population effect is
 * only ~+2pt and swamped by n=60 sampling noise; against a genuine rival it is ~+7pt and stable.)
 *
 * Triplets are SEEDED (mulberry32) from the edges file, so the probe set is stable run-to-run.
 *
 * Ship gate (runbook E6): withLineage's B-above-C rate is >= withoutLineage + 1.0 pt.
 *
 * Env: EDGES_FILE (edges.json), N (60), PROBE_SEED, OUT (eval/lineage-probe.json). No API, Node 18+.
 */
import { loadEngine, _setEdges } from './engine-port.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const EDGES_FILE = process.env.EDGES_FILE || 'edges.json';
const N = +(process.env.N || 300);   // 300 samples the ~+7pt population effect stably; n=60 is too noisy
const SEED = +(process.env.PROBE_SEED || 0x1a2b3c4d);
const OUT = process.env.OUT || (ROOT + 'eval/lineage-probe.json');

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Undirected adjacency from an edges.json map (id -> [influence ids]) — mirrors engine loadEdges.
function buildAdj(j) {
  const adj = Object.create(null); const add = (x, y) => { (adj[x] || (adj[x] = new Set())).add(y); };
  for (const id in j) { const es = j[id]; if (!Array.isArray(es)) continue; for (const e of es) if (e && e !== id) { add(id, e); add(e, id); } }
  return adj;
}

async function main() {
  const eng = await loadEngine({ edgesFile: EDGES_FILE });
  const { byId, D, CAT_ORDER, score, crossScore } = eng;

  let edgeJson;
  try { edgeJson = JSON.parse(await readFile(ROOT + EDGES_FILE, 'utf8')); }
  catch { console.error(`FATAL: cannot read ${EDGES_FILE} — build it with influence.mjs first.`); process.exit(1); }
  const adj = buildAdj(edgeJson);

  // per category: the pool of item ids present in byId, sorted for determinism
  const catPool = Object.create(null);
  for (const cat of CAT_ORDER) catPool[cat] = (D[cat] || []).map((it) => it.id).filter((id) => byId[id]);

  // anchors = ids with >=1 neighbour that is also in the catalog; sorted so the seeded shuffle is stable
  const anchors = Object.keys(adj).filter((a) => byId[a] && [...adj[a]].some((b) => byId[b])).sort();
  const rng = mulberry32(SEED);
  // Fisher–Yates over a copy so anchor order is seeded but reproducible
  for (let i = anchors.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [anchors[i], anchors[j]] = [anchors[j], anchors[i]]; }

  // pair score: same category -> score().total; cross-media -> crossScore(). B and C share a category,
  // so a triplet always uses one consistent function for both (A,B) and (A,C).
  const pairScore = (X, Y) => (X._cat === Y._cat ? score(X, Y, X._cat).total : crossScore(X, Y));

  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const triplets = [];
  // C must be a GENUINE competitor, not a random item: a random same-category item is almost always
  // far less similar to A than B (a near-neighbour influence), so B wins with or without lineage and
  // the probe measures nothing. Instead pick C from a competitive band — sort B's category by the
  // BASE (lineage-OFF) similarity to A and take a mid-rank rival (ranks ~8-40). Then lineage's edge
  // to B can actually decide the pairing, which is exactly what we want to measure.
  _setEdges(null);   // score the candidate pool on base signals only while selecting C
  for (let pass = 0; pass < 4 && triplets.length < N; pass++) {
    for (const a of anchors) {
      if (triplets.length >= N) break;
      const A = byId[a];
      const kin = [...adj[a]].filter((b) => byId[b]);
      if (!kin.length) continue;
      const b = pick(kin); const B = byId[b];
      const pool = catPool[B._cat].filter((id) => id !== a && id !== b && !(adj[a] && adj[a].has(id)));
      if (!pool.length) continue;
      const ranked = pool.map((id) => [id, pairScore(A, byId[id])]).sort((x, y) => y[1] - x[1]);
      const idx = Math.min(ranked.length - 1, 8 + Math.floor(rng() * 32));   // competitive rival, seeded
      const C = byId[ranked[idx][0]];
      triplets.push({ A, B, C });
    }
  }

  const rate = () => {
    let win = 0;
    for (const { A, B, C } of triplets) if (pairScore(A, B) > pairScore(A, C)) win++;
    return triplets.length ? (100 * win / triplets.length) : 0;
  };

  _setEdges(adj);                    // lineage ON
  const withLineage = rate();
  _setEdges(null);                   // lineage OFF (signal absent -> no prior -> contributes nothing)
  const withoutLineage = rate();

  const delta = +(withLineage - withoutLineage).toFixed(2);
  const report = {
    n: triplets.length,
    withLineage: +withLineage.toFixed(2),
    withoutLineage: +withoutLineage.toFixed(2),
    delta,
    pass: delta >= 1,
    edgesFile: EDGES_FILE,
  };
  await mkdir(ROOT + 'eval/', { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 2));

  const line = `lineage probe: n=${report.n}  withLineage=${report.withLineage}%  withoutLineage=${report.withoutLineage}%  Δ=${delta >= 0 ? '+' : ''}${delta}pt  ${report.pass ? 'PASS' : 'FAIL'}`;
  console.log(line);
  console.log(`wrote ${OUT}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, `## Muse lineage probe\n\n${line}\n`, { flag: 'a' });
  }
  if (!report.pass) process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { buildAdj, mulberry32 };
