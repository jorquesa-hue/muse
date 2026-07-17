/* Muse — build embeddings.b64.json (runs in GitHub Actions, weekly after refresh; workflow_dispatch).
 * Embeds every catalog item's text with a small local sentence-transformer model (no API key —
 * @xenova/transformers runs the ONNX model on CPU), quantizes to signed Int8, and packs the
 * result into the exact base64 blob app.js's loadEmb()/embSim() expect (app.js:323-329):
 *   loadEmb(): Int8Array over atob(data)'s raw bytes, EMB_DIM = j.dim, EMB_IDX[id] = row index.
 *   embSim():  dot(rowA, rowB) / (127*127)  — this is only a correct cosine approximation because
 *              each row is a UNIT-NORM float vector quantized as round(v*127); see quantize() below.
 * Re-embeds the WHOLE catalog every run (simple + correct, and — by construction — this is also
 * how daily-ingested live items get embedded: they're already in data.json by the time this runs).
 * Node 20+.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { pipeline } from '@xenova/transformers';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = ROOT + 'data.json';
const OUT  = ROOT + 'embeddings.b64.json';
const SW   = ROOT + 'sw.js';
const MODEL = 'Xenova/all-MiniLM-L6-v2';
const DIM = 384;

function itemText(it) {
  const by = it.by ? 'by ' + it.by : '';
  // a handful of stale live-ingested (`-x`) records predate ingest.mjs's own Array.isArray guard
  // and still carry a bare string for `g`/`th` — match that same guard here rather than assume shape.
  const g = (Array.isArray(it.g) ? it.g : []).join(', ');
  const th = (Array.isArray(it.th) ? it.th : []).join(', ');
  const en = (it.d && it.d.en) || '';
  return [it.t, by, g, th, en].filter(Boolean).join(' — ');
}

// L2-normalize, then map each float component to a signed int in [-127,127] (round(v*127) —
// unit-norm components are always well within that range in practice, but clamp defensively),
// then re-express as an UNSIGNED byte (twos-complement) since that's what gets base64-packed and
// later reinterpreted as Int8Array on the decode side.
function l2normalize(vec) {
  let sum = 0; for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum) || 1;
  return vec.map((v) => v / norm);
}
function quantize(vec) {
  const out = new Uint8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    let q = Math.round(vec[i] * 127);
    if (q > 127) q = 127; else if (q < -127) q = -127;
    out[i] = q < 0 ? q + 256 : q;
  }
  return out;
}

async function main() {
  const data = JSON.parse(await readFile(DATA, 'utf8'));
  const items = [];
  for (const cat of Object.keys(data)) for (const it of data[cat]) items.push(it);
  console.log(`embedding ${items.length} items with ${MODEL}...`);

  const extractor = await pipeline('feature-extraction', MODEL);

  const ids = new Array(items.length);
  const flat = new Uint8Array(items.length * DIM);
  for (let i = 0; i < items.length; i++) {
    const text = itemText(items[i]);
    // one item at a time: the single-input {pooling:'mean'} shape is the library's documented,
    // version-stable usage — batched-array output shapes vary more across versions.
    const out = await extractor(text, { pooling: 'mean', normalize: true });
    const raw = Array.from(out.data).slice(0, DIM);
    const bytes = quantize(l2normalize(raw)); // re-normalize defensively even though normalize:true was requested
    flat.set(bytes, i * DIM);
    ids[i] = items[i].id;
    if (i % 500 === 0) console.log(`  ${i}/${items.length}`);
  }

  const b64 = Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength).toString('base64');
  const out = { dim: DIM, ids, data: b64 };
  await writeFile(OUT, JSON.stringify(out));
  console.log(`wrote ${OUT}: ${ids.length} items, ${(flat.byteLength / 1024 / 1024).toFixed(2)} MB raw / ${(b64.length / 1024 / 1024).toFixed(2)} MB b64`);

  let sw = await readFile(SW, 'utf8');
  const m = sw.match(/muse-v(\d+)/);
  if (m) { const next = `muse-v${parseInt(m[1], 10) + 1}`; sw = sw.replace(/muse-v\d+/g, next); await writeFile(SW, sw, 'utf8'); console.log('sw ->', next); }
}
main().catch((e) => { console.error(e); process.exit(1); });
