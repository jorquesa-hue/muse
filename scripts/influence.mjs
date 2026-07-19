/* Muse — E6 lineage/influence graph. For each catalog item, find its 40 nearest neighbours in the
 * live embedding space, then ask a cheap bulk LLM (Haiku) which of THOSE (and only those) are direct
 * influences on the item or spiritual kin. Restricting the answer to the provided neighbour ids keeps
 * it grounded — the model can't invent an edge to something not in the catalog. Edges are cached by id
 * in edges.json (the shipped, precached graph) and built incrementally (MAX_ITEMS/run).
 *
 * app.js / engine-port.mjs turn edges.json into an undirected adjacency and score lineageSim = 1.0 for
 * a direct edge, 0.5 for a shared neighbour, else null (a 0.05-weight nudge in CATALGOS + crossScore).
 *
 * Env: ANTHROPIC_API_KEY (required), BULK_MODEL (default Haiku), MAX_ITEMS (400), NEIGHBORS (40),
 *      MAX_EDGES (4), INFLUENCE_CONCURRENCY (4), DRY_RUN=1 (mock LLM -> edges.dryrun.json). Node 20+.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = ROOT + 'data.json';
const EMB = ROOT + 'embeddings.b64.json';
const EDGES = ROOT + 'edges.json';
const SW = ROOT + 'sw.js';

const API_KEY = process.env.ANTHROPIC_API_KEY;
const BULK_MODEL = process.env.BULK_MODEL || 'claude-haiku-4-5-20251001';
const MAX_ITEMS = +(process.env.MAX_ITEMS || 400);
const NEIGHBORS = +(process.env.NEIGHBORS || 40);
const MAX_EDGES = +(process.env.MAX_EDGES || 4);
const CONCURRENCY = Math.max(1, +(process.env.INFLUENCE_CONCURRENCY || 4));
const DRY_RUN = process.env.DRY_RUN === '1';
const CAT_ORDER = ['movies', 'tv', 'books', 'music', 'games', 'anime', 'food', 'travel'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- nearest neighbours via the live Int8 embedding (same decode as embed.mjs) ---------- */
function loadEmb(j) {
  const buf = Buffer.from(j.data, 'base64');
  const arr = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const idx = Object.create(null); j.ids.forEach((id, i) => { idx[id] = i; });
  return { arr, idx, dim: j.dim, ids: j.ids };
}
function neighbors(emb, row, n) {
  const { arr, dim, ids } = emb;
  const oa = row * dim;
  const scored = new Array(ids.length);
  for (let s = 0; s < ids.length; s++) {
    if (s === row) { scored[s] = { i: s, d: -1e9 }; continue; }
    const ob = s * dim; let dot = 0;
    for (let k = 0; k < dim; k++) dot += arr[oa + k] * arr[ob + k];
    scored[s] = { i: s, d: dot };
  }
  scored.sort((p, q) => q.d - p.d);
  return scored.slice(0, n).map((x) => ids[x.i]);
}

/* ---------- LLM (mirror enrich/vibe callAnthropic) ---------- */
let emptyLogged = 0;
async function callAnthropic(p) {
  // 256 tokens is ample for a JSON array of <=4 ids and leaves margin so the array is never
  // truncated mid-string (a truncated `[...]` fails parseIds' complete-array match -> dropped edges).
  const body = { model: BULK_MODEL, max_tokens: 256, messages: [{ role: 'user', content: p }] };
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
      if (!txt && emptyLogged < 5) { emptyLogged++; console.error(`  [empty LLM] stop=${j.stop_reason}`); }
      return txt;
    }
    if (res.status === 429 || res.status >= 500) { await sleep(800 * 2 ** attempt); continue; }
    throw new Error(`Anthropic API ${res.status}: ${await res.text().catch(() => '')}`);
  }
  throw new Error('Anthropic API: exhausted retries');
}

