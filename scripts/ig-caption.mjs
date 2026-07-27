/* Muse — trilingual (EN / ES / PT) Instagram caption builder for the "universe out" cards.
 *
 * Shared by scripts/ig-cards.mjs (fresh renders in Actions) and scripts/ig-recaption.mjs (retrofit
 * the already-rendered queue in place). Pure text, no deps — safe to run anywhere.
 *
 * A caption is built from: the anchor title (a proper noun, never translated), the anchor's category,
 * and the shown cross-media matches [{ t, cat }]. The card image text stays English/neutral; the
 * caption carries all three languages so one post reaches EN + ES + PT audiences.
 */

export const EMO = { movies: '🎬', tv: '📺', books: '📚', music: '🎵', games: '🎮', anime: '🌸', food: '🍜', travel: '✈️' };
// reverse map so a rendered chain line ("🎬 Title · …") can be parsed back into {t, cat}.
export const EMO_TO_CAT = Object.fromEntries(Object.entries(EMO).map(([c, e]) => [e, c]));

// parallel hooks — same idea in each language; {a} is the anchor title, inserted verbatim.
const HOOKS = [
  { en: (a) => `You love ${a}. Here's your whole universe. 🌌`,
    es: (a) => `Amas ${a}. Aquí tienes tu universo entero. 🌌`,
    pt: (a) => `Você ama ${a}. Aqui está o seu universo inteiro. 🌌` },
  { en: (a) => `Loved ${a}? Here's its echo in every other medium. 🧭`,
    es: (a) => `¿Te encantó ${a}? Aquí está su eco en todos los demás medios. 🧭`,
    pt: (a) => `Curtiu ${a}? Aqui está o eco dele em todas as outras mídias. 🧭` },
  { en: (a) => `${a} fans — your next obsession isn't more of the same. It's all of these. ✨`,
    es: (a) => `Fans de ${a}: tu próxima obsesión no es más de lo mismo. Son todas estas. ✨`,
    pt: (a) => `Fãs de ${a}: seu próximo vício não é mais do mesmo. São todos estes. ✨` },
  { en: (a) => `One love in, a universe out. Today: ${a}. 🌍`,
    es: (a) => `Un amor entra, un universo sale. Hoy: ${a}. 🌍`,
    pt: (a) => `Um amor entra, um universo sai. Hoje: ${a}. 🌍` },
];

// the fixed value line, per language.
const VAL = {
  en: 'Muse finds the echo of what you love across every medium.',
  es: 'Muse encuentra el eco de lo que amas en cada medio.',
  pt: 'A Muse encontra o eco do que você ama em cada mídia.',
};
const CTA = { en: 'Try it free', es: 'Pruébalo gratis', pt: 'Experimente grátis' };
const FLAG = { en: '🇬🇧', es: '🇪🇸', pt: '🇧🇷' };

// category hashtags (kept mostly English — searched globally — plus a few ES/PT below in GEN).
const HASH = {
  movies: ['#movierecommendations', '#whattowatch', '#filmtok'],
  tv: ['#tvshowrecommendations', '#whattowatch', '#bingewatch'],
  books: ['#bookrecommendations', '#booktok', '#whattoread'],
  music: ['#musicrecommendations', '#musicdiscovery', '#newmusic'],
  games: ['#gamerecommendations', '#gamingcommunity', '#whattoplay'],
  anime: ['#animerecommendations', '#anitok', '#animecommunity'],
  food: ['#foodie', '#whattoeat', '#foodlover'],
  travel: ['#travelinspo', '#wheretogo', '#bucketlist'],
};
const GEN = ['#muse', '#tasteengine', '#ifyoulike', '#recommendations', '#recomendaciones', '#recomendações', '#foryou', '#discovery'];

const uniq = (a) => [...new Set(a)];

export function hashtagsFor(anchorCat, matchCats) {
  const cats = uniq(matchCats);
  return uniq([...(HASH[anchorCat] || []), ...cats.flatMap((c) => (HASH[c] || []).slice(0, 1)), ...GEN]).slice(0, 15);
}

export function chainLine(matches) {
  return matches.slice(0, 5).map((m) => `${EMO[m.cat] || '•'} ${m.t}`).join('  ·  ');
}

// parse a rendered chain line back into [{ t, cat }] (used by the retrofit).
export function parseChain(line) {
  return String(line || '').split('  ·  ').map((seg) => {
    seg = seg.trim();
    for (const [emo, cat] of Object.entries(EMO_TO_CAT)) if (seg.startsWith(emo)) return { cat, t: seg.slice(emo.length).trim() };
    return { cat: null, t: seg };
  }).filter((m) => m.t);
}

// a single-language caption (used for per-language export / language-specific posting).
function oneLang(lang, hook, anchorTitle, chain, tags) {
  return [
    hook[lang](anchorTitle), '',
    chain, '',
    VAL[lang], '',
    `${CTA[lang]} 👉 muse-find.com (link in bio)`, '',
    tags.join(' '),
  ].join('\n');
}

// { combined (trilingual), en, es, pt, tags } for one post.
export function buildCaptions({ anchorTitle, anchorCat, matches, index = 0 }) {
  const chain = chainLine(matches);
  const tags = hashtagsFor(anchorCat, matches.map((m) => m.cat));
  const H = HOOKS[index % HOOKS.length];
  const combined = [
    H.en(anchorTitle), H.es(anchorTitle), H.pt(anchorTitle), '',
    chain, '',
    `${FLAG.en} ${VAL.en}`, `${FLAG.es} ${VAL.es}`, `${FLAG.pt} ${VAL.pt}`, '',
    `✨ ${CTA.en} · ${CTA.es} · ${CTA.pt} 👉 muse-find.com (link in bio)`, '',
    tags.join(' '),
  ].join('\n');
  return {
    combined,
    en: oneLang('en', H, anchorTitle, chain, tags),
    es: oneLang('es', H, anchorTitle, chain, tags),
    pt: oneLang('pt', H, anchorTitle, chain, tags),
    tags,
  };
}
