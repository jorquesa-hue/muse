/* Muse — Instagram auto-poster (run by .github/workflows/ig-post.yml on a cron).
 *
 * Publishes the NEXT unposted card in ig/queue.json to Instagram via the official Graph API
 * (Content Publishing). One post per run — well under Instagram's 25/day limit and spam-safe.
 *
 * Flow (official, ToS-compliant): create a media container from a PUBLIC image URL + caption,
 * poll it to FINISHED, then publish. The image URL is the card committed under ig/ and served by
 * GitHub Pages at muse-find.com/ig/posts/<slug>.jpg.
 *
 * Requires (GitHub repo secrets):
 *   IG_USER_ID       - the Instagram *Business/Creator* account id (from the Graph API)
 *   IG_ACCESS_TOKEN  - a long-lived access token with instagram_content_publish
 * Optional env:
 *   IG_ASSET_BASE    - public base for the images (default https://muse-find.com)
 *   IG_GRAPH_VERSION - Graph API version (default v21.0)
 *   DRY_RUN=1        - parse + pick the next post and print what WOULD be published; no API calls
 *
 * Exit codes: 0 = published (or queue empty, or dry-run), 1 = misconfig / API error.
 * Node 20+ (global fetch). No deps.
 */
import { readFile, writeFile } from 'node:fs/promises';

const QUEUE = new URL('../ig/queue.json', import.meta.url).pathname;
const BASE = (process.env.IG_ASSET_BASE || 'https://muse-find.com').replace(/\/+$/,'');
const GV = process.env.IG_GRAPH_VERSION || 'v21.0';
const DRY = !!process.env.DRY_RUN;
const IG_USER = process.env.IG_USER_ID;
const TOKEN = process.env.IG_ACCESS_TOKEN;

const q = JSON.parse(await readFile(QUEUE, 'utf8'));
const next = (q.posts || []).find(p => !p.posted);
if (!next) { console.log('Queue empty — every card is already posted. Nothing to do.'); process.exit(0); }

const imageUrl = `${BASE}/ig/${next.img}`;
console.log(`Next: #${next.n} "${next.anchor}"  ->  ${imageUrl}`);

if (DRY) {
  console.log('--- DRY_RUN: would publish this caption ---\n' + next.caption + '\n--- (no API calls made) ---');
  process.exit(0);
}
if (!IG_USER || !TOKEN) { console.error('ERROR: IG_USER_ID and IG_ACCESS_TOKEN must be set (GitHub secrets).'); process.exit(1); }

const api = (path, body) => fetch(`https://graph.facebook.com/${GV}/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, access_token: TOKEN }),
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 1) create the media container
const cRes = await api(`${IG_USER}/media`, { image_url: imageUrl, caption: next.caption });
const cJson = await cRes.json().catch(() => ({}));
if (!cRes.ok || !cJson.id) { console.error('Container creation failed:', cRes.status, JSON.stringify(cJson)); process.exit(1); }
const creationId = cJson.id;
console.log('Container:', creationId);

// 2) wait until the container has fetched the image (FINISHED) before publishing
let status = '';
for (let i = 0; i < 10; i++) {
  const sRes = await fetch(`https://graph.facebook.com/${GV}/${creationId}?fields=status_code&access_token=${encodeURIComponent(TOKEN)}`);
  const sJson = await sRes.json().catch(() => ({}));
  status = sJson.status_code || '';
  if (status === 'FINISHED') break;
  if (status === 'ERROR') { console.error('Container processing ERROR:', JSON.stringify(sJson)); process.exit(1); }
  await sleep(3000);
}
if (status !== 'FINISHED') { console.error('Container not ready in time (last status:', status + '). Aborting; will retry next run.'); process.exit(1); }

// 3) publish
const pRes = await api(`${IG_USER}/media_publish`, { creation_id: creationId });
const pJson = await pRes.json().catch(() => ({}));
if (!pRes.ok || !pJson.id) { console.error('Publish failed:', pRes.status, JSON.stringify(pJson)); process.exit(1); }

next.posted = true; next.posted_id = pJson.id;
await writeFile(QUEUE, JSON.stringify(q, null, 2));
const left = q.posts.filter(p => !p.posted).length;
console.log(`Published "${next.anchor}" as media ${pJson.id}. ${left} post(s) left in the queue.`);
