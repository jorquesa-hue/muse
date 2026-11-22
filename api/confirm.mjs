/* Muse — the organizer clicks the link in the confirmation e-mail.  GET /api/confirm?t=<token>
 * Moves the submission from "unconfirmed" to "pending" (waiting for the owner's approval) and shows a page. */
import { rpc, sha, esc, SITE } from './_lib.mjs';

const page = (title, msg) => new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Muse — ${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff8ec;color:#1e1640;font-family:Nunito,Arial,sans-serif}
.c{max-width:420px;margin:24px;background:#fff;border:2px solid rgba(30,22,64,.11);border-radius:22px;padding:26px;text-align:center}
h1{font-size:24px;margin:8px 0}p{color:#4f4870;font-weight:600;line-height:1.5}a{display:inline-block;margin-top:10px;background:#ff3d7f;color:#fff;
text-decoration:none;font-weight:800;padding:12px 18px;border-radius:14px}</style></head>
<body><div class="c"><div style="font-size:44px">${title === 'Confirmado!' ? '🎉' : '🤔'}</div><h1>${esc(title)}</h1><p>${msg}</p>
<a href="${SITE}/">Abrir o Muse</a></div></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

export async function GET(request) {
  const t = new URL(request.url).searchParams.get('t') || '';
  if (t.length < 16 || !process.env.MUSE_FN_SECRET) return page('Link inválido', 'Este link de confirmação não é válido.');
  let r;
  try { r = await rpc('muse_confirm', { p_token_hash: sha(t) }); } catch (e) { console.error(e.message); }
  const st = r && r.status;
  if (st === 'confirmed') return page('Confirmado!', `Obrigado! <b>${esc(r.title)}</b> está na fila de revisão. Assim que for aprovado, aparece no app para as famílias da região.`);
  if (st === 'already') return page('Já confirmado', `<b>${esc(r.title)}</b> já estava confirmado e aguarda revisão (ou já foi revisado).`);
  if (st === 'expired') return page('Link expirado', 'Este link venceu (7 dias). Cadastre o evento de novo, por favor.');
  return page('Link inválido', 'Não encontramos este cadastro. Confira se copiou o link inteiro.');
}
