/* Muse — family day-out finder for Brazil.
 * Reads events.json (built by scripts/events.mjs in GitHub Actions) and shows what a family can do
 * today / tomorrow / this weekend within the chosen radius (50–150 km, default 100) of where they are. Music festivals lead.
 * Everything runs in the browser: location never leaves the device (distance is computed here
 * against cities.json, the IBGE municipality list). The only network writes are anonymous
 * "tapped details / directions / calendar / share" counts (event id + category + the event's state).
 */
'use strict';

const RADII = [50, 100, 120, 150]; // radius choices (km) in the location panel; 100 is the default
const DEFAULT_KM = 100;
const farKm = () => Math.max(300, state.km * 2); // empty-state helper: "a little further away"
const ROAD_FACTOR = 1.3;   // straight line -> road distance, rough
const AVG_KMH = 65;
const SB_URL = 'https://esviqajfbkdnpoohjpjt.supabase.co';
const CLICK_ENDPOINT = SB_URL + '/rest/v1/event_clicks';
const AREA_ENDPOINT = SB_URL + '/rest/v1/area_cache';
const ORG_ENDPOINT = SB_URL + '/rest/v1/published_events';  // events listed by organizers and approved (read-only)   // events found by on-demand searches, per ~50 km cell (read-only)
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzdmlxYWpmYmtkbnBvb2hqcGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NzM1NzgsImV4cCI6MjA5OTQ0OTU3OH0.0C0oBrs0OjrcvxNdDVXeBtBs8KTVmgviGJkWffkFKj4'; // public by design — RLS: insert-only clicks, read-only area cache

const CAT_ORDER = ['music', 'food', 'festas', 'kids', 'outdoor', 'fairs'];
const CATS = {
  music:   { emoji: '🎶', name: { pt: 'Música', en: 'Music', es: 'Música' } },
  food:    { emoji: '🍽️', name: { pt: 'Gastronomia', en: 'Food', es: 'Gastronomía' } },
  festas:  { emoji: '🎉', name: { pt: 'Festas populares', en: 'Folk festivals', es: 'Fiestas populares' } },
  kids:    { emoji: '🧸', name: { pt: 'Infantil', en: 'Kids', es: 'Infantil' } },
  outdoor: { emoji: '🌳', name: { pt: 'Ao ar livre', en: 'Outdoors', es: 'Al aire libre' } },
  fairs:   { emoji: '🧺', name: { pt: 'Feiras', en: 'Fairs', es: 'Ferias' } },
};
const LOCALE = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };

