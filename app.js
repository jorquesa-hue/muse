(function(){
'use strict';

/* ================= data ================= */
let D = window.VIBRA_DATA;   // inline (self-contained build) OR fetched from data.json (deployed build)
const CAT_ORDER = ['movies','tv','books','music','games','anime','food','travel'];

/* ================= category config ================= */
const CATS = {
  movies:{acc:'#ff4d5a',sigma:12,name:{en:'Movies',es:'Películas',pt:'Filmes'},unit:{en:'a movie',es:'una película',pt:'um filme'},
    intro:{en:'From slow-burn noir to blockbuster spectacle — find films that share the soul of the one you love.',
           es:'Del noir pausado al espectáculo taquillero: encuentra películas que comparten alma con la que amas.',
           pt:'Do noir lento ao blockbuster: encontre filmes que dividem a alma com aquele que você ama.'}},
  tv:{acc:'#a06bff',sigma:10,name:{en:'TV Series',es:'Series',pt:'Séries'},unit:{en:'a series',es:'una serie',pt:'uma série'},
    intro:{en:'Series that hook you the same way — same tone, same pull, same “one more episode” at 3am.',
           es:'Series que te atrapan igual: mismo tono, mismo tirón, mismo “un capítulo más” a las 3am.',
           pt:'Séries que fisgam do mesmo jeito — mesmo tom, mesma pegada, mesmo “só mais um episódio” às 3h.'}},
  books:{acc:'#ffb020',sigma:25,name:{en:'Books',es:'Libros',pt:'Livros'},unit:{en:'a book',es:'un libro',pt:'um livro'},
    intro:{en:'Books with the same pulse — prose, themes and worlds that rhyme with your favorite.',
           es:'Libros con el mismo pulso: prosa, temas y mundos que riman con tu favorito.',
           pt:'Livros com o mesmo pulso — prosa, temas e mundos que rimam com o seu favorito.'}},
  music:{acc:'#22c98a',sigma:8,name:{en:'Music',es:'Música',pt:'Música'},unit:{en:'an album',es:'un álbum',pt:'um álbum'},
    intro:{en:'Albums that hit the same nerve — matched by mood, sound profile and era.',
           es:'Álbumes que tocan el mismo nervio: emparejados por ánimo, perfil sonoro y época.',
           pt:'Álbuns que tocam o mesmo nervo — combinados por clima, perfil sonoro e época.'}},
  games:{acc:'#3d8fd6',sigma:8,name:{en:'Games',es:'Videojuegos',pt:'Games'},unit:{en:'a game',es:'un videojuego',pt:'um jogo'},
    intro:{en:'Games that feel the same in your hands — mechanics, mood and worlds aligned.',
           es:'Juegos que se sienten igual en tus manos: mecánicas, ánimo y mundos alineados.',
           pt:'Jogos com a mesma sensação nas mãos — mecânicas, clima e mundos alinhados.'}},
  anime:{acc:'#ff6ec7',sigma:10,name:{en:'Anime',es:'Anime',pt:'Anime'},unit:{en:'an anime',es:'un anime',pt:'um anime'},
    intro:{en:'From Ghibli warmth to cyberpunk dread — anime cut from the same cloth as yours.',
           es:'Del calor de Ghibli a la angustia cyberpunk: anime cortado de la misma tela que el tuyo.',
           pt:'Do calor Ghibli ao pavor cyberpunk — animes cortados do mesmo tecido que o seu.'}},
  food:{acc:'#ff8a3c',sigma:0,name:{en:'Food & Dishes',es:'Comida',pt:'Comida'},unit:{en:'a dish',es:'un plato',pt:'um prato'},
    intro:{en:'Loved a dish? Trace its flavor DNA to your next food obsession.',
           es:'¿Amaste un plato? Sigue su ADN de sabor hasta tu próxima obsesión.',
           pt:'Amou um prato? Siga o DNA de sabor até a sua próxima obsessão.'}},
  travel:{acc:'#1fd1c1',sigma:0,name:{en:'Travel',es:'Viajes',pt:'Viagens'},unit:{en:'a destination',es:'un destino',pt:'um destino'},
    intro:{en:'Places that feel like the places you loved — destinations matched by vibe, not by distance.',
           es:'Lugares que se sienten como los que amaste: destinos unidos por la vibra, no la distancia.',
           pt:'Lugares com a sensação dos que você amou — destinos combinados pela vibe, não pela distância.'}},
};

/* ---- minimal line icons (stroke = currentColor) ---- */
const _S='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">';
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
const DICE_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.15" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1.15" fill="currentColor" stroke="none"/><circle cx="9" cy="15" r="1.15" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.15" fill="currentColor" stroke="none"/></svg>';
const HEART_SVG='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.5S3.5 15.2 3.5 9.6C3.5 6.9 5.6 5 8 5c1.7 0 3.1 1 3.8 2.3.7-1.3 2.1-2.3 3.8-2.3 2.4 0 4.5 1.9 4.5 4.6 0 5.6-8.4 10.9-8.4 10.9z"/></svg>';

/* ================= i18n ================= */
const T = {
  proto:{en:'prototype',es:'prototipo',pt:'protótipo'},
  tagline:{en:'Love <em>one thing</em>. Find <em>everything</em> like it.',
           es:'Ama <em>una cosa</em>. Encuentra <em>todo</em> lo que se le parece.',
           pt:'Ame <em>uma coisa</em>. Encontre <em>tudo</em> parecido.'},
  stats:{en:'<b>{n}</b> works<i>·</i><b>8</b> worlds<i>·</i><b>{a}</b> algorithms<i>·</i>on-device',
         es:'<b>{n}</b> obras<i>·</i><b>8</b> mundos<i>·</i><b>{a}</b> algoritmos<i>·</i>local',
         pt:'<b>{n}</b> obras<i>·</i><b>8</b> mundos<i>·</i><b>{a}</b> algoritmos<i>·</i>no aparelho'},
  ph:{en:'Type {u} you love…',es:'Escribe {u} que te encante…',pt:'Digite {u} que você ama…'},
  surprise:{en:'Surprise me',es:'Sorpréndeme',pt:'Surpreenda-me'},
  tryThese:{en:'Try',es:'Prueba',pt:'Tente'},
  spotTitle:{en:'One love in — a universe out',es:'Un amor entra — un universo sale',pt:'Um amor entra — um universo sai'},
  spotLine:{en:'Tell Muse one thing you love; it finds everything like it — across every medium.',
            es:'Dile a Muse una cosa que ames; encuentra todo lo que se le parece — en todos los medios.',
            pt:'Diga ao Muse uma coisa que você ama; ele encontra tudo parecido — em todas as mídias.'},
  browseLabel:{en:'Browse a world',es:'Explora un mundo',pt:'Explore um mundo'},
  hint:{en:'Typo-proof predictive search — try “<b>blade runer</b>”, “<b>cien años</b>” or clear it and hit the dice.',
        es:'Búsqueda predictiva a prueba de errores: prueba “<b>blade runer</b>”, “<b>cien años</b>” o pulsa el botón.',
        pt:'Busca preditiva à prova de erros — tente “<b>blade runer</b>”, “<b>cien anos</b>” ou aperte o botão.'},
  introHead:{en:'Start with one you love',es:'Empieza con algo que ames',pt:'Comece com algo que você ama'},
  topMatches:{en:'Closest matches',es:'Mejores coincidencias',pt:'Melhores combinações'},
  topSub:{en:'ranked by {a} weighted algorithms',es:'según {a} algoritmos ponderados',pt:'por {a} algoritmos ponderados'},
  beyond:{en:'Beyond — same DNA, different medium',es:'Más allá — mismo ADN, otro medio',pt:'Além — mesmo DNA, outro meio'},
  beyondSub:{en:'the best echo of this work in every other world',es:'el mejor eco de esta obra en cada otro mundo',pt:'o melhor eco desta obra em cada outro mundo'},
  lab:{en:'Algorithm lab — how Muse matches {cat}',es:'Laboratorio — cómo Muse empareja {cat}',pt:'Laboratório — como o Muse combina {cat}'},
  expand:{en:'Full breakdown',es:'Análisis completo',pt:'Análise completa'},
  collapse:{en:'Close',es:'Cerrar',pt:'Fechar'},
  exploreFrom:{en:'Search from this one →',es:'Buscar desde esta →',pt:'Buscar a partir desta →'},
  dnaCap:{en:'DNA overlay',es:'ADN superpuesto',pt:'DNA sobreposto'},
  srcLegend:{en:'yours',es:'la tuya',pt:'a sua'},
  matchLegend:{en:'match',es:'coincidencia',pt:'combinação'},
  kicker:{en:'Your pick',es:'Tu elección',pt:'Sua escolha'},
  sharedThemes:{en:'Shared themes',es:'Temas compartidos',pt:'Temas compartilhados'},
  notFound:{en:'Nothing found — try another title or hit “Surprise me”.',es:'No encontramos nada: prueba otro título o “Sorpréndeme”.',pt:'Nada encontrado — tente outro título ou “Surpreenda-me”.'},
  otherWorlds:{en:'In other worlds',es:'En otros mundos',pt:'Em outros mundos'},
  pop:{en:'Popularity',es:'Popularidad',pt:'Popularidade'},
  acc:{en:'Acclaim',es:'Prestigio',pt:'Aclamação'},
  main:{en:'Mainstream',es:'Mainstream',pt:'Mainstream'},
  weight:{en:'weight',es:'peso',pt:'peso'},
  q85:{en:'Soul twin',es:'Alma gemela',pt:'Alma gêmea'},
  q70:{en:'Strong echo',es:'Eco fuerte',pt:'Eco forte'},
  q55:{en:'Same wavelength',es:'Misma sintonía',pt:'Mesma sintonia'},
  q0:{en:'Distant cousin',es:'Pariente lejano',pt:'Parente distante'},
  suggestCta:{en:'+ Suggest a title or fix a name',es:'+ Sugiere un título o corrige un nombre',pt:'+ Sugira um título ou corrija um nome'},
  fixName:{en:'Wrong name? Suggest a fix',es:'¿Nombre incorrecto? Corrígelo',pt:'Nome errado? Corrija'},
  rateQ:{en:'Good match?',es:'¿Buena coincidencia?',pt:'Boa combinação?'},
  rateGood:{en:'Spot on',es:'Acertada',pt:'Certeira'},
  rateBad:{en:'Off',es:'No',pt:'Não'},
  rateThx:{en:'Thanks — noted',es:'Gracias — anotado',pt:'Obrigado — anotado'},
  searchWeb:{en:'Search the web for “{q}”',es:'Buscar “{q}” en la web',pt:'Buscar “{q}” na web'},
  searching:{en:'Searching the web for “{q}” …',es:'Buscando “{q}” en la web …',pt:'Buscando “{q}” na web …'},
  noWebResult:{en:'Couldn’t find “{q}”. Try another title.',es:'No se encontró “{q}”. Prueba otro título.',pt:'Não encontrei “{q}”. Tente outro título.'},
  liveTag:{en:'found live',es:'en vivo',pt:'ao vivo'},
  loading:{en:'Loading your taste engine…',es:'Cargando tu motor de gustos…',pt:'Carregando seu motor de gosto…'},
  loadFail:{en:'Couldn’t load the catalog — check your connection.',es:'No se pudo cargar el catálogo. Revisa tu conexión.',pt:'Não foi possível carregar o catálogo. Verifique sua conexão.'},
  retry:{en:'Retry',es:'Reintentar',pt:'Tentar de novo'},
  foot:{en:'<b>Muse</b> is a working prototype: a hand-curated offline dataset of <b>{n} works</b> and {a} similarity algorithms running fully in your browser — nothing leaves this page. The production version plugs the same engine into live catalogs (TMDB, Open Library, Spotify, IGDB…).',
        es:'<b>Muse</b> es un prototipo funcional: un dataset curado de <b>{n} obras</b> y {a} algoritmos de similitud corriendo por completo en tu navegador; nada sale de esta página. La versión final conecta el mismo motor a catálogos en vivo (TMDB, Open Library, Spotify, IGDB…).',
        pt:'<b>Muse</b> é um protótipo funcional: um dataset curado de <b>{n} obras</b> e {a} algoritmos de similaridade rodando inteiramente no seu navegador — nada sai desta página. A versão final liga o mesmo motor a catálogos ao vivo (TMDB, Open Library, Spotify, IGDB…).'},
  dataMissing:{en:'Dataset not embedded yet — this is the empty shell build.',es:'Dataset aún no incrustado.',pt:'Dataset ainda não incorporado.'},
};

const ALGO_NAMES = {
  emb:{en:'Semantic match',es:'Coincidencia semántica',pt:'Correspondência semântica'},
  theme:{en:'Thematic DNA',es:'ADN temático',pt:'DNA temático'},
  mood:{en:'Mood fingerprint',es:'Huella anímica',pt:'Impressão de clima'},
  genre:{en:'Genre resonance',es:'Resonancia de género',pt:'Ressonância de gênero'},
  creator:{en:'Creator affinity',es:'Afinidad de creador',pt:'Afinidade de criador'},
  era:{en:'Era echo',es:'Eco de época',pt:'Eco de época'},
  culture:{en:'Cultural roots',es:'Raíces culturales',pt:'Raízes culturais'},
  audience:{en:'Audience overlap',es:'Público afín',pt:'Público em comum'},
  ing:{en:'Ingredient overlap',es:'Ingredientes en común',pt:'Ingredientes em comum'},
  tech:{en:'Technique',es:'Técnica',pt:'Técnica'},
  vibe:{en:'Vibe match',es:'Afinidad de vibra',pt:'Afinidade de vibe'},
  climate:{en:'Climate',es:'Clima',pt:'Clima'},
  srcdem:{en:'Source & audience',es:'Origen y demografía',pt:'Origem e demografia'},
};
const CRAFT_NAMES = {
  movies:{en:'Pacing & style',es:'Ritmo y estilo',pt:'Ritmo e estilo'},
  tv:{en:'Format & binge',es:'Formato y enganche',pt:'Formato e maratona'},
  books:{en:'Prose & structure',es:'Prosa y estructura',pt:'Prosa e estrutura'},
  music:{en:'Sound profile',es:'Perfil sonoro',pt:'Perfil sonoro'},
  games:{en:'Mechanics match',es:'Mecánicas afines',pt:'Mecânicas afins'},
  anime:{en:'Style & emotion',es:'Estilo y emoción',pt:'Estilo e emoção'},
  food:{en:'Flavor profile',es:'Perfil de sabor',pt:'Perfil de sabor'},
  travel:{en:'Trip profile',es:'Perfil de viaje',pt:'Perfil de viagem'},
};
const ALGO_DESCS = {
  emb:{en:'AI text-embedding cosine — catches likeness the tags miss; also powers cross-media.',es:'Coseno de embeddings de IA — capta parecidos que las etiquetas no ven.',pt:'Cosseno de embeddings de IA — capta semelhanças que as tags não pegam.'},
  theme:{en:'Cosine similarity over a 48-theme universal vocabulary — what the work is really about.',
         es:'Similitud de coseno sobre 48 temas universales: de qué trata realmente la obra.',
         pt:'Similaridade de cosseno sobre 48 temas universais — do que a obra realmente trata.'},
  mood:{en:'Distance across 8 vibe axes (dark, pace, warmth, weirdness…) shared by every category.',
        es:'Distancia en 8 ejes de vibra (oscuridad, ritmo, calidez, rareza…) comunes a todas las categorías.',
        pt:'Distância em 8 eixos de vibe (sombrio, ritmo, calor, estranheza…) comuns a todas as categorias.'},
  genre:{en:'Set overlap of category-specific genre tags.',es:'Solapamiento de géneros específicos de la categoría.',pt:'Sobreposição de gêneros específicos da categoria.'},
  craft:{en:'Category-specific craft features — the “how it’s made” fingerprint.',
         es:'Rasgos de factura propios de la categoría: la huella de “cómo está hecho”.',
         pt:'Traços de fatura próprios da categoria — a digital do “como é feito”.'},
  creator:{en:'Same director, author, artist or studio; shared key collaborators.',
           es:'Mismo director, autor, artista o estudio; colaboradores clave en común.',
           pt:'Mesmo diretor, autor, artista ou estúdio; colaboradores-chave em comum.'},
  era:{en:'Gaussian decay over the years separating the two works.',es:'Decaimiento gaussiano sobre los años que separan las obras.',pt:'Decaimento gaussiano sobre os anos que separam as obras.'},
  culture:{en:'Same country first, then same cultural region.',es:'Mismo país primero, luego misma región cultural.',pt:'Mesmo país primeiro, depois mesma região cultural.'},
  audience:{en:'How close their popularity, acclaim and mainstream-vs-cult profiles sit.',
            es:'Qué tan cerca están sus perfiles de popularidad, prestigio y mainstream-vs-culto.',
            pt:'Quão próximos são seus perfis de popularidade, aclamação e mainstream-vs-cult.'},
  ing:{en:'Overlap of key ingredients.',es:'Solapamiento de ingredientes clave.',pt:'Sobreposição de ingredientes-chave.'},
  tech:{en:'Same core cooking technique.',es:'Misma técnica de cocina.',pt:'Mesma técnica de cozinha.'},
  vibe:{en:'Overlap of destination vibe tags.',es:'Solapamiento de etiquetas de vibra del destino.',pt:'Sobreposição de tags de vibe do destino.'},
  climate:{en:'Climate family match.',es:'Coincidencia de familia climática.',pt:'Combinação de família climática.'},
  srcdem:{en:'Same source material and target demographic.',es:'Mismo material de origen y demografía.',pt:'Mesmo material de origem e demografia.'},
};
const WHY = {
  emb:{en:'reads the same to a semantic model',es:'suena igual a un modelo semántico',pt:'soa igual a um modelo semântico'},
  mood:{en:'a near-identical mood fingerprint',es:'una huella anímica casi idéntica',pt:'um clima quase idêntico'},
  creator:{en:'connected creators',es:'creadores conectados',pt:'criadores conectados'},
  era:{en:'born in the same era',es:'nacidas en la misma época',pt:'nascidas na mesma época'},
  culture:{en:'shared cultural roots',es:'raíces culturales comunes',pt:'raízes culturais comuns'},
  audience:{en:'loved by the same crowd',es:'amadas por el mismo público',pt:'amadas pelo mesmo público'},
  ing:{en:'overlapping ingredients',es:'ingredientes en común',pt:'ingredientes em comum'},
  tech:{en:'the same technique',es:'la misma técnica',pt:'a mesma técnica'},
  vibe:{en:'a matching vibe',es:'la misma vibra',pt:'a mesma vibe'},
  climate:{en:'a similar climate',es:'un clima similar',pt:'um clima parecido'},
  srcdem:{en:'same origin & audience',es:'mismo origen y público',pt:'mesma origem e público'},
};
const WHY_THEME = {en:'they share {x}',es:'comparten {x}',pt:'compartilham {x}'};
const WHY_GENRE = {en:'the same “{x}” spirit',es:'el mismo espíritu “{x}”',pt:'o mesmo espírito “{x}”'};
const WHY_CRAFT = {
  movies:{en:'twin pacing & visual style',es:'ritmo y estilo gemelos',pt:'ritmo e estilo gêmeos'},
  tv:{en:'same format & binge pull',es:'mismo formato y enganche',pt:'mesmo formato e vício'},
  books:{en:'kindred prose & structure',es:'prosa y estructura afines',pt:'prosa e estrutura afins'},
  music:{en:'a matching sound profile',es:'un perfil sonoro gemelo',pt:'um perfil sonoro gêmeo'},
  games:{en:'it plays the same way',es:'se juega igual',pt:'joga do mesmo jeito'},
  anime:{en:'same style & emotional weight',es:'mismo estilo y peso emocional',pt:'mesmo estilo e peso emocional'},
  food:{en:'a twin flavor profile',es:'un perfil de sabor gemelo',pt:'um perfil de sabor gêmeo'},
  travel:{en:'the same kind of trip',es:'el mismo tipo de viaje',pt:'o mesmo tipo de viagem'},
};
const DNA_AX = [
  {en:'Dark',es:'Oscuro',pt:'Sombrio'},{en:'Intense',es:'Intenso',pt:'Intenso'},
  {en:'Cerebral',es:'Cerebral',pt:'Cerebral'},{en:'Humor',es:'Humor',pt:'Humor'},
  {en:'Pace',es:'Ritmo',pt:'Ritmo'},{en:'Epic',es:'Épico',pt:'Épico'},
  {en:'Warm',es:'Cálido',pt:'Caloroso'},{en:'Weird',es:'Extraño',pt:'Estranho'},
];
const THEME_I18N = {
  identity:{es:'identidad',pt:'identidade'},love:{es:'amor',pt:'amor'},family:{es:'familia',pt:'família'},
  friendship:{es:'amistad',pt:'amizade'},betrayal:{es:'traición',pt:'traição'},revenge:{es:'venganza',pt:'vingança'},
  redemption:{es:'redención',pt:'redenção'},survival:{es:'supervivencia',pt:'sobrevivência'},
  'coming-of-age':{es:'crecer',pt:'amadurecer'},nostalgia:{es:'nostalgia',pt:'nostalgia'},memory:{es:'memoria',pt:'memória'},
  loss:{es:'pérdida',pt:'perda'},isolation:{es:'aislamiento',pt:'isolamento'},obsession:{es:'obsesión',pt:'obsessão'},
  power:{es:'poder',pt:'poder'},corruption:{es:'corrupción',pt:'corrupção'},justice:{es:'justicia',pt:'justiça'},
  crime:{es:'crimen',pt:'crime'},war:{es:'guerra',pt:'guerra'},faith:{es:'fe',pt:'fé'},freedom:{es:'libertad',pt:'liberdade'},
  rebellion:{es:'rebelión',pt:'rebelião'},dystopia:{es:'distopía',pt:'distopia'},technology:{es:'tecnología',pt:'tecnologia'},
  nature:{es:'naturaleza',pt:'natureza'},journey:{es:'viaje',pt:'jornada'},discovery:{es:'descubrimiento',pt:'descoberta'},
  mystery:{es:'misterio',pt:'mistério'},transformation:{es:'transformación',pt:'transformação'},ambition:{es:'ambición',pt:'ambição'},
  artistry:{es:'arte',pt:'arte'},tradition:{es:'tradición',pt:'tradição'},celebration:{es:'celebración',pt:'celebração'},
  comfort:{es:'confort',pt:'aconchego'},adventure:{es:'aventura',pt:'aventura'},escape:{es:'evasión',pt:'escapismo'},
  community:{es:'comunidad',pt:'comunidade'},luxury:{es:'lujo',pt:'luxo'},simplicity:{es:'sencillez',pt:'simplicidade'},
  spirituality:{es:'espiritualidad',pt:'espiritualidade'},romance:{es:'romance',pt:'romance'},melancholy:{es:'melancolía',pt:'melancolia'},
  joy:{es:'alegría',pt:'alegria'},chaos:{es:'caos',pt:'caos'},heritage:{es:'herencia',pt:'herança'},
  innovation:{es:'innovación',pt:'inovação'},craftsmanship:{es:'artesanía',pt:'artesanato'},indulgence:{es:'indulgencia',pt:'indulgência'},
  wonder:{es:'asombro',pt:'encanto'},
};

const REGIONS = {
  USA:'NA',Canada:'NA',
  Mexico:'LATAM',Brazil:'LATAM',Argentina:'LATAM',Peru:'LATAM',Chile:'LATAM',Colombia:'LATAM',Cuba:'LATAM',
  Uruguay:'LATAM',Bolivia:'LATAM',Ecuador:'LATAM',Venezuela:'LATAM',Guatemala:'LATAM','Costa Rica':'LATAM','Puerto Rico':'LATAM',
  UK:'EUW','United Kingdom':'EUW',Ireland:'EUW',France:'EUW',Germany:'EUW',Netherlands:'EUW',Belgium:'EUW',Austria:'EUW',Switzerland:'EUW',
  Spain:'EUS',Portugal:'EUS',Italy:'EUS',Greece:'EUS',
  Sweden:'EUN',Norway:'EUN',Denmark:'EUN',Finland:'EUN',Iceland:'EUN',
  Poland:'EUE','Czech Republic':'EUE',Hungary:'EUE',Russia:'EUE',Ukraine:'EUE',Romania:'EUE',Serbia:'EUE',
  Japan:'EA','South Korea':'EA',China:'EA',Taiwan:'EA','Hong Kong':'EA',Mongolia:'EA',
  India:'SA',Pakistan:'SA',Bangladesh:'SA','Sri Lanka':'SA',Nepal:'SA',
  Thailand:'SEA',Vietnam:'SEA',Indonesia:'SEA',Philippines:'SEA',Malaysia:'SEA',Singapore:'SEA',Cambodia:'SEA',Laos:'SEA',Myanmar:'SEA',
  Turkey:'ME',Israel:'ME',Lebanon:'ME',Iran:'ME','Saudi Arabia':'ME',UAE:'ME',Jordan:'ME',Egypt:'ME',
  Morocco:'AF',Tunisia:'AF',Ethiopia:'AF',Nigeria:'AF','South Africa':'AF',Kenya:'AF',Ghana:'AF',Senegal:'AF',Tanzania:'AF',
  Australia:'OC','New Zealand':'OC',Fiji:'OC',
};

/* ================= math & similarity ================= */
const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function cosSets(A,B){ if(!A||!B||!A.length||!B.length) return null;   // v2: null on missing (was 0)
  const sb=new Set(B); let inter=0; for(const x of A) if(sb.has(x)) inter++;
  return inter/Math.sqrt(A.length*B.length); }
const clamp01=v=>v<0?0:v>1?1:v;
const isNum=v=>typeof v==='number'&&!Number.isNaN(v);
const validVec=v=>Array.isArray(v)&&v.length===8&&v.every(isNum);
/* skip-and-renormalize weighted blend of [value,weight] pairs; null sub-terms dropped */
function blend(pairs){ let num=0,den=0; for(const p of pairs){ const v=p[0]; if(v!=null){ num+=v*p[1]; den+=p[1]; } } return den>0?num/den:null; }
/* IDF weighting: sharing a rare tag ("cyberpunk") counts far more than a generic one ("drama") */
const themeIDF={}, genreIDF={};
function buildIDF(list){ const N=Math.max(1,list.length), FL=Math.max(5,Math.round(0.01*N)), td={}, gd={};  // v2: DF floor (~1% of N)
  list.forEach(it=>{ Array.from(new Set(it.th||[])).forEach(t=>td[t]=(td[t]||0)+1);
    Array.from(new Set(it.g||[])).forEach(g=>gd[g]=(gd[g]||0)+1); });
  for(const t in td) themeIDF[t]=Math.log(N/Math.max(td[t],FL))+1;
  for(const g in gd) genreIDF[g]=Math.log(N/Math.max(gd[g],FL))+1; }
function wCos(A,B,idf){ if(!A||!B||!A.length||!B.length) return null;   // v2: null on missing
  const w=t=>{ const v=idf[t]; return v?v*v:1; };
  let num=0,sa=0,sb=0; const setB=new Set(B);
  for(const t of A){ sa+=w(t); if(setB.has(t)) num+=w(t); }
  for(const t of B) sb+=w(t);
  const den=Math.sqrt(sa*sb); return den?num/den:null; }
/* v2 §2.3: Gaussian + per-axis weights (default all-1 == v1 near/mid curve). cat optional. */
const DNA_AXIS_W={ _default:[1,1,1,1,1,1,1,1] };
const DNA_SIGMA=0.25, FEAT_SIGMA=0.28;
function dnaSim(a,b,cat){ if(!validVec(a)||!validVec(b)) return null;   // v2: null (was 0.4)
  const w=DNA_AXIS_W[cat]||DNA_AXIS_W._default; let s=0,sw=0;
  for(let i=0;i<8;i++){ const d=(a[i]-b[i])/100; s+=w[i]*d*d; sw+=w[i]; }
  const d=Math.sqrt(s/sw); return Math.exp(-(d*d)/(2*DNA_SIGMA*DNA_SIGMA)); }
function featSim(xa,xb,keys){ if(!xa||!xb) return null; let s=0,n=0;   // v2: present-keys-only + Gaussian
  for(const k of keys){ if(isNum(xa[k])&&isNum(xb[k])){ const d=(xa[k]-xb[k])/100; s+=d*d; n++; } }
  if(n===0) return null; const d=Math.sqrt(s/n); return Math.exp(-(d*d)/(2*FEAT_SIGMA*FEAT_SIGMA)); }
function prox(a,b,span){ if(!isNum(a)||!isNum(b)) return null; return Math.max(0, 1-Math.abs(a-b)/span); }   // v2: null (was 0.5)
function eraSim(ya,yb,sg){ if(!isNum(ya)||!isNum(yb)) return null; const d=ya-yb; return Math.exp(-d*d/(2*sg*sg)); }   // v2: takes YEARS, null on missing
function creatorSim(a,b){
  if(a.by&&b.by&&norm(a.by)===norm(b.by)) return 1;
  const xa=a.x||{}, xb=b.x||{};
  if(xa.st&&xb.st&&xa.st===xb.st) return .8;
  const ca=(a.cast||[]).map(norm), cb=(b.cast||[]).map(norm);
  if(ca.some(x=>x&&cb.includes(x))) return .65;
  return 0; }
function cultureSim(a,b){
  const ca=(a.x&&a.x.reg)||a.c, cb=(b.x&&b.x.reg)||b.c;
  if(!ca||!cb) return null; if(ca===cb) return 1;   // v2: null only if BOTH lack region/country
  return (REGIONS[ca]&&REGIONS[ca]===REGIONS[cb]) ? .55 : 0; }
function audSim(a,b){ if(!isNum(a.pop)||!isNum(b.pop)||!isNum(a.acc)||!isNum(b.acc)||!isNum(a.main)||!isNum(b.main)) return null;
  return Math.max(0, 1-(Math.abs(a.pop-b.pop)+Math.abs(a.acc-b.acc)+Math.abs(a.main-b.main))/300); }
/* v2 §2.10: text-embedding cosine. Loads a build-time file at runtime; null until loaded / if un-embedded. */
let EMB_BUF=null, EMB_IDX=null, EMB_DIM=0;
async function loadEmb(url='embeddings.b64.json'){ const j=await (await fetch(url)).json();
  const raw=Uint8Array.from(atob(j.data),c=>c.charCodeAt(0)); EMB_BUF=new Int8Array(raw.buffer);
  EMB_DIM=j.dim; EMB_IDX=Object.create(null); j.ids.forEach((id,i)=>{ EMB_IDX[id]=i; }); }
function embSim(a,b){ if(!EMB_BUF) return null; const ia=EMB_IDX[a.id], ib=EMB_IDX[b.id];
  if(ia==null||ib==null) return null; const oa=ia*EMB_DIM, ob=ib*EMB_DIM; let dot=0;
  for(let k=0;k<EMB_DIM;k++) dot+=EMB_BUF[oa+k]*EMB_BUF[ob+k]; return Math.max(0,dot/(127*127)); }

const CRAFT_FN = {   // v2: blend() drops null sub-terms and renormalizes
  movies:(a,b)=>{const xa=a.x||{},xb=b.x||{};return blend([[featSim(xa,xb,['vis','dlg','twist']),.8],[prox(xa.run,xb.run,90),.2]]);},
  tv:(a,b)=>{const xa=a.x||{},xb=b.x||{};return blend([[featSim(xa,xb,['ser','binge']),.6],[prox(xa.ep,xb.ep,40),.2],[prox(xa.sea,xb.sea,8),.2]]);},
  books:(a,b)=>{const xa=a.x||{},xb=b.x||{};return blend([[featSim(xa,xb,['lit','plot','exp']),.8],[prox(xa.pg,xb.pg,600),.2]]);},
  music:(a,b)=>{const xa=a.x||{},xb=b.x||{};return blend([[featSim(xa,xb,['nrg','val','aco','dan']),.7],[cosSets(xa.inst,xb.inst),.3]]);},
  games:(a,b)=>{const xa=a.x||{},xb=b.x||{};const la=isNum(xa.len)?Math.min(xa.len,120):null,lb=isNum(xb.len)?Math.min(xb.len,120):null;return blend([[featSim(xa,xb,['dif','story','open']),.6],[cosSets(xa.mech,xb.mech),.3],[prox(la,lb,100),.1]]);},
  anime:(a,b)=>{const xa=a.x||{},xb=b.x||{};return featSim(xa,xb,['act','art','emo']);},
  food:(a,b)=>{const xa=a.x||{},xb=b.x||{};return blend([[featSim(xa,xb,['spice','rich','sweet','prep']),.6],[cosSets(xa.fl,xb.fl),.4]]);},
  travel:(a,b)=>{const xa=a.x||{},xb=b.x||{};return featSim(xa,xb,['nat','adv','bud','off']);},
};
/* v2: unified dispatch — every entry returns number|null; a,b are items. */
const ALGO = {
  emb:(a,b)=>embSim(a,b),
  theme:(a,b)=>wCos(a.th,b.th,themeIDF),
  mood:(a,b,cat)=>dnaSim(a.dna,b.dna,cat),
  genre:(a,b)=>wCos(a.g,b.g,genreIDF),
  craft:(a,b,cat)=>CRAFT_FN[cat]?CRAFT_FN[cat](a,b):null,
  creator:(a,b)=>creatorSim(a,b),
  era:(a,b,cat)=>eraSim(a.y,b.y,(CATS[cat]&&CATS[cat].sigma)||10),
  audience:(a,b)=>audSim(a,b),
  culture:(a,b)=>cultureSim(a,b),
  ing:(a,b)=>cosSets((a.x||{}).ing,(b.x||{}).ing),
  tech:(a,b)=>{const A=(a.x||{}).tech,B=(b.x||{}).tech; if(A==null||B==null) return null; return A===B?1:0;},
  vibe:(a,b)=>cosSets((a.x||{}).vibe,(b.x||{}).vibe),
  climate:(a,b)=>{const A=(a.x||{}).climate,B=(b.x||{}).climate; if(!A||!B) return null; if(A===B) return 1;
    const mild=['temperate','mediterranean']; return (mild.includes(A)&&mild.includes(B))?.5:0;},
  srcdem:(a,b)=>{const xa=a.x||{},xb=b.x||{}; if(xa.src==null&&xa.dem==null) return null; return (xa.src&&xa.src===xb.src?.5:0)+(xa.dem&&xa.dem===xb.dem?.5:0);},
};
const CATALGOS = {   // v2: emb 0.22 added to every row (renormalizer rescales the rest)
  movies:[['emb',.22],['theme',.20],['mood',.20],['genre',.15],['craft',.13],['creator',.10],['era',.08],['audience',.08],['culture',.06]],
  tv:    [['emb',.22],['theme',.20],['mood',.20],['genre',.15],['craft',.13],['creator',.08],['era',.08],['audience',.10],['culture',.06]],
  books: [['emb',.22],['theme',.22],['mood',.20],['genre',.14],['craft',.14],['creator',.08],['era',.08],['audience',.08],['culture',.06]],
  music: [['emb',.22],['craft',.22],['mood',.20],['genre',.16],['theme',.12],['creator',.08],['era',.10],['audience',.06],['culture',.06]],
  games: [['emb',.22],['craft',.22],['genre',.18],['mood',.16],['theme',.12],['creator',.06],['era',.08],['audience',.10],['culture',.08]],
  anime: [['emb',.22],['theme',.18],['mood',.18],['genre',.16],['craft',.14],['creator',.12],['era',.08],['audience',.08],['srcdem',.06]],
  food:  [['emb',.22],['craft',.26],['ing',.12],['tech',.06],['genre',.14],['mood',.14],['theme',.10],['culture',.12],['audience',.06]],
  travel:[['emb',.22],['craft',.24],['vibe',.14],['mood',.16],['theme',.12],['genre',.12],['climate',.08],['culture',.08],['audience',.06]],
};
/* rows of CATALGOS[cat] that can actually fire right now — excludes 'emb' until embeddings.b64.json loads */
const activeAlgoRows=cat=>CATALGOS[cat].filter(([id])=>id!=='emb'||EMB_BUF);
/* v2 §7.1: skip-and-renormalize over PRESENT signals + coverage gate. Reads ALGO/CATALGOS globals. */
const MIN_COVERAGE=0.5;
function score(a,b,cat){
  const parts={}; let num=0,den=0,wtot=0;
  for(const pair of CATALGOS[cat]){ const id=pair[0], w=pair[1]; wtot+=w;
    const v=ALGO[id]?ALGO[id](a,b,cat):null; parts[id]=v;
    if(v==null) continue; num+=clamp01(v)*w; den+=w; }
  const total=den>0?num/den:0, coverage=wtot>0?den/wtot:0;
  return { parts, total, coverage, eligible:coverage>=MIN_COVERAGE, pct:Math.min(99,Math.round(100*Math.pow(total,0.8))) };
}
/* v2 §7.2: embedding-dominant, audience removed; skip-and-renormalize; falls back to dna+theme if no embeddings. */
function crossScore(a,b){ let num=0,den=0;
  const e=embSim(a,b);              if(e!=null){ num+=0.55*e; den+=0.55; }
  const dn=dnaSim(a.dna,b.dna,null);if(dn!=null){ num+=0.30*dn; den+=0.30; }
  const th=wCos(a.th,b.th,themeIDF);if(th!=null){ num+=0.15*th; den+=0.15; }
  const v=den>0?num/den:0;
  return Math.min(99, Math.round(100*Math.pow(v,0.9)));
}
/* v2 §7.4: MMR diversity re-rank. ranked=[{item,total,...}] sorted desc; ≤2 per creator. */
function mmrRerank(ranked,cat,k=10,lambda=0.75){
  const pool=ranked.slice(0,30), selected=[], creator=Object.create(null);
  const redundancy=(c,s)=>{ const e=embSim(c.item,s.item); return e==null?(dnaSim(c.item.dna,s.item.dna,cat)||0):e; };
  while(selected.length<k&&pool.length){ let best=-Infinity,bi=-1;
    for(let i=0;i<pool.length;i++){ const c=pool[i]; const by=(c.item.by||'').toLowerCase();
      if(by&&(creator[by]||0)>=2) continue; let maxSim=0;
      for(const s of selected){ const r=redundancy(c,s); if(r>maxSim) maxSim=r; }
      const mmr=lambda*c.total-(1-lambda)*maxSim; if(mmr>best){ best=mmr; bi=i; } }
    if(bi<0) break; const chosen=pool.splice(bi,1)[0]; const by=(chosen.item.by||'').toLowerCase();
    if(by) creator[by]=(creator[by]||0)+1; selected.push(chosen); }
  return selected;
}
function lev(a,b,max){
  if(Math.abs(a.length-b.length)>max) return max+1;
  const n=b.length; if(!a.length) return n; if(!n) return a.length;
  let prev=[],cur=[]; for(let j=0;j<=n;j++) prev[j]=j;
  for(let i=1;i<=a.length;i++){ cur[0]=i; let best=i;
    for(let j=1;j<=n;j++){ cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1)); if(cur[j]<best)best=cur[j]; }
    if(best>max) return max+1; const t=prev; prev=cur; cur=t; }
  return prev[n];
}

