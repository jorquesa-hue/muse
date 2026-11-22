/* Muse — family events pipeline for Brazil (runs in GitHub Actions: .github/workflows/events.yml).
 *
 * Builds events.json, the only data the app reads. Two modes:
 *   node scripts/events.mjs            daily, no API calls: drops finished events, re-expands the
 *                                      confirmed calendar seeds (incl. weekly fairs) for the window.
 *   node scripts/events.mjs --discover twice a week: Claude (web search tool) (1) confirms the dates of
 *                                      calendar/festivals-br.json seeds whose usual months are near, and
 *                                      (2) searches each region for family events in the next 14 days.
 *
 * Nothing the model returns is published unchecked. Every candidate must have: a category we know,
 * concrete dates overlapping the window, a municipality that exists in cities.json (that is where the
 * coordinates come from — the model never supplies lat/lng), and a source URL that resolves (404/410/
 * DNS failure = dropped; bot walls 401/403/429 are tolerated because the page was seen in search).
 * When the source page is plain HTML with real text, at least one distinctive word of the title must
 * appear in it. Adults-only events are dropped. Near-duplicates are merged.
 *
 * Env: ANTHROPIC_API_KEY (discover only), EVENTS_MODEL, WEB_SEARCH_TOOL, DRY_RUN=1 (write
 * events.dryrun.json), SKIP_URL_CHECK=1 (local tests where the sandbox can't reach event sites),
 * MOCK_FILE=path (canned model answers {seeds:[...], regions:{SP:[...]}} — no API).
 * Node 20+. No dependencies.
 */
import { readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url).pathname;
const EVENTS_FILE = ROOT + 'events.json';
const SEEDS_FILE = ROOT + 'calendar/festivals-br.json';
const STATE_FILE = ROOT + 'calendar/state.json';
const CITIES_FILE = ROOT + 'cities.json';

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.EVENTS_MODEL || 'claude-haiku-5-5';
const SEARCH_TOOL = process.env.WEB_SEARCH_TOOL || 'web_search_20250305';
const DRY = process.env.DRY_RUN === '1';
const SKIP_URL_CHECK = process.env.SKIP_URL_CHECK === '1';
const MOCK_FILE = process.env.MOCK_FILE || '';
const DISCOVER = process.argv.includes('--discover');

const DISCOVER_DAYS = 14;          // open search horizon
const SEED_LOOKAHEAD_DAYS = 60;    // calendar seeds are confirmed this far ahead
const KEEP_DAYS = 60;              // events.json never holds anything starting later than this
const MAX_SPAN_DAYS = 130;         // longer "events" (e.g. a whole season) are rejected as malformed
const SEED_RECHECK_DAYS = 14, WEEKLY_RECHECK_DAYS = 30;
const SEEDS_PER_CALL = 6;

export const CATS = ['music', 'food', 'festas', 'kids', 'outdoor', 'fairs'];
const REGIONS = [['SP'], ['RJ', 'ES'], ['MG'], ['PR', 'SC'], ['RS'], ['BA', 'SE', 'AL'], ['PE', 'PB', 'RN'], ['CE', 'PI', 'MA'], ['DF', 'GO', 'TO', 'MS', 'MT'], ['PA', 'AM', 'AP', 'RR', 'RO', 'AC']];

/* ---------------- small utils ---------------- */
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fb; } };
export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const brToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
export const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
const weekday = (ymd) => new Date(ymd + 'T12:00:00Z').getUTCDay();
const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00Z'));
const slug = (s) => fold(s).replace(/ /g, '-').slice(0, 60);
const clip = (s, n) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, n) : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- cities ---------------- */
export function cityIndex(cities) {
  const m = new Map();
  for (const [name, uf, lat, lng] of cities.c) m.set(uf + '|' + fold(name), { name, uf, lat, lng });
  return m;
}
export function findCity(idx, city, uf) {
  if (!city || !uf) return null;
  const U = String(uf).toUpperCase().trim();
  const f = fold(city).replace(/^(municipio de|cidade de) /, '');
  return idx.get(U + '|' + f) || idx.get(U + '|' + f.replace(/ d[aeo]s? /g, ' ')) || null;
}

/* ---------------- Claude (web search) ---------------- */
async function post(body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) { if (attempt === 4) throw e; await sleep(1000 * 2 ** attempt); continue; }
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(2000 * 2 ** attempt); continue; }
    throw new Error(`Anthropic API ${res.status}: ${(await res.text().catch(() => '')).slice(0, 400)}`);
  }
  throw new Error('Anthropic API: retries exhausted');
}

