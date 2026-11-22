/* Muse — the owner's approval queue (admin.html).  Requires the ADMIN_TOKEN (header x-admin-key).
 *   GET  /api/admin                 -> submissions: pending first, then unconfirmed, then decided (14 days)
 *   POST /api/admin {id, approve}   -> approve (publishes it in the app) or reject */
import { rpc, json, sameSecret } from './_lib.mjs';

const allowed = (request) => !!process.env.ADMIN_TOKEN && sameSecret(request.headers.get('x-admin-key'), process.env.ADMIN_TOKEN);

export async function GET(request) {
  if (!allowed(request)) return json({ status: 'forbidden' }, 403);
  try { return json({ status: 'ok', items: (await rpc('muse_admin_list', {})) || [] }); }
  catch (e) { console.error(e.message); return json({ status: 'error' }, 502); }
}

export async function POST(request) {
  if (!allowed(request)) return json({ status: 'forbidden' }, 403);
  let b; try { b = await request.json(); } catch { return json({ status: 'bad' }, 400); }
  const id = Number(b && b.id);
  if (!Number.isInteger(id) || id < 1) return json({ status: 'bad' }, 400);
  try { return json(await rpc('muse_admin_decide', { p_id: id, p_approve: !!b.approve })); }
  catch (e) { console.error(e.message); return json({ status: 'error' }, 502); }
}