const T = {
  tagline: { pt: 'Um dia inteiro de <em>diversão em família</em>, a até {km} km de você.',
             en: 'A whole day of <em>family fun</em>, within {km} km of you.',
             es: 'Un día entero de <em>diversión en familia</em>, a menos de {km} km.' },
  today: { pt: 'Hoje', en: 'Today', es: 'Hoy' },
  tomorrow: { pt: 'Amanhã', en: 'Tomorrow', es: 'Mañana' },
  weekend: { pt: 'Fim de semana', en: 'Weekend', es: 'Fin de semana' },
  nextwk: { pt: 'Próximo fim de semana', en: 'Next weekend', es: 'Próximo fin de semana' },
  all: { pt: 'Tudo', en: 'All', es: 'Todo' },
  free: { pt: 'Grátis', en: 'Free', es: 'Gratis' },
  near: { pt: 'Perto de {c}', en: 'Near {c}', es: 'Cerca de {c}' },
  radius: { pt: 'Distância máxima', en: 'Maximum distance', es: 'Distancia máxima' },
  chooseLoc: { pt: 'Escolha sua cidade', en: 'Choose your city', es: 'Elige tu ciudad' },
  useGps: { pt: '📍 Usar minha localização', en: '📍 Use my location', es: '📍 Usar mi ubicación' },
  locating: { pt: 'Localizando…', en: 'Locating…', es: 'Buscando…' },
  gpsDenied: { pt: 'Não deu para usar a localização. Digite sua cidade abaixo.', en: "Couldn't get your location. Type your city below.", es: 'No se pudo obtener tu ubicación. Escribe tu ciudad abajo.' },
  cityPh: { pt: 'Ou digite sua cidade…', en: 'Or type your city…', es: 'O escribe tu ciudad…' },
  noCity: { pt: 'Nenhuma cidade encontrada', en: 'No city found', es: 'Ninguna ciudad encontrada' },
  welcomeT: { pt: 'Onde a família está?', en: 'Where is the family?', es: '¿Dónde está la familia?' },
  welcomeS: { pt: 'Mostramos festivais, gastronomia e festas a até {km} km. Sua localização fica só no seu aparelho.',
              en: 'We show festivals, food and folk festivals within {km} km. Your location stays on your device.',
              es: 'Mostramos festivales, gastronomía y fiestas a menos de {km} km. Tu ubicación queda en tu dispositivo.' },
  typeCity: { pt: 'Escolher cidade', en: 'Pick a city', es: 'Elegir ciudad' },
  loading: { pt: 'Carregando a agenda…', en: 'Loading events…', es: 'Cargando la agenda…' },
  srchGo: { pt: '🔎 Buscar mais perto de mim', en: '🔎 Find more near me', es: '🔎 Buscar más cerca de mí' },
  srchGoRun: { pt: '🔎 Buscando…', en: '🔎 Searching…', es: '🔎 Buscando…' },
  srchT: { pt: 'Quer mais opções por perto?', en: 'Want more nearby options?', es: '¿Quieres más opciones cerca?' },
  srchBtn: { pt: '🔎 Buscar mais eventos perto de mim', en: '🔎 Find more events near me', es: '🔎 Buscar más eventos cerca de mí' },
  srchS: { pt: 'A IA vasculha as agendas da sua região: prefeituras, SESC, bilheterias e imprensa local. 1 busca por semana; o que ela achar fica para todas as famílias por perto.',
           en: 'AI combs through your region’s listings: city halls, SESC, ticket sites and local press. 1 search a week; what it finds stays for every family nearby.',
           es: 'La IA revisa las agendas de tu región: alcaldías, SESC, boleterías y prensa local. 1 búsqueda por semana; lo que encuentre queda para todas las familias cercanas.' },
  srchRun: { pt: 'Procurando passeios perto de {c}…', en: 'Looking for outings near {c}…', es: 'Buscando paseos cerca de {c}…' },
  srchRunS: { pt: 'Os eventos aparecem aqui conforme vamos achando.', en: 'Events show up here as we find them.', es: 'Los eventos aparecen aquí a medida que los encontramos.' },
  srchSoFar: { pt: '{n} encontrados até agora — procurando mais…', en: '{n} found so far — looking for more…', es: '{n} encontrados hasta ahora — buscando más…' },
  srchSoFar1: { pt: '1 encontrado até agora — procurando mais…', en: '1 found so far — looking for more…', es: '1 encontrado hasta ahora — buscando más…' },
  srchTips: { pt: '🎶 festivais de música|🍲 festivais gastronômicos|🧒 teatro infantil|🌳 parques e atividades ao ar livre|🛍️ feiras de artesanato|🎉 festas populares',
              en: '🎶 music festivals|🍲 food festivals|🧒 kids’ theatre|🌳 parks and outdoor fun|🛍️ craft fairs|🎉 folk festivals',
              es: '🎶 festivales de música|🍲 festivales gastronómicos|🧒 teatro infantil|🌳 parques y aire libre|🛍️ ferias de artesanía|🎉 fiestas populares' },
  srchDone: { pt: 'Pronto! Encontramos {n} eventos na sua região.', en: 'Done! We found {n} events in your region.', es: '¡Listo! Encontramos {n} eventos en tu región.' },
  srchNone: { pt: 'Procuramos bem, mas não achamos nada novo para os próximos dias. Volte na semana que vem!', en: 'We looked hard but found nothing new for the coming days. Check back next week!', es: 'Buscamos bien, pero no hay nada nuevo para los próximos días. ¡Vuelve la próxima semana!' },
  srchCached: { pt: 'A região de {p} já foi pesquisada em {d} — os eventos encontrados já estão na lista. Nova busca a partir de {n}.', en: 'The {p} area was searched on {d} — what we found is already in the list. Next search from {n}.', es: 'La región de {p} se buscó el {d} — lo encontrado ya está en la lista. Nueva búsqueda desde el {n}.' },
  srchLimited: { pt: 'Você já usou a busca desta semana. A próxima fica liberada em {n}.', en: 'You’ve used this week’s search. The next one opens on {n}.', es: 'Ya usaste la búsqueda de esta semana. La próxima se libera el {n}.' },
  srchBusy: { pt: 'Alguém aqui perto está buscando agora. Volte em alguns minutos para ver o resultado.', en: 'Someone nearby is searching right now. Come back in a few minutes to see the results.', es: 'Alguien cerca está buscando ahora. Vuelve en unos minutos para ver el resultado.' },
  srchBudget: { pt: 'Muitas buscas hoje! Tente de novo amanhã.', en: 'Lots of searches today! Try again tomorrow.', es: '¡Muchas búsquedas hoy! Inténtalo mañana.' },
  srchErr: { pt: 'A busca não está disponível agora. Tente mais tarde.', en: 'Search isn’t available right now. Try later.', es: 'La búsqueda no está disponible ahora. Inténtalo más tarde.' },
  loadFail: { pt: 'Não conseguimos carregar a agenda. Confira sua conexão e tente de novo.', en: "We couldn't load events. Check your connection and try again.", es: 'No pudimos cargar la agenda. Revisa tu conexión e inténtalo de nuevo.' },
  retry: { pt: 'Tentar de novo', en: 'Try again', es: 'Reintentar' },
  building: { pt: 'A agenda está sendo montada', en: 'The agenda is being built', es: 'La agenda se está armando' },
  buildingS: { pt: 'Estamos reunindo os eventos de todo o Brasil. Volte em algumas horas!', en: "We're gathering events from all over Brazil. Check back in a few hours!", es: 'Estamos reuniendo eventos de todo Brasil. ¡Vuelve en unas horas!' },
  emptyT: { pt: 'Nada por aqui {d}', en: 'Nothing nearby {d}', es: 'Nada por aquí {d}' },
  emptyS: { pt: 'Não achamos eventos a até {km} km{c}. Experimente:', en: 'No events within {km} km{c}. Try:', es: 'No hay eventos a menos de {km} km{c}. Prueba:' },
  inCat: { pt: ' em {c}', en: ' in {c}', es: ' en {c}' },
  allCats: { pt: 'Todas as categorias', en: 'All categories', es: 'Todas las categorías' },
  paidToo: { pt: 'Incluir pagos', en: 'Include paid', es: 'Incluir de pago' },
  further: { pt: 'Um pouco mais longe', en: 'A little further away', es: 'Un poco más lejos' },
  highlight: { pt: 'Destaque', en: 'Highlight', es: 'Destacado' },
  more: { pt: 'Mais passeios', en: 'More outings', es: 'Más salidas' },
  stats: { pt: '<b>{n}</b> {w} perto de você {d}', en: '<b>{n}</b> {w} near you {d}', es: '<b>{n}</b> {w} cerca de ti {d}' },
  outing1: { pt: 'passeio', en: 'outing', es: 'salida' },
  outingN: { pt: 'passeios', en: 'outings', es: 'salidas' },
  dToday: { pt: 'hoje', en: 'today', es: 'hoy' },
  dTomorrow: { pt: 'amanhã', en: 'tomorrow', es: 'mañana' },
  dWeekend: { pt: 'no fim de semana', en: 'this weekend', es: 'este fin de semana' },
  dNextwk: { pt: 'no próximo fim de semana', en: 'next weekend', es: 'el próximo fin de semana' },
  details: { pt: 'Detalhes', en: 'Details', es: 'Detalles' },
  directions: { pt: 'Como chegar', en: 'Directions', es: 'Cómo llegar' },
  calendar: { pt: 'Agenda', en: 'Calendar', es: 'Agenda' },
  share: { pt: 'Compartilhar', en: 'Share', es: 'Compartir' },
  copied: { pt: 'Link copiado!', en: 'Link copied!', es: '¡Enlace copiado!' },
  freeB: { pt: 'Grátis', en: 'Free', es: 'Gratis' },
  paidB: { pt: 'Pago', en: 'Paid', es: 'De pago' },
  kidsB: { pt: 'Bom para crianças', en: 'Kid-friendly', es: 'Para niños' },
  weeklyB: { pt: 'Toda semana', en: 'Every week', es: 'Cada semana' },
  drive: { pt: '~{t} de carro', en: '~{t} by car', es: '~{t} en coche' },
  until: { pt: 'até {d}', en: 'until {d}', es: 'hasta {d}' },
  updated: { pt: 'Agenda atualizada em {d}', en: 'Agenda updated {d}', es: 'Agenda actualizada el {d}' },
  stale: { pt: 'A agenda não é atualizada há alguns dias. Confirme no site do evento antes de sair.', en: "The agenda hasn't refreshed in a few days. Check the event's site before you go.", es: 'La agenda no se actualiza hace unos días. Confirma en el sitio del evento antes de salir.' },
  privacy: { pt: 'Privacidade', en: 'Privacy', es: 'Privacidad' },
  suggest: { pt: '＋ Organiza um evento? Cadastre no Muse', en: '＋ Organizing an event? List it on Muse', es: '＋ ¿Organizas un evento? Regístralo en Muse' },
  shareApp: { pt: 'Compartilhar o Muse', en: 'Share Muse', es: 'Compartir Muse' },
  shareAppMsg: { pt: 'Muse: passeios em família perto de você — festivais de música, gastronomia, festas e programação infantil, hoje e no fim de semana.',
                 en: 'Muse: family day-outs near you — music festivals, food, folk festivals and kids’ shows, today and this weekend.',
                 es: 'Muse: paseos en familia cerca de ti — festivales de música, gastronomía, fiestas y programación infantil, hoy y el fin de semana.' },
  linkCopied: { pt: 'Link copiado!', en: 'Link copied!', es: '¡Enlace copiado!' },
  orgB: { pt: '✓ Cadastrado pelo organizador', en: '✓ Listed by the organizer', es: '✓ Registrado por el organizador' },
  labTitle: { pt: 'Como o Muse funciona', en: 'How Muse works', es: 'Cómo funciona Muse' },
  labBody: {
    pt: '<p><b>De onde vêm os eventos.</b> Todo dia o Muse revisa a agenda; duas vezes por semana uma IA pesquisa a web por eventos familiares em todos os estados e confirma as datas dos grandes festivais anuais.</p><p><b>Nada entra sem checagem.</b> Cada evento precisa de datas concretas, de uma cidade real e de uma página-fonte que funcione. Eventos +18 ficam de fora.</p><p><b>{km} km.</b> A distância é em linha reta a partir da sua cidade; o tempo de carro é uma estimativa. Sua localização nunca sai do seu aparelho.</p><p><b>Antes de sair</b>, confirme horários no link “Detalhes”: eventos mudam.</p>',
    en: '<p><b>Where events come from.</b> Muse refreshes its agenda daily; twice a week an AI searches the web for family events in every Brazilian state and confirms the dates of the big annual festivals.</p><p><b>Nothing goes in unchecked.</b> Every event needs concrete dates, a real city and a working source page. Adults-only events are left out.</p><p><b>{km} km.</b> Distance is a straight line from your city; drive time is an estimate. Your location never leaves your device.</p><p><b>Before you go</b>, confirm times on the “Details” link: events change.</p>',
    es: '<p><b>De dónde vienen los eventos.</b> Muse revisa la agenda a diario; dos veces por semana una IA busca en la web eventos familiares en todos los estados y confirma las fechas de los grandes festivales anuales.</p><p><b>Nada entra sin verificar.</b> Cada evento necesita fechas concretas, una ciudad real y una página fuente que funcione. Los eventos +18 quedan fuera.</p><p><b>{km} km.</b> La distancia es en línea recta desde tu ciudad; el tiempo en coche es una estimación. Tu ubicación nunca sale de tu dispositivo.</p><p><b>Antes de salir</b>, confirma horarios en “Detalles”: los eventos cambian.</p>',
  },
};