let usage = { calls: 0, input: 0, output: 0, searches: 0 };
async function askWithSearch(prompt, { maxSearches = 6, maxTokens = 8000 } = {}) {
  const tools = [{ type: SEARCH_TOOL, name: 'web_search', max_uses: maxSearches,
    user_location: { type: 'approximate', country: 'BR', timezone: 'America/Sao_Paulo' } }];
  const messages = [{ role: 'user', content: prompt }];
  let text = '';
  for (let turn = 0; turn < 4; turn++) {
    const res = await post({ model: MODEL, max_tokens: maxTokens, tools, messages });
    usage.calls++; usage.input += res.usage?.input_tokens || 0; usage.output += res.usage?.output_tokens || 0;
    usage.searches += res.usage?.server_tool_use?.web_search_requests || 0;
    text += (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    // long searches can pause mid-turn: hand the partial turn back unchanged and let it continue
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
    break;
  }
  return text;
}

export function extractJSON(text) {
  const tagged = [...String(text).matchAll(/<json>([\s\S]*?)<\/json>/g)].pop();
  const fenced = [...String(text).matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].pop();
  const raw = (tagged && tagged[1]) || (fenced && fenced[1]) || '';
  try { return JSON.parse(raw.trim()); } catch { return null; }
}

const ITEM_SHAPE = `{"title":"nome do evento","cat":"music|food|festas|kids|outdoor|fairs","start":"YYYY-MM-DD","end":"YYYY-MM-DD","time":"HH:MM ou null","venue":"local","city":"município","uf":"SP","price":"free|paid|unknown","priceText":"ex. Gratuito, R$ 40 ou null","kids":"yes|unknown","url":"https://página-fonte","d":{"pt":"descrição curta, até 150 caracteres","en":"short description","es":"descripción corta"}}`;

const CAT_GUIDE = `Categorias, em ordem de prioridade: music = festivais de música, shows ao ar livre e apresentações musicais; food = festivais e festas gastronômicas; festas = festas populares e tradicionais (Natal, juninas, carnaval, festas religiosas de rua); kids = programação infantil, teatro e cinema para crianças; outdoor = atividades ao ar livre (balonismo, flores, parques, esportes abertos ao público); fairs = feiras culturais, de livros e de artesanato.`;

function discoverPrompt(ufs, states, today, to) {
  const names = ufs.map((u) => `${states[u]} (${u})`).join(', ');
  return `Você é o curador da agenda do Muse, um app para famílias no Brasil escolherem um passeio de um dia. Hoje é ${today} (horário de Brasília).

Use a busca na web para encontrar eventos FAMILIARES — bons para crianças e adultos juntos — acontecendo entre ${today} e ${to} em: ${names}.

${CAT_GUIDE} Festivais de música são o foco principal: procure-os primeiro.

Regras:
- Só eventos com datas concretas dentro do período e uma página-fonte que você realmente viu (site oficial, prefeitura, bilheteria ou imprensa).
- Exclua eventos +18, baladas, eventos corporativos, missas/cultos regulares e eventos online.
- Cubra cidades do interior também, não só a capital. No máximo 25 eventos.
- Não invente nada. Na dúvida, deixe de fora. Descrições escritas por você, sem copiar texto da fonte.

Responda APENAS com um array JSON entre <json> e </json>. Cada item:
${ITEM_SHAPE}`;
}

function seedPrompt(seeds, today, to) {
  const list = seeds.map((s) => s.when.weekly
    ? `- id "${s.id}": ${s.name} — ${s.city}/${s.uf} — feira/evento semanal, normalmente nos dias da semana ${JSON.stringify(s.when.weekly)} (0 = domingo)`
    : `- id "${s.id}": ${s.name} — ${s.city}/${s.uf} — costuma acontecer nos meses ${JSON.stringify(s.when.months)}`).join('\n');
  return `Hoje é ${today} (horário de Brasília). Use a busca na web para verificar cada evento recorrente abaixo:

${list}

Para os anuais: existe uma edição com datas acontecendo entre ${today} e ${to}? Quais as datas exatas?
Para os semanais: ainda acontece regularmente? Em quais dias da semana, horário e local?

Só confirme o que uma fonte vista por você confirma (site oficial, prefeitura ou imprensa recente). Se não houver edição no período, ou não for possível confirmar, use status "none". Descrições escritas por você.

Responda APENAS com um array JSON entre <json> e </json>, um item por id:
{"id":"id da lista","status":"confirmed|none","occurrences":[{"start":"YYYY-MM-DD","end":"YYYY-MM-DD"}],"weekly":[0,6] ou null,"time":"HH:MM ou null","venue":"local","city":"município","uf":"UF","price":"free|paid|unknown","priceText":"... ou null","url":"https://página-fonte","d":{"pt":"até 150 caracteres","en":"...","es":"..."}}
Para semanais use "weekly" e deixe "occurrences" vazio.`;
}

/* ---------------- source URL check ---------------- */
const urlCache = new Map();
const STOP = new Set(['festival', 'festa', 'feira', 'brasil', 'show', 'shows', 'evento', 'edicao', 'nacional', 'internacional', 'municipal', 'cidade', 'para', 'com', 'dos', 'das', 'del', 'the']);
const titleTokens = (t) => fold(t).split(' ').filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w));

