/* Bump the service-worker cache version. Run this AFTER editing index.html / style.css / app.js
 * so returning users actually receive the update (the SW is cache-first, keyed by version).
 * Usage:  node scripts/bump-sw.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
const SW = new URL('../sw.js', import.meta.url).pathname;
const sw = await readFile(SW, 'utf8');
const m = sw.match(/muse-v(\d+)/);
if (!m) { console.error('No muse-vN version found in sw.js'); process.exit(1); }
const next = 'muse-v' + (parseInt(m[1], 10) + 1);
await writeFile(SW, sw.replace(/muse-v\d+/g, next), 'utf8');
console.log('service worker ->', next);