/* ================= state & index ================= */
const state = { lang:'en', cat:'movies', sel:null, open:null };
try{ const l=localStorage.getItem('vibra-lang'); if(l&&['en','es','pt'].includes(l)) state.lang=l; }catch(e){}
const byId={}; const ALL=[];
let dataOK = false;
function indexData(){
  dataOK = D && typeof D==='object';
  if(dataOK){
    CAT_ORDER.forEach(k=>(D[k]||[]).forEach(it=>{
      it._cat=k; it._keys=[norm(it.t)].concat((it.alt||[]).map(norm)).concat(it.tl?['en','es','pt'].map(l=>norm(it.tl[l]||'')):[]).filter(Boolean);
      byId[it.id]=it; ALL.push(it);
    }));
    buildIDF(ALL);
  }
}
const tr=(o,vars)=>{ let s=(o&&(o[state.lang]||o.en))||''; if(vars) Object.keys(vars).forEach(k=>{ s=s.split('{'+k+'}').join(vars[k]); }); return s; };
// localized title: show the title in the current UI language, falling back to the base title
const TT=it=>(it&&it.tl&&it.tl[state.lang])||(it&&it.t)||'';
const themeLabel=t=>{ const m=THEME_I18N[t]; const s=(state.lang!=='en'&&m)?m[state.lang]:t.replace(/-/g,' '); return s; };
const qual=p=>tr(p>=85?T.q85:p>=70?T.q70:p>=55?T.q55:T.q0);

