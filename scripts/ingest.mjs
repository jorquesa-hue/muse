/* Muse — daily ingest of live "misses" into the catalog.
 * When someone searches a title that isn't local, the app finds it live (Wikipedia/Wikidata),
 * derives its features, and logs the finished item to Supabase `searches`. This job folds those
 * into data.json permanently, so tomorrow they're instant + offline. Dedups by normalized title.
 * Node 18+ (global fetch).
 * `searches.item` is anonymous, attacker-reachable input (RLS: anon INSERT with no shape check) —
 * clean() below whitelists/coerces every field before it can enter the catalog served to all users.
 *
 * Read auth: prefers SB_SERVICE_KEY (a service_role key, set as a GitHub Actions secret) so the
 * `searches` table can be locked down to deny anon SELECT (see supabase/migrations/ — anon can
 * currently read every user's search history through the public anon key, an active privacy
 * leak). Falls back to the historical public anon key when the secret isn't set yet, so this
 * script keeps working unchanged until the migration is actually applied.
 */
import { readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = ROOT + 'data.json';
const SW   = ROOT + 'sw.js';
const SB   = 'https://esviqajfbkdnpoohjpjt.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzdmlxYWpmYmtkbnBvb2hqcGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NzM1NzgsImV4cCI6MjA5OTQ0OTU3OH0.0C0oBrs0OjrcvxNdDVXeBtBs8KTVmgviGJkWffkFKj4';
const KEY = process.env.SB_SERVICE_KEY || ANON_KEY;
if (!process.env.SB_SERVICE_KEY) console.warn('SB_SERVICE_KEY not set — reading via the public anon key (fine until the searches-table RLS migration is applied; see supabase/migrations/).');

const normT = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const VALID = new Set(['movies','tv','books','music','games','anime','food','travel']);
const MAX_ADDED_PER_RUN = 200;                            // bound nightly catalog growth from anon input
const IMG_HOSTS = new Set(['image.tmdb.org','covers.openlibrary.org','upload.wikimedia.org']);

// Strictly validate + coerce an anon-submitted searches.item before it can enter the served
// catalog. Every field is whitelisted and type/range-checked; nothing is trusted verbatim.
// Returns a clean item object, or null if it isn't usable.
function clean(it){
  if(!it || typeof it !== 'object') return null;
  const t = String(it.t||'').slice(0,80).trim();
  if(!t) return null;
  const g = (Array.isArray(it.g)?it.g:[]).filter(x=>typeof x==='string').slice(0,6).map(s=>s.slice(0,24));
  if(!g.length) return null;                              // needs at least a genre to be matchable
  const dna = (Array.isArray(it.dna) && it.dna.length===8 && it.dna.every(n=>Number.isFinite(+n)))
    ? it.dna.map(n=>Math.max(0,Math.min(100,Math.round(+n)))) : null;
  if(!dna) return null;
  const num = (v,lo,hi) => Number.isFinite(+v) ? Math.max(lo,Math.min(hi,Math.round(+v))) : 0;
  const str = (v,max) => typeof v==='string' ? v.slice(0,max) : '';
  let img = null;
  try{ const u = new URL(it.img); if(u.protocol==='https:' && IMG_HOSTS.has(u.host)) img = u.href; }catch{}
  const o = {
    t, alt: [], cast: [],
    y: Number.isFinite(+it.y) ? Math.trunc(+it.y) : null,
    by: str(it.by,80),
    g, th: (Array.isArray(it.th)?it.th:[]).filter(x=>typeof x==='string').slice(0,6).map(s=>s.slice(0,24)),
    dna,
    pop: num(it.pop,0,100), acc: num(it.acc,0,100), main: num(it.main,0,100),
    hue: Number.isFinite(+it.hue) ? Math.trunc(+it.hue) % 360 : 222,
    c: str(it.c,40),
    d: { en: str(it.d&&it.d.en,300), es: str(it.d&&it.d.es,300), pt: str(it.d&&it.d.pt,300) },
    img,
    tl: { en: str(it.tl&&it.tl.en,80)||t, es: str(it.tl&&it.tl.es,80)||t, pt: str(it.tl&&it.tl.pt,80)||t },
    x: (it.x && typeof it.x==='object' && JSON.stringify(it.x).length<1500) ? it.x : {},
  };
  return JSON.stringify(o).length <= 4000 ? o : null;      // hard cap on per-item payload size
}

async function main(){
  const data = JSON.parse(await readFile(DATA, 'utf8'));
  const before = Object.fromEntries(Object.keys(data).map(k=>[k,data[k].length]));

  // read the last few days of logged searches (dedup handles overlap; a window bounds the read)
  const since = new Date(Date.now() - 4*24*3600*1000).toISOString();
  const url = `${SB}/rest/v1/searches?select=cat,title,item&created_at=gte.${encodeURIComponent(since)}&order=created_at.asc`;
  const r = await fetch(url, { headers: { apikey: KEY, Authorization: 'Bearer '+KEY } });
  if(!r.ok){ console.error('FATAL: Supabase read failed', r.status, await r.text().catch(()=> '')); process.exit(1); }
  const rows = await r.json();
  console.log('searches in window:', rows.length);

  const seen = {}, ids = new Set();
  for(const k of Object.keys(data)){ seen[k] = new Set(data[k].map(x=>normT(x.t))); data[k].forEach(x=>ids.add(x.id)); }

  let added = 0, rejected = 0; const perCat = {};
  for(const row of rows){
    if(added >= MAX_ADDED_PER_RUN) break;           // bound nightly catalog growth from anon input
    const cat = row.cat;
    if(!VALID.has(cat)) continue;
    const it = clean(row.item);
    if(!it){ rejected++; continue; }
    const nt = normT(it.t);
    if(!nt || seen[cat].has(nt)) continue;          // already in the catalog (or added earlier this run)
    seen[cat].add(nt);
    let id = 'sr-'+cat+'-'+nt.replace(/ /g,'-');    // always derive the id server-side — never trust a client-supplied one
    let base = id, i = 2; while(ids.has(id)){ id = base+i; i++; }
    it.id = id; ids.add(id);
    data[cat].push(it); added++; perCat[cat] = (perCat[cat]||0)+1;
  }
  console.log('added:', added, perCat, 'rejected:', rejected);
  if(!added){ console.log('No new titles — leaving files untouched.'); return; }

  await writeFile(DATA, JSON.stringify(data), 'utf8');
  let sw = await readFile(SW, 'utf8');
  const m = sw.match(/muse-v(\d+)/);
  if(m){ const next = `muse-v${parseInt(m[1],10)+1}`; sw = sw.replace(/muse-v\d+/g, next); await writeFile(SW, sw, 'utf8'); console.log('sw ->', next); }
  console.log('before', before);
  console.log('after ', Object.fromEntries(Object.keys(data).map(k=>[k,data[k].length])));
}
main().catch(e=>{ console.error(e); process.exit(1); });
