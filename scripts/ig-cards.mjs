/* Muse — Instagram "if you love X" card generator (marketing asset; run via .github/workflows/ig-cards.yml).
 *
 * The "one love in — a universe out" cards: a popular anchor + its best real cross-media matches
 * (from the app engine via engine-port.mjs), rendered 1080x1350, light theme, with each item's REAL
 * cover image (it.img — Wikimedia / Open Library / Apple Music).
 *
 * Images are loaded by the BROWSER (Chromium), not Node fetch: browsers load these hosts far more
 * reliably (correct UA/referer handling per host), so the real-cover hit rate is high. We first PROBE
 * every candidate cover in a hidden page, then finalize: a post ships ONLY if its subject cover loaded
 * AND >=4 of its match covers loaded. No image -> no post (no generative filler in this batch).
 *
 * The cover hosts are blocked from the Claude web-session sandbox but reachable on GitHub runners, which
 * is why this runs in Actions. Output: OUT_DIR (default ./ig-out) — posts/NN-slug.jpg, contact-sheet.png,
 * captions.md, index.json — uploaded as an artifact; nothing is committed.
 *
 * Env: PER_CAT (anchors/category, default 6), OUT_DIR, PW_CHROMIUM (chromium override, local), FAKE_IMAGES=1
 * (local: pretend every cover loaded, for render smoke tests). Node 20+. Dev dep: playwright (workflow only).
 */
import { chromium } from 'playwright';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { loadEngine } from './engine-port.mjs';

const OUT = process.env.OUT_DIR || new URL('../ig-out', import.meta.url).pathname;
const PER_CAT = +(process.env.PER_CAT || 6);
const EXE = process.env.PW_CHROMIUM || undefined;
const FAKE = !!process.env.FAKE_IMAGES;
const N_MATCHES = 5;

const CAT_META = {
  movies:{acc:'#ff4d5a',name:'Movies'}, tv:{acc:'#a06bff',name:'TV Series'}, books:{acc:'#ffb020',name:'Books'},
  music:{acc:'#22c98a',name:'Music'}, games:{acc:'#3d8fd6',name:'Games'}, anime:{acc:'#ff6ec7',name:'Anime'},
  food:{acc:'#ff8a3c',name:'Food'}, travel:{acc:'#1fd1c1',name:'Travel'},
};

/* ---------------- candidate generation (from the real engine) ---------------- */
const eng = await loadEngine();
const { D, CAT_ORDER, crossScore } = eng;
console.log('engine loaded, embeddings:', eng.embLoaded());

