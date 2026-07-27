/* Muse — retrofit the ALREADY-RENDERED Instagram queue with trilingual (EN/ES/PT) captions.
 *
 * The card images are unchanged; only the caption text is rewritten. Each card's recommendation
 * "chain" is parsed out of its existing caption, so the new trilingual caption always matches what
 * the image shows — no engine re-run, no cover fetch (those hosts are sandbox-blocked anyway).
 *
 * In:  ig/queue.json (from a previous build). Out: ig/queue.json (caption -> trilingual + per-lang
 * `captions` block) and ig/captions.md (human-readable, all three languages). No deps. Node 18+.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { buildCaptions, EMO } from './ig-caption.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const QUEUE = ROOT + 'ig/queue.json';
const CAPS = ROOT + 'ig/captions.md';
const EMO_VALUES = new Set(Object.values(EMO));

// find the recommendation-chain block inside an existing caption: the block that carries a category
// emoji and the "  ·  " separator (robust to hook/tagline wording changes).
function extractChainLine(caption) {
  const blocks = String(caption || '').split(/\n{2,}/).map((b) => b.trim());
  for (const b of blocks) {
    if (!b.includes('·')) continue;
    if ([...EMO_VALUES].some((e) => b.includes(e))) return b;
  }
  return null;
}

const q = JSON.parse(await readFile(QUEUE, 'utf8'));
let done = 0, skipped = 0;
for (const post of q.posts || []) {
  const chain = extractChainLine(post.caption);
  const { parseChain } = await import('./ig-caption.mjs');
  const matches = chain ? parseChain(chain) : [];
  if (!matches.length) { skipped++; console.warn(`! no chain parsed for #${post.n} ${post.anchor} — leaving as is`); continue; }
  const caps = buildCaptions({ anchorTitle: post.anchor, anchorCat: post.cat, matches, index: (post.n || 1) - 1 });
  post.caption = caps.combined;              // the trilingual caption (what you paste into IG)
  post.captions = { en: caps.en, es: caps.es, pt: caps.pt };  // per-language, for language-specific posting
  done++;
}
await writeFile(QUEUE, JSON.stringify(q, null, 2));

// human-readable captions.md — trilingual combined + collapsible per-language
let md = `# Muse — Instagram captions (trilingual EN / ES / PT)\n\n`;
md += `Every match is a real muse-find.com result. Bio link: **muse-find.com**\n\n`;
md += `Each post below has the ready-to-paste **trilingual** caption, then the individual EN / ES / PT versions if you prefer to post one language at a time.\n\n---\n\n`;
for (const post of q.posts || []) {
  md += `## ${post.n}. ${post.anchor}  \`${post.img}\`\n\n`;
  md += `**Trilingual (paste this):**\n\n> ${post.caption.replace(/\n/g, '\n> ')}\n\n`;
  if (post.captions) {
    for (const [lang, label] of [['en', '🇬🇧 English'], ['es', '🇪🇸 Español'], ['pt', '🇧🇷 Português']]) {
      md += `<details><summary>${label}</summary>\n\n> ${post.captions[lang].replace(/\n/g, '\n> ')}\n\n</details>\n\n`;
    }
  }
  md += `---\n\n`;
}
await writeFile(CAPS, md);

console.log(`recaptioned ${done} posts (${skipped} skipped) -> ${QUEUE} + ${CAPS}`);
