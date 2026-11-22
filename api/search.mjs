/* Muse — on-demand local search ("🔎 Buscar mais perto de mim").  Vercel Node function.
 *
 * POST /api/search  { lat, lng, sid }
 *   1. Snaps the family to the nearest municipality (cities.json) and its ~50 km grid cell.
 *   2. Asks Supabase (muse_search_begin) whether a search may run: the cell may already have fresh
 *      results (shared with everyone nearby for 7 days), the device may have used its weekly search,
 *      or the day's spending cap may be reached.
 *   3. If allowed: two web searches around the city (stage events / family activities), every candidate
 *      validated exactly like the weekly sweep (scripts/events.mjs), then cached per cell.
 *
 * Env: ANTHROPIC_API_KEY, MUSE_FN_SECRET (shared with Supabase muse_private), EVENTS_MODEL,
 *      MUSE_DAILY_BUDGET (USD, default 3), MUSE_SEARCH_KM (default 100).
 * The location is used only for this request; the database stores the city's grid cell and
 * salted hashes of the device id and network address, never the coordinates.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  MODEL, askWithSearch, extractJSON, repairJSON, normalizeCandidate, verifySource, pool, dedupe,
  cityIndex, localPrompt, estimateCost, LENSES, brToday, addDays,
} from '../scripts/events.mjs';

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

export async function searchAround(place, { km, today, acc }) {
  const to = addDays(today, HORIZON_DAYS);
  const { idx } = await cities();
  const lists = await Promise.all(Object.keys(LENSES).map(async (lens) => {
    const tag = `local ${place.name}/${place.uf} · ${lens}`;
    try {
      const text = await askWithSearch(localPrompt(place, lens, today, to, km), { maxSearches: 10, tag, acc });
      let list = extractJSON(text);
      if (!Array.isArray(list)) list = await repairJSON(text, undefined, { acc });
      return Array.isArray(list) ? list : [];
    } catch (e) { console.error(tag, e.message); return []; }
  }));
  const found = [];
  for (const raw of lists.flat()) {
    const r = normalizeCandidate(raw, { cities: idx, src: 'local', today, until: to });
    if (!r.ok) continue;
    if (haversine(place.lat, place.lng, r.ev.lat, r.ev.lng) > km + 60) continue; // the model drifted too far
    found.push(r.ev);
  }
  const checked = await pool(found, 6, async (ev) => ({ ev, err: await verifySource(ev) }));
  return dedupe(checked.filter((c) => !c.err).map((c) => c.ev));
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
  let events = [], ok = false;
  try { events = await searchAround(place, { km, today: brToday(), acc }); ok = acc.calls > 0; }
  catch (e) { console.error('search failed', e.message); }
  const cost = +estimateCost(acc, MODEL).toFixed(4);
  console.log(`local search ${place.name}/${place.uf} cell ${cell}: ${events.length} events, $${cost}`, JSON.stringify(acc));
  try {
    await rpc('muse_search_finish', { p_log_id: gate.log_id, p_ok: ok, p_cost: cost, p_cell: cell,
      p_lat: place.lat, p_lng: place.lng, p_place: `${place.name}/${place.uf}`, p_events: events });
  } catch (e) { console.error(e.message); }
  if (!ok) return json({ status: 'error' }, 502);
  return json({ status: 'done', place: `${place.name}/${place.uf}`, events });
}
