/* Muse — on-demand local search ("🔎 Buscar mais perto de mim").  Vercel Node function.
 *
 * POST /api/search  { lat, lng, sid }
 *   1. Snaps the family to the nearest municipality (cities.json) and its ~50 km grid cell.
 *   2. Asks Supabase (muse_search_begin) whether a search may run: the cell may already have fresh
 *      results (shared with everyone nearby for 7 days), the device may have used its weekly search,
 *      or the day's spending cap may be reached.
 *   3. If allowed: four narrow web searches around the city run in parallel (music / festas+food / kids /
 *      outdoor+fairs). Each one's validated events are STREAMED to the app as soon as it finishes
 *      (NDJSON), so the family sees the first results in seconds instead of waiting for all four.
 *      Everything is then cached per cell. Fast model by default (LOCAL_MODEL, Haiku 5.5): someone
 *      is waiting; the weekly sweep uses the slower, more thorough model.
 *
 * Env: ANTHROPIC_API_KEY, MUSE_FN_SECRET (shared with Supabase muse_private), LOCAL_MODEL,
 *      MUSE_DAILY_BUDGET (USD, default 3), MUSE_SEARCH_KM (default 100).
 * The location is used only for this request; the database stores the city's grid cell and
 * salted hashes of the device id and network address, never the coordinates.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  askWithSearch, extractJSON, repairJSON, normalizeCandidate, verifySource, pool, dedupe,
  cityIndex, localPrompt, estimateCost, LOCAL_LENSES, brToday, addDays,
} from '../scripts/events.mjs';

const LOCAL_MODEL = process.env.LOCAL_MODEL || 'claude-haiku-5-5';

const SB = 'https://esviqajfbkdnpoohjpjt.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzdmlxYWpmYmtkbnBvb2hqcGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NzM1NzgsImV4cCI6MjA5OTQ0OTU3OH0.0C0oBrs0OjrcvxNdDVXeBtBs8KTVmgviGJkWffkFKj4'; // public, same as app.js
const HORIZON_DAYS = 14;

export const cellOf = (lat, lng) => `${Math.floor(lat * 2)}_${Math.floor(lng * 2)}`; // 0.5° ≈ 55 km

function haversine(aLat, aLng, bLat, bLng) {
  const R = 6371, r = Math.PI / 180;
  const h = Math.sin((bLat - aLat) * r / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin((bLng - aLng) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

let CITIES = null;
async function cities() {
  if (!CITIES) {
    const data = JSON.parse(await readFile(new URL('../cities.json', import.meta.url), 'utf8'));
    CITIES = { data, idx: cityIndex(data), list: data.c.map(([name, uf, lat, lng]) => ({ name, uf, lat, lng })) };
  }
  return CITIES;
}

const hash = (s) => createHash('sha256').update(String(process.env.MUSE_FN_SECRET) + '|' + s).digest('hex').slice(0, 32);
async function rpc(fn, args) {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_secret: process.env.MUSE_FN_SECRET, ...args }),
  });
  if (!r.ok) throw new Error(`supabase ${fn} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

// Runs the four lenses in parallel and calls onBatch(newEvents) as each one finishes.
export async function searchAround(place, { km, today, acc, onBatch = () => {} }) {
  const to = addDays(today, HORIZON_DAYS);
  const { idx } = await cities();
  const all = [];
  await Promise.all(Object.keys(LOCAL_LENSES).map(async (lens) => {
    const tag = `local ${place.name}/${place.uf} · ${lens}`;
    let list = [];
    try {
      const text = await askWithSearch(localPrompt(place, lens, today, to, km),
        { maxSearches: 4, maxTokens: 5000, effort: 'low', model: LOCAL_MODEL, tag, acc });
      list = extractJSON(text);
      if (!Array.isArray(list)) list = await repairJSON(text, undefined, { model: LOCAL_MODEL, acc });
      if (!Array.isArray(list)) list = [];
    } catch (e) { console.error(tag, e.message); }
    const found = [];
    for (const raw of list) {
      const r = normalizeCandidate(raw, { cities: idx, src: 'local', today, until: to });
      if (!r.ok) continue;
      if (haversine(place.lat, place.lng, r.ev.lat, r.ev.lng) > km + 60) continue; // the model drifted too far
      found.push(r.ev);
    }
    const checked = await pool(found, 8, async (ev) => ({ ev, err: await verifySource(ev, { timeoutMs: 4000 }) }));
    const fresh = dedupe([...all, ...checked.filter((c) => !c.err).map((c) => c.ev)]).filter((e) => !all.includes(e));
    all.push(...fresh);
    if (fresh.length) onBatch(fresh);
  }));
  return dedupe(all);
}

export async function POST(request) {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.MUSE_FN_SECRET) return json({ status: 'off' }, 503);
  let body; try { body = await request.json(); } catch { return json({ status: 'bad' }, 400); }
  const lat = Number(body && body.lat), lng = Number(body && body.lng), sid = String((body && body.sid) || '').slice(0, 64);
  if (!(lat > -34.5 && lat < 6 && lng > -74.5 && lng < -28.5) || sid.length < 6) return json({ status: 'bad' }, 400);

  const { list } = await cities();
  let place = list[0], best = Infinity;
  for (const c of list) { const k = haversine(lat, lng, c.lat, c.lng); if (k < best) { best = k; place = c; } }
  const cell = cellOf(place.lat, place.lng);
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';

  let gate;
  try {
    gate = await rpc('muse_search_begin', { p_cell: cell, p_sid: hash('sid:' + sid), p_ip: hash('ip:' + ip),
      p_daily_budget: Number(process.env.MUSE_DAILY_BUDGET || 3) });
  } catch (e) { console.error(e.message); return json({ status: 'error' }, 502); }
  if (!gate || gate.status !== 'go') return json({ ...(gate || { status: 'error' }), place: `${place.name}/${place.uf}` });

  const acc = { calls: 0, input: 0, output: 0, searches: 0 };
  const km = Number(process.env.MUSE_SEARCH_KM || 100);
  const t0 = Date.now();
  const enc = new TextEncoder();
  const place1 = `${place.name}/${place.uf}`;
  // NDJSON stream: {"type":"start"} then {"type":"events","events":[...]} per finished lens, then {"type":"done",...}
  const stream = new ReadableStream({
    async start(ctl) {
      const send = (o) => { try { ctl.enqueue(enc.encode(JSON.stringify(o) + String.fromCharCode(10))); } catch {} };
      send({ type: 'start', place: place1 });
      let events = [], ok = false;
      try {
        events = await searchAround(place, { km, today: brToday(), acc, onBatch: (evs) => send({ type: 'events', events: evs }) });
        ok = acc.calls > 0;
      } catch (e) { console.error('search failed', e.message); }
      const cost = +estimateCost(acc, LOCAL_MODEL).toFixed(4);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`local search ${place1} cell ${cell}: ${events.length} events, $${cost}, ${secs}s`, JSON.stringify(acc));
      try {
        await rpc('muse_search_finish', { p_log_id: gate.log_id, p_ok: ok, p_cost: cost, p_cell: cell,
          p_lat: place.lat, p_lng: place.lng, p_place: place1, p_events: events });
      } catch (e) { console.error(e.message); }
      send(ok ? { type: 'done', status: 'done', place: place1, count: events.length } : { type: 'done', status: 'error' });
      ctl.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
}