function describe(it) {
  const bits = [`"${it.t}"${it.y ? ' (' + it.y + ')' : ''}`, it._cat];
  if (it.by) bits.push('by ' + it.by);
  if (Array.isArray(it.g) && it.g.length) bits.push(it.g.slice(0, 3).join('/'));
  return bits.join(' — ');
}
function buildPrompt(it, nbrs, byId) {
  const list = nbrs.map((id) => { const n = byId[id]; return `${id}: ${n ? n.t : id}${n && n.y ? ' (' + n.y + ')' : ''} [${n ? n._cat : '?'}]`; }).join('\n');
  return (
    `Work: ${describe(it)}\n\n` +
    `Below are candidate related works (id: title). Pick the ones that are DIRECT INFLUENCES on the ` +
    `work above, or its clear SPIRITUAL KIN (same lineage/tradition — a "descended from" relationship), ` +
    `NOT merely superficially similar. Choose at most ${MAX_EDGES}. If none qualify, return an empty ` +
    `array.\n\nCandidates:\n${list}\n\n` +
    `Return ONLY a JSON array of the chosen ids (from the list above, exact strings), e.g. ["mv-x-tmdb","bk-y"]. Nothing else.`
  );
}
function parseIds(txt, allowed) {
  if (!txt) return [];
  const m = String(txt).match(/\[[\s\S]*?\]/); let arr = [];
  if (m) { try { arr = JSON.parse(m[0]); } catch { arr = []; } }
  if (!Array.isArray(arr)) arr = [];
  const out = []; const seen = new Set();
  for (const x of arr) { if (typeof x === 'string' && allowed.has(x) && !seen.has(x)) { seen.add(x); out.push(x); } }
  return out.slice(0, MAX_EDGES);
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

async function main() {
  const data = JSON.parse(await readFile(DATA, 'utf8'));
  const items = []; const byId = Object.create(null);
  for (const cat of CAT_ORDER) for (const it of (data[cat] || [])) { it._cat = cat; if (it.id) { items.push(it); byId[it.id] = it; } }

  let embJson;
  try { embJson = JSON.parse(await readFile(EMB, 'utf8')); } catch { console.error('FATAL: embeddings.b64.json required for neighbours.'); process.exit(1); }
  const emb = loadEmb(embJson);

  let edges = {};
  try { edges = JSON.parse(await readFile(EDGES, 'utf8')); } catch { edges = {}; }

  // process items that are embedded and not yet in the edges cache
  const missing = items.filter((it) => emb.idx[it.id] != null && !(it.id in edges));
  const batch = missing.slice(0, MAX_ITEMS);
  console.log(`influence: ${items.length} items, ${Object.keys(edges).length} cached, ${missing.length} missing; processing ${batch.length}${DRY_RUN ? ' [DRY_RUN]' : ''}`);
  if (batch.length && !DRY_RUN && !API_KEY) { console.error('FATAL: ANTHROPIC_API_KEY not set and uncached items remain.'); process.exit(1); }

  let done = 0, withEdges = 0, sinceFlush = 0;
  const flush = async () => { await writeFile(DRY_RUN ? ROOT + 'edges.dryrun.json' : EDGES, JSON.stringify(edges), 'utf8'); };

  await pool(batch, CONCURRENCY, async (it) => {
    const nbrs = neighbors(emb, emb.idx[it.id], NEIGHBORS);
    const allowed = new Set(nbrs);
    let ids;
    if (DRY_RUN || !API_KEY) { ids = nbrs.filter((id) => (byId[id] && byId[id]._cat) === it._cat).slice(0, 2); } // mock: 2 same-cat neighbours
    else { try { ids = parseIds(await callAnthropic(buildPrompt(it, nbrs, byId)), allowed); } catch (e) { console.error(`  [call failed] ${it.id}: ${e.message}`); return; } }
    edges[it.id] = ids;
    if (ids.length) withEdges++;
    if (++done % 50 === 0) console.log(`  ${done}/${batch.length}`);
    if (++sinceFlush >= 50) { sinceFlush = 0; await flush(); }
  });

  await flush();
  const totalEdges = Object.values(edges).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
  console.log(`done: ${Object.keys(edges).length} items in graph, ${withEdges} newly given edges, ${totalEdges} total edges`);

  if (!DRY_RUN) {
    let sw = await readFile(SW, 'utf8');
    const m = sw.match(/muse-v(\d+)/);
    if (m) { const next = `muse-v${parseInt(m[1], 10) + 1}`; sw = sw.replace(/muse-v\d+/g, next); await writeFile(SW, sw, 'utf8'); console.log('sw ->', next); }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { neighbors, parseIds, loadEmb };
