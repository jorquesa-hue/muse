/* Muse — usage & agenda health dashboard (daily via .github/workflows/metrics.yml).
 *
 * Sources, all read server-side in Actions (nothing here ships to the browser):
 *   - events.json — the agenda: upcoming events by category / state / source, freshness.
 *   - Supabase `event_clicks` (service_role; RLS is insert-only for the public key) — anonymous
 *     interactions: details / directions / calendar / share taps, by category and the event's state;
 *     sessions are random browser-local ids, only ever counted, never shown.
 *   - Vercel Web Analytics REST API — visitors, pageviews, country, device (non-identifying by design).
 * Writes metrics/history.json (one snapshot/day, last 180) + metrics/index.html (static, no JS).
 * Env: SB_SERVICE_KEY, VERCEL_TOKEN — each optional; a missing one degrades its section to a
 * "not connected" note instead of failing. Node 20+.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url).pathname;
const SB = 'https://esviqajfbkdnpoohjpjt.supabase.co';
const KEY = process.env.SB_SERVICE_KEY;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const VERCEL_TEAM_ID = 'team_zh337tXixhvsa4rinCndAoKc';
const VERCEL_PROJECT_ID = 'prj_oI8NSLUV1yNzga7SjqBrp49If3Gz';
const OUT_DIR = ROOT + 'metrics';
const HISTORY_CAP = 180;

const CAT_ORDER = ['music', 'food', 'festas', 'kids', 'outdoor', 'fairs'];
const CAT_LABEL = { music: '🎶 Música', food: '🍽️ Gastronomia', festas: '🎉 Festas populares', kids: '🧸 Infantil', outdoor: '🌳 Ao ar livre', fairs: '🧺 Feiras' };
const KIND_LABEL = { details: 'Detalhes', directions: 'Como chegar', calendar: 'Agenda (.ics)', share: 'Compartilhar' };

const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fb; } };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const round1 = (v) => Math.round(v * 10) / 10;
const brToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/* ---------------- sources ---------------- */
async function fetchClicks() {
  if (!KEY) return null;
  try {
    const r = await fetch(`${SB}/rest/v1/event_clicks?select=created_at,sid,cat,kind,uf&order=created_at.asc&limit=100000`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
    if (!r.ok) { console.error('event_clicks fetch failed:', r.status, (await r.text().catch(() => '')).slice(0, 200)); return null; }
    return r.json();
  } catch (e) { console.error('event_clicks error:', e.message); return null; }
}
async function vercelGet(path, params) {
  const qs = new URLSearchParams({ teamId: VERCEL_TEAM_ID, projectId: VERCEL_PROJECT_ID, ...params });
  const r = await fetch(`https://api.vercel.com/v1/query/web-analytics/${path}?${qs}`, { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } });
  if (!r.ok) { console.error(`vercel ${path} failed:`, r.status, (await r.text().catch(() => '')).slice(0, 200)); return null; }
  return r.json();
}
const countryName = (code) => { try { return new Intl.DisplayNames(['pt-BR'], { type: 'region' }).of(code) || code; } catch { return code; } };
async function fetchTraffic(since, until) {
  if (!VERCEL_TOKEN) return null;
  try {
    const [count, byCountry, byDevice] = await Promise.all([
      vercelGet('visits/count', { since, until }),
      vercelGet('visits/aggregate', { since, until, by: 'country', limit: '10' }),
      vercelGet('visits/aggregate', { since, until, by: 'deviceType', limit: '6' }),
    ]);
    if (!count) return null;
    return {
      visitors: count.data?.visitors ?? 0, pageviews: count.data?.pageviews ?? 0,
      countries: (byCountry?.data || []).map((r) => ({ name: countryName(r.country), visitors: r.visitors })),
      devices: (byDevice?.data || []).map((r) => ({ type: r.deviceType || '?', visitors: r.visitors })),
    };
  } catch (e) { console.error('vercel analytics error:', e.message); return null; }
}