async function checkUrl(url) {
  if (urlCache.has(url)) return urlCache.get(url);
  let out = { ok: false, status: 0, text: '', img: null };
  if (SKIP_URL_CHECK) { out = { ok: true, status: 200, text: '', img: null }; urlCache.set(url, out); return out; }
  try {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 12000);
    const res = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: {
      'user-agent': 'Mozilla/5.0 (compatible; MuseEventsBot/1.0; +https://muse-find.com)',
      'accept': 'text/html,application/xhtml+xml', 'accept-language': 'pt-BR,pt;q=0.9' } });
    clearTimeout(timer);
    out.status = res.status;
    if (res.ok) {
      const ct = res.headers.get('content-type') || '';
      const html = ct.includes('html') ? (await res.text()).slice(0, 600000) : '';
      const og = html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
      if (og) { try { const u = new URL(og[1], res.url); if (u.protocol === 'https:' && u.href.length < 500) out.img = u.href; } catch {} }
      out.text = fold(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
      out.ok = true;
    } else {
      out.ok = [401, 403, 429, 503].includes(res.status); // bot walls: the page exists, it was seen in search
    }
  } catch { out.ok = false; }
  urlCache.set(url, out);
  return out;
}

/* ---------------- validation ---------------- */
export function normalizeCandidate(raw, { cities, src, today, until }) {
  const why = (r) => ({ ok: false, why: r, title: raw && raw.title });
  if (!raw || typeof raw !== 'object') return why('not an object');
  const title = clip(raw.title, 120); if (!title) return why('no title');
  const cat = CATS.includes(raw.cat) ? raw.cat : null; if (!cat) return why('bad cat ' + raw.cat);
  if (!isYmd(raw.start)) return why('bad start');
  const end = isYmd(raw.end) ? raw.end : raw.start;
  if (end < raw.start) return why('end<start');
  if (daysBetween(raw.start, end) > MAX_SPAN_DAYS) return why('span too long');
  if (end < today || raw.start > until) return why('outside window');
  if (raw.kids === 'no' || /\+ ?18|maiores de 18|adults only|proibido para menores/i.test(JSON.stringify(raw))) return why('adults only');
  const place = findCity(cities, raw.city, raw.uf); if (!place) return why(`unknown city ${raw.city}/${raw.uf}`);
  let url; try { url = new URL(raw.url); } catch { return why('bad url'); }
  if (!/^https?:$/.test(url.protocol)) return why('bad url scheme');
  const d = {}; for (const l of ['pt', 'en', 'es']) { const v = clip(raw.d && raw.d[l], 220); if (v) d[l] = v; }
  const time = typeof raw.time === 'string' && /^\d{1,2}:\d{2}$/.test(raw.time) ? raw.time.padStart(5, '0') : null;
  return { ok: true, ev: {
    id: `${slug(title)}-${slug(place.name)}-${raw.start}`, t: title, cat, start: raw.start, end, time,
    venue: clip(raw.venue, 120), city: place.name, uf: place.uf, lat: place.lat, lng: place.lng,
    price: ['free', 'paid'].includes(raw.price) ? raw.price : 'unknown', priceText: clip(raw.priceText, 60),
    kids: raw.kids === 'yes' ? 'yes' : 'unknown', url: url.href, img: null, d, src, seen: today,
  } };
}

