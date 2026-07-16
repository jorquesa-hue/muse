/* Muse — daily ingest of live "misses" into the catalog.
 * When someone searches a title that isn't local, the app finds it live (Wikipedia/Wikidata),
 * derives its features, and logs the finished item to Supabase `searches`. This job folds those
 * into data.json permanently, so tomorrow they're instant + offline. Dedups by normalized title.
 * Node 18+ (global fetch). No secrets — the Supabase anon key is public (RLS: searches is insert+select for anon).
 */
import { readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = ROOT + 'data.json';
const SW   = ROOT + 'sw.js';
const SB   = 'https://esviqajfbkdnpoohjpjt.supabase.co';
const KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzdmlxYWpmYmtkbnBvb2hqcGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NzM1NzgsImV4cCI6MjA5OTQ0OTU3OH0.0C0oBrs0OjrcvxNdDVXeBtBs8KTVmgviGJkWffkFKj4';

const normT = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const VALID = new Set(['movies','tv','books','music','games','anime','food','travel']);

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

  let added = 0; const perCat = {};
  for(const row of rows){
    const cat = row.cat; const it = row.item;
    if(!VALID.has(cat) || !it || typeof it !== 'object' || !it.t) continue;
    const nt = normT(it.t);
    if(!nt || seen[cat].has(nt)) continue;          // already in the catalog (or added earlier this run)
    seen[cat].add(nt);
    delete it._cat; delete it._live;                // strip client-only fields
    if(!it.x || typeof it.x !== 'object') it.x = {};
    if(!Array.isArray(it.g) || !it.g.length) continue;   // needs at least a genre to be matchable
    let id = (typeof it.id === 'string' && it.id) ? it.id : ('sr-'+cat+'-'+nt.replace(/ /g,'-'));
    let base = id, i = 2; while(ids.has(id)){ id = base+i; i++; }
    it.id = id; ids.add(id);
    data[cat].push(it); added++; perCat[cat] = (perCat[cat]||0)+1;
  }
  console.log('added:', added, perCat);
  if(!added){ console.log('No new titles — leaving files untouched.'); return; }

  await writeFile(DATA, JSON.stringify(data), 'utf8');
  let sw = await readFile(SW, 'utf8');
  const m = sw.match(/muse-v(\d+)/);
  if(m){ const next = `muse-v${parseInt(m[1],10)+1}`; sw = sw.replace(/muse-v\d+/g, next); await writeFile(SW, sw, 'utf8'); console.log('sw ->', next); }
  console.log('before', before);
  console.log('after ', Object.fromEntries(Object.keys(data).map(k=>[k,data[k].length])));
}
main().catch(e=>{ console.error(e); process.exit(1); });
