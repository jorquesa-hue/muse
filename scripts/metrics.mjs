/* Muse — usage & health dashboard (runs daily via .github/workflows/metrics.yml).
 *
 * Pulls together every real signal the project already collects — nothing new is instrumented,
 * this just reads and renders what's there:
 *   - Supabase `ratings` / `searches` (service_role, same REST + env pattern as refit.mjs/ingest.mjs;
 *     RLS is insert-only for the public anon key — see supabase/migrations/…t24…sql — so this read
 *     ONLY happens here, server-side in Actions, never in the browser). `ratings.sid` (a random id
 *     the browser generates once per device via getSid(), localStorage-only) is the only session
 *     linkage the app has, so it's also the only source for RETENTION (does a taster come back on a
 *     later day?) and ENGAGEMENT DEPTH (how many ratings / how many categories per taster) — both
 *     computed here, never per-sid displayed, always folded into aggregate counts/buckets.
 *   - Vercel Web Analytics REST API (https://vercel.com/docs/analytics/web-analytics-api) — GEOGRAPHY
 *     (visitor country) and traffic volume. Vercel's product is deliberately non-identifying (no
 *     persistent visitor id exposed via the API), so this is aggregate-only by construction — there
 *     is no way to cross-reference a country with a taster's ratings even if we wanted to. Optional:
 *     needs VERCEL_TOKEN (a Vercel Access Token) AND Web Analytics turned on for the project in the
 *     Vercel dashboard (one-time, dashboard-only — no API for that part); degrades to a "not
 *     connected yet" placeholder section otherwise, same as every other optional signal here.
 *   - data.json — catalog size + metadata coverage per category.
 *   - eval/report.json — the weekly LLM-judge triplet-accuracy report (scripts/eval.mjs).
 *   - ig/queue.json — Instagram distribution progress.
 *
 * Writes metrics/history.json (one snapshot per day, capped to the last 180 entries — mirrors the
 * retention window already documented for the Supabase tables) and renders metrics/index.html, a
 * dependency-free static page (no JS, no external assets) styled to match the app's light theme.
 *
 * Env: SB_SERVICE_KEY, VERCEL_TOKEN (both optional — each section degrades gracefully to an empty/
 * placeholder state if its key is absent, never fatal, matching loadWeights()/loadEmb()'s convention).
 * Node 18+.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { EMO } from './ig-caption.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const SB = 'https://esviqajfbkdnpoohjpjt.supabase.co';
const KEY = process.env.SB_SERVICE_KEY;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const VERCEL_TEAM_ID = 'team_zh337tXixhvsa4rinCndAoKc';
const VERCEL_PROJECT_ID = 'prj_oI8NSLUV1yNzga7SjqBrp49If3Gz';
const OUT_DIR = ROOT + 'metrics';
const HISTORY_FILE = OUT_DIR + '/history.json';
const HTML_FILE = OUT_DIR + '/index.html';
const HISTORY_CAP = 180;

const CAT_ORDER = ['movies', 'tv', 'books', 'music', 'games', 'anime', 'food', 'travel'];
const CAT_LABEL = { movies: 'Movies', tv: 'TV', books: 'Books', music: 'Music', games: 'Games', anime: 'Anime', food: 'Food', travel: 'Travel' };

async function readJSON(path, fallback = null) { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; } }

async function fetchTable(table, select) {
  if (!KEY) return [];
  const url = `${SB}/rest/v1/${table}?select=${select}&order=created_at.asc&limit=50000`;
  try {
    const r = await fetch(url, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
    if (!r.ok) { console.error(`${table} fetch failed:`, r.status, await r.text().catch(() => '')); return []; }
    return r.json();
  } catch (e) { console.error(`${table} fetch error:`, e.message); return []; }
}

const round1 = (v) => Math.round(v * 10) / 10;
const dayKey = (iso) => String(iso || '').slice(0, 10); // YYYY-MM-DD (UTC, matches Supabase created_at)

/* ---------------- Vercel Web Analytics (geography + traffic) ---------------- */
async function vercelGet(path, params) {
  const qs = new URLSearchParams({ teamId: VERCEL_TEAM_ID, projectId: VERCEL_PROJECT_ID, ...params });
  const r = await fetch(`https://api.vercel.com/v1/query/web-analytics/${path}?${qs}`, { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } });
  if (!r.ok) { console.error(`vercel ${path} failed:`, r.status, await r.text().catch(() => '')); return null; }
  return r.json();
}
// ISO region code ("US", "BR"…) -> a display name, via Node's built-in ICU data (no lookup table to maintain).
const countryName = (code) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; } catch { return code; } };
async function fetchTraffic(since, until) {
  if (!VERCEL_TOKEN) return null;
  try {
    const [count, byCountry, byDevice] = await Promise.all([
      vercelGet('visits/count', { since, until }),
      vercelGet('visits/aggregate', { since, until, by: 'country', limit: '10' }),
      vercelGet('visits/aggregate', { since, until, by: 'deviceType', limit: '6' }),
    ]);
    if (!count) return null; // Web Analytics not enabled for the project, or the token is bad — degrade to "not connected"
    return {
      visitors: count.data?.visitors ?? null,
      pageviews: count.data?.pageviews ?? null,
      countries: (byCountry?.data || []).map((r) => ({ code: r.country, name: countryName(r.country), visitors: r.visitors })),
      devices: (byDevice?.data || []).map((r) => ({ type: r.deviceType || 'unknown', visitors: r.visitors })),
    };
  } catch (e) { console.error('vercel analytics error:', e.message); return null; }
}

