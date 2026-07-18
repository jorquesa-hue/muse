/* Muse — build vibe.b64.json (E2): an "atmosphere embedding" that matches works by *feel* rather
 * than facts, so cross-media recommendations lean on mood/energy/texture instead of shared genre
 * words. Runs in GitHub Actions (weekly, after embed.yml; workflow_dispatch).
 *
 * Two stages:
 *   1. TEXTS — for each catalog item, a cheap bulk LLM (BULK_MODEL, default Haiku) writes a <=45-word
 *      descriptor of the item's EXPERIENTIAL ATMOSPHERE ONLY (mood, energy, texture, palette, tempo,
 *      emotional aftertaste — no plot, names, or genre words). Cached by item id in vibe/texts.json
 *      and generated INCREMENTALLY: a run only calls the LLM for items missing a cached text, so
 *      re-runs are nearly free and MAX_ITEMS chips away at any backlog across runs.
 *   2. EMBED — every item that HAS a text is embedded through the exact same local MiniLM path as
 *      embed.mjs (mean-pool + L2-normalize + Int8 quantize + base64 pack) and written to vibe.b64.json
 *      in the identical {dim, ids, data} shape app.js's loadVibe()/vibeSim() expect. Items still
 *      awaiting a text are simply absent from ids (vibeSim() returns null for them and the engine
 *      drops the vibe term from that pair's blend — graceful, no gap to fill).
 *
 * Env: ANTHROPIC_API_KEY (required — the only place this repo calls an LLM at build time),
 *      BULK_MODEL (default claude-haiku-4-5-20251001), MAX_ITEMS (per-run cap on NEW texts, default
 *      400), VIBE_CONCURRENCY (4). Node 20+.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pipeline } from '@xenova/transformers';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = ROOT + 'data.json';
const TEXTS = ROOT + 'vibe/texts.json';
const OUT = ROOT + 'vibe.b64.json';
const SW = ROOT + 'sw.js';

const API_KEY = process.env.ANTHROPIC_API_KEY;
const BULK_MODEL = process.env.BULK_MODEL || 'claude-haiku-4-5-20251001';
const MAX_ITEMS = +(process.env.MAX_ITEMS || 400);
const CONCURRENCY = Math.max(1, +(process.env.VIBE_CONCURRENCY || 4));
const MODEL = 'Xenova/all-MiniLM-L6-v2';
const DIM = 384;
const MAX_WORDS = 45;

/* ---------- quantize / pack: DUPLICATED VERBATIM from scripts/embed.mjs ----------
 * These MUST stay byte-for-byte identical to embed.mjs's l2normalize()/quantize() and the base64
 * pack in its main(): both files feed the SAME decode path (app.js loadEmb()/loadVibe() reinterpret
 * atob(data) as an Int8Array and do dot/(127*127)). If you change the format in one file, change it
 * in the other in the same commit. */
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
/* ---------- end duplicated block ---------- */

// Context we hand the LLM so it understands the work — but we ask it to output ONLY atmosphere, none
// of these facts. (Mirrors eval.mjs describe(): title/year/by/genres/themes/short description.)
function context(it) {
  const bits = [`${it.t}${it.y ? ' (' + it.y + ')' : ''}`];
  if (it.by) bits.push('by ' + it.by);
  const g = (Array.isArray(it.g) ? it.g : []);
  const th = (Array.isArray(it.th) ? it.th : []);
  if (g.length) bits.push('genres: ' + g.slice(0, 5).join(', '));
  if (th.length) bits.push('themes: ' + th.slice(0, 6).join(', '));
  const d = it.d && (it.d.en || it.d.es || it.d.pt);
  if (d) bits.push(String(d).slice(0, 220));
  return bits.join(' — ');
}

function prompt(it) {
  return (
    `You write one short "atmosphere descriptor" for a creative work, used by a recommendation ` +
    `engine that matches works by how they FEEL rather than by shared facts.\n\n` +
    `Work: ${context(it)}\n\n` +
    `Write at most ${MAX_WORDS} words describing ONLY the experiential atmosphere — its mood, ` +
    `emotional energy, texture, colour palette, tempo and pacing, and the emotional aftertaste it ` +
    `leaves. Do NOT mention the plot, characters, names, title, creators, setting specifics, or any ` +
    `genre/medium words (no "film", "novel", "game", "album", etc.). No preamble, no quotes — just ` +
    `the descriptor as a single flowing phrase.`
  );
}

