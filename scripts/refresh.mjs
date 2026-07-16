/* Muse — weekly data refresh (runs in GitHub Actions).
 * - TMDB: trending + popular + top-rated movies & TV → new items with EN/ES/PT titles + posters.
 * - TMDB: backfill localized titles (tl) for existing movies/TV that lack them.
 * - Open Library: trending books (keyless), genre/themes derived from subjects.
 * - Merges into data.json (dedup by normalized title). Writes + bumps sw.js ONLY when the catalog changed.
 * Node 18+ (global fetch). Env: TMDB_KEY = TMDB v4 Read Access Token (Bearer).
 */
import { readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = ROOT + 'data.json';
const SW   = ROOT + 'sw.js';

const TMDB_KEY = process.env.TMDB_KEY;
const TMDB = 'https://api.themoviedb.org/3';
const IMG  = 'https://image.tmdb.org/t/p/w500';
const HDRS = { Authorization: `Bearer ${TMDB_KEY}`, Accept: 'application/json' };
const UA   = { 'User-Agent': 'MuseRefresh/1.0 (jorquesa@gmail.com)' };

const MOVIE_PAGES = 8;   // ~20 items/page/list/lang
const TV_PAGES    = 8;
const BOOK_LIMIT  = 120;
const BACKFILL_ITEMS_MAX = 4000; // max EXISTING items to attempt tl-backfill per run (up to 2 TMDB calls each)

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const normT = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const clampI = (v) => Math.max(0, Math.min(100, Math.round(v)));
const hueOf = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return Math.abs(h); };
const jit = (seed, amp) => (seed % (2 * amp + 1)) - amp;