async function verifySource(ev) {
  const page = await checkUrl(ev.url);
  if (!page.ok) return `source unreachable (${page.status || 'network'})`;
  const toks = titleTokens(ev.t);
  if (page.text.length > 3000 && toks.length && !toks.some((w) => page.text.includes(w))) return 'source page does not mention the event';
  if (page.img) ev.img = page.img;
  return null;
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

/* ---------------- dedupe / merge ---------------- */
function jaccard(a, b) { const A = new Set(a), B = new Set(b); let n = 0; for (const x of A) if (B.has(x)) n++; return n / Math.max(1, A.size + B.size - n); }
export function dedupe(events) {
  const kept = [];
  for (const ev of events.sort((a, b) => (b.seen || '').localeCompare(a.seen || '') || (a.src === 'calendar' ? -1 : 1))) {
    const tk = titleTokens(ev.t);
    const dup = kept.find((k) => k.uf === ev.uf && k.city === ev.city && k.start <= ev.end && ev.start <= k.end
      && (k.id === ev.id || jaccard(tk, titleTokens(k.t)) >= 0.6));
    if (!dup) kept.push(ev);
  }
  return kept;
}

/* ---------------- calendar seeds ---------------- */
function seedsDue(seeds, state, today) {
  const monthsAhead = new Set(); for (let i = 0; i <= SEED_LOOKAHEAD_DAYS; i += 7) monthsAhead.add(+addDays(today, i).slice(5, 7));
  monthsAhead.add(+addDays(today, SEED_LOOKAHEAD_DAYS).slice(5, 7));
  return seeds.filter((s) => {
    const st = state.seeds[s.id];
    if (s.when.weekly) return !st || daysBetween(st.checked, today) >= WEEKLY_RECHECK_DAYS;
    if (!(s.when.months || []).some((m) => monthsAhead.has(m))) return false;
    return !st || daysBetween(st.checked, today) >= SEED_RECHECK_DAYS;
  });
}

// confirmed seed state -> dated events for the window (weekly fairs become one event per day they run)
function expandSeeds(seeds, state, cities, today, until) {
  const out = [];
  const horizon = addDays(today, DISCOVER_DAYS);
  for (const s of seeds) {
    const st = state.seeds[s.id]; if (!st || st.status !== 'confirmed' || !st.data) continue;
    const base = { ...st.data, title: s.name, cat: s.cat, kids: 'yes' };
    const dates = [];
    if (Array.isArray(st.data.weekly) && st.data.weekly.length) {
      for (let d = today; d <= horizon; d = addDays(d, 1)) if (st.data.weekly.includes(weekday(d))) dates.push({ start: d, end: d });
    } else for (const o of st.data.occurrences || []) dates.push(o);
    for (const o of dates) {
      const r = normalizeCandidate({ ...base, start: o.start, end: o.end || o.start }, { cities, src: 'calendar', today, until });
      if (r.ok) { r.ev.seen = st.checked; r.ev.img = st.img || null; if (st.data.weekly) r.ev.weekly = true; out.push(r.ev); }
    }
  }
  return out;
}

async function confirmSeeds(due, state, today, mock) {
  const to = addDays(today, SEED_LOOKAHEAD_DAYS);
  for (let i = 0; i < due.length; i += SEEDS_PER_CALL) {
    const batch = due.slice(i, i + SEEDS_PER_CALL);
    let answer;
    if (mock) answer = mock.seeds || [];
    else {
      try { answer = extractJSON(await askWithSearch(seedPrompt(batch, today, to), { maxSearches: 2 * batch.length })); }
      catch (e) { console.error('seed batch failed:', e.message); continue; }
    }
    if (!Array.isArray(answer)) { console.error('seed batch: unparseable answer'); continue; }
    for (const s of batch) {
      const a = answer.find((x) => x && x.id === s.id);
      const confirmed = a && a.status === 'confirmed' && a.url && ((Array.isArray(a.weekly) && a.weekly.length) || (Array.isArray(a.occurrences) && a.occurrences.length));
      let img = null;
      if (confirmed) {
        const page = await checkUrl(a.url);
        if (!page.ok) { state.seeds[s.id] = { checked: today, status: 'none', why: `source ${page.status || 'network'}` }; continue; }
        img = page.img;
      }
      state.seeds[s.id] = confirmed
        ? { checked: today, status: 'confirmed', img, data: { occurrences: a.occurrences || [], weekly: Array.isArray(a.weekly) && a.weekly.length ? a.weekly.filter((d) => d >= 0 && d <= 6) : null,
            time: a.time, venue: a.venue, city: a.city || s.city, uf: a.uf || s.uf, price: a.price, priceText: a.priceText, url: a.url, d: a.d } }
        : { checked: today, status: 'none' };
    }
  }
}

/* ---------------- open discovery ---------------- */
async function discoverRegions(states, cities, today, mock) {
  const to = addDays(today, DISCOVER_DAYS);
  const found = [], rejected = {};
  for (const ufs of REGIONS) {
    let list;
    if (mock) list = (mock.regions && mock.regions[ufs[0]]) || [];
    else {
      try { list = extractJSON(await askWithSearch(discoverPrompt(ufs, states, today, to), { maxSearches: 6 })); }
      catch (e) { console.error(`region ${ufs.join('/')} failed:`, e.message); continue; }
    }
    if (!Array.isArray(list)) { console.error(`region ${ufs.join('/')}: unparseable answer`); continue; }
    for (const raw of list) {
      if (raw && raw.uf && !ufs.includes(String(raw.uf).toUpperCase())) { rejected['wrong state'] = (rejected['wrong state'] || 0) + 1; continue; }
      const r = normalizeCandidate(raw, { cities, src: 'search', today, until: to });
      if (r.ok) found.push(r.ev); else rejected[r.why.split(' ')[0]] = (rejected[r.why.split(' ')[0]] || 0) + 1;
    }
    console.log(`region ${ufs.join('/')}: ${list.length} candidates`);
  }
  const checked = await pool(found, 6, async (ev) => ({ ev, err: await verifySource(ev) }));
  const ok = checked.filter((c) => !c.err).map((c) => c.ev);
  for (const c of checked) if (c.err) { console.log(`  drop "${c.ev.t}": ${c.err}`); rejected.source = (rejected.source || 0) + 1; }
  return { ok, rejected };
}

/* ---------------- main ---------------- */
async function main() {
  const today = brToday();
  const until = addDays(today, KEEP_DAYS);
  const citiesData = await readJSON(CITIES_FILE, null);
  if (!citiesData) throw new Error('cities.json missing');
  const cities = cityIndex(citiesData);
  const seeds = (await readJSON(SEEDS_FILE, { seeds: [] })).seeds;
  const state = await readJSON(STATE_FILE, { seeds: {} }); state.seeds = state.seeds || {};
  const prev = await readJSON(EVENTS_FILE, { events: [] });
  const mock = MOCK_FILE ? await readJSON(MOCK_FILE, null) : null;

  // keep previously discovered (already validated) events that are still current
  let searchEvents = (prev.events || []).filter((e) => e.src === 'search' && e.end >= today && e.start <= until);
  let report = { mode: DISCOVER ? 'discover' : 'prune' };

  if (DISCOVER) {
    if (!API_KEY && !mock) throw new Error('ANTHROPIC_API_KEY is required for --discover (or set MOCK_FILE)');
    const due = seedsDue(seeds, state, today);
    console.log(`calendar: ${due.length} seeds to confirm`);
    await confirmSeeds(due, state, today, mock);
    const { ok, rejected } = await discoverRegions(citiesData.states, cities, today, mock);
    searchEvents = searchEvents.concat(ok);
    report = { ...report, seedsChecked: due.length, discovered: ok.length, rejected, usage };
  }

  const calendarEvents = expandSeeds(seeds, state, cities, today, until);
  const events = dedupe([...calendarEvents, ...searchEvents])
    .sort((a, b) => a.start.localeCompare(b.start) || a.cat.localeCompare(b.cat) || a.t.localeCompare(b.t));

  const out = { generated: new Date().toISOString(), today, until, count: events.length, events };
  await writeFile(DRY ? ROOT + 'events.dryrun.json' : EVENTS_FILE, JSON.stringify(out));
  if (!DRY) await writeFile(STATE_FILE, JSON.stringify(state, null, 1));

  const byCat = Object.fromEntries(CATS.map((c) => [c, events.filter((e) => e.cat === c).length]));
  const nCal = events.filter((e) => e.src === 'calendar').length;
  const summary = `events: ${events.length} (${nCal} calendar, ${events.length - nCal} search) · ${JSON.stringify(byCat)} · ${JSON.stringify(report)}`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `## Muse events\n\n${summary}\n`, { flag: 'a' });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