// clamp to <=MAX_WORDS defensively (the model is asked to, but enforce it so a runaway reply can't
// bloat the text corpus / embedding input).
function clampWords(s) {
  const words = String(s).trim().replace(/\s+/g, ' ').split(' ');
  return words.length <= MAX_WORDS ? words.join(' ') : words.slice(0, MAX_WORDS).join(' ');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let emptyLogged = 0;
async function callAnthropic(p) {
  // mirrors eval.mjs callAnthropic(): retry on network/429/5xx, join ALL text blocks (a model may
  // prepend a non-text block), max_tokens generous so the descriptor is never truncated mid-phrase.
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
      if (!txt && emptyLogged < 8) { emptyLogged++; console.error(`  [empty response #${emptyLogged}] stop_reason=${j.stop_reason} blocks=${JSON.stringify((j.content || []).map((b) => b && b.type))} usage=${JSON.stringify(j.usage)}`); }
      return txt;
    }
    if (res.status === 429 || res.status >= 500) { await sleep(800 * 2 ** attempt); continue; }
    throw new Error(`Anthropic API ${res.status}: ${await res.text().catch(() => '')}`);
  }
  throw new Error('Anthropic API: exhausted retries');
}

// bounded-concurrency map (same shape as eval.mjs pool())
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

async function main() {
  const data = JSON.parse(await readFile(DATA, 'utf8'));
  const items = [];
  for (const cat of Object.keys(data)) for (const it of data[cat]) items.push(it);

  // load existing texts cache (incremental — only generate what's missing)
  let texts = {};
  try { texts = JSON.parse(await readFile(TEXTS, 'utf8')); } catch { texts = {}; }

  const missing = items.filter((it) => it.id && !(texts[it.id] && String(texts[it.id]).trim()));
  console.log(`vibe: ${items.length} items, ${items.length - missing.length} cached texts, ${missing.length} missing`);

  const batch = missing.slice(0, MAX_ITEMS);
  if (batch.length < missing.length) console.log(`NOTE: capping this run at MAX_ITEMS=${MAX_ITEMS}; ${missing.length - batch.length} items deferred to a later run.`);

  if (batch.length && !API_KEY) {
    console.error('FATAL: ANTHROPIC_API_KEY not set and uncached items remain. Set the secret to generate vibe texts.');
    process.exit(1);
  }

  // stage 1: generate atmosphere texts, flushing the cache periodically so a timeout mid-run keeps
  // whatever was already produced (Haiku calls are the expensive part — never redo them).
  let done = 0, produced = 0, sinceFlush = 0;
  await pool(batch, CONCURRENCY, async (it) => {
    const raw = await callAnthropic(prompt(it));
    const t = clampWords(raw);
    if (t) { texts[it.id] = t; produced++; }
    if (++done % 25 === 0) console.log(`  texts ${done}/${batch.length}`);
    if (++sinceFlush >= 25) { sinceFlush = 0; await mkdir(ROOT + 'vibe', { recursive: true }); await writeFile(TEXTS, JSON.stringify(texts, null, 0)); }
  });
  await mkdir(ROOT + 'vibe', { recursive: true });
  await writeFile(TEXTS, JSON.stringify(texts, null, 0));
  console.log(`stage 1 done: produced ${produced} new texts, ${Object.keys(texts).length} total cached`);

  // stage 2: embed every item that has a text, in catalog order, through the MiniLM path.
  const embItems = items.filter((it) => it.id && texts[it.id] && String(texts[it.id]).trim());
  if (!embItems.length) { console.log('no vibe texts yet — nothing to embed, leaving vibe.b64.json untouched.'); return; }
  console.log(`embedding ${embItems.length} vibe texts with ${MODEL}...`);
  const extractor = await pipeline('feature-extraction', MODEL);

  const ids = new Array(embItems.length);
  const flat = new Uint8Array(embItems.length * DIM);
  for (let i = 0; i < embItems.length; i++) {
    const out = await extractor(texts[embItems[i].id], { pooling: 'mean', normalize: true });
    const raw = Array.from(out.data).slice(0, DIM);
    const bytes = quantize(l2normalize(raw));
    flat.set(bytes, i * DIM);
    ids[i] = embItems[i].id;
    if (i % 500 === 0) console.log(`  ${i}/${embItems.length}`);
  }

  const b64 = Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength).toString('base64');
  const packed = { dim: DIM, ids, data: b64 };
  await writeFile(OUT, JSON.stringify(packed));
  console.log(`wrote ${OUT}: ${ids.length} items, ${(flat.byteLength / 1024 / 1024).toFixed(2)} MB raw / ${(b64.length / 1024 / 1024).toFixed(2)} MB b64`);

  // bump the SW cache version so returning users re-fetch the shell + the new vibe blob (same as embed.mjs).
  let sw = await readFile(SW, 'utf8');
  const m = sw.match(/muse-v(\d+)/);
  if (m) { const next = `muse-v${parseInt(m[1], 10) + 1}`; sw = sw.replace(/muse-v\d+/g, next); await writeFile(SW, sw, 'utf8'); console.log('sw ->', next); }
}
main().catch((e) => { console.error(e); process.exit(1); });