/* ---------------- retention + engagement depth (per rating session id) ---------------- */
// How long a taster sticks around (span between their first and last RATED interaction — the only
// session-linked signal the app logs; browsing without ever rating leaves no trace here, so this
// undercounts pure lookers, same honest caveat as everywhere else this file says "of RATED matches")
// and how deep they go (ratings logged, distinct categories touched). Aggregate buckets only — no
// per-sid values ever leave this function.
function summarizeEngagement(rows) {
  const bySid = {};
  for (const r of rows) {
    if (!r.sid || !r.created_at) continue;
    const t = new Date(r.created_at).getTime(); if (Number.isNaN(t)) continue;
    const s = bySid[r.sid] || (bySid[r.sid] = { first: t, last: t, n: 0, cats: new Set() });
    if (t < s.first) s.first = t;
    if (t > s.last) s.last = t;
    s.n++;
    if (r.cat) s.cats.add(r.cat);
  }
  const tasters = Object.values(bySid);
  const total = tasters.length;
  const spanDays = tasters.map((s) => Math.floor((s.last - s.first) / 86400000));
  const returning = spanDays.filter((d) => d > 0).length;
  const returningSpans = spanDays.filter((d) => d > 0);
  const avgReturningSpanDays = returningSpans.length ? round1(returningSpans.reduce((s, v) => s + v, 0) / returningSpans.length) : null;

  const tenureBuckets = { 'Same day': 0, '2–7 days': 0, '8–30 days': 0, '30+ days': 0 };
  for (const d of spanDays) {
    if (d === 0) tenureBuckets['Same day']++;
    else if (d <= 7) tenureBuckets['2–7 days']++;
    else if (d <= 30) tenureBuckets['8–30 days']++;
    else tenureBuckets['30+ days']++;
  }

  const depthBuckets = { '1 rating': 0, '2–5 ratings': 0, '6–15 ratings': 0, '16+ ratings': 0 };
  for (const s of tasters) {
    if (s.n === 1) depthBuckets['1 rating']++;
    else if (s.n <= 5) depthBuckets['2–5 ratings']++;
    else if (s.n <= 15) depthBuckets['6–15 ratings']++;
    else depthBuckets['16+ ratings']++;
  }

  const breadthBuckets = { '1 category': 0, '2 categories': 0, '3+ categories': 0 };
  for (const s of tasters) {
    const c = s.cats.size;
    if (c <= 1) breadthBuckets['1 category']++;
    else if (c === 2) breadthBuckets['2 categories']++;
    else breadthBuckets['3+ categories']++;
  }

  return { total, returning, returningPct: total ? round1(100 * returning / total) : null, avgReturningSpanDays, tenureBuckets, depthBuckets, breadthBuckets };
}