/* ================= html builders ================= */
function monogram(it){ const s=String(it.t||'?').trim(); const ch=s.charAt(0)||'?'; return esc(ch.toUpperCase()); }
function tile(it){ const h=(it.hue==null?222:it.hue)%360;
  const cov = it.img ? '<img class="cov" src="'+esc(it.img)+'" alt="" loading="lazy" referrerpolicy="no-referrer">' : '';
  return '<div class="tile'+(it.img?' hasimg':'')+'" style="--h:'+h+'"><span class="mono">'+monogram(it)+'</span>'+cov+'<span class="tcat">'+(CAT_ICON[it._cat]||'')+'</span></div>'; }
function qualColor(p){ return p>=85?'#3ab481':p>=70?'#7fae52':p>=55?'#d29a3c':'#a37c73'; }
function ring(pct){ const col=qualColor(pct), r=24, c=2*Math.PI*r;
  return '<div class="ring"><svg viewBox="0 0 56 56" width="100%" height="100%" aria-hidden="true"><circle cx="28" cy="28" r="'+r+'" stroke="var(--line2)" stroke-width="4.5" fill="none"></circle><circle cx="28" cy="28" r="'+r+'" stroke="'+col+'" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-dasharray="'+(c*pct/100).toFixed(1)+' '+c.toFixed(1)+'"></circle></svg><span class="num" style="color:'+col+'">'+pct+'</span></div>'; }