/* ---------------- summaries ---------------- */
export function summarizeAgenda(data, today) {
  const evs = (data && data.events) || [];
  const live = evs.filter((e) => e.end >= today);
  const next7 = addDays(today, 7);
  const byCat = Object.fromEntries(CAT_ORDER.map((c) => [c, live.filter((e) => e.cat === c).length]));
  const byUf = {}; for (const e of live) byUf[e.uf] = (byUf[e.uf] || 0) + 1;
  return {
    total: live.length,
    today: live.filter((e) => e.start <= today && e.end >= today).length,
    week: live.filter((e) => e.start <= next7).length,
    free: live.filter((e) => e.price === 'free').length,
    calendar: live.filter((e) => e.src === 'calendar').length,
    search: live.filter((e) => e.src === 'search').length,
    statesCovered: Object.keys(byUf).length,
    byCat, byUf, generated: (data && data.generated) || null,
  };
}
export function summarizeClicks(rows) {
  if (!rows) return null;
  const bySid = {};
  for (const r of rows) { if (!r.sid) continue; const t = Date.parse(r.created_at); const s = bySid[r.sid] || (bySid[r.sid] = { first: t, last: t, n: 0 }); s.first = Math.min(s.first, t); s.last = Math.max(s.last, t); s.n++; }
  const families = Object.values(bySid);
  const returning = families.filter((s) => s.last - s.first >= 86400000).length;
  const count = (key) => { const o = {}; for (const r of rows) o[r[key]] = (o[r[key]] || 0) + 1; return o; };
  const byDay = {}; for (const r of rows) { const d = String(r.created_at).slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; }
  const today = brToday(); const last30 = [];
  for (let i = 29; i >= 0; i--) { const d = addDays(today, -i); last30.push({ date: d, n: byDay[d] || 0 }); }
  return { total: rows.length, families: families.length, returningPct: families.length ? round1(100 * returning / families.length) : null,
    byKind: count('kind'), byCat: count('cat'), byUf: count('uf'), last30 };
}

/* ---------------- render ---------------- */
function bar(label, value, max) {
  const pct = max > 0 ? Math.max(2, Math.round(100 * value / max)) : 0;
  return `<div class="bar-row"><span class="bar-label">${esc(label)}</span><span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span><span class="bar-value">${esc(value)}</span></div>`;
}
const bars = (pairs) => { const max = Math.max(1, ...pairs.map((p) => p[1])); return pairs.map(([l, v]) => bar(l, v, max)).join(''); };
const kpi = (label, value, sub = '') => `<div class="kpi"><div class="kpi-val">${esc(value)}</div><div class="kpi-label">${esc(label)}</div>${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ''}</div>`;
const NOT = (what) => `<p class="muted">Não conectado — ${what}</p>`;