let calls = 0;
async function tmdb(path, params = {}) {
  const u = new URL(TMDB + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  for (let a = 1; a <= 4; a++) {
    try {
      calls++;
      const r = await fetch(u, { headers: HDRS });
      if (r.status === 401 || r.status === 403) {
        console.error(`FATAL: TMDB auth failed (${r.status}). Check the TMDB_KEY secret is a valid v4 Read Access Token.`);
        process.exit(1);
      }
      if (r.status === 429 || r.status >= 500) { await sleep(2000 * a); continue; }   // rate-limit / transient server error
      if (!r.ok) { console.error(`TMDB ${r.status} on ${path}`); return null; }
      return await r.json();
    } catch { await sleep(800 * a); }
  }
  console.error(`TMDB gave up after retries on ${path}`);
  return null;
}
async function ol(path) {
  for (let a = 1; a <= 3; a++) {
    try { const r = await fetch('https://openlibrary.org' + path, { headers: UA }); if (r.ok) return await r.json(); } catch {}
    await sleep(600 * a);
  }
  return null;
}

// ---------- genre → our keys ----------
const MG = { 28:'action',12:'adventure',16:'animation',35:'comedy',80:'crime',99:'documentary',18:'drama',10751:'drama',14:'fantasy',36:'historical',27:'horror',10402:'musical',9648:'mystery',10749:'romance',878:'sci-fi',53:'thriller',10752:'war',37:'western' };
const TG = { 10759:'action',16:'animation',35:'comedy',80:'crime',99:'documentary',18:'drama',10751:'drama',10762:'animation',9648:'mystery',10763:'documentary',10764:'drama',10765:'sci-fi',10766:'drama',10767:'comedy',10768:'war',37:'western' };
const MDNA = { drama:[55,55,60,20,40,45,52,25],comedy:[20,35,40,90,60,30,78,30],crime:[70,66,55,20,60,45,25,30],thriller:[66,82,55,15,80,45,25,35],'sci-fi':[55,55,80,25,58,66,30,66],fantasy:[40,52,52,35,55,82,52,60],horror:[85,82,45,10,55,40,15,66],animation:[24,42,45,66,60,52,78,42],action:[50,82,35,25,86,60,35,25],romance:[25,42,35,45,45,32,86,20],mystery:[55,56,72,25,55,36,30,32],historical:[56,54,60,22,42,66,46,22],adventure:[40,62,40,35,76,72,52,30],war:[80,82,55,10,66,76,25,25],western:[56,62,45,25,50,56,40,26],musical:[24,46,36,56,66,52,82,30],documentary:[45,36,82,25,36,46,46,24] };
const MTH = { drama:['identity','loss','family'],comedy:['joy','friendship','family'],crime:['crime','corruption','justice'],thriller:['mystery','survival','betrayal'],'sci-fi':['technology','discovery','wonder'],fantasy:['adventure','journey','wonder'],horror:['survival','isolation','chaos'],animation:['family','wonder','joy'],action:['survival','power','adventure'],romance:['love','romance'],mystery:['mystery','crime','discovery'],historical:['war','heritage','tradition'],adventure:['adventure','journey','discovery'],war:['war','survival','loss'],western:['freedom','justice','survival'],musical:['love','celebration','artistry'],documentary:['discovery','nature'] };
const GNAME = { drama:['Drama','drama','drama'],comedy:['Comedy','comedia','comédia'],crime:['Crime','crimen','crime'],thriller:['Thriller','suspenso','suspense'],'sci-fi':['Sci-fi','ciencia ficción','ficção científica'],fantasy:['Fantasy','fantasía','fantasia'],horror:['Horror','terror','terror'],animation:['Animated','animación','animação'],action:['Action','acción','ação'],romance:['Romance','romance','romance'],mystery:['Mystery','misterio','mistério'],historical:['Historical','época','época'],adventure:['Adventure','aventuras','aventura'],war:['War','guerra','guerra'],western:['Western','western','faroeste'],musical:['Musical','musical','musical'],documentary:['Documentary','documental','documentário'] };

function mapGenres(ids, table) {
  const out = [];
  for (const id of (ids || [])) { const g = table[id]; if (g && !out.includes(g)) out.push(g); if (out.length >= 3) break; }
  return out;
}
function deriveDna(gs, seed) {
  const acc = [0,0,0,0,0,0,0,0]; let n = 0;
  for (const g of gs) { const b = MDNA[g]; if (b) { for (let i=0;i<8;i++) acc[i]+=b[i]; n++; } }
  if (!n) return null;
  return acc.map((v,i) => clampI(v/n + jit(seed + i*7, 6)));
}
function deriveTh(gs, seed) {
  const p = []; for (const g of gs) for (const t of (MTH[g]||[])) if (!p.includes(t)) p.push(t);
  if (!p.length) return ['discovery'];
  return p.slice(0, Math.min(p.length, 3 + (seed % 2)));
}
function desc(gk, year, kind) {
  const g = GNAME[gk] || [gk, gk, gk];
  const noun = kind === 'tv' ? ['series','Serie','Série'] : ['film','Película','Filme'];
  const yr = year ? ` (${year})` : '';
  return { en: `${g[0]} ${noun[0]}${yr}`, es: `${noun[1]} de ${g[1]}${yr}`, pt: `${noun[2]} de ${g[2]}${yr}` };
}

// ---------- fetch a TMDB list across languages, keyed by id ----------
async function fetchTmdbSet(paths, pages, kind) {
  const byId = new Map(); // id -> {en, es, pt, poster, genre_ids, year, pop, vote}
  const langs = [['en-US','en'],['es-ES','es'],['pt-BR','pt']];
  for (const [tmdbLang, key] of langs) {
    for (const p of paths) {
      for (let page = 1; page <= pages; page++) {
        const j = await tmdb(p, { language: tmdbLang, page });
        await sleep(60);
        if (!j || !j.results) continue;
        for (const it of j.results) {
          const title = kind === 'tv' ? it.name : it.title;
          if (!it.id || !title) continue;
          let e = byId.get(it.id);
          if (!e) { e = { id: it.id }; byId.set(it.id, e); }
          e[key] = title.trim();
          if (key === 'en') {
            e.poster = it.poster_path ? IMG + it.poster_path : null;
            e.genre_ids = it.genre_ids || [];
            const d = kind === 'tv' ? it.first_air_date : it.release_date;
            e.year = d ? parseInt(d.slice(0, 4), 10) : null;
            e.pop = it.popularity || 0;
            e.vote = it.vote_average || 0;
          }
        }
      }
    }
  }
  return [...byId.values()].filter((e) => e.en);
}

function buildItem(e, kind, existingIds) {
  const t = e.en.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (!t || t.length > 65) return null;
  const table = kind === 'tv' ? TG : MG;
  let gs = mapGenres(e.genre_ids, table);
  if (!gs.length) gs = ['drama'];
  const seed = hueOf(t);
  const dna = deriveDna(gs, seed);
  if (!dna) return null;
  const g0 = gs[0];
  const tl = { en: t, es: e.es || t, pt: e.pt || t };   // en uses the stripped display title, matching id/monogram
  const x = kind === 'tv'
    ? { ser: clampI((gs.includes('comedy')||gs.includes('animation')?28:62) + jit(seed,14)), ep: Math.round((gs.includes('comedy')?24:46) + (seed%12)), sea: 3 + (seed%6), binge: clampI(60 + jit(seed,12)) }
    : { vis: clampI((/action|sci-fi|adventure|fantasy|war/.test(gs.join(' '))?70:45) + jit(seed,10)), dlg: clampI((/drama|documentary/.test(gs.join(' '))?70:45) + jit(seed,10)), twist: clampI((/thriller|mystery/.test(gs.join(' '))?65:30) + jit(seed,12)), run: 112 + (seed%40) };
  const prefix = kind === 'tv' ? 'tv' : 'mv';
  const base = slug(t) || ('id' + e.id);           // non-Latin titles slug to '' → fall back to the TMDB id
  let id = `${prefix}-${base}-tmdb`, b = id, i = 2;
  while (existingIds.has(id)) { id = `${b}${i}`; i++; }
  existingIds.add(id);
  return {
    id, t, alt: [], y: e.year || null, by: '', cast: [], g: gs, th: deriveTh(gs, seed), dna,
    pop: clampI(30 + Math.min(60, (e.pop||0) * 0.6)), acc: clampI(40 + (e.vote||0) * 5), main: clampI(35 + Math.min(55, (e.pop||0) * 0.5)),
    c: '', d: desc(g0, e.year, kind), hue: seed, img: e.poster, tl, x,
  };
}

// ---------- backfill tl for existing items (region-aware, verified-match, no partial-fill poisoning) ----------
async function backfillTl(items, kind, budget) {
  let checked = 0, filled = 0;
  for (const it of items) {
    if (checked >= budget.n) break;
    const esReal = it.tl && it.tl.es && it.tl.es !== it.t;
    const ptReal = it.tl && it.tl.pt && it.tl.pt !== it.t;
    if (esReal && ptReal) continue;              // already fully localized
    if (it.tlTried && !esReal && !ptReal) continue; // tried before, TMDB had nothing — don't waste calls
    checked++;
    const s = await tmdb(kind === 'tv' ? '/search/tv' : '/search/movie', { query: it.t, ...(it.y ? { [kind==='tv'?'first_air_date_year':'year']: it.y } : {}) });
    await sleep(70);
    const top = s && s.results && s.results[0];
    const topTitle = top ? (top.title || top.name || '') : '';
    if (!top || normT(topTitle) !== normT(it.t)) { it.tlTried = true; continue; }   // verify it's really the same title
    const tr = await tmdb(`/${kind === 'tv' ? 'tv' : 'movie'}/${top.id}/translations`);
    await sleep(70);
    it.tlTried = true;
    if (!tr || !tr.translations) continue;
    const pick = (lang, reg) => {
      const m = tr.translations.find((x) => x.iso_639_1===lang && x.iso_3166_1===reg && x.data && (x.data.title||x.data.name))
             || tr.translations.find((x) => x.iso_639_1===lang && x.data && (x.data.title||x.data.name));
      return m ? (m.data.title || m.data.name).trim() : '';
    };
    const es = pick('es','ES'), pt = pick('pt','BR');       // match the app's es-ES / pt-BR
    if (es || pt) {
      const cur = it.tl || { en: it.t, es: '', pt: '' };
      it.tl = { en: it.t, es: es || cur.es || '', pt: pt || cur.pt || '' };   // never poison a slot with the EN title
      filled++;
    }
  }
  budget.n -= checked;
  return { checked, filled };
}

// ---------- books via Open Library trending (keyless), genre/themes from subjects ----------
const BDNA = { 'sci-fi':[55,55,80,25,55,65,30,65],fantasy:[45,50,55,30,55,80,45,60],mystery:[55,55,70,25,55,35,30,30],thriller:[65,80,50,15,85,45,20,30],romance:[25,40,35,45,45,30,85,20],horror:[85,80,45,10,55,40,15,65],historical:[55,50,60,25,40,65,45,20],literary:[55,45,85,25,30,45,45,40],adventure:[40,60,40,35,75,70,50,30],crime:[70,65,55,20,60,40,20,25],philosophical:[45,35,95,25,25,45,40,40],poetry:[50,35,80,30,25,40,55,55] };
const BTH  = { 'sci-fi':['technology','discovery','wonder'],fantasy:['adventure','journey','wonder'],mystery:['mystery','crime'],thriller:['mystery','survival'],romance:['love','romance'],horror:['survival','isolation'],historical:['war','heritage'],literary:['identity','memory','melancholy'],adventure:['adventure','journey'],crime:['crime','justice'],philosophical:['identity','transformation'],poetry:['melancholy','love','nature'] };
const BSUBJ = [[/science fiction|sci-fi/,'sci-fi'],[/fantasy/,'fantasy'],[/mystery|detective/,'mystery'],[/thriller|suspense/,'thriller'],[/romance|love stor/,'romance'],[/horror/,'horror'],[/histor/,'historical'],[/poetry|poems/,'poetry'],[/philosoph/,'philosophical'],[/adventure/,'adventure'],[/crime/,'crime'],[/biograph|memoir|essay/,'literary']];
function bookGenre(subjects) { const s = (subjects || []).join(' ').toLowerCase(); for (const [re,g] of BSUBJ) if (re.test(s)) return g; return 'literary'; }
async function refreshBooks(data, existingTitles) {
  const j = await ol(`/trending/weekly.json?limit=${BOOK_LIMIT}`);
  if (!j || !j.works) return 0;
  const ids = new Set(data.books.map((b) => b.id));
  let added = 0;
  for (const w of j.works) {
    const t = (w.title || '').trim();
    if (!t || t.length > 68 || !w.cover_i) continue;
    const nt = normT(t);
    if (existingTitles.has(nt)) continue;
    existingTitles.add(nt);
    const by = (w.author_name && w.author_name[0]) ? w.author_name[0].trim() : '';
    const seed = hueOf(t + by);
    const g = bookGenre(w.subject);
    const dnaB = (BDNA[g] || BDNA.literary).map((v, i2) => clampI(v + jit(seed + i2*7, 8)));
    const base = slug(t) || ('id' + (w.cover_i || seed));
    let id = `bk-${base}-tmdb`, b = id, i = 2; while (ids.has(id)) { id = `${b}${i}`; i++; } ids.add(id);
    data.books.push({
      id, t, alt: [], y: w.first_publish_year || null, by, g: [g], th: (BTH[g] || BTH.literary),
      dna: dnaB, pop: clampI(45 + jit(seed,15)), acc: clampI(58 + jit(seed,12)), main: clampI(50 + jit(seed,12)),
      c: '', d: { en: `Trending ${g} book by ${by}`, es: `Libro popular de ${by}`, pt: `Livro popular de ${by}` },
      hue: seed, img: `https://covers.openlibrary.org/b/id/${w.cover_i}-M.jpg`, tl: { en: t, es: t, pt: t },
      x: { lit: clampI((['literary','philosophical','poetry','historical'].includes(g)?70:40) + jit(seed,15)), plot: clampI((['thriller','mystery','crime','adventure'].includes(g)?78:50) + jit(seed,12)), exp: clampI(25 + jit(seed,15)), pg: 280 + (seed % 260) },
    });
    added++;
  }
  return added;
}

// ---------- main ----------
async function main() {
  if (!TMDB_KEY) { console.error('FATAL: missing TMDB_KEY env/secret.'); process.exit(1); }
  const data = JSON.parse(await readFile(DATA, 'utf8'));
  const before = Object.fromEntries(Object.keys(data).map((k) => [k, data[k].length]));
  let changed = false;

  // NEW movies & tv
  for (const [cat, paths, pages, kind] of [
    ['movies', ['/trending/movie/week', '/movie/popular', '/movie/top_rated'], MOVIE_PAGES, 'movie'],
    ['tv',     ['/trending/tv/week', '/tv/popular', '/tv/top_rated'],          TV_PAGES,    'tv'],
  ]) {
    const set = await fetchTmdbSet(paths, pages, kind);
    if (cat === 'movies' && set.length === 0) {   // a healthy run always returns trending movies
      console.error('FATAL: TMDB returned 0 movies — treating as an API/auth failure rather than committing an empty refresh.');
      process.exit(1);
    }
    const titles = new Set(data[cat].map((x) => normT(x.t)));
    const ids = new Set(data[cat].map((x) => x.id));
    let added = 0;
    for (const e of set) {
      const nt = normT((e.en || '').replace(/\s*\([^)]*\)\s*$/, ''));
      if (!nt || titles.has(nt)) continue;
      const item = buildItem(e, kind, ids);
      if (!item) continue;
      titles.add(nt); data[cat].push(item); added++;
    }
    if (added) changed = true;
    console.log(`${cat}: +${added} new (fetched ${set.length}; ${calls} TMDB calls so far)`);
  }

  // BACKFILL localized titles for existing movies + tv
  const budget = { n: BACKFILL_ITEMS_MAX };
  const bm = await backfillTl(data.movies, 'movie', budget);
  const bt = await backfillTl(data.tv, 'tv', budget);
  if (bm.filled || bt.filled) changed = true;
  console.log(`tl backfill — movies ${bm.filled}/${bm.checked}, tv ${bt.filled}/${bt.checked}`);

  // BOOKS trending (keyless)
  const bookTitles = new Set(data.books.map((b) => normT(b.t)));
  const bAdded = await refreshBooks(data, bookTitles);
  if (bAdded) changed = true;
  console.log(`books: +${bAdded} trending`);

  if (!changed) {
    console.log('No catalog changes this run — leaving data.json and sw.js untouched.');
    return;   // don't churn the service worker / force clients to re-download unchanged data
  }

  await writeFile(DATA, JSON.stringify(data), 'utf8');
  let sw = await readFile(SW, 'utf8');
  const m = sw.match(/muse-v(\d+)/);
  if (m) { const next = `muse-v${parseInt(m[1], 10) + 1}`; sw = sw.replace(/muse-v\d+/g, next); await writeFile(SW, sw, 'utf8'); console.log(`sw -> ${next}`); }

  const after = Object.fromEntries(Object.keys(data).map((k) => [k, data[k].length]));
  console.log('counts before:', before);
  console.log('counts after :', after);
  console.log(`TMDB calls: ${calls}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