/* ---------------- ratings ---------------- */
function summarizeRatings(rows) {
  const total = rows.length;
  const up = rows.filter((r) => r.r === 1).length;
  const pcts = rows.map((r) => r.pct).filter((v) => typeof v === 'number');
  const avgPct = pcts.length ? pcts.reduce((s, v) => s + v, 0) / pcts.length : null;
  const uniqueSessions = new Set(rows.map((r) => r.sid).filter(Boolean)).size;

  const byCategory = {};
  for (const cat of CAT_ORDER) {
    const rs = rows.filter((r) => r.cat === cat);
    if (!rs.length) continue;
    const u = rs.filter((r) => r.r === 1).length;
    const ps = rs.map((r) => r.pct).filter((v) => typeof v === 'number');
    byCategory[cat] = { n: rs.length, upPct: round1(100 * u / rs.length), avgPct: ps.length ? round1(ps.reduce((s, v) => s + v, 0) / ps.length) : null };
  }

  const byLang = {};
  for (const r of rows) { const l = r.lang || '?'; byLang[l] = (byLang[l] || 0) + 1; }

  // daily volume, last 30 days (UTC calendar days), zero-filled so the chart has no false gaps
  const byDay = {};
  for (const r of rows) { const d = dayKey(r.created_at); if (d) byDay[d] = (byDay[d] || 0) + 1; }
  const days = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, n: byDay[key] || 0 });
  }

  return { total, upPct: total ? round1(100 * up / total) : null, avgPct: avgPct != null ? round1(avgPct) : null, uniqueSessions, byCategory, byLang, last30d: days };
}

/* ---------------- searches (catalog-gap signal) ---------------- */
function summarizeSearches(rows, catalogTitles) {
  const total = rows.length;
  const byCategory = {};
  for (const r of rows) { const c = r.cat || '?'; byCategory[c] = (byCategory[c] || 0) + 1; }
  const norm = (s) => String(s || '').toLowerCase().trim();
  const seen = new Set();
  const gaps = [];
  for (let i = rows.length - 1; i >= 0 && gaps.length < 15; i--) {
    const t = rows[i].title; if (!t) continue;
    const key = norm(t); if (seen.has(key)) continue; seen.add(key);
    if (!catalogTitles.has(key)) gaps.push({ title: t, cat: rows[i].cat || null });
  }
  return { total, byCategory, gaps };
}

/* ---------------- catalog health ---------------- */
function summarizeCatalog(D) {
  const byCategory = {}; let total = 0;
  for (const cat of CAT_ORDER) {
    const arr = D[cat] || []; const n = arr.length; total += n;
    const img = arr.filter((it) => it && it.img).length;
    byCategory[cat] = { n, imgPct: n ? round1(100 * img / n) : 0 };
  }
  return { total, byCategory };
}

function catalogTitleSet(D) {
  const s = new Set();
  for (const cat of CAT_ORDER) for (const it of (D[cat] || [])) if (it && it.t) s.add(String(it.t).toLowerCase().trim());
  return s;
}

/* ---------------- render ---------------- */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function bar(label, value, max, { suffix = '', title = null } = {}) {
  const pct = max > 0 ? Math.max(2, Math.round(100 * value / max)) : 0;
  return `<div class="bar-row"${title ? ` title="${esc(title)}"` : ''}>
    <span class="bar-label">${esc(label)}</span>
    <span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span>
    <span class="bar-value">${esc(value)}${esc(suffix)}</span>
  </div>`;
}