export function render({ agenda, clicks, traffic, generatedAt }) {
  const topUf = Object.entries(agenda.byUf).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const spark = clicks ? (() => { const max = Math.max(1, ...clicks.last30.map((d) => d.n));
    return `<div class="spark">${clicks.last30.map((d) => `<div class="spark-col" title="${esc(d.date)}: ${d.n}"><div class="spark-bar" style="height:${Math.max(3, Math.round(46 * d.n / max))}px"></div></div>`).join('')}</div>
    <div class="spark-ticks"><span>${esc(clicks.last30[0].date)}</span><span>${esc(clicks.last30[29].date)}</span></div>`; })() : NOT('crie a tabela <code>event_clicks</code> (supabase/migrations) e o secret <code>SB_SERVICE_KEY</code>.');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>muse — uso e agenda</title>
<style>
@font-face{font-family:Fredoka;font-weight:600;src:url(../fonts/fredoka-latin-600-normal.woff2) format('woff2')}
@font-face{font-family:Nunito;font-weight:400;src:url(../fonts/nunito-latin-400-normal.woff2) format('woff2')}
@font-face{font-family:Nunito;font-weight:800;src:url(../fonts/nunito-latin-800-normal.woff2) format('woff2')}
*{margin:0;padding:0;box-sizing:border-box}
:root{--ink:#1e1640;--mut:#4f4870;--dim:#6a6488;--acc:#ff3d7f;--vio:#6b3df2;--line:rgba(30,22,64,.11)}
body{background:#fff8ec;color:var(--ink);font-family:Nunito,system-ui,sans-serif;padding:32px 18px 70px}
.wrap{max-width:960px;margin:0 auto}
header{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:24px}
.wm{font-family:Fredoka,sans-serif;font-size:34px;font-weight:600}.wm .dot{color:var(--acc)}
.wm small{font-family:Nunito,sans-serif;font-size:17px;color:var(--mut);font-weight:800;margin-left:6px}
.gen{font-size:13px;color:var(--dim);font-weight:800}
h2{font-family:Fredoka,sans-serif;font-weight:600;font-size:21px;margin-bottom:12px}
.section{background:#fff;border:2px solid var(--line);border-radius:20px;padding:22px 24px;margin-bottom:18px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:18px}
.kpi{background:#fff;border:2px solid var(--line);border-radius:16px;padding:14px 16px}
.kpi-val{font-family:Fredoka,sans-serif;font-size:30px;font-weight:600}
.kpi-label{font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.06em;font-weight:800}
.kpi-sub{font-size:12.5px;color:var(--dim);margin-top:3px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}@media(max-width:720px){.grid2{grid-template-columns:1fr}}
.bar-row{display:flex;align-items:center;gap:10px;margin:8px 0;font-size:14px}
.bar-label{flex:0 0 140px;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:800}
.bar-track{flex:1;height:11px;background:#f3efe4;border-radius:6px;overflow:hidden}
.bar-fill{display:block;height:100%;background:var(--vio);border-radius:6px}
.bar-value{min-width:36px;text-align:right;font-weight:800;font-size:13px}
.muted{color:var(--dim);font-size:14px}
.spark{display:flex;align-items:flex-end;gap:3px;height:50px}.spark-col{flex:1;display:flex;align-items:flex-end;height:100%}
.spark-bar{width:100%;background:var(--acc);border-radius:3px 3px 0 0}
.spark-ticks{display:flex;justify-content:space-between;font-size:11px;color:var(--dim);margin-top:6px;font-weight:800}
footer{font-size:12px;color:var(--dim);margin-top:26px;line-height:1.6}
</style></head><body><div class="wrap">
<header><div class="wm">muse<span class="dot">.</span><small>uso e agenda</small></div><div class="gen">gerado ${esc(generatedAt)}</div></header>
<div class="kpis">
${kpi('Eventos ativos', agenda.total, `${agenda.today} hoje · ${agenda.week} nos próximos 7 dias`)}
${kpi('Estados', agenda.statesCovered, 'com ao menos 1 evento')}
${kpi('Grátis', agenda.free, `${agenda.calendar} do calendário · ${agenda.search} da busca`)}
${kpi('Visitantes (30d)', traffic ? traffic.visitors : '—', traffic ? traffic.pageviews + ' pageviews' : 'Web Analytics não conectado')}
${kpi('Interações', clicks ? clicks.total : '—', clicks ? `${clicks.families} famílias · ${clicks.returningPct ?? 0}% voltaram` : 'tabela event_clicks ausente')}
</div>
<div class="grid2">
  <div class="section"><h2>Agenda por categoria</h2>${bars(CAT_ORDER.map((c) => [CAT_LABEL[c], agenda.byCat[c]]))}</div>
  <div class="section"><h2>Agenda por estado</h2>${topUf.length ? bars(topUf) : '<p class="muted">Agenda vazia.</p>'}</div>
</div>
<div class="section"><h2>Interações — últimos 30 dias</h2>${spark}</div>
<div class="grid2">
  <div class="section"><h2>O que as famílias fazem</h2>${clicks ? bars(Object.keys(KIND_LABEL).map((k) => [KIND_LABEL[k], clicks.byKind[k] || 0])) : NOT('sem dados de interação.')}</div>
  <div class="section"><h2>Interesse por categoria</h2>${clicks ? bars(CAT_ORDER.map((c) => [CAT_LABEL[c], clicks.byCat[c] || 0])) : NOT('sem dados de interação.')}</div>
</div>
<div class="grid2">
  <div class="section"><h2>De onde vêm os visitantes</h2><p class="muted" style="margin-bottom:8px">Vercel Web Analytics, 30 dias, só país (nenhum IP chega ao Muse).</p>${traffic ? (traffic.countries.length ? bars(traffic.countries.map((c) => [c.name, c.visitors])) : '<p class="muted">Ainda sem visitas no período.</p>') : NOT('ative Web Analytics e o secret <code>VERCEL_TOKEN</code>.')}</div>
  <div class="section"><h2>Eventos clicados por estado</h2>${clicks && Object.keys(clicks.byUf).length ? bars(Object.entries(clicks.byUf).sort((a, b) => b[1] - a[1]).slice(0, 10)) : '<p class="muted">Ainda sem interações.</p>'}${traffic && traffic.devices.length ? `<h2 style="margin-top:18px">Dispositivo</h2>${bars(traffic.devices.map((d) => [d.type, d.visitors]))}` : ''}</div>
</div>
<footer>Só contagens agregadas. Ids de sessão são aleatórios, ficam no navegador e nunca são exibidos; a localização da família nunca sai do aparelho (só o estado do <i>evento</i> clicado é registrado). Agenda atualizada em ${esc(agenda.generated || '—')}. Gerado diariamente por <code>.github/workflows/metrics.yml</code>; não linkado no app.</footer>
</div></body></html>`;
}

/* ---------------- main ---------------- */
async function main() {
  const today = brToday();
  const [data, clickRows, traffic] = await Promise.all([
    readJSON(ROOT + 'events.json', { events: [] }), fetchClicks(), fetchTraffic(addDays(today, -29), today),
  ]);
  const agenda = summarizeAgenda(data, today);
  const clicks = summarizeClicks(clickRows);
  const generatedAt = new Date().toISOString();
  const snap = { date: today, generatedAt, agenda, clicks, traffic };
  let history = await readJSON(OUT_DIR + '/history.json', []);
  history = (Array.isArray(history) ? history : []).filter((h) => h.date !== today && h.agenda);
  history.push(snap); history = history.slice(-HISTORY_CAP);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_DIR + '/history.json', JSON.stringify(history));
  await writeFile(OUT_DIR + '/index.html', render(snap));
  console.log(`metrics: events=${agenda.total} clicks=${clicks ? clicks.total : 'n/a'} visitors=${traffic ? traffic.visitors : 'n/a'}`);
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) main().catch((e) => { console.error(e); process.exit(1); });
