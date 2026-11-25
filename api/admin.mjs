/* Muse — the owner's approval queue (admin.html).
 * Two ways in:
 *   - Google sign-in: header `Authorization: Bearer <Google ID token>`; the token must be for this app
 *     (GOOGLE_CLIENT_ID) and carry a verified e-mail listed in ADMIN_EMAILS (comma-separated).
 *   - the ADMIN_TOKEN key (header x-admin-key), kept as a fallback.
 *   GET  /api/admin?config=1         -> {googleClientId} (public: lets the page draw the Google button)
 *   GET  /api/admin                  -> submissions: pending first, then unconfirmed, then decided (14 days)
 *   POST /api/admin {id, approve}    -> approve (publishes it in the app) or reject */
import { rpc, json, sameSecret } from './_lib.mjs';

const admins = () => String(process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// Checks the ID token with Google (signature, expiry) and then audience, issuer and e-mail here.
async function googleAdmin(request) {
  const m = /^Bearer\s+([\w.-]{20,4096})$/.exec(request.headers.get('authorization') || '');
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!m || !clientId || !admins().length) return false;
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(m[1]), { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return false;
    const t = await r.json();
    return t.aud === clientId
      && (t.iss === 'accounts.google.com' || t.iss === 'https://accounts.google.com')
      && String(t.email_verified) === 'true'
      && Number(t.exp) * 1000 > Date.now()
      && admins().includes(String(t.email || '').toLowerCase());
  } catch (e) { console.error('google token check failed:', e.message); return false; }
}

async function allowed(request) {
  if (process.env.ADMIN_TOKEN && sameSecret(request.headers.get('x-admin-key'), process.env.ADMIN_TOKEN)) return true;
  return googleAdmin(request);
}

export async function GET(request) {
  if (new URL(request.url).searchParams.has('config')) return json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
  if (!(await allowed(request))) return json({ status: 'forbidden' }, 403);
  try { return json({ status: 'ok', items: (await rpc('muse_admin_list', {})) || [] }); }
  catch (e) { console.error(e.message); return json({ status: 'error' }, 502); }
}

export async function POST(request) {
  if (!(await allowed(request))) return json({ status: 'forbidden' }, 403);
  let b; try { b = await request.json(); } catch { return json({ status: 'bad' }, 400); }
  const id = Number(b && b.id);
  if (!Number.isInteger(id) || id < 1) return json({ status: 'bad' }, 400);
  try { return json(await rpc('muse_admin_decide', { p_id: id, p_approve: !!b.approve })); }
  catch (e) { console.error(e.message); return json({ status: 'error' }, 502); }
}