function bar(label,pct){ return '<div class="bar"><div class="lb"><span>'+esc(label)+'</span><span class="v">'+pct+'%</span></div><div class="track"><div class="fill" data-w="'+pct+'"></div></div></div>'; }
function meter(label,val){ return '<div class="meter"><div class="lb"><span>'+esc(label)+'</span><b>'+esc(val)+'</b></div><div class="track"><div class="fill" data-w="'+esc(val)+'"></div></div></div>'; }
function radar(dnaA,dnaB){
  const R=72,cx=110,cy=92;
  const pt=(i,v)=>{ const ang=Math.PI*2*i/8-Math.PI/2, rr=R*v/100; return [(cx+rr*Math.cos(ang)),(cy+rr*Math.sin(ang))]; };
  const poly=d=>d.map((v,i)=>pt(i,v).map(n=>n.toFixed(1)).join(',')).join(' ');
  let s='<svg width="220" height="188" viewBox="0 0 220 188" aria-hidden="true">';
  [25,50,75,100].forEach(v=>{ s+='<polygon points="'+poly([v,v,v,v,v,v,v,v])+'" fill="none" stroke="rgba(255,255,255,.06)"></polygon>'; });
  for(let i=0;i<8;i++){ const p=pt(i,100); s+='<line x1="'+cx+'" y1="'+cy+'" x2="'+p[0].toFixed(1)+'" y2="'+p[1].toFixed(1)+'" stroke="rgba(255,255,255,.05)"></line>'; }
  s+='<polygon points="'+poly(dnaA)+'" style="fill:rgba(255,255,255,.09);stroke:rgba(255,255,255,.45);stroke-width:1.3"></polygon>';
  s+='<polygon points="'+poly(dnaB)+'" style="fill:color-mix(in srgb,var(--acc) 20%,transparent);stroke:var(--acc);stroke-width:1.6"></polygon>';
  for(let i=0;i<8;i++){ const ang=Math.PI*2*i/8-Math.PI/2, lx=cx+R*1.24*Math.cos(ang), ly=cy+R*1.24*Math.sin(ang);
    const anchor=Math.cos(ang)>.35?'start':Math.cos(ang)<-.35?'end':'middle';
    s+='<text x="'+lx.toFixed(1)+'" y="'+(ly+3.5).toFixed(1)+'" text-anchor="'+anchor+'" font-size="9.5" letter-spacing=".08em" fill="rgba(255,255,255,.4)">'+esc(tr(DNA_AX[i]).toUpperCase())+'</text>'; }
  return s+'</svg>';
}
function metaLine(it){
  const bits=[]; if(it.y) bits.push(esc(String(it.y)));
  if(it.by) bits.push('<b>'+esc(it.by)+'</b>');
  const reg=(it.x&&it.x.reg)||it.c; if(reg&&reg!==it.by) bits.push(esc(reg));
  return bits.join(' · ');
}
function whyText(a,b,cat,parts){
  const ranked=CATALGOS[cat].map(([id,w])=>({id,c:(parts[id]||0)*w,v:parts[id]||0})).sort((x,y)=>y.c-x.c);
  const ph=[];
  for(const r of ranked){
    if(ph.length>=3) break; if(r.v<.42) continue;
    if(r.id==='theme'){ const sh=(a.th||[]).filter(t=>(b.th||[]).includes(t)).slice(0,2).map(themeLabel);
      if(sh.length) ph.push(tr(WHY_THEME,{x:sh.join(' + ')})); }
    else if(r.id==='genre'){ const sh=(a.g||[]).filter(t=>(b.g||[]).includes(t));
      if(sh.length) ph.push(tr(WHY_GENRE,{x:sh[0]})); }
    else if(r.id==='craft') ph.push(tr(WHY_CRAFT[cat]));
    else if(WHY[r.id]) ph.push(tr(WHY[r.id]));
  }
  if(!ph.length) ph.push(tr(WHY.mood));
  const s=ph.slice(0,3).join(' · ');
  return s.charAt(0).toUpperCase()+s.slice(1);
}

