/* Muse — one-time curated food seed. The weekly grow.mjs (E5) adds dishes the LLM proposes and that
 * have an *English* Wikipedia page, with empty alt-names — so it under-serves shrimp-forward and
 * Brazilian dishes and makes them unfindable by their native names (e.g. "camarão"). This hand-curated
 * batch fills that gap: 13 shrimp/prawn dishes (incl. camarão na moranga) + a few Brazilian staples,
 * each with tri-lingual display titles (`tl`) and rich `alt`-names — including the bare words
 * "shrimp"/"camarão"/"gambas"/"prawn"/"camarones" — so a search in any language surfaces them.
 *
 * Items get `fd-<slug>-tmdb` ids so enrich.mjs re-rates their dna/themes/craft later and embed.mjs
 * embeds them; enrich never touches t/alt/tl/g/ingredients, so the curated text is preserved.
 * Idempotent: skips any dish whose id or normalized title is already present. Writes minified
 * data.json + bumps the SW, exactly like grow.mjs. Node 18+. `DRY_RUN=1` -> data.dryrun.json.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = ROOT + 'data.json';
const SW = ROOT + 'sw.js';
const DRY_RUN = process.env.DRY_RUN === '1';

const slug = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const normT = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const hueOf = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; };

// Compact curated table. dna order = [Dark(heaviness), Intense(bold/spicy), Cerebral(refined),
// Humor(fun), Pace(quick<->slow), Epic(indulgent), Warm(comforting), Weird(exotic)]; craft = [spice,
// rich, sweet, prep]; th from the app theme vocab. alt-names drive multilingual/ingredient search.
const D = [
  { t: 'Camarão na Moranga', en: 'Shrimp in Pumpkin', es: 'Camarón en Calabaza', cuisine: 'Brazilian', country: 'Brazil',
    alt: ['camarao na moranga', 'shrimp in pumpkin', 'shrimp stuffed pumpkin', 'camaron en calabaza', 'camarão', 'camarao', 'shrimp', 'prawn'],
    g: ['seafood', 'comfort food', 'main course'], th: ['indulgence', 'celebration', 'tradition', 'comfort'],
    dna: [60, 45, 55, 40, 30, 80, 85, 55], craft: [45, 85, 20, 80], fl: ['creamy', 'savory', 'garlicky', 'rich'],
    ing: ['shrimp', 'pumpkin', 'cream cheese', 'tomato', 'coconut milk', 'garlic'], tech: 'baked', reg: 'Southeast Brazil',
    d: { en: 'Garlicky shrimp in a creamy sauce served inside a roasted kabocha pumpkin — a party centerpiece.', es: 'Camarones al ajillo en salsa cremosa servidos dentro de una calabaza asada — el centro de la fiesta.', pt: 'Camarões ao alho em creme servidos dentro de uma moranga assada — o centro da festa.' } },

  { t: 'Bobó de Camarão', en: 'Shrimp Bobó', es: 'Bobó de Camarón', cuisine: 'Bahian', country: 'Brazil',
    alt: ['bobo de camarao', 'shrimp bobo', 'bobo de camaron', 'camarão', 'camarao', 'shrimp', 'prawn'],
    g: ['seafood', 'stew', 'spicy'], th: ['heritage', 'tradition', 'indulgence', 'comfort'],
    dna: [55, 60, 50, 35, 25, 70, 80, 60], craft: [55, 80, 15, 75], fl: ['creamy', 'nutty', 'spicy', 'savory'],
    ing: ['shrimp', 'cassava', 'coconut milk', 'palm oil', 'tomato', 'onion'], tech: 'simmered', reg: 'Bahia, Brazil',
    d: { en: 'Shrimp folded into a silky cassava-and-coconut cream, gilded with dendê palm oil.', es: 'Camarones en una crema sedosa de yuca y coco, dorada con aceite de dendê.', pt: 'Camarões numa creme sedoso de mandioca e coco, dourado no azeite de dendê.' } },

  { t: 'Vatapá', en: 'Vatapá', es: 'Vatapá', cuisine: 'Bahian', country: 'Brazil',
    alt: ['vatapa', 'shrimp', 'camarão', 'camarao', 'prawn'],
    g: ['seafood', 'street food', 'spicy'], th: ['heritage', 'tradition', 'craftsmanship'],
    dna: [55, 55, 55, 30, 25, 65, 75, 70], craft: [55, 82, 15, 80], fl: ['creamy', 'nutty', 'spicy', 'umami'],
    ing: ['shrimp', 'bread', 'coconut milk', 'peanuts', 'palm oil', 'ginger'], tech: 'simmered', reg: 'Bahia, Brazil',
    d: { en: 'A creamy Afro-Brazilian paste of bread, peanuts, coconut and dried shrimp — deep and warming.', es: 'Una crema afrobrasileña de pan, maní, coco y camarón seco — profunda y reconfortante.', pt: 'Um creme afro-brasileiro de pão, amendoim, coco e camarão seco — profundo e reconfortante.' } },

  { t: 'Acarajé', en: 'Acarajé', es: 'Acarajé', cuisine: 'Bahian', country: 'Brazil',
    alt: ['acaraje', 'black eyed pea fritter', 'shrimp fritter', 'camarão', 'camarao', 'shrimp'],
    g: ['street food', 'seafood', 'fried'], th: ['heritage', 'tradition', 'community', 'celebration'],
    dna: [50, 60, 45, 45, 20, 55, 70, 65], craft: [60, 70, 10, 70], fl: ['savory', 'spicy', 'nutty', 'crispy'],
    ing: ['black-eyed peas', 'dried shrimp', 'palm oil', 'onion', 'vatapá'], tech: 'fried', reg: 'Salvador, Bahia',
    d: { en: 'A crisp black-eyed-pea fritter fried in palm oil and split open with vatapá and shrimp.', es: 'Un buñuelo crujiente de frijol carita frito en aceite de palma, relleno de vatapá y camarón.', pt: 'Um bolinho crocante de feijão-fradinho frito no dendê, recheado com vatapá e camarão.' } },

  { t: 'Gambas al Ajillo', en: 'Garlic Shrimp', es: 'Gambas al Ajillo', cuisine: 'Spanish', country: 'Spain',
    alt: ['gambas al ajillo', 'garlic shrimp', 'garlic prawns', 'gambas', 'shrimp', 'prawn', 'camarão', 'camarao'],
    g: ['tapas', 'seafood', 'spicy'], th: ['simplicity', 'tradition', 'celebration'],
    dna: [40, 65, 40, 45, 75, 45, 70, 30], craft: [55, 60, 5, 40], fl: ['garlicky', 'savory', 'spicy', 'olive'],
    ing: ['shrimp', 'garlic', 'olive oil', 'chili', 'parsley'], tech: 'sautéed', reg: 'Spain',
    d: { en: 'Shrimp sizzled in olive oil with garlic and dried chili — the pan still bubbling at the table.', es: 'Gambas chisporroteando en aceite de oliva con ajo y guindilla — la cazuela aún hirviendo en la mesa.', pt: 'Camarões fervendo em azeite com alho e pimenta seca — a panela ainda borbulhando na mesa.' } },

  { t: 'Camarones a la Diabla', en: 'Deviled Shrimp', es: 'Camarones a la Diabla', cuisine: 'Mexican', country: 'Mexico',
    alt: ['camarones a la diabla', 'deviled shrimp', 'diabla shrimp', 'camarones', 'shrimp', 'prawn', 'camarão', 'camarao'],
    g: ['seafood', 'spicy', 'main course'], th: ['tradition', 'indulgence', 'celebration'],
    dna: [45, 90, 40, 40, 55, 55, 60, 40], craft: [90, 60, 10, 45], fl: ['spicy', 'smoky', 'savory', 'tangy'],
    ing: ['shrimp', 'chile de arbol', 'chipotle', 'tomato', 'garlic'], tech: 'simmered', reg: 'Mexico',
    d: { en: 'Shrimp drowned in a fiery red chile-árbol and chipotle sauce — hot enough to earn its name.', es: 'Camarones ahogados en una salsa ardiente de chile de árbol y chipotle — pican como su nombre.', pt: 'Camarões afogados num molho ardente de chile de árbol e chipotle — picantes como o nome diz.' } },

  { t: 'Ceviche de Camarón', en: 'Shrimp Ceviche', es: 'Ceviche de Camarón', cuisine: 'Latin American', country: 'Ecuador',
    alt: ['ceviche de camaron', 'shrimp ceviche', 'camaron', 'camarón', 'shrimp', 'prawn'],
    g: ['seafood', 'cold dish', 'citrus'], th: ['simplicity', 'tradition', 'joy'],
    dna: [20, 55, 55, 50, 85, 35, 45, 45], craft: [50, 25, 15, 30], fl: ['citrus', 'fresh', 'tangy', 'savory'],
    ing: ['shrimp', 'lime', 'red onion', 'cilantro', 'tomato', 'chili'], tech: 'cured', reg: 'Latin America',
    d: { en: 'Shrimp cured bright in lime with onion, cilantro and chili — cool, sharp and clean.', es: 'Camarón curado en lima con cebolla, cilantro y ají — fresco, filoso y limpio.', pt: 'Camarão curado na lima com cebola, coentro e pimenta — fresco, ácido e limpo.' } },

  { t: 'Ebi Fry', en: 'Fried Shrimp', es: 'Camarón Empanizado', cuisine: 'Japanese', country: 'Japan',
    alt: ['ebi fry', 'ebi furai', 'fried shrimp', 'panko shrimp', 'shrimp', 'prawn', 'camarão', 'camarao'],
    g: ['seafood', 'fried', 'comfort food'], th: ['comfort', 'craftsmanship', 'nostalgia'],
    dna: [45, 35, 45, 55, 60, 45, 75, 35], craft: [15, 60, 10, 55], fl: ['crispy', 'savory', 'buttery'],
    ing: ['shrimp', 'panko', 'egg', 'flour', 'tonkatsu sauce'], tech: 'deep-fried', reg: 'Japan',
    d: { en: 'Butterflied shrimp in shatteringly crisp panko, straight and golden — a yōshoku classic.', es: 'Camarones abiertos en panko ultracrujiente, rectos y dorados — un clásico yōshoku.', pt: 'Camarões abertos em panko ultracrocante, retos e dourados — um clássico yōshoku.' } },

  { t: 'Shrimp Scampi', en: 'Shrimp Scampi', es: 'Gambas al Ajillo Estilo Scampi', cuisine: 'Italian-American', country: 'United States',
    alt: ['shrimp scampi', 'scampi', 'garlic butter shrimp', 'shrimp', 'prawn', 'camarão', 'camarao'],
    g: ['seafood', 'pasta', 'comfort food'], th: ['comfort', 'indulgence', 'simplicity'],
    dna: [45, 45, 40, 40, 65, 55, 80, 25], craft: [30, 75, 5, 45], fl: ['garlicky', 'buttery', 'lemony', 'savory'],
    ing: ['shrimp', 'garlic', 'butter', 'white wine', 'lemon', 'linguine'], tech: 'sautéed', reg: 'United States',
    d: { en: 'Shrimp swirled in garlic butter, white wine and lemon over linguine — glossy and quick.', es: 'Camarones en mantequilla de ajo, vino blanco y limón sobre linguine — brillante y rápido.', pt: 'Camarões na manteiga de alho, vinho branco e limão sobre linguine — brilhante e rápido.' } },

  { t: 'Har Gow', en: 'Shrimp Dumplings', es: 'Dumplings de Camarón', cuisine: 'Cantonese', country: 'China',
    alt: ['har gow', 'har gau', 'shrimp dumplings', 'crystal shrimp dumpling', 'shrimp', 'prawn', 'camarão', 'camarao'],
    g: ['dim sum', 'seafood', 'steamed'], th: ['craftsmanship', 'tradition', 'simplicity'],
    dna: [30, 35, 65, 45, 55, 40, 65, 40], craft: [15, 45, 10, 80], fl: ['savory', 'sweet', 'delicate', 'umami'],
    ing: ['shrimp', 'tapioca starch', 'bamboo shoot', 'sesame oil'], tech: 'steamed', reg: 'Guangdong, China',
    d: { en: 'Whole shrimp glowing through a pleated translucent wrapper — the test of any dim sum chef.', es: 'Camarón entero brillando bajo una masa translúcida plisada — la prueba de todo chef de dim sum.', pt: 'Camarão inteiro brilhando sob uma massa translúcida plissada — o teste de todo chef de dim sum.' } },

  { t: 'Coconut Shrimp', en: 'Coconut Shrimp', es: 'Camarón al Coco', cuisine: 'American', country: 'United States',
    alt: ['coconut shrimp', 'coconut prawns', 'camarao ao coco', 'shrimp', 'prawn', 'camarão', 'camarao'],
    g: ['seafood', 'fried', 'appetizer'], th: ['indulgence', 'joy', 'comfort'],
    dna: [45, 35, 30, 60, 55, 50, 70, 40], craft: [20, 65, 40, 55], fl: ['sweet', 'crispy', 'coconut', 'savory'],
    ing: ['shrimp', 'shredded coconut', 'panko', 'flour', 'sweet chili sauce'], tech: 'deep-fried', reg: 'United States',
    d: { en: 'Shrimp in a crunchy coconut crust with sweet-chili dip — beach-bar food that everyone finishes.', es: 'Camarones en costra crujiente de coco con salsa dulce picante — comida de playa que nadie deja.', pt: 'Camarões em crosta crocante de coco com molho agridoce — comida de praia que ninguém deixa.' } },

  { t: 'Prawn Masala', en: 'Prawn Masala', es: 'Curry de Gambas', cuisine: 'Indian', country: 'India',
    alt: ['prawn masala', 'shrimp curry', 'prawn curry', 'jhinga masala', 'prawn', 'shrimp', 'camarão', 'camarao'],
    g: ['seafood', 'curry', 'spicy'], th: ['tradition', 'heritage', 'indulgence'],
    dna: [55, 80, 50, 35, 45, 55, 75, 45], craft: [85, 65, 15, 55], fl: ['spicy', 'savory', 'aromatic', 'tangy'],
    ing: ['prawns', 'garam masala', 'tomato', 'onion', 'ginger', 'chili'], tech: 'simmered', reg: 'India',
    d: { en: 'Prawns simmered in a fragrant tomato-onion masala loud with ginger, garlic and chili.', es: 'Gambas guisadas en una masala fragante de tomate y cebolla con jengibre, ajo y ají.', pt: 'Camarões cozidos numa masala perfumada de tomate e cebola com gengibre, alho e pimenta.' } },

  { t: 'Prawn Cocktail', en: 'Prawn Cocktail', es: 'Cóctel de Camarones', cuisine: 'British', country: 'United Kingdom',
    alt: ['prawn cocktail', 'shrimp cocktail', 'coctel de camarones', 'prawn', 'shrimp', 'camarão', 'camarao'],
    g: ['seafood', 'cold dish', 'appetizer'], th: ['nostalgia', 'simplicity', 'celebration'],
    dna: [25, 30, 35, 55, 80, 40, 55, 30], craft: [25, 40, 20, 25], fl: ['tangy', 'fresh', 'creamy', 'savory'],
    ing: ['prawns', 'cocktail sauce', 'lettuce', 'lemon', 'paprika'], tech: 'chilled', reg: 'United Kingdom',
    d: { en: 'Chilled prawns fanned over lettuce under a rosy Marie Rose sauce — the retro starter that never left.', es: 'Camarones fríos sobre lechuga bajo una salsa rosada Marie Rose — el entrante retro que nunca se fue.', pt: 'Camarões gelados sobre alface sob um molho rosado Marie Rose — a entrada retrô que nunca saiu.' } },

  { t: 'Coxinha', en: 'Coxinha', es: 'Coxinha', cuisine: 'Brazilian', country: 'Brazil',
    alt: ['coxinha', 'chicken croquette', 'brazilian chicken croquette'],
    g: ['street food', 'fried', 'snack'], th: ['comfort', 'nostalgia', 'community', 'joy'],
    dna: [50, 35, 35, 60, 45, 45, 80, 35], craft: [25, 65, 10, 65], fl: ['savory', 'crispy', 'creamy'],
    ing: ['chicken', 'wheat dough', 'catupiry cheese', 'breadcrumbs'], tech: 'deep-fried', reg: 'São Paulo, Brazil',
    d: { en: 'A teardrop of shredded chicken and cream cheese in a crisp golden shell — Brazil’s favorite snack.', es: 'Una lágrima de pollo desmenuzado y queso crema en una corteza dorada — el antojo favorito de Brasil.', pt: 'Uma gota de frango desfiado com requeijão numa casca dourada — o salgado favorito do Brasil.' } },

  { t: 'Brigadeiro', en: 'Brigadeiro', es: 'Brigadeiro', cuisine: 'Brazilian', country: 'Brazil',
    alt: ['brigadeiro', 'chocolate fudge ball', 'brazilian truffle', 'negrinho'],
    g: ['dessert', 'sweets', 'chocolate'], th: ['joy', 'celebration', 'nostalgia', 'indulgence'],
    dna: [35, 25, 20, 70, 40, 45, 85, 20], craft: [0, 70, 95, 40], fl: ['sweet', 'chocolatey', 'creamy'],
    ing: ['condensed milk', 'cocoa powder', 'butter', 'chocolate sprinkles'], tech: 'cooked', reg: 'Brazil',
    d: { en: 'A soft chocolate fudge ball rolled in sprinkles — the birthday-party sweet every Brazilian grew up on.', es: 'Una trufa suave de chocolate cubierta de granas — el dulce de cumpleaños de toda la infancia brasileña.', pt: 'Um docinho de chocolate coberto de granulado — o doce de festa que todo brasileiro comeu na infância.' } },

  { t: 'Açaí na Tigela', en: 'Açaí Bowl', es: 'Tazón de Açaí', cuisine: 'Brazilian', country: 'Brazil',
    alt: ['acai na tigela', 'acai bowl', 'acai', 'açaí', 'acaí bowl'],
    g: ['dessert', 'breakfast', 'fruit', 'healthy'], th: ['nature', 'joy', 'simplicity', 'heritage'],
    dna: [20, 30, 40, 65, 70, 40, 60, 45], craft: [0, 45, 80, 25], fl: ['sweet', 'fruity', 'refreshing', 'tart'],
    ing: ['açaí', 'banana', 'granola', 'guaraná syrup', 'strawberry'], tech: 'blended', reg: 'Pará, Brazil',
    d: { en: 'Frozen açaí whipped thick and cold, piled with banana and granola — the Amazon by way of the beach.', es: 'Açaí congelado batido espeso y frío, coronado con banana y granola — la Amazonía en la playa.', pt: 'Açaí congelado batido grosso e gelado, coberto com banana e granola — a Amazônia na praia.' } },

  { t: 'Pastel', en: 'Pastel', es: 'Pastel Brasileño', cuisine: 'Brazilian', country: 'Brazil',
    alt: ['pastel', 'brazilian pastel', 'pastel de feira', 'fried pastry'],
    g: ['street food', 'fried', 'snack'], th: ['comfort', 'community', 'nostalgia'],
    dna: [50, 40, 30, 60, 40, 45, 75, 35], craft: [30, 60, 15, 55], fl: ['savory', 'crispy', 'cheesy'],
    ing: ['wheat dough', 'ground beef', 'cheese', 'palm heart'], tech: 'deep-fried', reg: 'Brazil',
    d: { en: 'A big crackly fried pastry pocket from the street market, steaming with beef or cheese.', es: 'Una gran empanada frita y crujiente de la feria, humeante con carne o queso.', pt: 'Um pastel grande e crocante da feira, soltando vapor com recheio de carne ou queijo.' } },
];

function buildItem(x, ids) {
  const seed = hueOf(x.t);
  let id = `fd-${slug(x.t)}-tmdb`, base = id, i = 2; while (ids.has(id)) { id = `${base}${i}`; i++; }
  const th = (x.th || []).filter((t) => typeof t === 'string' && t.trim()).slice(0, 6);
  return {
    id, t: x.t, tl: { en: x.en || x.t, es: x.es || x.t, pt: x.t }, alt: x.alt || [], y: null,
    by: (x.cuisine ? x.cuisine.toLowerCase() + ' cuisine' : ''), g: x.g || [], th: th.length ? th : ['indulgence'],
    dna: x.dna, pop: 60, acc: 62, main: 55, c: x.country || '', d: x.d, hue: seed, img: null,
    x: { spice: x.craft[0], rich: x.craft[1], sweet: x.craft[2], prep: x.craft[3], fl: x.fl || [], ing: x.ing || [], tech: x.tech || '', reg: x.reg || '' },
  };
}

async function main() {
  const data = JSON.parse(await readFile(DATA, 'utf8'));
  const food = Array.isArray(data.food) ? data.food : (data.food = []);
  const haveId = new Set(food.map((f) => f.id));
  const haveTitle = new Set(food.map((f) => normT(f.t)));
  let added = 0;
  for (const x of D) {
    if (haveTitle.has(normT(x.t))) { console.log(`skip (dup title): ${x.t}`); continue; }
    const it = buildItem(x, haveId);
    if (haveId.has(it.id)) { console.log(`skip (dup id): ${it.id}`); continue; }
    haveId.add(it.id); haveTitle.add(normT(x.t));
    food.push(it); added++;
    console.log(`+ ${it.t}  (${it.id})`);
  }
  console.log(`\nadded ${added} dishes. food ${food.length - added} -> ${food.length}`);
  if (!added) { console.log('nothing to add.'); return; }
  const OUT = DRY_RUN ? ROOT + 'data.dryrun.json' : DATA;
  await writeFile(OUT, JSON.stringify(data), 'utf8');
  console.log(`wrote ${OUT}`);
  if (!DRY_RUN) {
    let sw = await readFile(SW, 'utf8');
    const m = sw.match(/muse-v(\d+)/);
    if (m) { const next = `muse-v${parseInt(m[1], 10) + 1}`; sw = sw.replace(/muse-v\d+/g, next); await writeFile(SW, sw, 'utf8'); console.log(`sw -> ${next}`); }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { D, buildItem, slug, normT };