/* ---------------- utils ---------------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const store = {
  get(k, fb) { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch (e) { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const catName = (c) => CATS[c].name[state.lang] || CATS[c].name.pt;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '#');

function haversine(aLat, aLng, bLat, bLng) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* ---------------- state ---------------- */
function detectLang() {
  const saved = store.get('muse-lang', null); if (saved && ['pt', 'en', 'es'].includes(saved)) return saved;
  const n = (navigator.language || 'pt').slice(0, 2).toLowerCase();
  return n === 'es' ? 'es' : n === 'en' ? 'en' : 'pt';
}
const state = { lang: detectLang(), day: 'today', cat: 'all', free: false, focus: null, loc: store.get('muse-loc', null),
  km: RADII.includes(store.get('muse-km', DEFAULT_KM)) ? store.get('muse-km', DEFAULT_KM) : DEFAULT_KM };
let DATA = null, LOAD_ERR = false, CITIES = null, acItems = [], acIdx = -1;
// on-demand search: events cached for the cells around the family, and the search button's state
const LOCAL = { key: null, events: [], rows: [], myCell: null, org: [] };
const SEARCH = { phase: 'idle', msg: null, tip: 0, timer: null, found: 0 };

function tr(k, vars) {
  const e = T[k]; let s = e ? (e[state.lang] || e.pt) : k;
  if (vars) for (const v in vars) s = s.split('{' + v + '}').join(vars[v]);
  return s.split('{km}').join(String(state.km));
}
function driveText(km) {
  const mins = Math.max(10, Math.round((km * ROAD_FACTOR / AVG_KMH) * 60 / 5) * 5);
  const t = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h${mins % 60 ? String(mins % 60).padStart(2, '0') : ''}`;
  return tr('drive', { t });
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.day = DAYS.includes(p.get('d')) ? p.get('d') : 'today';
  const c = p.get('c'); state.cat = c && CATS[c] ? c : 'all';
  state.free = p.get('f') === '1';
  state.focus = p.get('e') || null;
}
function writeHash() {
  const p = new URLSearchParams();
  if (state.day !== 'today') p.set('d', state.day);
  if (state.cat !== 'all') p.set('c', state.cat);
  if (state.free) p.set('f', '1');
  const h = p.toString();
  history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
}

/* ---------------- dates (device-local calendar days) ---------------- */
const DAYS = ['today', 'tomorrow', 'weekend', 'nextwk'];
function viewDays(which) {
  const n = new Date(); const t = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const plus = (d, k) => { const x = new Date(d); x.setDate(x.getDate() + k); return x; };
  if (which === 'today') return [ymd(t)];
  if (which === 'tomorrow') return [ymd(plus(t, 1))];
  const w = t.getDay();
  if (which === 'nextwk') { // the Saturday-Sunday after the one the "weekend" tab shows
    const sat = plus(t, w === 6 ? 7 : w === 0 ? 6 : 13 - w); return [ymd(sat), ymd(plus(sat, 1))];
  }
  if (w === 6) return [ymd(t), ymd(plus(t, 1))];
  if (w === 0) return [ymd(t)];
  const sat = plus(t, 6 - w); return [ymd(sat), ymd(plus(sat, 1))];
}
const fmt = (s, opts) => new Intl.DateTimeFormat(LOCALE[state.lang], opts).format(parseYmd(s));
function dayLabel(which) {
  const ds = viewDays(which);
  if (ds.length > 1) { // "28–29/11", or "31/1–1/2" when the weekend crosses a month (US order in English)
    const [, m1, d1] = ds[0].split('-').map(Number), [, m2, d2] = ds[1].split('-').map(Number);
    if (state.lang === 'en') return m1 === m2 ? `${m1}/${d1}–${d2}` : `${m1}/${d1}–${m2}/${d2}`;
    return m1 === m2 ? `${d1}–${d2}/${m2}` : `${d1}/${m1}–${d2}/${m2}`;
  }
  return fmt(ds[0], { weekday: 'short', day: 'numeric', month: 'numeric' });
}
function whenText(e, days) {
  const time = e.time ? ` · ${e.time.replace(/:00$/, 'h').replace(':', 'h')}` : '';
  if (e.start === e.end) return fmt(e.start, { weekday: 'short', day: 'numeric', month: 'short' }) + time;
  if (e.start <= days[0]) return tr('until', { d: fmt(e.end, { day: 'numeric', month: 'short' }) }) + time;
  return `${fmt(e.start, { day: 'numeric', month: 'short' })} – ${fmt(e.end, { day: 'numeric', month: 'short' })}${time}`;
}

/* ---------------- data ---------------- */
async function loadEvents() {
  LOAD_ERR = false;
  try {
    const r = await fetch('events.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('http ' + r.status);
    DATA = await r.json();
  } catch (e) { LOAD_ERR = true; }
  render();
  loadArea();
}
async function loadCities() {
  if (CITIES) return CITIES;
  const j = await (await fetch('cities.json')).json();
  CITIES = j.c.map(([n, uf, lat, lng, cap]) => ({ n, uf, lat, lng, cap, f: fold(n) }));
  return CITIES;
}

/* ---------------- on-demand local search ---------------- */
const cellOf = (lat, lng) => `${Math.floor(lat * 2)}_${Math.floor(lng * 2)}`; // same grid as api/search.mjs
function allEvents() {
  const base = (DATA && DATA.events) || [];
  if (!LOCAL.events.length && !LOCAL.org.length) return base;
  // organizer listings first: when the same event was also found by search, the organizer's version wins
  const seen = new Set(LOCAL.org.map((e) => e.id));
  return LOCAL.org.concat(base.filter((e) => !seen.has(e.id) && seen.add(e.id)), LOCAL.events.filter((e) => !seen.has(e.id) && seen.add(e.id)));
}
async function nearestCity(lat, lng) {
  const cs = await loadCities(); let best = Infinity, near = null;
  for (const c of cs) { const k = haversine(lat, lng, c.lat, c.lng); if (k < best) { best = k; near = c; } }
  return near;
}
async function loadArea(force) {
  if (!state.loc) return;
  const loc = state.loc, key = `${loc.lat.toFixed(3)},${loc.lng.toFixed(3)},${state.km}`;
  if (!force && LOCAL.key === key) return;
  LOCAL.key = key;
  const dLat = (state.km + 60) / 111, dLng = (state.km + 60) / (111 * Math.cos(loc.lat * Math.PI / 180));
  const q = `select=cell,place,searched_at,events&lat=gte.${(loc.lat - dLat).toFixed(3)}&lat=lte.${(loc.lat + dLat).toFixed(3)}`
    + `&lng=gte.${(loc.lng - dLng).toFixed(3)}&lng=lte.${(loc.lng + dLng).toFixed(3)}`;
  try {
    const near = await nearestCity(loc.lat, loc.lng).catch(() => null);
    LOCAL.myCell = near ? cellOf(near.lat, near.lng) : null;
    const hdr = { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY } };
    const [r, o] = await Promise.all([fetch(`${AREA_ENDPOINT}?${q}`, hdr),
      fetch(`${ORG_ENDPOINT}?${q.replace('select=cell,place,searched_at,events', 'select=event')}`, hdr).catch(() => null)]);
    if (o && o.ok) { const orows = await o.json().catch(() => []); if (LOCAL.key === key) LOCAL.org = orows.map((x) => x.event).filter((e) => e && e.id); }
    if (!r.ok) { render(); return; }
    const rows = await r.json(); if (LOCAL.key !== key) return;
    const today = ymd(new Date());
    LOCAL.rows = rows;
    LOCAL.events = rows.flatMap((x) => Array.isArray(x.events) ? x.events : []).filter((e) => e && e.id && e.end >= today);
    render();
  } catch (e) { /* the cache is a bonus: the agenda works without it */ }
}
const dateShort = (iso) => new Date(iso).toLocaleDateString(LOCALE[state.lang], { day: 'numeric', month: 'short' }).replace(/\.$/, '');
function searchCard() {
  if (!state.loc) return '';
  const here = state.loc.uf ? `${state.loc.name}` : '';
  if (SEARCH.phase === 'running') {
    const tips = tr('srchTips').split('|');
    return `<div class="card srch running" role="status"><div class="big spin" aria-hidden="true">🔎</div><h2>${esc(tr('srchRun', { c: here || '…' }))}</h2>
      <p class="tip">${esc(tips[SEARCH.tip % tips.length])}</p>
      <p class="mut">${esc(SEARCH.found ? (SEARCH.found === 1 ? tr('srchSoFar1') : tr('srchSoFar', { n: SEARCH.found })) : tr('srchRunS'))}</p></div>`;
  }
  const mine = LOCAL.rows.find((x) => x.cell === LOCAL.myCell);
  const next = store.get('muse-search-next', null);
  let note = SEARCH.msg ? `<p class="srchmsg">${esc(SEARCH.msg)}</p>` : '';
  let body;
  if (mine) body = `<p>${esc(tr('srchCached', { p: mine.place, d: dateShort(mine.searched_at), n: dateShort(Date.parse(mine.searched_at) + 7 * 86400000) }))}</p>`;
  else if (next && Date.parse(next) > Date.now()) body = `<p>${esc(tr('srchLimited', { n: dateShort(next) }))}</p>`;
  else body = `<p class="mut">${esc(tr('srchS'))}</p><div class="row"><button class="btn pink" type="button" data-search>${esc(tr('srchBtn'))}</button></div>`;
  return `<div class="card srch"><h2>${esc(tr('srchT'))}</h2>${note}${body}</div>`;
}
function canSearch() {
  const next = store.get('muse-search-next', null);
  return !LOCAL.rows.find((x) => x.cell === LOCAL.myCell) && !(next && Date.parse(next) > Date.now());
}
function addLocal(events) {
  if (!Array.isArray(events)) return 0;
  const ids = new Set(allEvents().map((e) => e.id));
  const fresh = events.filter((e) => e && e.id && !ids.has(e.id));
  LOCAL.events = LOCAL.events.concat(fresh);
  return fresh.length;
}
async function runSearch() {
  if (SEARCH.phase === 'running' || !state.loc) return;
  SEARCH.phase = 'running'; SEARCH.msg = null; SEARCH.tip = 0; SEARCH.found = 0;
  SEARCH.timer = setInterval(() => { SEARCH.tip++; const t = document.querySelector('.srch.running .tip'); if (t) t.textContent = tr('srchTips').split('|')[SEARCH.tip % 6]; }, 2500);
  render();
  const el = document.querySelector('.srch'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  let res = null;
  try {
    const r = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: state.loc.lat, lng: state.loc.lng, sid: getSid() }) });
    if ((r.headers.get('content-type') || '').includes('ndjson') && r.body) {
      // the search streams one line per finished lens: show each batch as soon as it arrives
      const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (value) buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          let m; try { m = JSON.parse(line); } catch (e) { continue; }
          if (m.type === 'events') { SEARCH.found += addLocal(m.events); render(); }
          else if (m.type === 'done') res = m;
        }
        if (done) break;
      }
      if (!res) res = { status: SEARCH.found ? 'done' : 'error' };
    } else res = await r.json().catch(() => null);
  } catch (e) { res = SEARCH.found ? { status: 'done' } : null; }
  clearInterval(SEARCH.timer); SEARCH.phase = 'idle';
  const st = res && res.status;
  if (st === 'done') {
    store.set('muse-search-next', new Date(Date.now() + 7 * 86400000).toISOString());
    if (Array.isArray(res.events)) SEARCH.found += addLocal(res.events);
    SEARCH.msg = SEARCH.found ? tr('srchDone', { n: SEARCH.found }) : tr('srchNone');
    loadArea(true);
  } else if (st === 'cached') { loadArea(true); }
  else if (st === 'limited') { if (res.next_at) store.set('muse-search-next', res.next_at); }
  else SEARCH.msg = tr(st === 'busy' ? 'srchBusy' : st === 'budget' ? 'srchBudget' : 'srchErr');
  logClick('search', { id: 'local-search', cat: 'music', uf: state.loc.uf || null });
  render();
}

function visibleEvents(which, opts) {
  opts = opts || {};
  if (!DATA || !state.loc) return [];
  const days = viewDays(which), first = days[0], last = days[days.length - 1];
  const max = opts.maxKm || state.km;
  const out = [];
  for (const e of allEvents()) {
    if (!(e.start <= last && e.end >= first)) continue;
    if (!opts.ignoreCat && state.cat !== 'all' && e.cat !== state.cat) continue;
    if (!opts.ignoreFree && state.free && e.price !== 'free') continue;
    const km = haversine(state.loc.lat, state.loc.lng, e.lat, e.lng);
    if (km > max) continue;
    out.push({ e, km });
  }
  // music festivals lead, then the other categories by priority; nearest first within each
  out.sort((a, b) => CAT_ORDER.indexOf(a.e.cat) - CAT_ORDER.indexOf(b.e.cat) || a.km - b.km || a.e.start.localeCompare(b.e.start));
  return out;
}

/* ---------------- telemetry (anonymous counts) ---------------- */
function getSid() { let s = store.get('muse-sid', null); if (!s) { s = 's' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); store.set('muse-sid', s); } return s; }
function logClick(kind, e) {
  try {
    fetch(CLICK_ENDPOINT, { method: 'POST', keepalive: true,
      headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ sid: getSid(), event_id: String(e.id).slice(0, 160), cat: e.cat, kind, uf: e.uf, lang: state.lang }) }).catch(() => {});
  } catch (err) {}
}

/* ---------------- calendar (.ics) ---------------- */
const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function downloadIcs(e) {
  const days = viewDays(state.day);
  const day = e.start > days[0] ? e.start : days[0]; // the day the family is actually going, not a months-long range
  const d = day.replace(/-/g, '');
  const next = ymd(new Date(parseYmd(day).getTime() + 36 * 3600000)).replace(/-/g, '');
  let when;
  if (e.time) {
    const [h, m] = e.time.split(':').map(Number);
    const p2 = (n) => String(n).padStart(2, '0');
    when = `DTSTART;TZID=America/Sao_Paulo:${d}T${p2(h)}${p2(m)}00\r\nDTEND;TZID=America/Sao_Paulo:${d}T${p2(Math.min(23, h + 3))}${p2(m)}00`;
  } else when = `DTSTART;VALUE=DATE:${d}\r\nDTEND;VALUE=DATE:${next}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const desc = ((e.d && (e.d[state.lang] || e.d.pt)) || '') + '\n' + e.url;
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Muse//muse-find.com//PT', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${icsText(e.id)}-${d}@muse-find.com`, `DTSTAMP:${stamp}`, when, `SUMMARY:${icsText(e.t)}`,
    `LOCATION:${icsText([e.venue, `${e.city} - ${e.uf}`].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${icsText(desc)}`, `URL:${safeUrl(e.url)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  a.download = `muse-${fold(e.t).replace(/ /g, '-').slice(0, 40) || 'evento'}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const mapsUrl = (e) => 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent([e.venue, `${e.city} - ${e.uf}`, 'Brasil'].filter(Boolean).join(', '));

async function shareEvent(e, btn) {
  const url = location.origin + location.pathname + '#e=' + encodeURIComponent(e.id) + (state.day !== 'today' ? '&d=' + state.day : '');
  if (navigator.share) { try { await navigator.share({ title: 'Muse — ' + e.t, text: `${e.t} — ${e.city}/${e.uf}`, url }); } catch (err) {} return; }
  try {
    await navigator.clipboard.writeText(url);
    const s = btn.querySelector('span'); const old = s.textContent; s.textContent = tr('copied'); setTimeout(() => { s.textContent = old; }, 1600);
  } catch (err) {}
}

// footer button: invite friends to the app itself (native share sheet on phones, copy link elsewhere)
async function shareApp() {
  const url = 'https://muse-find.com/';
  if (navigator.share) { try { await navigator.share({ title: 'Muse', text: tr('shareAppMsg'), url }); } catch (err) {} return; }
  try {
    await navigator.clipboard.writeText(url);
    $('shareAppTxt').textContent = tr('linkCopied'); setTimeout(() => { $('shareAppTxt').textContent = tr('shareApp'); }, 1800);
  } catch (err) {}
}

/* ---------------- rendering ---------------- */
const ICON = {
  link: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  car: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 17h14M6 17v2M18 17v2"/><path d="M4 13l2-5a2 2 0 0 1 2-1.4h8A2 2 0 0 1 18 8l2 5v4H4z"/></svg>',
  cal: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M12 13v4M10 15h4"/></svg>',
  share: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg>',
};

function card(x, hero) {
  const e = x.e, days = viewDays(state.day);
  if (!CATS[e.cat]) return '';
  const desc = e.d && (e.d[state.lang] || e.d.pt || e.d.en);
  const badges = [];
  if (e.price === 'free') badges.push(`<span class="badge free">${esc(tr('freeB'))}</span>`);
  else if (e.price === 'paid') badges.push(`<span class="badge">${esc(e.priceText || tr('paidB'))}</span>`);
  if (e.kids === 'yes') badges.push(`<span class="badge kids">${esc(tr('kidsB'))}</span>`);
  if (e.weekly) badges.push(`<span class="badge week">${esc(tr('weeklyB'))}</span>`);
  if (e.org) badges.push(`<span class="badge org">${esc(tr('orgB'))}</span>`);
  return `<article class="ev cat-${e.cat}${hero ? ' hero' : ''}" id="ev-${esc(e.id)}" data-id="${esc(e.id)}">
  <div class="band"><span>${CATS[e.cat].emoji} ${esc(hero ? tr('highlight') + ' · ' + catName(e.cat) : catName(e.cat))}</span><span class="when">${esc(whenText(e, days))}</span></div>
  ${e.img ? `<img class="cover" src="${esc(safeUrl(e.img))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
  <div class="body">
    <h3>${esc(e.t)}</h3>
    <div class="meta">
      ${e.venue ? `<div><span class="ico" aria-hidden="true">📍</span><span>${esc(e.venue)}</span></div>` : ''}
      <div><span class="ico" aria-hidden="true">🚗</span><span><b>${esc(e.city)}/${esc(e.uf)}</b> · ${Math.round(x.km)} km · ${esc(driveText(x.km))}</span></div>
    </div>
    ${desc ? `<p class="desc">${esc(desc)}</p>` : ''}
    ${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}
    <div class="acts">
      <a class="act primary" data-act="details" href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener noreferrer">${ICON.link}<span>${esc(tr('details'))}</span></a>
      <a class="act" data-act="directions" href="${esc(mapsUrl(e))}" target="_blank" rel="noopener noreferrer">${ICON.car}<span>${esc(tr('directions'))}</span></a>
      <button class="act" type="button" data-act="calendar">${ICON.cal}<span>${esc(tr('calendar'))}</span></button>
      <button class="act" type="button" data-act="share">${ICON.share}<span>${esc(tr('share'))}</span></button>
    </div>
  </div>
</article>`;
}

function renderChrome() {
  document.documentElement.lang = LOCALE[state.lang];
  $('langs').innerHTML = ['pt', 'en', 'es'].map((l) => `<button type="button" data-lang="${l}" aria-pressed="${state.lang === l}">${l.toUpperCase()}</button>`).join('');
  $('tagline').innerHTML = tr('tagline');
  $('locText').textContent = state.loc ? tr('near', { c: state.loc.uf ? `${state.loc.name}/${state.loc.uf}` : state.loc.name }) : tr('chooseLoc');
  $('locRadius').textContent = `${state.km} km`;
  $('radiusLbl').textContent = tr('radius');
  $('radii').innerHTML = RADII.map((k) => `<button type="button" class="chip" data-km="${k}" aria-pressed="${state.km === k}">${k} km</button>`).join('');
  if (!$('gpsBtn').disabled) $('gpsBtn').textContent = tr('useGps');
  $('q').placeholder = tr('cityPh');
  $('days').innerHTML = DAYS.map((d) =>
    `<button type="button" data-day="${d}" aria-pressed="${state.day === d}"><span class="dl">${esc(tr(d))}</span><span class="dd">${esc(dayLabel(d))}</span></button>`).join('');
  const base = visibleEvents(state.day, { ignoreCat: true });
  const count = (c) => base.filter((x) => x.e.cat === c).length;
  $('cats').innerHTML = `<button type="button" class="chip" data-cat="all" aria-pressed="${state.cat === 'all'}">✨ ${esc(tr('all'))} <span class="n">${base.length}</span></button>`
    + CAT_ORDER.map((c) => { const n = count(c); return `<button type="button" class="chip cat-${c}${n ? '' : ' zero'}" data-cat="${c}" aria-pressed="${state.cat === c}">${CATS[c].emoji} ${esc(catName(c))} <span class="n">${n}</span></button>`; }).join('')
    + `<button type="button" class="chip free" data-free aria-pressed="${state.free}">💸 ${esc(tr('free'))}</button>`;
  $('labTitle').textContent = tr('labTitle');
  $('labBody').innerHTML = tr('labBody');
  $('suggestBtn').textContent = tr('suggest');
  $('shareAppTxt').textContent = tr('shareApp');
  const upd = DATA && DATA.generated ? tr('updated', { d: new Intl.DateTimeFormat(LOCALE[state.lang], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(DATA.generated)) }) + ' · ' : '';
  $('foot').innerHTML = `${esc(upd)}<a href="privacy.html">${esc(tr('privacy'))}</a>`;
}

function renderStats(list) {
  const dk = { today: 'dToday', tomorrow: 'dTomorrow', weekend: 'dWeekend', nextwk: 'dNextwk' }[state.day];
  const ready = state.loc && DATA && !LOAD_ERR && allEvents().length;
  $('stats').innerHTML = ready
    ? tr('stats', { n: list.length, w: esc(tr(list.length === 1 ? 'outing1' : 'outingN')), d: esc(tr(dk)) })
      + `<button class="morebtn" type="button" data-search-go${SEARCH.phase === 'running' ? ' disabled' : ''}>${esc(tr(SEARCH.phase === 'running' ? 'srchGoRun' : 'srchGo'))}</button>` : '';
}

function render() {
  renderChrome();
  const out = $('out');
  if (!state.loc) {
    renderStats([]);
    out.innerHTML = `<div class="card"><div class="big" aria-hidden="true">👨‍👩‍👧‍👦</div><h2>${esc(tr('welcomeT'))}</h2><p>${esc(tr('welcomeS'))}</p>
      <div class="row"><button class="btn pink" type="button" data-gps>${esc(tr('useGps'))}</button><button class="btn alt" type="button" data-openloc>${esc(tr('typeCity'))}</button></div></div>`;
    return;
  }
  if (LOAD_ERR) { renderStats([]); out.innerHTML = `<div class="card"><div class="big" aria-hidden="true">📡</div><p>${esc(tr('loadFail'))}</p><div class="row"><button class="btn" type="button" data-retry>${esc(tr('retry'))}</button></div></div>`; return; }
  if (!DATA) { out.innerHTML = `<p class="vh">${esc(tr('loading'))}</p><div class="skel"></div><div class="skel"></div>`; return; }
  if (!allEvents().length) { renderStats([]); out.innerHTML = `<div class="card"><div class="big" aria-hidden="true">🎪</div><h2>${esc(tr('building'))}</h2><p>${esc(tr('buildingS'))}</p></div>`; return; }

  const list = visibleEvents(state.day);
  renderStats(list);
  let html = '';
  if (DATA.generated && Date.now() - Date.parse(DATA.generated) > 4 * 86400000) html += `<div class="notice">${esc(tr('stale'))}</div>`;
  const searchTop = SEARCH.phase === 'running' || !!SEARCH.msg;
  if (searchTop) html += searchCard();
  if (!list.length) html += emptyState() + (searchTop ? '' : searchCard());
  else {
    const heroIdx = list.findIndex((x) => x.e.cat === 'music');
    const hero = list[heroIdx >= 0 ? heroIdx : 0];
    html += card(hero, true);
    const rest = list.filter((x) => x !== hero);
    if (rest.length) html += `<h2 class="sec">${esc(tr('more'))} <span class="pillc">${rest.length}</span></h2>` + rest.map((x) => card(x, false)).join('');
    if (!searchTop) html += searchCard();
  }
  out.innerHTML = html;
  if (state.focus) {
    const el = document.getElementById('ev-' + state.focus);
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('hero'); }
    state.focus = null;
  }
}

function emptyState() {
  const dk = { today: 'dToday', tomorrow: 'dTomorrow', weekend: 'dWeekend', nextwk: 'dNextwk' }[state.day];
  const alts = [];
  for (const d of DAYS) {
    if (d === state.day) continue;
    const n = visibleEvents(d).length;
    if (n) alts.push(`<button class="btn alt" type="button" data-day="${d}">${esc(tr(d))} (${n})</button>`);
  }
  if (state.cat !== 'all') { const n = visibleEvents(state.day, { ignoreCat: true }).length; if (n) alts.push(`<button class="btn alt" type="button" data-cat="all">${esc(tr('allCats'))} (${n})</button>`); }
  if (state.free) { const n = visibleEvents(state.day, { ignoreFree: true }).length; if (n) alts.push(`<button class="btn alt" type="button" data-free>${esc(tr('paidToo'))} (${n})</button>`); }
  const far = visibleEvents(state.day, { maxKm: farKm() }).filter((x) => x.km > state.km).sort((a, b) => a.km - b.km).slice(0, 3);
  const farHtml = far.length ? `<div class="near"><strong>${esc(tr('further'))}</strong>${far.map((x) =>
    `<button type="button" data-far="${esc(x.e.id)}"><span>${CATS[x.e.cat].emoji} ${esc(x.e.t)} — ${esc(x.e.city)}/${esc(x.e.uf)}</span><span class="k">${Math.round(x.km)} km</span></button>`).join('')}</div>` : '';
  return `<div class="card"><div class="big" aria-hidden="true">🔭</div><h2>${esc(tr('emptyT', { d: tr(dk) }))}</h2>
    <p>${esc(tr('emptyS', { c: state.cat !== 'all' ? tr('inCat', { c: catName(state.cat) }) : '' }))}</p>
    ${alts.length ? `<div class="row">${alts.join('')}</div>` : ''}${farHtml}</div>`;
}

function renderFar(id) {
  const e = allEvents().find((x) => x.id === id); if (!e) return;
  const km = haversine(state.loc.lat, state.loc.lng, e.lat, e.lng);
  $('out').insertAdjacentHTML('beforeend', card({ e, km }, false));
  const el = document.getElementById('ev-' + id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ---------------- location ---------------- */
function setLoc(loc) { state.loc = loc; store.set('muse-loc', loc); togglePanel(false); SEARCH.msg = null; render(); loadArea(); }
function togglePanel(open, noFocus) {
  $('locPanel').hidden = !open; $('locBtn').setAttribute('aria-expanded', String(open));
  if (open) { loadCities().catch(() => {}); if (!noFocus) setTimeout(() => $('q').focus(), 30); }
  else { $('q').value = ''; $('locNote').textContent = ''; hideAC(); }
}
function useGps() {
  if (!navigator.geolocation) { togglePanel(true); $('locNote').textContent = tr('gpsDenied'); return; }
  const btn = $('gpsBtn'); btn.disabled = true; btn.textContent = tr('locating');
  navigator.geolocation.getCurrentPosition(async (pos) => {
    btn.disabled = false;
    const { latitude: lat, longitude: lng } = pos.coords;
    let near = null;
    try { const cs = await loadCities(); let best = Infinity; for (const c of cs) { const k = haversine(lat, lng, c.lat, c.lng); if (k < best) { best = k; near = c; } } } catch (e) {}
    setLoc({ name: near ? near.n : '📍', uf: near ? near.uf : '', lat, lng, mode: 'gps' });
  }, () => {
    btn.disabled = false; btn.textContent = tr('useGps');
    togglePanel(true); $('locNote').textContent = tr('gpsDenied');
  }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 30 * 60000 });
}

/* city autocomplete (combobox) */
function hideAC() { $('ac').hidden = true; acItems = []; acIdx = -1; $('q').setAttribute('aria-expanded', 'false'); $('q').removeAttribute('aria-activedescendant'); }
function renderAC() {
  const ac = $('ac');
  ac.innerHTML = acItems.length
    ? acItems.map((c, i) => `<div class="opt${i === acIdx ? ' sel' : ''}" role="option" id="ac-${i}" data-i="${i}" aria-selected="${i === acIdx}"><span>${esc(c.n)}</span><span class="uf">${esc(c.uf)}</span></div>`).join('')
    : `<div class="none">${esc(tr('noCity'))}</div>`;
  ac.hidden = false; $('q').setAttribute('aria-expanded', 'true');
  if (acIdx >= 0) $('q').setAttribute('aria-activedescendant', 'ac-' + acIdx); else $('q').removeAttribute('aria-activedescendant');
}
async function onCityInput() {
  const q = fold($('q').value);
  if (q.length < 2) { hideAC(); return; }
  const cs = await loadCities();
  if (fold($('q').value) !== q) return; // a newer keystroke already took over
  const starts = [], inner = [];
  for (const c of cs) { if (c.f.startsWith(q)) starts.push(c); else if (c.f.includes(' ' + q)) inner.push(c); }
  const rank = (a, b) => b.cap - a.cap || a.n.length - b.n.length;
  acItems = starts.sort(rank).concat(inner.sort(rank)).slice(0, 8); acIdx = acItems.length ? 0 : -1;
  renderAC();
}
const pickCity = (c) => setLoc({ name: c.n, uf: c.uf, lat: c.lat, lng: c.lng, mode: 'city' });

/* ---------------- wiring ---------------- */
document.addEventListener('click', (ev) => {
  const t = ev.target;
  const lang = t.closest('[data-lang]'); if (lang) { state.lang = lang.dataset.lang; store.set('muse-lang', state.lang); render(); return; }
  const day = t.closest('[data-day]'); if (day) { state.day = day.dataset.day; writeHash(); render(); return; }
  const cat = t.closest('[data-cat]'); if (cat) { state.cat = cat.dataset.cat; writeHash(); render(); return; }
  if (t.closest('[data-free]')) { state.free = !state.free; writeHash(); render(); return; }
  if (t.closest('[data-home]')) { state.day = 'today'; state.cat = 'all'; state.free = false; writeHash(); render(); window.scrollTo(0, 0); return; }
  if (t.closest('#gpsBtn') || t.closest('[data-gps]')) { useGps(); return; }
  const km = t.closest('[data-km]'); if (km) { state.km = +km.dataset.km; store.set('muse-km', state.km); togglePanel(false); render(); loadArea(); return; }
  // tapping the "100 km" pill opens the panel without popping the keyboard (they came to change the distance)
  if (t.closest('#locBtn') || t.closest('[data-openloc]')) { togglePanel($('locPanel').hidden, !!t.closest('#locRadius') && !!state.loc); return; }
  if (t.closest('[data-search]')) { runSearch(); return; }
  // shortcut under the stats line: search right away, or show the card that explains why not
  if (t.closest('[data-search-go]')) { if (canSearch()) runSearch(); else { const c = document.querySelector('.srch'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); } return; }
  if (t.closest('[data-retry]')) { DATA = null; render(); loadEvents(); return; }
  if (t.closest('[data-shareapp]')) { shareApp(); return; }
  if (t.closest('[data-suggest]')) { location.href = 'cadastrar.html'; return; }
  const far = t.closest('[data-far]'); if (far) { renderFar(far.dataset.far); far.remove(); return; }
  const opt = t.closest('.ac .opt'); if (opt) { const c = acItems[+opt.dataset.i]; if (c) pickCity(c); return; }
  const act = t.closest('[data-act]');
  if (act) {
    const art = act.closest('.ev'); const e = art && DATA && allEvents().find((x) => x.id === art.dataset.id); if (!e) return;
    logClick(act.dataset.act, e);
    if (act.dataset.act === 'calendar') downloadIcs(e);
    else if (act.dataset.act === 'share') shareEvent(e, act);
  }
});
// cover images come from each event's own site: if one fails, drop it rather than show a broken box
document.addEventListener('error', (ev) => { const t = ev.target; if (t && t.classList && t.classList.contains('cover')) t.remove(); }, true);

$('q').addEventListener('input', () => { onCityInput(); });
$('q').addEventListener('keydown', (ev) => {
  if ($('ac').hidden) { if (ev.key === 'Escape') togglePanel(false); return; }
  if (ev.key === 'ArrowDown') { ev.preventDefault(); if (acItems.length) { acIdx = (acIdx + 1) % acItems.length; renderAC(); } }
  else if (ev.key === 'ArrowUp') { ev.preventDefault(); if (acItems.length) { acIdx = (acIdx - 1 + acItems.length) % acItems.length; renderAC(); } }
  else if (ev.key === 'Enter') { ev.preventDefault(); if (acItems[acIdx]) pickCity(acItems[acIdx]); }
  else if (ev.key === 'Escape') hideAC();
});
window.addEventListener('hashchange', () => { readHash(); render(); });
// a tab left open overnight rolls "today" forward when the family comes back to it
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && DATA) render(); });

readHash();
render();
loadEvents();