/* ================= renderers ================= */
const $=id=>document.getElementById(id);
function setAccent(){ document.documentElement.style.setProperty('--acc',CATS[state.cat].acc);
  document.documentElement.style.setProperty('--acc-soft',CATS[state.cat].acc+'29'); }
function animateFills(root){ requestAnimationFrame(()=>{ requestAnimationFrame(()=>{
  root.querySelectorAll('.fill[data-w]').forEach(f=>{ f.style.width=f.dataset.w+'%'; }); }); }); }
function renderChrome(){
  $('protoTag').textContent=tr(T.proto);
  $('tagline').innerHTML=tr(T.tagline);
  $('stats').innerHTML=tr(T.stats,{n:ALL.length,a:activeAlgoRows(state.cat).length});
  $('dice').innerHTML=DICE_SVG+'<span>'+tr(T.surprise)+'</span>';
  $('q').placeholder=tr(T.ph,{u:tr(CATS[state.cat].unit)});
  $('foot').innerHTML=tr(T.foot,{n:ALL.length,a:activeAlgoRows(state.cat).length});
  { const sb=$('suggestBtn'); if(sb) sb.textContent=tr(T.suggestCta); }
  $('labTitle').textContent=tr(T.lab,{cat:tr(CATS[state.cat].name)});
  $('langs').innerHTML=['en','es','pt'].map(l=>'<button data-lang="'+l+'" class="'+(l===state.lang?'on':'')+'">'+l.toUpperCase()+'</button>').join('');
  $('cats').innerHTML=CAT_ORDER.map(k=>{ const c=CATS[k];
    return '<button class="cat '+(k===state.cat?'on':'')+'" data-cat="'+k+'" style="--c:'+c.acc+'"><span class="ico">'+(CAT_ICON[k]||'')+'</span>'+esc(tr(c.name))+'</button>'; }).join('');
  { const rows=activeAlgoRows(state.cat), den=rows.reduce((s,[,w])=>s+w,0);
    $('labGrid').innerHTML=rows.map(([id,w])=>{
      const nm=id==='craft'?tr(CRAFT_NAMES[state.cat]):tr(ALGO_NAMES[id]);
      return '<div class="alg"><div class="nm"><span>'+esc(nm)+'</span><span class="w">'+Math.round(w/den*100)+'% '+tr(T.weight)+'</span></div><div class="ds">'+esc(tr(ALGO_DESCS[id]))+'</div></div>'; }).join(''); }
}
function suggCards(items){ return '<div class="sugg">'+items.map(it=>
  '<button class="sg" data-sel="'+esc(it.id)+'">'+tile(it)+'<span class="t">'+esc(TT(it))+'</span><span class="y">'+esc(it.y||(it.x&&it.x.reg)||it.c||'')+'</span></button>').join('')+'</div>'; }
