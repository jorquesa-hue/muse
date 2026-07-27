# Muse — kit de postagem no Instagram (@muse_find)

Tudo o que você precisa para postar as cartas **"if you love X → a universe out"** no Instagram,
**a partir do seu computador, sem o Meta Business / API oficial**.

## O que tem aqui

| Arquivo | O que é |
|---|---|
| `posts/NN-slug.jpg` | As **45 imagens** prontas (1080×1350, tema claro, capas reais). |
| `queue.json` | A fila: cada post tem a legenda **trilíngue** + versões separadas EN/ES/PT, e um flag `posted`. |
| `captions.md` | As legendas em formato legível (trilíngue + cada idioma). Bom para copiar à mão. |
| `contact-sheet.png` | Miniatura de todas as cartas juntas, para revisar rápido. |
| `post-helper.py` | Um ajudante local que copia a legenda e abre a imagem para você postar. |

As legendas são **trilíngues (EN / ES / PT)** — inglês, espanhol e português no mesmo post — e cabem
folgado no limite de 2200 caracteres do Instagram. Os títulos das obras não são traduzidos (nomes próprios).

## Modo assistido (recomendado — zero risco de banimento)

O `post-helper.py` **não faz login** na sua conta e não usa nenhuma API. Ele só prepara o post:
copia a legenda para a área de transferência e abre a imagem. Você toca em **"+"** no app do
Instagram, escolhe a imagem e **cola** a legenda. Um humano posta — nada automatiza o login.

```bash
cd ig                     # entre nesta pasta
python3 post-helper.py list                 # ver a fila e o que já foi postado
python3 post-helper.py next                 # próxima carta não postada (legenda trilíngue)
python3 post-helper.py next --lang pt        # só em português (ou en / es / tri)
python3 post-helper.py post 8                # uma carta específica pelo número
python3 post-helper.py reset 8               # marcar como "não postada" de novo
```

Ao rodar `next`, ele: copia a legenda, salva um `.txt` ao lado da imagem, abre a imagem, e pergunta
se você postou — se responder `y`, marca como feito e da próxima vez pula para a seguinte.

Precisa de Python 3.8+ (já vem no macOS e na maioria dos Linux; no Windows: python.org).
No Linux, para copiar a legenda automaticamente, instale `xclip` ou `wl-copy` (senão a legenda fica
salva no `.txt`).

## Automação total (opcional — leia o aviso)

Dá para automatizar 100% (o script posta sozinho num horário), mas **só via APIs não-oficiais**
(ex.: a biblioteca `instagrapi`, que faz login como se fosse o app do celular). Isso **viola os
Termos do Instagram** e tem **risco real de bloqueio de ações ou banimento** — especialmente numa
conta nova postando de forma automática. Não incluí esse caminho por padrão de propósito.

Se mesmo assim você quiser, dá para montar com salvaguardas (1 post/dia, sessão salva, horários
humanos). É só pedir que eu preparo — mas o modo assistido acima entrega quase a mesma comodidade
sem colocar a conta em risco.

## Dica de cadência

3 posts por semana (seg/qua/sex) faz as 45 cartas durarem ~15 semanas. Postar 1/dia esgota em ~6
semanas. O Instagram permite bastante mais que isso; o limite prático é não parecer spam.