const pctOf = cs => Math.min(99, Math.max(1, Math.round(100 * Math.pow(cs, 0.8))));
const lite = it => ({ id:it.id, t:it.t, y:(it.y??null), hue:(it.hue??222), by:(it.by??null), cat:it._cat, img:(it.img||null) });
const nrm = s => String(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const STOP = new Set(['the','a','an','of','and','to','in','on','original','motion','picture','soundtrack','deluxe','edition','vol','part','story','my','no']);
const toks = s => new Set(nrm(s).split(' ').filter(w => w.length > 2 && !STOP.has(w)));
const shareWord = (a,b) => { const tb = toks(b.t); for (const w of toks(a.t)) if (tb.has(w)) return true; return false; };

const anchors = [];
for (const cat of CAT_ORDER) {
  const pool = (D[cat]||[]).filter(it => it && it.t && typeof it.pop === 'number' && it.img).sort((a,b)=>b.pop-a.pop);
  const picked = [], seen = new Set();
  for (const it of pool) { const k = it.t.toLowerCase().slice(0,6); if (seen.has(k)) continue; seen.add(k); picked.push(it); if (picked.length>=PER_CAT) break; }
  anchors.push(...picked);
}
const draft = [];
for (const a of anchors) {
  const best = [];
  for (const cat of CAT_ORDER) {
    if (cat === a._cat) continue;
    let cands = [];
    for (const b of (D[cat]||[])) { if (!b || !b.t || !b.img) continue; if (shareWord(a,b) && (b.pop||0)<55) continue; cands.push({ b, s: crossScore(a,b) }); }
    if (!cands.length) continue;
    const recog = cands.filter(c => (c.b.pop||0)>=30); const pool = recog.length?recog:cands;
    pool.sort((x,y)=>y.s-x.s); const top = pool[0];
    if (top && top.s>0) best.push({ ...lite(top.b), pct: pctOf(top.s), _s: top.s });
  }
  best.sort((x,y)=>y._s-x._s);
  const cands = best.filter(m=>m.pct>=52).map(({_s,...m})=>m);
  if (cands.length>=4) draft.push({ anchor: lite(a), cands });
}
console.log('drafted', draft.length, 'candidate posts');

/* ---------------- render assets ---------------- */
const _S = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">';
const CAT_ICON = {
  movies:_S+'<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M10 8.4l5.6 3.6L10 15.6z"/></svg>',
  tv:_S+'<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/></svg>',
  books:_S+'<path d="M12 6.6C10.3 5.3 7.8 4.6 5 4.6c-.6 0-1 .4-1 1v11.4c0 .6.5 1 1 1 2.6 0 5 .6 7 1.9"/><path d="M12 6.6c1.7-1.3 4.2-2 7-2 .6 0 1 .4 1 1V17c0 .6-.5 1-1 1-2.6 0-5 .6-7 1.9"/><path d="M12 6.6v13.2"/></svg>',
  music:_S+'<path d="M9 18V6l10-2v11"/><ellipse cx="6.4" cy="18" rx="2.6" ry="2.1"/><ellipse cx="16.4" cy="15" rx="2.6" ry="2.1"/></svg>',
  games:_S+'<rect x="2.5" y="7.5" width="19" height="10" rx="5"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="15.5" cy="11.7" r="1"/><circle cx="18" cy="13.6" r="1"/></svg>',
  anime:_S+'<path d="M3.5 7.6c3-2.3 14-2.3 17 0"/><path d="M4.6 11h14.8"/><path d="M7 8v11M17 8v11"/></svg>',
  food:_S+'<path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0z"/><path d="M9 4.4c0 1.5-1 1.6-1 3M13 4c0 1.5-1 1.6-1 3"/></svg>',
  travel:_S+'<circle cx="12" cy="12" r="8.5"/><path d="M15.6 8.4l-2.3 4.9-4.9 2.3 2.3-4.9z"/></svg>',
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const qualColor = p => p>=85?'#1f9d64':p>=70?'#5a9c3a':p>=55?'#c0871f':'#a06a3a';
let OK = {};   // id -> cover URL that loaded
function tile(it, size, icon){
  const src = OK[it.id] || '';
  return `<div class="tile" style="width:${size}px;height:${size}px"><img class="cov" src="${esc(src)}" referrerpolicy="no-referrer" alt=""><span class="tcat" style="width:${icon}px;height:${icon}px">${CAT_ICON[it.cat]||''}</span></div>`;
}
function row(m){ const cm=CAT_META[m.cat]; return `<div class="mrow">${tile(m,98,22)}
  <div class="minfo"><div class="mcat" style="color:${cm.acc}">${CAT_ICON[m.cat]}<span>${esc(cm.name)}</span></div>
  <div class="mtitle">${esc(m.t)}</div><div class="mmeta">${m.y?esc(m.y):(m.by?esc(m.by):'')}</div></div>
  <div class="pct" style="color:${qualColor(m.pct)};border-color:${qualColor(m.pct)}55">${m.pct}<span>%</span></div></div>`; }
function card(p){ const a=p.anchor, cm=CAT_META[a.cat]; return `<div class="card">
  <div class="top"><div class="wm">muse<span class="dot"></span></div><div class="url">muse-find.com</div></div>
  <div class="hero">${tile(a,176,32)}<div class="hinfo"><div class="kick">If you love</div>
  <div class="atitle">${esc(a.t)}</div><div class="acat" style="color:${cm.acc}">${CAT_ICON[a.cat]}<span>${esc(cm.name)}${a.y?' · '+esc(a.y):''}</span></div></div></div>
  <div class="lead"><span class="dot2"></span>one love in — a universe out</div>
  <div class="rows">${p.matches.slice(0,5).map(row).join('')}</div>
  <div class="foot"><div class="ig">${_S}<rect x="3" y="3" width="18" height="18" rx="5.4"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1.15" fill="currentColor" stroke="none"/></svg><span>@muse_find</span></div>
  <div class="cta">Find yours free →</div></div></div>`; }

const CARD_BG = `radial-gradient(120% 70% at 92% -6%, hsl(8 60% 92%), transparent 55%),radial-gradient(90% 55% at -5% 104%, hsl(210 50% 93%), transparent 55%), var(--bg)`;
const CSS = `
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--bg:#faf8f5;--panel:#ffffff;--ink:#18181b;--mut:#5b5b63;--dim:#8a8a90;--acc:#db5a54;--line:rgba(0,0,0,.08);
    --sans:system-ui,'DejaVu Sans',sans-serif;--mono:'DejaVu Sans Mono',ui-monospace,monospace;--serif:Georgia,'Times New Roman',serif}
  body{width:1080px;height:1350px;background:${CARD_BG};color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased}
  .card{width:1080px;height:1350px;padding:70px 68px 60px;display:flex;flex-direction:column;background:${CARD_BG}}
  .top{display:flex;align-items:center;justify-content:space-between}
  .wm{font-size:40px;font-weight:800;letter-spacing:-.01em;display:inline-flex;align-items:baseline}
  .wm .dot{width:10px;height:10px;border-radius:50%;background:var(--acc);margin-left:4px;align-self:flex-end;margin-bottom:8px}
  .url{font-family:var(--mono);font-size:20px;color:var(--dim);letter-spacing:.04em}
  .hero{display:flex;align-items:center;gap:32px;margin-top:50px}
  .hinfo{min-width:0}
  .kick{font-family:var(--mono);font-size:22px;letter-spacing:.22em;text-transform:uppercase;color:var(--dim);margin-bottom:10px}
  .atitle{font-family:var(--serif);font-size:64px;line-height:1.02;font-weight:700;letter-spacing:-.01em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .acat{display:inline-flex;align-items:center;gap:9px;margin-top:15px;font-family:var(--mono);font-size:23px;letter-spacing:.03em}
  .acat svg{width:26px;height:26px}
  .lead{display:flex;align-items:center;gap:13px;margin:44px 0 8px;font-family:var(--mono);font-size:23px;letter-spacing:.03em;color:var(--mut)}
  .lead .dot2{width:9px;height:9px;border-radius:50%;background:var(--acc)}
  .rows{display:flex;flex-direction:column;gap:14px;flex:1;justify-content:center}
  .mrow{display:flex;align-items:center;gap:22px;background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:16px 24px;box-shadow:0 6px 22px -14px rgba(0,0,0,.25)}
  .minfo{flex:1;min-width:0}
  .mcat{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:17px;letter-spacing:.11em;text-transform:uppercase;margin-bottom:5px}
  .mcat svg{width:19px;height:19px}
  .mtitle{font-size:31px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mmeta{font-family:var(--mono);font-size:18px;color:var(--dim);margin-top:3px}
  .pct{flex:none;font-family:var(--mono);font-size:34px;font-weight:700;border:2px solid;border-radius:14px;padding:8px 14px;min-width:96px;text-align:center}
  .pct span{font-size:19px;opacity:.7;margin-left:1px}
  .tile{position:relative;border-radius:16px;overflow:hidden;flex:none;background:#e6e4df;box-shadow:inset 0 1px 0 rgba(255,255,255,.3), inset 0 0 0 1px rgba(0,0,0,.08)}
  .tile .cov{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
  .tile .tcat{position:absolute;left:10px;bottom:9px;color:#fff;opacity:.92;filter:drop-shadow(0 1px 3px rgba(0,0,0,.6))}
  .tile .tcat svg{width:100%;height:100%}
  .foot{display:flex;align-items:center;justify-content:space-between;margin-top:32px;padding-top:28px;border-top:1px solid var(--line)}
  .ig{display:inline-flex;align-items:center;gap:11px;font-family:var(--mono);font-size:26px;color:var(--ink);letter-spacing:.02em}
  .ig svg{width:30px;height:30px}
  .cta{font-family:var(--mono);font-size:23px;letter-spacing:.02em;color:var(--acc);font-weight:700}`;

/* ---------------- browser: probe covers, then render ---------------- */
await mkdir(OUT + '/posts', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: EXE });
const ctx = await browser.newContext({ viewport:{width:1080,height:1350}, deviceScaleFactor:2, userAgent:
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' });

// PROBE: load every candidate cover in the browser; keep the ones that actually decode (>1px).
const urls = [...new Set(draft.flatMap(p => [p.anchor, ...p.cands]).map(it => it.img).filter(Boolean))];
console.log('probing', urls.length, 'cover images in-browser…');
let loaded = {};
if (FAKE) {
  for (const u of urls) loaded[u] = true;
} else {
  const probe = await ctx.newPage();
  loaded = await probe.evaluate(async (urls) => {
    const res = {};
    await Promise.all(urls.map(u => new Promise(done => {
      const im = new Image(); let fin = false;
      const end = ok => { if (fin) return; fin = true; res[u] = ok; done(); };
      im.onload = () => end(im.naturalWidth > 1 && im.naturalHeight > 1);
      im.onerror = () => end(false);
      im.referrerPolicy = 'no-referrer';
      im.src = u;
      setTimeout(() => end(false), 25000);
    })));
    return res;
  }, urls);
  await probe.close();
}
for (const it of draft.flatMap(p => [p.anchor, ...p.cands])) if (it.img && loaded[it.img]) OK[it.id] = FAKE ? ('data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#89c"/></svg>')) : it.img;
const okCount = Object.values(loaded).filter(Boolean).length;
console.log('covers loaded:', okCount, '/', urls.length);

// FINALIZE: subject cover must have loaded AND >=4 match covers too, else drop the post.
const posts = [];
let dropNoAnchor = 0, dropFewMatches = 0;
for (const p of draft) {
  if (!OK[p.anchor.id]) { dropNoAnchor++; continue; }
  const matches = p.cands.filter(m => OK[m.id]).slice(0, N_MATCHES);
  if (matches.length < 4) { dropFewMatches++; continue; }
  posts.push({ anchor: p.anchor, matches });
}
console.log(`kept ${posts.length} posts (dropped ${dropNoAnchor} no subject cover, ${dropFewMatches} <4 match covers)`);

const page = await ctx.newPage();
const idx = [];
let i=0;
for (const p of posts) {
  i++;
  const slug = String(i).padStart(2,'0') + '-' + p.anchor.t.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,28);
  await page.setContent(`<!doctype html><meta charset="utf8"><style>${CSS}</style>${card(p)}`, { waitUntil:'load' });
  await page.evaluate(() => Promise.all(Array.from(document.images).map(im => im.complete ? 0 : im.decode().catch(()=>0))));
  await page.screenshot({ path: `${OUT}/posts/${slug}.jpg`, type:'jpeg', quality:92 });
  idx.push({ n:i, slug, anchor:p.anchor.t, cat:p.anchor.cat });
}

// contact sheet
if (posts.length) {
  const cells = posts.map((p,k)=>`<div class="cell"><div class="scl">${card(p)}</div><div class="cnum">${String(k+1).padStart(2,'0')}</div></div>`).join('');
  const sheetCSS = CSS + `body{width:auto;height:auto;background:#e9e7e2}
    .sheet{display:grid;grid-template-columns:repeat(5,270px);gap:20px;padding:28px;width:max-content}
    .cell{position:relative;width:270px;height:337px;border-radius:12px;overflow:hidden;box-shadow:0 10px 26px rgba(0,0,0,.18);border:1px solid rgba(0,0,0,.08)}
    .scl{transform:scale(.25);transform-origin:top left;width:1080px;height:1350px}
    .cnum{position:absolute;top:8px;left:9px;font-family:var(--mono);font-size:13px;color:#fff;background:rgba(0,0,0,.45);border-radius:6px;padding:2px 7px}`;
  const cols = 5, rows = Math.ceil(posts.length/cols);
  const sheet = await ctx.newPage();
  await sheet.setViewportSize({ width: cols*290+56, height: rows*357+56 });
  await sheet.setContent(`<!doctype html><meta charset="utf8"><style>${sheetCSS}</style><div class="sheet">${cells}</div>`, { waitUntil:'load' });
  await sheet.evaluate(() => Promise.all(Array.from(document.images).map(im => im.complete ? 0 : im.decode().catch(()=>0))));
  await (await sheet.$('.sheet')).screenshot({ path: `${OUT}/contact-sheet.png` });
}
await ctx.close(); await browser.close();

// captions
const EMO = { movies:'🎬', tv:'📺', books:'📚', music:'🎵', games:'🎮', anime:'🌸', food:'🍜', travel:'✈️' };
const HOOKS = [ a=>`You love ${a}. Here's your entire universe. 🌌`, a=>`Loved ${a}? Muse mapped its echo across every medium. 🧭`,
  a=>`If ${a} is your thing — read this, play this, taste this, go here. 👇`, a=>`${a} fans: your next obsession isn't another movie. It's all of these. ✨`,
  a=>`One love in, a universe out. Today: ${a}. 🌍`, a=>`We asked Muse what ${a} feels like in every other medium 👇` ];
const HASH = { movies:['#movierecommendations','#whattowatch','#filmtok'], tv:['#tvshowrecommendations','#whattowatch','#bingewatch'],
  books:['#bookrecommendations','#booktok','#whattoread'], music:['#musicrecommendations','#musicdiscovery','#newmusic'],
  games:['#gamerecommendations','#gamingcommunity','#whattoplay'], anime:['#animerecommendations','#anitok','#animecommunity'],
  food:['#foodie','#whattoeat','#foodlover'], travel:['#travelinspo','#wheretogo','#bucketlist'] };
const GEN = ['#muse','#tasteengine','#ifyoulike','#recommendations','#foryou','#discovery','#crossmedia'];
const uniq = a => [...new Set(a)];
function captionText(p, k){
  const a = p.anchor, shown = p.matches.slice(0,5);
  const chain = shown.map(m => `${EMO[m.cat]} ${m.t}`).join('  ·  ');
  const cats = uniq(shown.map(m => m.cat));
  const tags = uniq([...(HASH[a.cat]||[]), ...cats.flatMap(c => (HASH[c]||[]).slice(0,1)), ...GEN]).slice(0,14);
  return `${HOOKS[k % HOOKS.length](a.t)}\n\n${chain}\n\nMuse finds the echo of what you love in every other medium — one in, a universe out.\n\nTry it free 👉 muse-find.com (link in bio)\n\n${tags.join(' ')}`;
}
let md = `# Muse — recommendation cards (real covers)\n\nEvery match is a real muse-find.com result. Bio link: muse-find.com\n\n---\n\n`;
posts.forEach((p,k)=>{ md += `## ${k+1}. ${p.anchor.t}  \`posts/${idx[k].slug}.jpg\`\n\n> ${captionText(p,k).replace(/\n/g,'\n> ')}\n\n---\n\n`; });
await writeFile(OUT + '/captions.md', md);
await writeFile(OUT + '/index.json', JSON.stringify(idx, null, 2));

// queue.json — the auto-poster's worklist. Preserve `posted` state (keyed by anchor id) across
// rebuilds so a re-run of the queue builder never re-posts something already published.
let prevPosted = {};
try { const old = JSON.parse(await readFile(OUT + '/queue.json', 'utf8')); for (const e of (old.posts||[])) if (e.posted) prevPosted[e.key] = e; } catch { /* first build */ }
const queue = { generated: posts.length, posts: posts.map((p,k) => {
  const key = p.anchor.id, prev = prevPosted[key];
  return { key, n:k+1, img:`posts/${idx[k].slug}.jpg`, anchor:p.anchor.t, cat:p.anchor.cat,
    caption: captionText(p,k), posted: prev ? true : false, ...(prev && prev.posted_id ? { posted_id: prev.posted_id } : {}) };
}) };
await writeFile(OUT + '/queue.json', JSON.stringify(queue, null, 2));
const already = queue.posts.filter(p=>p.posted).length;
console.log(`done: ${idx.length} cards -> ${OUT} (covers ${okCount}/${urls.length}; queue: ${queue.posts.length} posts, ${already} already posted)`);
