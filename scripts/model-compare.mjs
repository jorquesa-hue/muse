/* Muse — E4 embedding-model bake-off. Reads two eval reports (the current live model vs a candidate)
 * produced by eval.mjs with different embeddings, writes eval/model-comparison.md, and applies the
 * ship gate: SWITCH to the candidate ONLY if its overall accuracy beats the baseline by >= 1 point.
 *
 * Env: BASE_REPORT / CAND_REPORT (paths, default eval/report.minilm.json / eval/report.bge.json),
 *      BASE_NAME / CAND_NAME (labels), SWITCH_THRESHOLD (default 1). Node 18+.
 */
import { readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url).pathname;
const EVAL = ROOT + 'eval/';
const BASE_REPORT = process.env.BASE_REPORT || (EVAL + 'report.minilm.json');
const CAND_REPORT = process.env.CAND_REPORT || (EVAL + 'report.bge.json');
const BASE_NAME = process.env.BASE_NAME || 'all-MiniLM-L6-v2 (current)';
const CAND_NAME = process.env.CAND_NAME || 'bge-small-en-v1.5 (candidate)';
const THRESHOLD = +(process.env.SWITCH_THRESHOLD || 1);
const OUT = EVAL + 'model-comparison.md';

const CATS = ['movies', 'tv', 'books', 'music', 'games', 'anime', 'food', 'travel'];
const num = (v) => (v == null ? '—' : `${v}%`);

async function main() {
  const base = JSON.parse(await readFile(BASE_REPORT, 'utf8'));
  const cand = JSON.parse(await readFile(CAND_REPORT, 'utf8'));
  const bO = base.overall.accuracy, cO = cand.overall.accuracy;
  const bX = base.cross?.accuracy, cX = cand.cross?.accuracy;
  const dOverall = Math.round((cO - bO) * 10) / 10;
  const dCross = (bX != null && cX != null) ? Math.round((cX - bX) * 10) / 10 : null;
  const doSwitch = dOverall >= THRESHOLD;

  const sign = (d) => (d == null ? '—' : (d > 0 ? `+${d}` : `${d}`));
  const rows = [];
  rows.push(`| bucket | ${BASE_NAME} | ${CAND_NAME} | Δ |`);
  rows.push('|---|---|---|---|');
  rows.push(`| **overall** | **${num(bO)}** | **${num(cO)}** | **${sign(dOverall)}** |`);
  rows.push(`| cross-media | ${num(bX)} | ${num(cX)} | ${sign(dCross)} |`);
  for (const c of CATS) {
    const b = base.perCategory?.[c]?.accuracy, k = cand.perCategory?.[c]?.accuracy;
    const d = (b != null && k != null) ? Math.round((k - b) * 10) / 10 : null;
    if (b != null || k != null) rows.push(`| ${c} | ${num(b)} | ${num(k)} | ${sign(d)} |`);
  }

  const verdict = doSwitch
    ? `**SWITCH → ${CAND_NAME}.** Overall accuracy improved by ${sign(dOverall)} pt (≥ ${THRESHOLD} pt gate).`
    : `**KEEP → ${BASE_NAME}.** The candidate did not clear the +${THRESHOLD} pt overall-accuracy gate (Δ ${sign(dOverall)}).`;

  const md = [
    '# Embedding model comparison (v3 §E4)',
    '',
    `Baseline: **${BASE_NAME}** · Candidate: **${CAND_NAME}**`,
    `Judge: ${base.judgeModel} · baseline n=${base.overall.n}, candidate n=${cand.overall.n}`,
    '',
    rows.join('\n'),
    '',
    `## Verdict`,
    '',
    verdict,
    '',
    `> Gate: switch only if the candidate\'s overall triplet accuracy beats the baseline by ≥ ${THRESHOLD} pt. ` +
    `Both models are 384-d, so a switch is a drop-in — just change \`embed.mjs\`\'s default \`EMBED_MODEL\` ` +
    `and let the next embed run rebuild \`embeddings.b64.json\`.`,
    '',
  ].join('\n');

  await writeFile(OUT, md);
  console.log(md);
  console.log(`\nwrote ${OUT}`);
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, md, { flag: 'a' });
  if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `switch=${doSwitch}\ndelta=${dOverall}\n`, { flag: 'a' });
}
main().catch((e) => { console.error(e); process.exit(1); });