function sparkbars(days) {
  const max = Math.max(1, ...days.map((d) => d.n));
  return `<div class="spark">${days.map((d) => {
    const h = Math.max(3, Math.round(46 * d.n / max));
    return `<div class="spark-col" title="${esc(d.date)}: ${d.n} rating${d.n === 1 ? '' : 's'}"><div class="spark-bar" style="height:${h}px"></div></div>`;
  }).join('')}</div>
  <div class="spark-ticks"><span>${esc(days[0]?.date || '')}</span><span>${esc(days[days.length - 1]?.date || '')}</span></div>`;
}

function kpi(label, value, sub = '') {
  return `<div class="kpi"><div class="kpi-val">${esc(value)}</div><div class="kpi-label">${esc(label)}</div>${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}</div>`;
}

// render a plain {label: count} object as bars scaled to its own max — used for the retention/
// engagement-depth histograms, which have no natural shared scale with anything else on the page.
function bucketBars(buckets) {
  const max = Math.max(1, ...Object.values(buckets));
  return Object.entries(buckets).map(([label, n]) => bar(label, n, max)).join('');
}

const NOT_CONNECTED = (what) => `<p class="muted">Not connected yet — ${what}</p>`;

function render(snap, history) {
  const { ratings, searches, catalog, evalReport, ig, traffic, generatedAt } = snap;
  const catMax = Math.max(1, ...CAT_ORDER.map((c) => catalog.byCategory[c]?.n || 0));
  const ratingCatMax = Math.max(1, ...Object.values(ratings.byCategory).map((v) => v.n));

  const evalRows = evalReport?.perCategory
    ? CAT_ORDER.filter((c) => evalReport.perCategory[c]).map((c) => bar(`${EMO[c] || ''} ${CAT_LABEL[c]}`, evalReport.perCategory[c].accuracy, 100, { suffix: '%', title: `n=${evalReport.perCategory[c].n} judged triplets` })).join('')
    : '<p class="muted">No eval/report.json yet — run scripts/eval.mjs.</p>';

  const catalogRows = CAT_ORDER.map((c) => bar(`${EMO[c] || ''} ${CAT_LABEL[c]}`, catalog.byCategory[c]?.n || 0, catMax, { title: `${catalog.byCategory[c]?.imgPct ?? 0}% have a real cover image` })).join('');

  const ratingCatRows = Object.keys(ratings.byCategory).length
    ? CAT_ORDER.filter((c) => ratings.byCategory[c]).map((c) => { const v = ratings.byCategory[c]; return bar(`${EMO[c] || ''} ${CAT_LABEL[c]}`, v.n, ratingCatMax, { title: `${v.upPct}% thumbs-up · avg match quality ${v.avgPct ?? '—'}%` }); }).join('')
    : '<p class="muted">No ratings yet.</p>';

  const searchGaps = searches.gaps.length
    ? `<ul class="gaps">${searches.gaps.map((g) => `<li><span class="gcat">${esc(g.cat ? CAT_LABEL[g.cat] || g.cat : '?')}</span>${esc(g.title)}</li>`).join('')}</ul>`
    : '<p class="muted">No catalog gaps in the recent search log.</p>';

  const langOrder = ['en', 'es', 'pt'];
  const langTotal = Object.values(ratings.byLang).reduce((s, v) => s + v, 0) || 1;
  const langRows = langOrder.filter((l) => ratings.byLang[l]).map((l) =>
    bar({ en: '🇬🇧 English', es: '🇪🇸 Español', pt: '🇧🇷 Português' }[l], ratings.byLang[l], langTotal)).join('') || '<p class="muted">No ratings yet.</p>';

  const igPct = ig.total ? Math.round(100 * ig.posted / ig.total) : 0;

  const engagement = snap.engagement;
  const tenureRows = engagement.total ? bucketBars(engagement.tenureBuckets) : '<p class="muted">No rated activity yet.</p>';
  const depthRows = engagement.total ? bucketBars(engagement.depthBuckets) : '<p class="muted">No rated activity yet.</p>';
  const breadthRows = engagement.total ? bucketBars(engagement.breadthBuckets) : '<p class="muted">No rated activity yet.</p>';

  const countryMax = Math.max(1, ...(traffic?.countries || []).map((c) => c.visitors));
  const countryRows = traffic?.countries?.length
    ? traffic.countries.map((c) => bar(c.name, c.visitors, countryMax)).join('')
    : (traffic ? '<p class="muted">No visitors in this window yet.</p>' : NOT_CONNECTED('enable Web Analytics for this project in the Vercel dashboard, create a Vercel Access Token, and add it as the <code>VERCEL_TOKEN</code> repo secret.'));
  const deviceMax = Math.max(1, ...(traffic?.devices || []).map((d) => d.visitors));
  const deviceRows = traffic?.devices?.length
    ? traffic.devices.map((d) => bar(d.type, d.visitors, deviceMax)).join('')
    : '';

  // eval accuracy trend across accumulated daily snapshots (grows over time as metrics.yml runs)
  const evalHist = history.filter((h) => h.eval?.overall != null).map((h) => ({ date: h.date, v: h.eval.overall }));
  const evalTrend = evalHist.length >= 2
    ? `<div class="spark">${evalHist.map((h) => { const height = Math.max(3, Math.round(46 * h.v / 100)); return `<div class="spark-col" title="${esc(h.date)}: ${h.v}% overall accuracy"><div class="spark-bar accent-b" style="height:${height}px"></div></div>`; }).join('')}</div>
       <div class="spark-ticks"><span>${esc(evalHist[0].date)}</span><span>${esc(evalHist[evalHist.length - 1].date)}</span></div>`
    : '<p class="muted">Trend builds up as metrics.yml runs on more days.</p>';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>muse — usage &amp; health</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#f6f6f4;--panel:#ffffff;--ink:#18181b;--mut:#5b5b63;--dim:#8a8a90;--acc:#db5a54;--accb:#2a78d6;--line:rgba(0,0,0,.08);
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--mono:ui-monospace,"SF Mono","Cascadia Code",Menlo,Consolas,monospace;--serif:"Iowan Old Style",Palatino,Georgia,serif}
body{background:radial-gradient(120% 70% at 50% -10%,#f7f0ee,#eeece7 60%);color:var(--ink);font-family:var(--sans);padding:36px 20px 80px}
.wrap{max-width:960px;margin:0 auto}
header{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:28px}
.wm{font-size:30px;font-weight:800;letter-spacing:-.01em}
.wm .dot{color:var(--acc)}
.gen{font-family:var(--mono);font-size:13px;color:var(--dim)}
h2{font-family:var(--serif);font-size:22px;font-weight:700;margin:0 0 14px}
.section{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:26px 28px;margin-bottom:20px;box-shadow:0 10px 30px -22px rgba(0,0,0,.25)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.kpi-val{font-size:28px;font-weight:800;letter-spacing:-.01em}
.kpi-label{font-family:var(--mono);font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.06em;margin-top:2px}
.kpi-sub{font-size:12px;color:var(--dim);margin-top:4px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:20px}
@media (max-width:720px){.grid2{grid-template-columns:1fr}}
.bar-row{display:flex;align-items:center;gap:10px;margin:9px 0;font-size:14px}
.bar-label{flex:0 0 118px;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar-track{flex:1;height:10px;background:#eeede8;border-radius:6px;overflow:hidden}
.bar-fill{display:block;height:100%;background:var(--acc);border-radius:6px}
.bar-value{flex:0 0 auto;font-family:var(--mono);font-size:13px;font-weight:600;min-width:40px;text-align:right}
.muted{color:var(--dim);font-size:14px}
.spark{display:flex;align-items:flex-end;gap:3px;height:50px}
.spark-col{flex:1;display:flex;align-items:flex-end;height:100%}
.spark-bar{width:100%;background:var(--acc);border-radius:3px 3px 0 0;min-height:3px}
.spark-bar.accent-b{background:var(--accb)}
.spark-ticks{display:flex;justify-content:space-between;font-family:var(--mono);font-size:11px;color:var(--dim);margin-top:6px}
.gaps{list-style:none;font-size:14px}
.gaps li{padding:7px 0;border-top:1px solid var(--line);display:flex;gap:10px;align-items:baseline}
.gaps li:first-child{border-top:none}
.gcat{font-family:var(--mono);font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.04em;flex:0 0 60px}
.ig-track{height:12px;background:#eeede8;border-radius:7px;overflow:hidden;margin:10px 0 6px}
.ig-fill{display:block;height:100%;background:var(--acc);border-radius:7px}
footer{font-size:12px;color:var(--dim);margin-top:30px;line-height:1.6}
</style></head><body><div class="wrap">
<header><div class="wm">muse<span class="dot">.</span> <span style="font-weight:400;font-size:18px;color:var(--mut)">usage &amp; health</span></div>
<div class="gen">generated ${esc(generatedAt)}</div></header>

<div class="kpis">
${kpi('Ratings', ratings.total, ratings.upPct != null ? ratings.upPct + '% 👍' : '')}
${kpi('Match quality', ratings.avgPct != null ? ratings.avgPct + '%' : '—', 'avg of rated matches')}
${kpi('Tasters', ratings.uniqueSessions, engagement.returningPct != null ? engagement.returningPct + '% returning' : 'unique sessions')}
${kpi('Visitors (30d)', traffic?.visitors ?? '—', traffic ? traffic.pageviews + ' pageviews' : 'Web Analytics not connected')}
${kpi('Searches logged', searches.total, searches.gaps.length + ' catalog gaps')}
${kpi('Catalog', catalog.total.toLocaleString('en-US'), CAT_ORDER.length + ' categories')}
${kpi('Engine accuracy', evalReport?.overall?.accuracy != null ? evalReport.overall.accuracy + '%' : '—', evalReport ? 'judge-verified, n=' + evalReport.overall.n : 'no eval run yet')}
</div>

<div class="section">
  <h2>Ratings — last 30 days</h2>
  ${sparkbars(ratings.last30d)}
</div>

<div class="grid2">
  <div class="section"><h2>Ratings by category</h2>${ratingCatRows}</div>
  <div class="section"><h2>Rated in</h2>${langRows}</div>
</div>

<div class="section">
  <h2>Where tasters are from</h2>
  <p class="muted" style="margin-bottom:12px">Vercel Web Analytics, last 30 days — country-level only, aggregated by Vercel at the edge (no IP ever reaches Muse).</p>
  ${countryRows}
  ${deviceRows ? `<h2 style="margin-top:22px">Device</h2>${deviceRows}` : ''}
</div>

<div class="grid2">
  <div class="section">
    <h2>How long tasters stick around</h2>
    <p class="muted" style="margin-bottom:12px">${engagement.returningPct != null ? `${engagement.returningPct}% rated on more than one day` + (engagement.avgReturningSpanDays != null ? ` · avg span ${engagement.avgReturningSpanDays}d` : '') : 'Based on the span between a taster’s first and last rated match.'}</p>
    ${tenureRows}
  </div>
  <div class="section">
    <h2>Engagement depth</h2>
    <p class="muted" style="margin-bottom:12px">Ratings logged per taster</p>
    ${depthRows}
    <h2 style="margin-top:20px;font-size:16px">Categories explored</h2>
    ${breadthRows}
  </div>
</div>

<div class="section">
  <h2>Engine accuracy by category</h2>
  <p class="muted" style="margin-bottom:12px">Judge-verified triplet accuracy (scripts/eval.mjs) · overall ${evalReport?.overall?.accuracy ?? '—'}% · cross-media ${evalReport?.cross?.accuracy ?? '—'}%</p>
  ${evalRows}
  <h2 style="margin-top:22px">Accuracy trend</h2>
  ${evalTrend}
</div>

<div class="section">
  <h2>Catalog size by category</h2>
  ${catalogRows}
</div>

<div class="section">
  <h2>Recent search misses</h2>
  <p class="muted" style="margin-bottom:10px">Searched but not (yet) an exact catalog title — candidates for scripts/ingest.mjs.</p>
  ${searchGaps}
</div>

<div class="section">
  <h2>Instagram distribution</h2>
  <div class="ig-track"><span class="ig-fill" style="width:${igPct}%"></span></div>
  <p class="muted">${ig.posted} / ${ig.total} cards posted (${igPct}%)</p>
</div>

<footer>
  Aggregate counts only — no personal data. Session ids are random, browser-local, and never shown; "tasters" and "days active" are derived from RATED matches only (browsing without rating leaves no trace here). Country/device come from Vercel Web Analytics, which never exposes a visitor-level id via its API — there is no way to cross-reference a country with a taster's ratings. Sources: Supabase <code>ratings</code>/<code>searches</code> (service_role read, never exposed to the browser), Vercel Web Analytics (server-side token, never shipped to the client), <code>data.json</code>, <code>eval/report.json</code>, <code>ig/queue.json</code>. Regenerated daily by <code>.github/workflows/metrics.yml</code> — not linked from the app nav.
</footer>
</div></body></html>`;
}

/* ---------------- main ---------------- */
async function main() {
  const D = await readJSON(ROOT + 'data.json', {});
  const evalReport = await readJSON(ROOT + 'eval/report.json', null);
  const igQueue = await readJSON(ROOT + 'ig/queue.json', { posts: [] });

  const generatedAt = new Date().toISOString();
  const date = generatedAt.slice(0, 10);
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [ratingRows, searchRows, traffic] = await Promise.all([
    fetchTable('ratings', 'created_at,sid,cat,pct,r,lang'),
    fetchTable('searches', 'created_at,cat,title'),
    fetchTraffic(since, date),
  ]);

  const ratings = summarizeRatings(ratingRows);
  const searches = summarizeSearches(searchRows, catalogTitleSet(D));
  const catalog = summarizeCatalog(D);
  const engagement = summarizeEngagement(ratingRows);
  const ig = { total: igQueue.posts.length, posted: igQueue.posts.filter((p) => p.posted).length };

  const snap = { date, generatedAt, ratings, searches, catalog, engagement, traffic, eval: evalReport, ig };

  let history = await readJSON(HISTORY_FILE, []);
  if (!Array.isArray(history)) history = [];
  history = history.filter((h) => h.date !== date); // idempotent same-day re-run
  history.push(snap);
  history.sort((a, b) => a.date.localeCompare(b.date));
  if (history.length > HISTORY_CAP) history = history.slice(history.length - HISTORY_CAP);

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(HISTORY_FILE, JSON.stringify(history));
  await writeFile(HTML_FILE, render({ ...snap, evalReport }, history));

  console.log(`metrics: ratings=${ratings.total} searches=${searches.total} catalog=${catalog.total} eval=${evalReport?.overall?.accuracy ?? 'n/a'}% ig=${ig.posted}/${ig.total} traffic=${traffic ? traffic.visitors + 'v' : 'not connected'} -> ${HTML_FILE}`);
}

// run only when invoked directly (not when imported for testing, mirrors eval.mjs)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { summarizeRatings, summarizeSearches, summarizeCatalog, summarizeEngagement, catalogTitleSet, render };
