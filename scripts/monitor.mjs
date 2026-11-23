/* Muse — data files for the monitoring dashboard (daily via .github/workflows/metrics.yml).
 *
 * Writes monitor/*.json, each {rows, meta}: aggregated, non-identifying rows only (no session ids,
 * no hashes, no e-mails, no coordinates finer than a municipality).
 *   catalog.json      agenda events now published (events.json + approved organizer events)
 *   runs.json         one row per sweep run (Supabase pipeline_runs + monitor/runs-history.json)
 *   run_areas.json    per run and sweep area: calls, web searches, cost, candidates, valid, published
 *   searches.json     on-demand local searches (search_log): when, where, status, events, cost, seconds
 *   clicks.json       event-card interactions per day, UF, kind and category, with distinct sessions
 *   devices.json      distinct devices per day (interactions) and distinct searchers
 *   submissions.json  organizer submissions per day, UF and status
 * Env: SB_SERVICE_KEY (optional: without it only catalog and the run history are written). Node 20+.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = ROOT + 'monitor/';
const SB = 'https://esviqajfbkdnpoohjpjt.supabase.co';
const KEY = process.env.SB_SERVICE_KEY;
const DAYS = 120;

const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fb; } };
const day = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
const ufOf = (place) => { const m = /\/([A-Z]{2})$/.exec(place || ''); return m ? m[1] : null; };
const since = new Date(Date.now() - DAYS * 864e5).toISOString();

async function sb(path) {
  if (!KEY) return null;
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, Range: `${from}-${from + 999}` } });
    if (!r.ok) { console.error(`supabase ${path.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 160)}`); return out.length ? out : null; }
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

async function save(name, rows, origin) {
  const meta = [{ label: 'Origem', value: origin }, { label: 'Gerado em', value: new Date().toISOString() }];
  await writeFile(OUT + name, JSON.stringify({ rows, meta }));
  console.log(`${name}: ${rows.length} rows`);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  // ---- catalog
  const ev = (await readJSON(ROOT + 'events.json', { events: [] })).events || [];
  const org = (await sb(`published_events?select=id,event,end_date`)) || [];
  const catalog = [
    ...ev.map((e) => ({ id: e.id, uf: e.uf, city: e.city, cat: e.cat, src: e.src, start: e.start, end: e.end })),
    ...org.map((o) => ({ id: o.id, uf: o.event.uf, city: o.event.city, cat: o.event.cat, src: 'organizer', start: o.event.start, end: o.event.end || o.end_date })),
  ];
  await save('catalog.json', catalog, 'events.json (varredura + calendário) e published_events (organizadores)');

  // ---- sweep runs: logged rows, plus the runs before logging existed (read from their Actions logs)
  const hist = await readJSON(OUT + 'runs-history.json', { runs: [] });
  const db = (await sb(`pipeline_runs?select=*&order=run_at.asc`)) || [];
  const runs = [], areas = [];
  for (const r of [...hist.runs, ...db.map((d) => ({ ...d, source: 'pipeline_runs' }))]) {
    runs.push({
      run_at: r.run_at, day: day(r.run_at), mode: r.mode, model: r.model || '', calls: r.calls, searches: r.searches,
      input_tokens: r.input_tokens, output_tokens: r.output_tokens, cost_usd: Number(r.cost_usd), discovered: r.discovered,
      events_total: r.events_total, source: r.source || 'log', run_url: r.run_url || '',
    });
    for (const a of r.areas || []) {
      areas.push({ run_at: r.run_at, area: a.area, ufs: a.ufs, calls: a.calls ?? null, searches: a.searches ?? null,
        cost_usd: a.cost_usd ?? null, candidates: a.candidates, valid: a.valid, published: a.published ?? null, failed: a.failed || 0 });
    }
  }
  runs.sort((a, b) => a.run_at.localeCompare(b.run_at));
  await save('runs.json', runs, 'pipeline_runs (Supabase) e logs das rodadas anteriores no GitHub Actions');
  await save('run_areas.json', areas, 'pipeline_runs.areas');
  if (!KEY) return console.log('SB_SERVICE_KEY not set: usage files skipped');

  // ---- local searches
  const cache = (await sb(`area_cache?select=cell,place,searched_at,events`)) || [];
  const placeOfCell = Object.fromEntries(cache.map((c) => [c.cell, c.place]));
  let log = await sb(`search_log?select=created_at,cell,place,status,found,cost_usd,secs&created_at=gte.${since}&order=created_at.asc`);
  if (!log) log = (await sb(`search_log?select=created_at,cell,status,found,cost_usd&created_at=gte.${since}&order=created_at.asc`)) || [];
  const searches = log.map((s) => {
    const place = s.place || placeOfCell[s.cell] || '';
    return { at: s.created_at, day: day(s.created_at), place, uf: ufOf(place), cell: s.cell, status: s.status,
      found: s.found ?? 0, cost_usd: Number(s.cost_usd || 0), secs: s.secs == null ? null : Number(s.secs) };
  });
  await save('searches.json', searches, 'search_log (Supabase)');

  // ---- interactions and devices
  const clicks = (await sb(`event_clicks?select=created_at,sid,cat,kind,uf&created_at=gte.${since}`)) || [];
  const g = new Map(), dev = new Map();
  for (const c of clicks) {
    const d = day(c.created_at);
    const k = [d, c.uf || '', c.kind, c.cat].join('|');
    if (!g.has(k)) g.set(k, { day: d, uf: c.uf || '', kind: c.kind, cat: c.cat, n: 0, s: new Set() });
    const o = g.get(k); o.n++; o.s.add(c.sid);
    if (!dev.has(d)) dev.set(d, { sessions: new Set(), searchers: new Set() });
    dev.get(d).sessions.add(c.sid);
  }
  for (const s of log) {
    const d = day(s.created_at);
    if (!dev.has(d)) dev.set(d, { sessions: new Set(), searchers: new Set() });
  }
  const sidLog = (await sb(`search_log?select=created_at,sid_hash&created_at=gte.${since}`)) || [];
  for (const s of sidLog) dev.get(day(s.created_at))?.searchers.add(s.sid_hash);
  await save('clicks.json', [...g.values()].map(({ s, ...o }) => ({ ...o, sessions: s.size })).sort((a, b) => a.day.localeCompare(b.day)),
    'event_clicks (Supabase), sessões contadas, nunca listadas');
  await save('devices.json', [...dev.entries()].map(([d, o]) => ({ day: d, sessions: o.sessions.size, searchers: o.searchers.size })).sort((a, b) => a.day.localeCompare(b.day)),
    'event_clicks e search_log (Supabase)');

  // ---- organizer submissions
  const subs = (await sb(`event_submissions?select=created_at,status,event&created_at=gte.${since}`)) || [];
  const sg = new Map();
  for (const s of subs) {
    const k = [day(s.created_at), s.event?.uf || '', s.status].join('|');
    if (!sg.has(k)) sg.set(k, { day: day(s.created_at), uf: s.event?.uf || '', status: s.status, n: 0 });
    sg.get(k).n++;
  }
  await save('submissions.json', [...sg.values()], 'event_submissions (Supabase), sem contatos');
}

main().catch((e) => { console.error(e); process.exit(1); });