function renderEmpty(){
  const fan=['movies','music','books','travel'].map(k=>'<i style="background:'+CATS[k].acc+'"></i>').join('');
  const grid=CAT_ORDER.map(k=>{ const c=CATS[k];
    return '<button class="ct" data-cat="'+k+'" style="--c:'+c.acc+'"><span class="ci">'+(CAT_ICON[k]||'')+'</span><span class="cn">'+esc(tr(c.name))+'</span></button>'; }).join('');
  $('out').innerHTML=
    '<section class="spotlight"><h2><span class="dot"></span>'+esc(tr(T.spotTitle))+'</h2>'+
    '<div class="sp-diagram"><span class="heart">'+HEART_SVG+'</span><span class="arrow">&rarr;</span><span class="fan">'+fan+'</span></div>'+
    '<p>'+esc(tr(T.spotLine))+'</p></section>'+
    '<div class="browse"><div class="browse-l">'+esc(tr(T.browseLabel))+'</div><div class="cgrid">'+grid+'</div></div>'+
    '<div class="home-stats">'+tr(T.stats,{n:ALL.length,a:activeAlgoRows(state.cat).length})+'</div>';
}
/* ===== rate-the-match feedback: the training signal for re-fitting the algorithm weights ===== */
const RATING_ENDPOINT='https://esviqajfbkdnpoohjpjt.supabase.co/rest/v1/ratings';
const SEARCH_ENDPOINT='https://esviqajfbkdnpoohjpjt.supabase.co/rest/v1/searches';  // live "misses" logged here → a daily job folds them into the catalog
const RATING_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzdmlxYWpmYmtkbnBvb2hqcGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NzM1NzgsImV4cCI6MjA5OTQ0OTU3OH0.0C0oBrs0OjrcvxNdDVXeBtBs8KTVmgviGJkWffkFKj4';  // anon key — public by design; RLS is insert-only
let rateCtx={};             // matchId -> {pct, parts} stashed at render so a rating can log WHY the pick was made
const CHK_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const XX_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
function getSid(){ let s; try{ s=localStorage.getItem('muse-sid'); if(!s){ s='s'+Math.random().toString(36).slice(2,10)+Date.now().toString(36); localStorage.setItem('muse-sid',s); } }catch(e){ s='anon'; } return s; }
function loadRatings(){ try{ return JSON.parse(localStorage.getItem('muse-ratings')||'[]'); }catch(e){ return []; } }
function ratingOf(src,match){ const r=loadRatings().find(x=>x.k===src+'|'+match); return r?r.r:0; }
function recordRating(mid,val){
  const src=state.sel, cat=state.cat, ctx=rateCtx[mid]||{};
  const key=src+'|'+mid; let arr=loadRatings().filter(x=>x.k!==key);
  if(val!==0){ arr.push({k:key,src:src,match:mid,cat:cat,pct:ctx.pct,parts:ctx.parts||{},r:val,lang:state.lang,sid:getSid(),ts:Date.now()}); }
  try{ localStorage.setItem('muse-ratings',JSON.stringify(arr.slice(-800))); }catch(e){}
  if(RATING_ENDPOINT && RATING_KEY && val!==0){
    const p={sid:getSid(),src:src,match:mid,cat:cat,pct:ctx.pct,r:val,lang:state.lang,parts:ctx.parts||{}};
    try{ fetch(RATING_ENDPOINT,{method:'POST',headers:{'apikey':RATING_KEY,'Authorization':'Bearer '+RATING_KEY,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(p)}).catch(()=>{}); }catch(e){}
  }
}
function rateRow(mid){ const r=ratingOf(state.sel,mid);
  return '<div class="rate"><span class="rq">'+esc(tr(T.rateQ))+'</span>'+
    '<button class="rb up'+(r===1?' on':'')+'" type="button" data-rate="1" data-mid="'+esc(mid)+'" aria-label="'+esc(tr(T.rateGood))+'">'+CHK_SVG+'</button>'+
    '<button class="rb dn'+(r===-1?' on':'')+'" type="button" data-rate="-1" data-mid="'+esc(mid)+'" aria-label="'+esc(tr(T.rateBad))+'">'+XX_SVG+'</button></div>';
}
function matchCard(src,m,i){
  const open=state.open===m.it.id;
  rateCtx[m.it.id]={pct:m.s.pct,parts:m.s.parts};
  const algos=CATALGOS[state.cat].filter(([id])=>m.s.parts[id]!=null).map(([id])=>({id, nm:id==='craft'?tr(CRAFT_NAMES[state.cat]):tr(ALGO_NAMES[id]), v:Math.round(m.s.parts[id]*100)}));
  const top2=algos.slice().sort((a,b)=>b.v-a.v).slice(0,2);
  const why='<div class="why">'+esc(whyText(src,m.it,state.cat,m.s.parts))+'</div>';
  const head='<div class="mhead">'+tile(m.it)+'<div class="info"><div class="rank">#'+(i+1)+' · <span class="quality">'+esc(qual(m.s.pct))+'</span></div><div class="nm">'+esc(TT(m.it))+'</div><div class="by">'+metaLine(m.it)+'</div></div>'+ring(m.s.pct)+'</div>';
  if(!open){
    return '<article class="match" data-mid="'+esc(m.it.id)+'">'+head+why+'<div class="bars">'+top2.map(a=>bar(a.nm,a.v)).join('')+'</div>'+rateRow(m.it.id)+'<div class="more">'+tr(T.expand)+' ↓</div></article>';
  }
  const shared=(src.th||[]).filter(t=>(m.it.th||[]).includes(t));
  const chips=shared.length?'<div><div class="rank" style="margin:10px 0 7px">'+tr(T.sharedThemes).toUpperCase()+'</div><div class="chips">'+shared.map(t=>'<span class="chip th">'+esc(themeLabel(t))+'</span>').join('')+'</div></div>':'';
  return '<article class="match open" data-mid="'+esc(m.it.id)+'">'+head+
    '<div class="xpand"><div>'+why+'<div class="bars" style="margin-top:12px">'+algos.map(a=>bar(a.nm,a.v)).join('')+'</div>'+chips+
    '<p class="desc">'+esc((m.it.d&&(m.it.d[state.lang]||m.it.d.en))||'')+'</p>'+
    '<button class="more" data-sel="'+esc(m.it.id)+'">'+tr(T.exploreFrom)+'</button></div>'+
    '<div class="radarbox"><span class="cap">'+tr(T.dnaCap)+'</span>'+radar(src.dna||[50,50,50,50,50,50,50,50],m.it.dna||[50,50,50,50,50,50,50,50])+
    '<div class="legend"><span><i style="background:rgba(255,255,255,.45)"></i>'+tr(T.srcLegend)+'</span><span><i style="background:var(--acc)"></i>'+tr(T.matchLegend)+'</span></div></div></div>'+
    rateRow(m.it.id)+'<div class="more">'+tr(T.collapse)+' ↑</div></article>';
}
/* food pairing: complementary dish, not a lookalike — same cuisine, contrasting flavour/course */
function pairScore(a,b){
  const xa=a.x||{}, xb=b.x||{};
  const ra=xa.reg||a.c, rb=xb.reg||b.c;
  const cuisine=(ra&&rb&&norm(ra)===norm(rb))?1:((REGIONS[ra]&&REGIONS[ra]===REGIONS[rb])?0.5:0.12);
  const contrast=k=>{ if(!isNum(xa[k])||!isNum(xb[k])) return null; return Math.abs(xa[k]-xb[k])/100; };
  const cp=[contrast('rich'),contrast('sweet'),contrast('spice')].filter(v=>v!=null);
  const flavour=cp.length?cp.reduce((s,v)=>s+v,0)/cp.length:0.3;
  const course=(xa.tech&&xb.tech)?(xa.tech===xb.tech?0:1):0.4;
  return Math.min(99, Math.round(100*(0.45*cuisine+0.35*flavour+0.20*course)));
}
function renderResults(){
  const src=byId[state.sel]; if(!src){ renderEmpty(); return; }
  const cat=state.cat;
  let pool0=(D[cat]||[]).filter(x=>x.id!==src.id);
  if(cat==='food'){ const sb=(src.g||[]).includes('beverage'); pool0=pool0.filter(x=>((x.g||[]).includes('beverage'))===sb); }  // dishes match dishes, drinks match drinks
  let scored=pool0.map(it=>({it,s:score(src,it,cat)}));
  let elig=scored.filter(x=>x.s.eligible);            // v2: coverage gate
  if(elig.length<5) elig=scored;                       // safety: never strand the user on an over-aggressive gate
  elig.sort((a,b)=>b.s.total-a.s.total);
  const ranked=elig.map(x=>({item:x.it,total:x.s.total,s:x.s}));
  const matches=mmrRerank(ranked,cat,10,0.75).sort((a,b)=>b.total-a.total).map(r=>({it:r.item,s:r.s}));   // v2: diversity re-rank, then sort by score so displayed % stays monotonic
  const beyond=CAT_ORDER.filter(k=>k!==cat).map(k=>{
    let best=null,bp=-1; (D[k]||[]).forEach(it=>{ const p=crossScore(src,it); if(p>bp){bp=p;best=it;} });
    return best?{cat:k,it:best,pct:bp}:null; }).filter(Boolean);
  const srcCard='<section class="source"><div class="shead">'+tile(src)+'<div class="stitle"><div class="kicker">'+tr(T.kicker)+' · '+esc(tr(CATS[cat].name)).toUpperCase()+'</div><h2>'+esc(TT(src))+'</h2><div class="meta">'+metaLine(src)+'</div></div></div>'+
    '<div class="chips">'+(src.g||[]).map(g=>'<span class="chip">'+esc(g)+'</span>').join('')+(src.th||[]).slice(0,4).map(t=>'<span class="chip th">'+esc(themeLabel(t))+'</span>').join('')+'</div>'+
    '<p class="desc">'+esc((src.d&&(src.d[state.lang]||src.d.en))||'')+'</p>'+
    '<div class="meters">'+meter(tr(T.pop),src.pop)+meter(tr(T.acc),src.acc)+meter(tr(T.main),src.main)+'</div><span class="fixlink" data-fix="'+esc(src.id)+'">'+esc(tr(T.fixName))+'</span></section>';
  const list='<div class="sechead"><h3>'+tr(T.topMatches)+'</h3><span class="sub">'+tr(T.topSub,{a:activeAlgoRows(cat).length})+'</span></div><div class="grid">'+matches.map((m,i)=>matchCard(src,m,i)).join('')+'</div>';
  const bey='<div class="sechead"><h3>'+esc(tr(T.beyond))+'</h3><span class="sub">'+tr(T.beyondSub)+'</span></div><div class="beyond">'+beyond.map(b=>{
    const c=CATS[b.cat];
    return '<div class="bx" data-sel="'+esc(b.it.id)+'" style="--acc:'+c.acc+'"><div class="cathead" style="color:'+c.acc+'">'+(CAT_ICON[b.cat]||'')+esc(tr(c.name))+'</div><div class="row">'+tile(b.it)+'<div><div class="nm">'+esc(TT(b.it))+'</div><div class="subby">'+esc(b.it.by||'')+'</div></div><span class="pc" style="color:'+c.acc+'">'+b.pct+'</span></div><div class="why">'+esc(whyCross(src,b.it))+'</div></div>'; }).join('')+'</div>';
  let pairs='';
  if(cat==='food'){
    const isBev=it=>(it.g||[]).includes('beverage'), srcBev=isBev(src), allf=(D.food||[]).filter(x=>x.id!==src.id);
    let pl;
    if(srcBev){ pl=allf.filter(x=>!isBev(x)).map(it=>({it,p:pairScore(src,it)})).filter(x=>x.p>=25).sort((a,b)=>b.p-a.p).slice(0,6); }
    else { const ALC=new Set(['beer','wine','cocktail','spirit']); const isAlc=it=>(it.g||[]).some(g=>ALC.has(g));
      const bev=allf.filter(isBev).map(it=>({it,p:pairScore(src,it)}));
      const alc=bev.filter(x=>isAlc(x.it)).sort((a,b)=>b.p-a.p).slice(0,3);        // alcoholic drinks first
      const soft=bev.filter(x=>!isAlc(x.it)).sort((a,b)=>b.p-a.p).slice(0,2);       // then the others (non-alcoholic)
      const dishes=allf.filter(x=>!isBev(x)).map(it=>({it,p:pairScore(src,it)})).filter(x=>x.p>=28).sort((a,b)=>b.p-a.p).slice(0,2);
      pl=alc.concat(soft).concat(dishes); }
    if(pl.length) pairs='<div class="sechead"><h3>'+esc(tr({en:'Perfect pairings',es:'Maridajes perfectos',pt:'Harmonizações perfeitas'}))+'</h3><span class="sub">'+esc(tr({en:'drinks & dishes that complete the meal',es:'bebidas y platos que completan la comida',pt:'bebidas e pratos que completam a refeição'}))+'</span></div><div class="beyond">'+
      pl.map(x=>'<div class="bx" data-sel="'+esc(x.it.id)+'" style="--acc:'+CATS.food.acc+'"><div class="cathead" style="color:'+CATS.food.acc+'">'+(CAT_ICON.food||'')+esc(((x.it.x&&x.it.x.reg)||x.it.c||'dish'))+'</div><div class="row">'+tile(x.it)+'<div><div class="nm">'+esc(TT(x.it))+'</div></div><span class="pc" style="color:'+CATS.food.acc+'">'+x.p+'</span></div></div>').join('')+'</div>';
  }
  $('out').innerHTML=srcCard+pairs+bey+list;
  animateFills($('out'));
}
function whyCross(a,b){
  const sh=(a.th||[]).filter(t=>(b.th||[]).includes(t)).slice(0,2).map(themeLabel);
  if(sh.length){ const s=tr(WHY_THEME,{x:sh.join(' + ')}); return s.charAt(0).toUpperCase()+s.slice(1); }
  return tr(WHY.mood).charAt(0).toUpperCase()+tr(WHY.mood).slice(1);
}
function renderAll(){ setAccent(); renderChrome(); const pit=$('pitch'),lab=$('lab'),foot=$('foot'),cats=$('cats');
  if(!dataOK){ if(pit) pit.hidden=false; $('out').innerHTML='<p class="hint">'+tr(T.dataMissing)+'</p>'; return; }
  renderResults(); const home=!state.sel;
  if(pit) pit.hidden=!home;
  if(cats) cats.style.display=home?'none':'';
  if(lab) lab.style.display=home?'none':'';
  if(foot) foot.style.display='none';
  animateFills(document.body); }

/* ================= autocomplete ================= */
let acItems=[], acIdx=-1;
function suggScore(qq,it){
  let best=0;
  for(const k of it._keys){
    if(!k) continue; let s=0;
    if(k===qq) s=120;
    else if(k.startsWith(qq)) s=100-Math.min(20,(k.length-qq.length)*.5);
    else { const words=k.split(' ');
      if(words.some(w=>w.startsWith(qq))) s=84;
      else if(qq.length>=3&&k.indexOf(qq)>=0) s=72;
      else if(qq.length>=4){
        const d=lev(qq,k,2); if(d<=2) s=68-9*d;
        else for(const w of words){ if(Math.abs(w.length-qq.length)<=2){ const dw=lev(qq,w,2); if(dw<=2) s=Math.max(s,60-8*dw); } } } }
    if(s>best) best=s; }
  return best? best+(it.pop||0)*.08 : 0;
}
function suggest(qq){
  qq=norm(qq); if(!qq) return {list:[]};
  const scored=ALL.map(it=>{ const b=suggScore(qq,it); return {it, s: b>0 ? b+(it._cat===state.cat?12:0) : 0}; }).filter(x=>x.s>0).sort((a,b)=>b.s-a.s);  // only lift genuine matches; a 0-score item must NOT pass via the same-cat bonus
  return { list:scored.slice(0,9) };   // globally ranked; a strong exact/prefix match wins over a weak same-category one
}
function renderAC(){
  const el=$('ac'); const v=$('q').value; const q=v.trim();
  if(!q){ el.hidden=true; acItems=[]; return; }
  const {list}=suggest(v); acItems=list; acIdx=acItems.length?0:-1;
  const mag='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.6-3.6"></path></svg>';
  const liveRow='<div class="opt liveopt" data-live="1"><span class="mini">'+mag+'</span><span class="nm">'+esc(tr(T.searchWeb,{q:q}))+'</span></div>';
  el.innerHTML=list.map((x,i)=>acOpt(x.it,i)).join('')+liveRow;  // always offer a live "find anything" search
  el.hidden=false;
}
function acOpt(it,i){
  const c=CATS[it._cat]; const h=(it.hue==null?222:it.hue)%360;
  return '<div class="opt'+(i===acIdx?' sel':'')+'" data-i="'+i+'"><span class="mini" style="--h:'+h+'">'+monogram(it)+'</span><span class="nm">'+esc(TT(it))+(it.y?' <span class="yr">'+esc(it.y)+'</span>':'')+'</span><span class="ct">'+(CAT_ICON[it._cat]||'')+esc(tr(c.name))+'</span></div>';
}
function hideAC(){ $('ac').hidden=true; acItems=[]; acIdx=-1; }
function pick(i){ if(i<0||i>=acItems.length) return; select(acItems[i].it.id,true); }

/* ================= actions ================= */
function select(id,scroll){
  const it=byId[id]; if(!it) return;
  state.cat=it._cat; state.sel=id; state.open=null;
  $('q').value=it.t; hideAC(); renderAll();
  if(scroll){ const o=$('out'); if(o&&o.scrollIntoView) o.scrollIntoView({behavior:'smooth',block:'start'}); }
}
function surprise(){
  const pool=(D[state.cat]||[]); if(!pool.length) return;
  const hot=pool.filter(p=>p.pop>=55); const src=(hot.length?hot:pool);
  select(src[Math.floor(Math.random()*src.length)].id,true);
}

/* ================= events ================= */
const REPO='https://github.com/jorquesa-hue/muse';
// community curation: open a pre-filled GitHub issue (user reviews + submits it themselves)
function openSuggest(itemId){
  let title, body;
  if(itemId && byId[itemId]){ const it=byId[itemId];
    title='[Fix] '+it.t;
    body='Item: '+it.t+' (id: '+it.id+', '+it._cat+')\n\nWhat is wrong? (localized title / cover / genre / data)\n\nCorrect titles —\nEN: \nES: \nPT: \n\nNotes:\n';
  } else {
    title='[Suggestion] ';
    body='Type (movie / tv / book / music / game / anime / food / travel):\nTitle:\nWhy it belongs / what to fix:\n\nIf a title shows the wrong name, add the correct names —\nEN: \nES: \nPT: \n';
  }
  const url=REPO+'/issues/new?labels=data-suggestion&title='+encodeURIComponent(title)+'&body='+encodeURIComponent(body);
  window.open(url,'_blank','noopener,noreferrer');
}
/* ================= live "find anything" fallback (keyless: Wikipedia + Wikidata) ================= */
const WIKI_API='https://en.wikipedia.org/w/api.php';
const LIVE_HINT={movies:'film',tv:'television series',books:'novel',music:'music album',games:'video game',anime:'anime',food:'dish',travel:'city'};
const LIVE_GEN=[[/science fiction|sci-fi|sci fi/,'sci-fi'],[/fantasy/,'fantasy'],[/horror/,'horror'],[/thriller|suspense/,'thriller'],[/sitcom|comed/,'comedy'],[/roman[ct]/,'romance'],[/action/,'action'],[/adventure/,'adventure'],[/drama/,'drama'],[/crime|detective|noir|gangster/,'crime'],[/myster/,'mystery'],[/documentary/,'documentary'],[/animat/,'animation'],[/\bwar\b/,'war'],[/western/,'western'],[/musical/,'musical'],[/histor|period piece/,'historical'],[/role-playing|rpg/,'rpg'],[/shooter|first-person/,'shooter'],[/platform/,'platformer'],[/strategy/,'strategy'],[/puzzle/,'puzzle'],[/fighting/,'fighting'],[/racing/,'racing'],[/simulation|life sim/,'simulation'],[/\brock\b/,'rock'],[/\bpop\b/,'pop'],[/hip hop|hip-hop|\brap\b/,'hip-hop'],[/electronic|techno|house|edm/,'electronic'],[/jazz/,'jazz'],[/metal/,'metal'],[/\bfolk\b/,'folk'],[/soul|r&b|rhythm and blues/,'soul'],[/classical|orchestr|symphon/,'classical'],[/reggae/,'reggae'],[/punk/,'punk'],[/blues/,'blues'],[/\bcountry\b/,'country'],[/sh[oō]nen/,'shonen-action'],[/seinen/,'seinen'],[/slice of life/,'slice-of-life'],[/mecha/,'mecha'],[/psychological/,'psychological'],[/sport/,'sports']];
const GDNA={'drama':[55,55,60,20,40,45,52,25],'comedy':[20,35,40,90,60,30,78,30],'crime':[70,66,55,20,60,45,25,30],'thriller':[66,82,55,15,80,45,25,35],'sci-fi':[55,55,80,25,58,66,30,66],'fantasy':[40,52,52,35,55,82,52,60],'horror':[85,82,45,10,55,40,15,66],'animation':[24,42,45,66,60,52,78,42],'action':[50,82,35,25,86,60,35,25],'romance':[25,42,35,45,45,32,86,20],'mystery':[55,56,72,25,55,36,30,32],'historical':[56,54,60,22,42,66,46,22],'adventure':[40,62,40,35,76,72,52,30],'war':[80,82,55,10,66,76,25,25],'western':[56,62,45,25,50,56,40,26],'musical':[24,46,36,56,66,52,82,30],'documentary':[45,36,82,25,36,46,46,24],'rpg':[50,55,65,25,45,80,50,40],'shooter':[60,85,35,20,90,55,25,30],'platformer':[30,55,35,45,82,45,62,35],'strategy':[45,50,82,20,35,60,35,30],'puzzle':[30,40,82,35,50,30,50,45],'fighting':[55,80,30,30,92,50,30,35],'racing':[35,72,25,30,95,45,40,25],'simulation':[35,35,60,35,30,45,55,42],'rock':[50,65,40,30,70,55,45,35],'pop':[25,45,30,45,72,40,72,25],'hip-hop':[55,70,55,40,75,50,40,40],'electronic':[45,60,55,25,78,55,35,58],'jazz':[45,40,75,35,45,45,62,45],'metal':[85,90,45,15,82,65,15,50],'folk':[42,35,55,35,35,40,72,30],'soul':[40,50,42,40,55,40,78,30],'classical':[45,45,82,20,40,78,55,35],'reggae':[25,42,40,50,55,35,80,35],'punk':[65,85,40,35,90,45,30,45],'blues':[60,50,50,30,45,35,58,30],'country':[40,40,35,42,50,40,72,20],'shonen-action':[45,75,40,45,82,65,45,45],'seinen':[65,60,72,25,50,55,35,50],'slice-of-life':[20,25,45,55,30,25,85,35],'mecha':[60,75,65,20,70,75,30,55],'psychological':[80,70,88,10,45,45,20,60],'sports':[30,65,40,45,80,55,60,25]};
const GTH={'drama':['identity','loss'],'comedy':['joy','friendship'],'crime':['crime','justice'],'thriller':['mystery','survival'],'sci-fi':['technology','discovery'],'fantasy':['adventure','wonder'],'horror':['survival','isolation'],'animation':['family','wonder'],'action':['survival','power'],'romance':['love','romance'],'mystery':['mystery','crime'],'historical':['heritage','tradition'],'adventure':['adventure','journey'],'war':['war','survival'],'western':['freedom','justice'],'musical':['love','celebration'],'documentary':['discovery','nature'],'rpg':['journey','power'],'shooter':['survival','war'],'platformer':['adventure','joy'],'strategy':['power','ambition'],'puzzle':['discovery'],'fighting':['ambition','power'],'racing':['freedom','ambition'],'simulation':['craftsmanship'],'rock':['rebellion','freedom'],'pop':['love','joy'],'hip-hop':['identity','ambition'],'electronic':['escape','technology'],'jazz':['artistry','melancholy'],'metal':['chaos','rebellion'],'folk':['nostalgia','nature'],'soul':['love','melancholy'],'classical':['artistry','tradition'],'reggae':['freedom','community'],'punk':['rebellion','chaos'],'blues':['melancholy','loss'],'country':['nostalgia','heritage'],'shonen-action':['adventure','friendship'],'seinen':['identity','isolation'],'slice-of-life':['comfort','friendship'],'mecha':['war','technology'],'psychological':['identity','obsession'],'sports':['ambition','friendship']};
const NOUN_L={tv:'series',books:'book',music:'album',games:'game',anime:'anime',food:'dish',travel:'destination'};
let liveBusy=false;
const slugL=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const hueL=s=>{let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%360;return Math.abs(h);};
const clL=v=>Math.max(0,Math.min(100,Math.round(v)));
const jitL=(s,a)=>(s%(2*a+1))-a;
async function jget(url){ try{ const r=await fetch(url); return r.ok?await r.json():null; }catch(e){ return null; } }
function mapLiveGenres(labels){ const out=[]; const s=labels.join(' | ').toLowerCase(); for(const pair of LIVE_GEN){ if(pair[0].test(s)&&out.indexOf(pair[1])<0) out.push(pair[1]); if(out.length>=3) break; } return out; }
function liveDna(keys,seed){ const acc=[0,0,0,0,0,0,0,0]; let n=0; for(const k of keys){ const b=GDNA[k]; if(b){ for(let i=0;i<8;i++) acc[i]+=b[i]; n++; } } if(!n){ const base=[45,50,52,40,50,52,55,42]; return base.map((v,i)=>clL(v+jitL(seed+i*7,8))); } return acc.map((v,i)=>clL(v/n+jitL(seed+i*7,6))); }
function liveTh(keys){ const p=[]; for(const k of keys){ for(const t of (GTH[k]||[])){ if(p.indexOf(t)<0) p.push(t); } } return p.length?p.slice(0,4):['discovery']; }
async function liveLookup(cat, query){
  const s=await jget(WIKI_API+'?action=query&list=search&srnamespace=0&srlimit=1&format=json&origin=*&srsearch='+encodeURIComponent(query+' '+(LIVE_HINT[cat]||'')));
  const hit=s&&s.query&&s.query.search&&s.query.search[0]; if(!hit) return null;
  const pp=await jget(WIKI_API+'?action=query&prop=pageprops|pageimages&piprop=thumbnail&pithumbsize=440&redirects=1&format=json&origin=*&titles='+encodeURIComponent(hit.title));
  const pages=pp&&pp.query&&pp.query.pages; const page=pages&&pages[Object.keys(pages)[0]];
  const qid=page&&page.pageprops&&page.pageprops.wikibase_item;
  const img=page&&page.thumbnail&&page.thumbnail.source||null;
  let genres=[],year=null,creator='',country='',links=6,ptTitle='',esTitle='';
  if(qid){
    const Q='SELECT ?glabel ?year ?clabel ?colabel ?links ?ptlab ?eslab WHERE { wd:'+qid+' wikibase:sitelinks ?links. OPTIONAL{ wd:'+qid+' wdt:P136 ?g. ?g rdfs:label ?glabel. FILTER(LANG(?glabel)="en") } OPTIONAL{ wd:'+qid+' wdt:P577 ?d. BIND(YEAR(?d) AS ?year) } OPTIONAL{ wd:'+qid+' (wdt:P57|wdt:P50|wdt:P175|wdt:P178|wdt:P86) ?c. ?c rdfs:label ?clabel. FILTER(LANG(?clabel)="en") } OPTIONAL{ wd:'+qid+' (wdt:P495|wdt:P17) ?co. ?co rdfs:label ?colabel. FILTER(LANG(?colabel)="en") } OPTIONAL{ wd:'+qid+' rdfs:label ?ptlab. FILTER(LANG(?ptlab)="pt") } OPTIONAL{ wd:'+qid+' rdfs:label ?eslab. FILTER(LANG(?eslab)="es") } } LIMIT 30';
    const wd=await jget('https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(Q));
    const rows=(wd&&wd.results&&wd.results.bindings)||[];
    for(const r of rows){ if(r.glabel&&genres.indexOf(r.glabel.value)<0) genres.push(r.glabel.value); if(r.year&&!year) year=parseInt(r.year.value,10); if(r.clabel&&!creator) creator=r.clabel.value; if(r.colabel&&!country) country=r.colabel.value; if(r.links&&r.links.value) links=parseInt(r.links.value,10); if(r.ptlab&&!ptTitle) ptTitle=r.ptlab.value; if(r.eslab&&!esTitle) esTitle=r.eslab.value; }
  }
  const t=hit.title.replace(/\s*\([^)]*\)\s*$/,'').trim(); if(!t) return null;
  const keys=mapLiveGenres(genres); const seed=hueL(t); const gk=keys[0]||'drama';
  const noun=NOUN_L[cat]||'film'; const dtxt=gk.charAt(0).toUpperCase()+gk.slice(1)+' '+noun+(year?' ('+year+')':'');
  return { id:'live-'+cat+'-'+slugL(t), t:t, alt:[], y:year, by:creator, cast:[], g:(keys.length?keys:[gk]), th:liveTh(keys), dna:liveDna(keys,seed),
    pop:clL(28+Math.round(Math.log10(links+1)*22)), acc:clL(60+jitL(seed,10)), main:clL(38+Math.round(Math.log10(links+1)*15)),
    c:country, d:{en:dtxt,es:dtxt,pt:dtxt}, hue:seed, img:img, tl:{en:t,es:(esTitle||t),pt:(ptTitle||t)}, x:{}, _cat:cat, _live:true };
}
async function selectLive(cat, query){
  query=(query||'').trim(); if(!query||liveBusy) return; liveBusy=true; hideAC();
  { const o=$('out'); if(o){ o.innerHTML='<div class="livewait">'+esc(tr(T.searching,{q:query}))+'</div>'; if(o.scrollIntoView) o.scrollIntoView({behavior:'smooth',block:'center'}); } }
  try{
    const it=await liveLookup(cat,query);
    if(it){ byId[it.id]=it;
      if(SEARCH_ENDPOINT&&RATING_KEY){ try{ fetch(SEARCH_ENDPOINT,{method:'POST',headers:{apikey:RATING_KEY,Authorization:'Bearer '+RATING_KEY,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({cat:cat,title:it.t,item:it})}).catch(function(){}); }catch(e){} }
      state.cat=cat; state.sel=it.id; state.open=null; $('q').value=it.t; renderAll(); const o=$('out'); if(o&&o.scrollIntoView) o.scrollIntoView({behavior:'smooth',block:'start'}); }
    else { const o=$('out'); if(o) o.innerHTML='<div class="livewait">'+esc(tr(T.noWebResult,{q:query}))+'</div>'; }
  }catch(err){ const o=$('out'); if(o) o.innerHTML='<div class="livewait">'+esc(tr(T.noWebResult,{q:query}))+'</div>'; }
  liveBusy=false;
}
document.addEventListener('click',e=>{
  const lb=e.target.closest('[data-lang]');
  if(lb){ state.lang=lb.dataset.lang; try{localStorage.setItem('vibra-lang',state.lang);}catch(err){} renderAll(); return; }
  if(e.target.closest('[data-home]')){ state.sel=null; state.open=null; $('q').value=''; hideAC(); renderAll(); const sc=document.querySelector('.appscroll'); if(sc) sc.scrollTop=0; if(window.scrollTo) window.scrollTo(0,0); return; }
  const fx=e.target.closest('[data-fix]'); if(fx){ openSuggest(fx.getAttribute('data-fix')); return; }
  if(e.target.closest('[data-retry]')){ boot(); loadData(); return; }
  if(e.target.closest('[data-suggest]')){ openSuggest(null); return; }
  const rb=e.target.closest('[data-rate]');
  if(rb){ const mid=rb.getAttribute('data-mid'); const cur=ratingOf(state.sel,mid); const val=+rb.getAttribute('data-rate'); const nv=(cur===val?0:val);
    recordRating(mid,nv); const grp=rb.parentNode; grp.querySelectorAll('.rb').forEach(b=>b.classList.toggle('on', nv!==0 && +b.getAttribute('data-rate')===nv)); return; }
  const cb=e.target.closest('[data-cat]');
  if(cb){ state.cat=cb.dataset.cat; state.sel=null; state.open=null; $('q').value=''; hideAC(); renderAll(); const qi=$('q'); if(qi&&qi.focus) qi.focus(); return; }
  const sb=e.target.closest('[data-sel]');
  if(sb){ e.stopPropagation(); select(sb.dataset.sel,true); return; }
  const card=e.target.closest('.match');
  if(card){
    const id=card.dataset.mid;
    if(state.open!==id){ state.open=id; renderResults(); }
    else if(e.target.closest('.more')||e.target.closest('.mhead')){ state.open=null; renderResults(); }
    return;
  }
  if(!e.target.closest('.searchbox')) hideAC();
});
$('ac').addEventListener('mousedown',e=>{
  const o=e.target.closest('.opt'); if(!o) return; e.preventDefault();
  if(o.hasAttribute('data-live')){ selectLive(state.cat,$('q').value); return; }
  pick(+o.dataset.i);
});
$('q').addEventListener('input',renderAC);
$('q').addEventListener('focus',renderAC);
$('q').addEventListener('keydown',e=>{
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    if(!acItems.length) return; e.preventDefault();
    acIdx=(acIdx+(e.key==='ArrowDown'?1:-1)+acItems.length)%acItems.length;
    const el=$('ac'); el.querySelectorAll('.opt').forEach(o=>o.classList.toggle('sel',+o.dataset.i===acIdx));
  } else if(e.key==='Enter'){
    if(acItems.length) pick(Math.max(0,acIdx));
    else selectLive(state.cat,$('q').value);   // nothing local → find it live
  } else if(e.key==='Escape'){ hideAC(); }
});
$('dice').addEventListener('click',surprise);
/* broken/blocked cover image -> drop it so the monogram shows through */
document.addEventListener('error',function(e){ const t=e.target; if(t&&t.classList&&t.classList.contains('cov')) t.remove(); },true);
document.addEventListener('keydown',e=>{
  if(e.key==='/'&&document.activeElement!==$('q')){ e.preventDefault(); $('q').focus(); }
});

/* boot: use inline data if present, else fetch external data.json (deployed build) */
function finishInit(){
  indexData(); renderAll();
  loadEmb('embeddings.b64.json').then(()=>{ if(state.sel) renderResults(); }).catch(()=>{});
}
// render chrome + a loading state immediately, before data.json has even started resolving,
// so first-time visitors never see a dead blank screen while the ~3.6MB catalog downloads.
function boot(){
  indexData(); renderChrome();
  const pit=$('pitch'), fo=$('foot'); if(pit) pit.hidden=true; if(fo) fo.style.display='none';
  $('out').innerHTML='<div class="livewait">'+esc(tr(T.loading))+'</div>';
}
function loadData(){
  fetch('data.json').then(r=>{ if(!r.ok) throw new Error('http '+r.status); return r.json(); })
    .then(j=>{ D=j; finishInit(); })
    .catch(()=>{ $('out').innerHTML='<div class="livewait">'+esc(tr(T.loadFail))+
      '<br><button class="suggest" type="button" data-retry>'+esc(tr(T.retry))+'</button></div>'; });
}
if(D && typeof D==='object'){ finishInit(); }
else { boot(); loadData(); }
})();